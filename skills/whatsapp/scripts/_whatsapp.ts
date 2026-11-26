/**
 * WhatsApp: what the connector does, on top of one Baileys connection at a time.
 *
 * The connection to WhatsApp opens only inside a call (a read or a send: connect, take in what arrived
 * while away, answer, close) or while a link waits for the person (a few minutes, then it closes).
 * Reads answer from the store (_store.ts). Every connection, reconnects included, takes a slot of the
 * limits (_limits.ts), and a call reconnects at most MAX_RECONNECTS times.
 */
import { addConnectedTime, LimitHit, minutesLeftToday, takeSlot, type LimitOpts } from "./_limits";
import { Store, type StoredChat } from "./_store";
import { isGroupJid, numberOf } from "./_messages";
import type { AuthHandle, WASocketLike } from "./_socket";

/** A refusal the agent reads: a code and plain words. */
export class Fail extends Error { constructor(public code: string, msg: string) { super(msg); } }
export const fail = (code: string, msg: string): never => { throw new Fail(code, msg); };

export interface Timings {
  openWaitMs: number; pendingWaitMs: number; settleMs: number; linkWindowMs: number;
  firstQrWaitMs: number; historyWaitMs: number; reconnectDelayMs: number;
}
export const TIMINGS: Timings = {
  openWaitMs: 30_000, pendingWaitMs: 15_000, settleMs: 1_500, linkWindowMs: 4 * 60_000,
  firstQrWaitMs: 30_000, historyWaitMs: 40_000, reconnectDelayMs: 2_000,
};
/** Reconnects one call (or one link) may make after its first connection; each takes a slot. */
export const MAX_RECONNECTS = 2;

export interface ServiceDeps {
  dataDir: string;
  openSocket(auth: AuthHandle): Promise<WASocketLike>;
  loadAuth(): Promise<AuthHandle>;
  clearAuth(): void;
  qrImage(qr: string): Promise<string>;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  timeZone?: string;
  timings?: Partial<Timings>;
}

/** WhatsApp's close codes (Baileys DisconnectReason). */
const CLOSE = { loggedOut: 401, forbidden: 403, multideviceMismatch: 411, connectionReplaced: 440, badSession: 500, restartRequired: 515 } as const;

const MAX_SEND_TEXT = 4000;
const LIST_PARAMS = ["chats", "to", "recipients", "recipient", "numbers", "number", "phone", "jid", "jids"];
const MASS_MENTION = /(^|\s)@(all|everyone|here|channel|group|members)\b/i;

type Update = { kind: "qr"; qr: string } | { kind: "open" } | { kind: "pending" } | { kind: "newLogin" } | { kind: "closed"; code: number; message: string };

/** One socket with its events fed into the store, and its connection updates queued for whoever waits. */
class Connection {
  private updates: Update[] = [];
  private waiters: Array<() => void> = [];
  historyDone = false;
  lastMessageAt = 0;
  ended = false;
  private endCalled = false;

  constructor(readonly sock: WASocketLike, auth: AuthHandle, store: Store, now: () => number) {
    const ev = sock.ev;
    ev.on("creds.update", () => { auth.saveCreds().catch(() => {}); });
    ev.on("messaging-history.set", (h: any) => {
      store.applyContacts(h?.contacts); store.applyChats(h?.chats); store.addMessages(h?.messages);
      if (h?.isLatest || h?.progress === 100) this.historyDone = true;
      this.wake();
    });
    ev.on("messages.upsert", (u: any) => { store.addMessages(u?.messages, u?.type === "notify"); this.lastMessageAt = now(); });
    ev.on("chats.upsert", (c: any) => store.applyChats(c));
    ev.on("chats.update", (c: any) => store.applyChats(c));
    ev.on("contacts.upsert", (c: any) => store.applyContacts(c));
    ev.on("contacts.update", (c: any) => store.applyContacts(c));
    ev.on("groups.upsert", (g: any) => store.applyGroups(g));
    ev.on("groups.update", (g: any) => store.applyGroups(g));
    ev.on("connection.update", (u: any) => {
      if (u?.qr) this.push({ kind: "qr", qr: u.qr });
      if (u?.isNewLogin) this.push({ kind: "newLogin" });
      if (u?.connection === "open") this.push({ kind: "open" });
      if (u?.receivedPendingNotifications) this.push({ kind: "pending" });
      if (u?.connection === "close") {
        const err = u?.lastDisconnect?.error;
        this.ended = true;
        this.push({ kind: "closed", code: Number(err?.output?.statusCode ?? 0), message: String(err?.message ?? "closed") });
      }
    });
  }

