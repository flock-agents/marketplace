// A pretend Baileys socket and the service wired to it, for the WhatsApp connector's tests. Each test
// scripts what WhatsApp does on each connection (`script(sock, n)`, n counting from 0).
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WhatsAppService, type Timings } from "../../skills/whatsapp/server/_whatsapp";
import type { AuthHandle, WASocketLike } from "../../skills/whatsapp/server/_socket";

type Handler = (arg: any) => void;

export class MockSocket implements WASocketLike {
  private handlers = new Map<string, Handler[]>();
  ev = {
    on: (event: string, fn: Handler) => { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); },
    off: (event: string, fn: Handler) => { this.handlers.set(event, (this.handlers.get(event) ?? []).filter((f) => f !== fn)); },
  };
  user = null;
  ended = false;
  pairing: string[] = [];
  sent: Array<{ jid: string; content: Record<string, unknown> }> = [];
  loggedOut = false;
  /** Never called by the connector: a media download or a profile picture or presence ask would show here. */
  forbidden: string[] = [];
  downloadMediaMessage = () => { this.forbidden.push("downloadMediaMessage"); };
  updateMediaMessage = () => { this.forbidden.push("updateMediaMessage"); };
  profilePictureUrl = () => { this.forbidden.push("profilePictureUrl"); };
  presenceSubscribe = () => { this.forbidden.push("presenceSubscribe"); };
  sendPresenceUpdate = () => { this.forbidden.push("sendPresenceUpdate"); };
  groups: Record<string, { id: string; subject: string }> = {};
  pairingCode = "k7qd2m9x";

  emit(event: string, arg: any): void { for (const f of this.handlers.get(event) ?? []) f(arg); }
  open(): void { this.emit("connection.update", { connection: "open" }); this.emit("connection.update", { receivedPendingNotifications: true }); }
  close(code: number, message = "closed"): void {
    this.emit("connection.update", { connection: "close", lastDisconnect: { error: { message, output: { statusCode: code } } } });
  }
  qr(qr = "2@qr-ref"): void { this.emit("connection.update", { qr }); }

  async requestPairingCode(phone: string): Promise<string> { this.pairing.push(phone); return this.pairingCode; }
  async sendMessage(jid: string, content: Record<string, unknown>): Promise<any> {
    this.sent.push({ jid, content });
    return { key: { id: `S${this.sent.length}`, remoteJid: jid, fromMe: true }, message: { conversation: content.text }, messageTimestamp: Math.floor(Date.now() / 1000) };
  }
  async logout(): Promise<void> { this.loggedOut = true; }
  async groupFetchAllParticipating() { return this.groups; }
  end(): void { this.ended = true; }
}

export const FAST: Partial<Timings> = {
  openWaitMs: 300, pendingWaitMs: 100, settleMs: 5, linkWindowMs: 400, firstQrWaitMs: 300, historyWaitMs: 100, reconnectDelayMs: 1,
  idleCloseMs: 60, sendGapMs: 20, sendJitterMinMs: 1_000, sendJitterMaxMs: 3_000,
};

export interface World {
  dir: string;
  wa: WhatsAppService;
  sockets: MockSocket[];
  auth: { linked: boolean; cleared: number; saved: number };
  qrImages: string[];
  /** Every wait the service asked for (send pacing and jitter, reconnect backoff); each really waits at most 30 ms. */
  sleeps: number[];
}

/** A service on a fresh data folder. `linked`: a finished link is saved already. */
export function world(script: (sock: MockSocket, n: number, w: World) => void, opts: { linked?: boolean; timings?: Partial<Timings>; random?: () => number; now?: () => number } = {}): World {
  const dir = mkdtempSync(join(tmpdir(), "wa-service-"));
  const auth = { linked: !!opts.linked, cleared: 0, saved: 0 };
  const sockets: MockSocket[] = [];
  const qrImages: string[] = [];
  const handle = (): AuthHandle => ({ state: { creds: {}, keys: {} }, saveCreds: async () => { auth.saved++; }, registered: () => auth.linked });
  const sleeps: number[] = [];
  const w = { dir, sockets, auth, qrImages, sleeps } as World;
  w.wa = new WhatsAppService({
    dataDir: dir,
    timeZone: "UTC",
    timings: { ...FAST, ...opts.timings },
    random: opts.random ?? (() => 0.5),
    ...(opts.now ? { now: opts.now } : {}),
    sleep: (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, Math.min(ms, 30))); },
    loadAuth: async () => handle(),
    clearAuth: () => { auth.linked = false; auth.cleared++; },
    qrImage: async (qr) => { qrImages.push(qr); return `data:image/png;base64,${Buffer.from(qr).toString("base64")}`; },
    openSocket: async () => {
      const sock = new MockSocket();
      const n = sockets.length;
      sockets.push(sock);
      setTimeout(() => script(sock, n, w), 1);
      return sock;
    },
  });
  return w;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The refusal code `p` rejects with, or null. */
export async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: any) { return e?.code ?? String(e); }
}

/** A chat list and a few messages, as WhatsApp sends them when a device is linked. */
export function history(now = Date.now()) {
  const s = Math.floor(now / 1000);
  return {
    isLatest: true,
    contacts: [{ id: "919811111111@s.whatsapp.net", name: "Mom" }, { id: "919822222222@s.whatsapp.net", notify: "Ravi" }],
    chats: [
      { id: "919811111111@s.whatsapp.net", conversationTimestamp: s - 60, unreadCount: 1 },
      { id: "1203630001@g.us", name: "School Parents", conversationTimestamp: s - 120 },
      { id: "status@broadcast", conversationTimestamp: s },
    ],
    messages: [
      { key: { id: "M1", remoteJid: "919811111111@s.whatsapp.net", fromMe: false }, message: { conversation: "Dinner at 8?" }, messageTimestamp: s - 60, pushName: "Mummy" },
      { key: { id: "M2", remoteJid: "1203630001@g.us", participant: "919822222222@s.whatsapp.net", fromMe: false }, pushName: "Ravi",
        message: { imageMessage: { caption: "Sports day notice", url: "https://mmg.whatsapp.net/x", mediaKey: "k", fileLength: 120000 } }, messageTimestamp: s - 130 },
      { key: { id: "M3", remoteJid: "1203630001@g.us", participant: "919822222222@s.whatsapp.net", fromMe: false }, pushName: "Ravi",
        message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "circular.pdf", fileLength: { low: 2048, high: 0 }, url: "https://mmg.whatsapp.net/y" } } } }, messageTimestamp: s - 120 },
      { key: { id: "M4", remoteJid: "status@broadcast", participant: "919822222222@s.whatsapp.net" }, message: { conversation: "my status" }, messageTimestamp: s },
      { key: { id: "M5", remoteJid: "919811111111@s.whatsapp.net" }, message: { reactionMessage: { text: "👍" } }, messageTimestamp: s },
    ],
  };
}

/** A linked world whose every connection opens and gets `history` once. */
export function linkedWorld(onSock?: (sock: MockSocket, n: number) => void): World {
  return world((sock, n) => {
    sock.open();
    if (n === 0) sock.emit("messaging-history.set", history());
    onSock?.(sock, n);
  }, { linked: true });
}