  private push(u: Update): void { this.updates.push(u); this.wake(); }
  private wake(): void { const w = this.waiters; this.waiters = []; for (const f of w) f(); }

  /** The first queued update `match` takes (removed from the queue), or null after `ms`. */
  async next(match: (u: Update) => boolean, ms: number): Promise<Update | null> {
    const deadline = Date.now() + Math.max(0, ms);
    for (;;) {
      const i = this.updates.findIndex(match);
      if (i >= 0) return this.updates.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, left); this.waiters.push(() => { clearTimeout(t); resolve(); }); });
    }
  }

  /** Waits until `done()` or `ms` passes, waking on any event. */
  async until(done: () => boolean, ms: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, ms);
    while (!done() && Date.now() < deadline) {
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, Math.min(250, deadline - Date.now())); this.waiters.push(() => { clearTimeout(t); resolve(); }); });
    }
  }

  /** Closes it; whoever waits on it wakes to a close (code 0: closed here). */
  end(): void {
    if (this.endCalled) return;
    this.endCalled = true;
    try { this.sock.end(undefined); } catch { /* already closed */ }
    if (this.ended) return;
    this.ended = true;
    this.push({ kind: "closed", code: 0, message: "closed here" });
  }
}

export type LinkPhase = "waiting" | "linked" | "expired" | "failed";
interface LinkState { mode: "code" | "qr"; phase: LinkPhase; phone?: string; code?: string; qrImage?: string; startedAt: number; endsAt: number; error?: string }

/** A link code as the person types it: K7QD-2M9X. */
export const formatCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The phone number for a link code: digits only, with the country code, 8 to 15 of them. */
export function phoneDigits(phone: unknown): string {
  const digits = String(phone ?? "").replace(/^\s*\+/, "").replace(/[\s().-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) fail("BAD_PHONE", "Give phone: the person's WhatsApp number with its country code, such as +919812345678.");
  if (digits.startsWith("0")) fail("BAD_PHONE", "The number must start with its country code (such as 91 for India), not 0.");
  return digits;
}

const masked = (digits: string) => `+${digits.slice(0, Math.max(0, digits.length - 4)).replace(/\d/g, "•")}${digits.slice(-4)}`;

/** A whole number param within [1, max], else `fallback`. */
export function count(value: unknown, fallback: number, max: number): number {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export class WhatsAppService {
  readonly store: Store;
  private readonly t: Timings;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private link: LinkState | null = null;
  private linkConn: Connection | null = null;
  private linkTask: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ServiceDeps) {
    this.store = new Store(deps.dataDir);
    this.t = { ...TIMINGS, ...deps.timings };
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get limitOpts(): LimitOpts { return { dir: this.deps.dataDir, timeZone: this.deps.timeZone }; }
  private minutesLeft(): number { try { return minutesLeftToday(this.limitOpts); } catch { return 0; } }
  private take(kind: "connect" | "send"): number { return takeSlot(kind, this.limitOpts); }
  private addTime(ms: number): void { try { addConnectedTime(ms, this.limitOpts); } catch { /* kept best effort */ } }

  /** One call at a time, in the order they came: two connections at once would be two devices fighting. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private linkWaiting(): boolean { return this.link?.phase === "waiting"; }

  /** What WhatsApp's close means for this call: give up with a reason, or (null) try again. */
  private closeOutcome(code: number, message: string): Fail | null {
    if (code === CLOSE.loggedOut || code === CLOSE.badSession || code === CLOSE.multideviceMismatch) {
      this.deps.clearAuth(); this.store.clear();
      return new Fail("NOT_LINKED", "WhatsApp is not linked any more (it was unlinked on the phone, or WhatsApp ended it). Link it again with `link`.");
    }
    if (code === CLOSE.forbidden) return new Fail("WHATSAPP_REFUSED", `WhatsApp refused this account (${message}). Tell the person; do not retry.`);
    if (code === CLOSE.connectionReplaced) return new Fail("REPLACED", "Another connection of this linked device took over. Try again later.");
    return null;
  }

  /** Connects on the saved link, takes in what arrived while away, runs `fn`, and closes. */
  private async withConnection<T>(kind: "connect" | "send", fn: (conn: Connection) => Promise<T>): Promise<T> {
    if (this.linkWaiting()) fail("LINK_WAITING", "A link is waiting for the person to type the code. Try again once it is linked.");
    if (this.linkTask) await this.linkTask;
    const auth = await this.deps.loadAuth();
    if (!auth.registered()) fail("NOT_LINKED", "WhatsApp is not linked yet. Link it with `link`.");
    for (let attempt = 0; ; attempt++) {
      const left = this.take(attempt === 0 ? kind : "connect");
      const startedAt = this.now();
      const conn = new Connection(await this.deps.openSocket(auth), auth, this.store, this.now);
      try {
        const first = await conn.next((u) => u.kind === "open" || u.kind === "closed" || u.kind === "qr", Math.min(this.t.openWaitMs, left));
        if (first?.kind === "qr") {
          this.deps.clearAuth();
          fail("NOT_LINKED", "WhatsApp asked to be linked again. Link it with `link`.");
        }
        if (first?.kind === "open") {
          await conn.next((u) => u.kind === "pending", Math.min(this.t.pendingWaitMs, left));
          await conn.until(() => this.now() - conn.lastMessageAt >= this.t.settleMs, Math.min(this.t.pendingWaitMs, left));
          this.store.markSynced(this.now());
          return await fn(conn);
        }
        const outcome = first?.kind === "closed" ? this.closeOutcome(first.code, first.message) : null;
        if (outcome) throw outcome;
        if (attempt >= MAX_RECONNECTS) {
          fail("CONNECT_FAILED", `Could not connect to WhatsApp (${first?.kind === "closed" ? `${first.code} ${first.message}` : "no answer in time"}). Try again later.`);
        }
      } finally {
        conn.end();
        this.addTime(this.now() - startedAt);
        this.store.save();
      }
      await this.sleep(this.t.reconnectDelayMs * (attempt + 1));
    }
  }

  /** Each answer says how many minutes of WhatsApp time are left today. */
  private answer<T extends Record<string, unknown>>(result: T): T & { minutesLeftToday: number } {
    return { ...result, minutesLeftToday: this.minutesLeft() };
  }

  // --- Linking ---

  private linkView(): Record<string, unknown> {
    const l = this.link;
    if (!l) return { phase: "none" };
    return {
      phase: l.phase, mode: l.mode,
      ...(l.phase === "waiting" && l.code ? { code: l.code, phone: l.phone } : {}),
      ...(l.phase === "waiting" && l.qrImage ? { qrImage: l.qrImage } : {}),
      ...(l.error ? { error: l.error } : {}),
      ...(l.phase === "waiting" ? { waitsUntil: new Date(l.endsAt).toISOString() } : {}),
    };
  }

  private cancelLink(): void {
    this.linkConn?.end();
    this.linkConn = null;
  }

  /** Starts linking: a link code for the person's number (default), or a QR code (`qr: true`). Answers
   *  as soon as the code is there; the link connection stays open a few minutes for the person. */
  async startLink(params: { phone?: unknown; qr?: unknown }): Promise<Record<string, unknown>> {
    return this.exclusive(async () => {
      if (this.linkTask && !this.linkWaiting()) await this.linkTask;
      const current = await this.deps.loadAuth();
      if (current.registered()) return this.answer({ linked: true, message: "WhatsApp is already linked. To link another number, `unlink` first." });
      const mode: "code" | "qr" = params.qr === true || params.qr === "true" ? "qr" : "code";
      const digits = mode === "code" ? phoneDigits(params.phone) : "";
      if (this.linkWaiting()) { this.cancelLink(); await this.linkTask; }
      this.deps.clearAuth();
      const auth = await this.deps.loadAuth();
      const left = this.take("connect");
      const startedAt = this.now();
      const link: LinkState = { mode, phase: "waiting", startedAt, endsAt: startedAt + Math.min(this.t.linkWindowMs, left), ...(digits ? { phone: masked(digits) } : {}) };
      const conn = new Connection(await this.deps.openSocket(auth), auth, this.store, this.now);
      try {
        const first = await conn.next((u) => u.kind === "qr" || u.kind === "closed", Math.min(this.t.firstQrWaitMs, left));
        if (first?.kind !== "qr") fail("CONNECT_FAILED", `Could not reach WhatsApp to link (${first?.kind === "closed" ? `${first.code} ${first.message}` : "no answer in time"}). Try again later.`);
        if (mode === "code") link.code = formatCode(String(await conn.sock.requestPairingCode(digits)).toUpperCase());
        else link.qrImage = await this.deps.qrImage((first as { qr: string }).qr);
      } catch (e) {
        conn.end();
        this.addTime(this.now() - startedAt);
        this.deps.clearAuth();
        throw e;
      }
      this.link = link;
      this.linkConn = conn;
      this.linkTask = this.runLink(conn, auth, startedAt).finally(() => { this.linkTask = null; });
      return this.answer({ linked: false, link: this.linkView() });
    });
  }

  /** The waiting link, in the background: QR refreshes, the pairing, WhatsApp's one restart after it,
   *  then the chat list, until linked or the window ends. */
  private async runLink(conn: Connection, auth: AuthHandle, startedAt: number): Promise<void> {
    const link = this.link!;
    let current = conn;
    let since = startedAt;
    let reconnects = 0;
    try {
      for (;;) {
        const u = await current.next(() => true, link.endsAt - this.now());
        if (!u) { if (link.phase === "waiting") { link.phase = "expired"; this.deps.clearAuth(); } return; }
        if (u.kind === "qr" && link.mode === "qr") link.qrImage = await this.deps.qrImage(u.qr);
        if (u.kind === "open") {
          link.phase = "linked";
          await current.until(() => current.historyDone, Math.min(this.t.historyWaitMs, Math.max(0, link.endsAt - this.now())));
          try { this.store.applyGroups(await current.sock.groupFetchAllParticipating?.() ?? {}); } catch { /* names from the chat list then */ }
          this.store.markSynced(this.now());
          return;
        }
        if (u.kind !== "closed") continue;
        if (current !== this.linkConn) { link.phase = link.phase === "waiting" ? "failed" : link.phase; link.error ??= "A new link was started."; return; }
        const paired = auth.registered();
        const outcome = paired && u.code === CLOSE.restartRequired ? null : this.closeOutcome(u.code, u.message);
        if (!paired && u.code !== CLOSE.restartRequired) { link.phase = "failed"; link.error = outcome?.message ?? `WhatsApp closed the link (${u.code} ${u.message}).`; this.deps.clearAuth(); return; }
        if (outcome) { link.phase = "failed"; link.error = outcome.message; return; }
        if (reconnects >= MAX_RECONNECTS) { link.phase = paired ? "linked" : "failed"; link.error = "WhatsApp did not reconnect after the link."; return; }
        reconnects++;
        current.end();
        this.addTime(this.now() - since);
        try { this.take("connect"); } catch (e) { link.phase = paired ? "linked" : "failed"; link.error = (e as Error).message; since = this.now(); return; }
        since = this.now();
        current = new Connection(await this.deps.openSocket(auth), auth, this.store, this.now);
        this.linkConn = current;
      }
    } catch (e) {
      link.phase = "failed"; link.error = String((e as Error)?.message ?? e);
    } finally {
      current.end();
      if (this.linkConn === current) this.linkConn = null;
      this.addTime(this.now() - since);
      this.store.save();
    }
  }

  /** Whether WhatsApp is linked, and how a waiting link is doing. */
  async linkStatus(): Promise<Record<string, unknown>> {
    const auth = await this.deps.loadAuth();
    return this.answer({ linked: auth.registered() && this.link?.phase !== "waiting", link: this.linkView(), chats: this.store.chatCount });
  }

  /** Unlinks: logs this device out of WhatsApp when it can, then forgets the link and every stored chat. */
  async unlink(): Promise<Record<string, unknown>> {
    return this.exclusive(async () => {
      this.cancelLink();
      if (this.linkTask) await this.linkTask;
      this.link = null;
      const auth = await this.deps.loadAuth();
      let loggedOut = false;
      let note: string | undefined;
      if (auth.registered()) {
        try {
          await this.withConnection("connect", async (conn) => { await conn.sock.logout(); loggedOut = true; });
        } catch (e) {
          note = `Could not tell WhatsApp (${(e as Error).message}); the link was forgotten here. The person can remove "Chrome (Flock)" in Linked devices on their phone.`;
        }
      }
      this.deps.clearAuth();
      this.store.clear();
      return this.answer({ unlinked: true, loggedOut, ...(note ? { note } : {}) });
    });
  }

  // --- Reads ---

  /** A fresh read: connect for what arrived since, unless a link just filled the store. */
  private async refresh(): Promise<void> {
    await this.withConnection("connect", async () => undefined);
  }

  async listChats(params: { max?: unknown }): Promise<Record<string, unknown>> {
    return this.exclusive(async () => {
      await this.refresh();
      const chats = this.store.listChats(count(params.max, 20, 50));
      return this.answer({ chats, ...(chats.length ? {} : { note: "No chats yet: WhatsApp sends the chat list just after linking, and new messages as they come." }) });
    });
  }

  /** The one chat named exactly `name`, or a refusal. */
  private chatNamed(name: string): StoredChat {
    const found = this.store.findChats(name);
    if (found.length === 0) fail("CHAT_NOT_FOUND", `No chat named exactly "${name}". Use the name exactly as list-chats or search shows it. Only existing chats can be read or sent to.`);
    if (found.length > 1) fail("CHAT_AMBIGUOUS", `${found.length} chats are named "${name}". Ask the person which one they mean (one is ${found.map((c) => numberOf(c.jid)).join(", ")}).`);
    return found[0];
  }

  async readChat(params: { chat?: unknown; count?: unknown }): Promise<Record<string, unknown>> {
    const name = text(params.chat);
    if (!name || Array.isArray(params.chat)) fail("MISSING_PARAM", "Give chat: the chat's exact name as list-chats shows it.");
    const n = count(params.count, 10, 30);
    return this.exclusive(async () => {
      await this.refresh();
      const chat = this.chatNamed(name);
      const messages = chat.messages.slice(-n).map((m) => ({
        from: m.from, time: new Date(m.at).toISOString(), text: m.text, mine: m.mine, ...(m.media ? { media: m.media } : {}),
      }));
      const thin = messages.length < n;
      return this.answer({ chat: chat.name, kind: chat.kind, messages, ...(thin ? { note: "These are all the messages here: only a few from before WhatsApp was linked, then everything since." } : {}) });
    });
  }

  async search(params: { query?: unknown; max?: unknown }): Promise<Record<string, unknown>> {
    const query = text(params.query);
    if (!query) fail("MISSING_PARAM", "Give query: the words to look for.");
    return this.exclusive(async () => {
      await this.refresh();
      return this.answer({ query, ...this.store.search(query, count(params.max, 10, 30)) });
    });
  }

  // --- Sending ---

  /** One text message to one existing chat, by its exact name. */
  async sendMessage(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (Array.isArray(params.chat) || LIST_PARAMS.some((p) => p in params)) fail("ONE_RECIPIENT", "One existing chat per send: give chat as one chat's name. Lists, broadcasts and new numbers are never sent to.");
    const name = text(params.chat);
    const message = typeof params.text === "string" ? params.text.replace(/\r\n/g, "\n").trim() : "";
    if (!name) fail("MISSING_PARAM", "Give chat: the chat's exact name as list-chats shows it.");
    if (!message) fail("MISSING_PARAM", "Give text: the message the person approved.");
    if (message.length > MAX_SEND_TEXT) fail("TOO_LONG", `The message is ${message.length} characters; at most ${MAX_SEND_TEXT}.`);
    if (MASS_MENTION.test(message)) fail("MASS_MENTION", "Messages that mention everyone in a group are never sent.");
    return this.exclusive(async () => {
      return this.withConnection("send", async (conn) => {
        const chat = this.chatNamed(name);
        let sent: any;
        try {
          sent = await conn.sock.sendMessage(chat.jid, { text: message, linkPreview: null });
        } catch (e) {
          fail("SEND_FAILED", `WhatsApp did not take the message (${(e as Error).message}). It may not have gone out: read the chat before sending again.`);
        }
        if (sent?.key) this.store.addMessages([{ ...sent, key: { ...sent.key, fromMe: true } }]);
        return this.answer({ chat: chat.name, kind: isGroupJid(chat.jid) ? "group" : "person", sent: true, message: "Sent." });
      });
    });
  }
}

/** A refusal as the agent gets it. */
export function failureOf(e: unknown): { error: string; message: string } {
  if (e instanceof Fail || e instanceof LimitHit) return { error: e.code, message: e.message };
  return { error: "SERVER_ERROR", message: String((e as Error)?.message ?? e) };
}
