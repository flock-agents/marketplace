// WhatsApp connector: what the server does on a (pretend) Baileys socket. Linking with a link code or a
// QR code, the reconnect cap, the store and its placeholders, the limits, and the send's safety checks.
//
// Run: bun test tests/whatsapp.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { MAX_RECONNECTS, formatCode, phoneDigits } from "../../skills/whatsapp/scripts/_whatsapp";
import { LIMITS } from "../../skills/whatsapp/scripts/_limits";
import { codeOf, history, linkedWorld, sleep, world, type World } from "./_mock";

const made: World[] = [];
const track = (w: World) => { made.push(w); return w; };
afterEach(() => { for (const w of made.splice(0)) rmSync(w.dir, { recursive: true, force: true }); });
const limits = (w: World) => JSON.parse(readFileSync(join(w.dir, "limits.json"), "utf8"));

describe("link with a link code", () => {
  it("answers the code for the person's number at once and keeps the link open while they type it", async () => {
    const w = track(world((sock) => sock.qr()));
    const out: any = await w.wa.startLink({ phone: "+91 98123 45678" });
    expect(out.linked).toBe(false);
    expect(out.link).toMatchObject({ phase: "waiting", mode: "code", code: "K7QD-2M9X", phone: "+••••••••5678" });
    expect(w.sockets[0].pairing).toEqual(["919812345678"]);
    expect(w.sockets[0].ended).toBe(false);
    expect(out.link.qrImage).toBeUndefined();
  });

  it("finishes after WhatsApp's restart: reconnects on the saved link, takes the chat list, then closes", async () => {
    const w = track(world((sock, n, w) => {
      if (n === 0) {
        sock.qr();
        setTimeout(() => { w.auth.linked = true; sock.close(515, "restart required"); }, 30);
      } else {
        sock.groups = { "1203630001@g.us": { id: "1203630001@g.us", subject: "School Parents" } };
        sock.open();
        sock.emit("messaging-history.set", history());
      }
    }));
    await w.wa.startLink({ phone: "919812345678" });
    for (let i = 0; i < 50 && (await w.wa.linkStatus() as any).link.phase === "waiting"; i++) await sleep(10);
    await sleep(50);
    const status: any = await w.wa.linkStatus();
    expect(status.linked).toBe(true);
    expect(status.link.phase).toBe("linked");
    expect(status.chats).toBeGreaterThan(0);
    expect(w.sockets.length).toBe(2);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
    expect(limits(w).connections.length).toBe(2);
  });

  it("expires after its window when nobody types it: closed, the half-made link forgotten", async () => {
    const w = track(world((sock) => sock.qr()));
    await w.wa.startLink({ phone: "919812345678" });
    await sleep(600);
    const status: any = await w.wa.linkStatus();
    expect(status.link.phase).toBe("expired");
    expect(status.linked).toBe(false);
    expect(w.sockets[0].ended).toBe(true);
    expect(w.auth.cleared).toBeGreaterThanOrEqual(2);
  });

  it("refuses a number without its country code, and says an existing link is there", async () => {
    expect(() => phoneDigits("09812345678")).toThrow(/country code/);
    expect(() => phoneDigits("12345")).toThrow(/WhatsApp number/);
    expect(formatCode("ABCD1234")).toBe("ABCD-1234");
    const w = track(linkedWorld());
    expect(await w.wa.startLink({ phone: "919812345678" })).toMatchObject({ linked: true });
    expect(w.sockets.length).toBe(0);
  });

  it("a read while the link waits is refused, not run on the half-made link", async () => {
    const w = track(world((sock) => sock.qr()));
    await w.wa.startLink({ phone: "919812345678" });
    expect(await codeOf(w.wa.listChats({}))).toBe("LINK_WAITING");
    expect(w.sockets.length).toBe(1);
  });

  it("a new link code ends the waiting one first", async () => {
    const w = track(world((sock) => sock.qr()));
    await w.wa.startLink({ phone: "919812345678" });
    const again: any = await w.wa.startLink({ phone: "919812345678" });
    expect(again.link.phase).toBe("waiting");
    expect(w.sockets[0].ended).toBe(true);
    expect(w.sockets[1].ended).toBe(false);
  });
});

describe("link with a QR code", () => {
  it("gives a QR picture, asks for no link code, and keeps the picture fresh as WhatsApp changes it", async () => {
    const w = track(world((sock) => { sock.qr("2@first"); setTimeout(() => sock.qr("2@second"), 20); }));
    const out: any = await w.wa.startLink({ qr: true });
    expect(out.link.mode).toBe("qr");
    expect(out.link.qrImage).toBe(`data:image/png;base64,${Buffer.from("2@first").toString("base64")}`);
    expect(w.sockets[0].pairing).toEqual([]);
    await sleep(60);
    const status: any = await w.wa.linkStatus();
    expect(status.link.qrImage).toBe(`data:image/png;base64,${Buffer.from("2@second").toString("base64")}`);
  });
});

describe("connecting for a read", () => {
  it("connects, takes in what arrived, answers and closes the connection", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.listChats({});
    expect(out.chats.map((c: any) => c.name)).toEqual(["Mom", "School Parents"]);
    expect(w.sockets.length).toBe(1);
    expect(w.sockets[0].ended).toBe(true);
    expect(limits(w).connections.length).toBe(1);
    expect(typeof out.minutesLeftToday).toBe("number");
  });

  it("reconnects at most MAX_RECONNECTS times, each taking a slot, then gives up", async () => {
    const w = track(world((sock) => sock.close(408, "timed out"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(w.sockets.length).toBe(1 + MAX_RECONNECTS);
    expect(limits(w).connections.length).toBe(1 + MAX_RECONNECTS);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
  });

  it("the cap holds across a slow drop too: a connection that never answers counts once and is closed", async () => {
    const w = track(world(() => {}, { linked: true }));
    expect(await codeOf(w.wa.readChat({ chat: "Mom" }))).toBe("CONNECT_FAILED");
    expect(w.sockets.length).toBe(1 + MAX_RECONNECTS);
  });

  it("logged out on the phone: the link and the stored chats are forgotten, no retry", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    const lo = track(world((sock) => sock.close(401, "logged out"), { linked: true }));
    expect(await codeOf(lo.wa.listChats({}))).toBe("NOT_LINKED");
    expect(lo.sockets.length).toBe(1);
    expect(lo.auth.linked).toBe(false);
    expect(lo.wa.store.chatCount).toBe(0);
  });

  it("a refused account is reported and never retried", async () => {
    const w = track(world((sock) => sock.close(403, "forbidden"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("WHATSAPP_REFUSED");
    expect(w.sockets.length).toBe(1);
  });

  it("not linked: refused without connecting", async () => {
    const w = track(world(() => {}));
    expect(await codeOf(w.wa.search({ query: "x" }))).toBe("NOT_LINKED");
    expect(w.sockets.length).toBe(0);
  });

  it("stops at the connection limit, naming when it frees up", async () => {
    const w = track(linkedWorld());
    for (let i = 0; i < LIMITS.connectionsPerHour; i++) await w.wa.listChats({});
    const err = await w.wa.listChats({}).catch((e) => e);
    expect(err.code).toBe("CONNECT_LIMIT_HOUR");
    expect(err.message).toMatch(/frees up in about/);
  });
});

describe("the store and what reads answer", () => {
  it("read-chat: the shape Flock's gate checks, oldest first, media as placeholders only", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.readChat({ chat: "school parents" });
    expect(out.chat).toBe("School Parents");
    expect(out.messages.map((m: any) => m.text)).toEqual(["[photo] Sports day notice", "[document]"]);
    expect(out.messages[0]).toMatchObject({ from: "Ravi", mine: false, media: { kind: "photo", caption: "Sports day notice", size: 120000 } });
    expect(out.messages[1].media).toEqual({ kind: "document", fileName: "circular.pdf", size: 2048 });
    for (const m of out.messages) expect(typeof m.time).toBe("string");
    expect(JSON.stringify(out)).not.toContain("mmg.whatsapp.net");
  });

  it("leaves out status updates, broadcasts and housekeeping such as reactions", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.readChat({ chat: "Mom" });
    expect(out.messages.map((m: any) => m.text)).toEqual(["Dinner at 8?"]);
    const list: any = await w.wa.listChats({});
    expect(list.chats.map((c: any) => c.name)).not.toContain("status");
  });

  it("names a person by their saved contact name over the name they gave themselves", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.listChats({});
    expect(out.chats[0]).toMatchObject({ name: "Mom", kind: "person", unread: 1, preview: "Dinner at 8?" });
  });

  it("search finds chats by name and messages by their words, in the gate's shape", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.search({ query: "SPORTS" });
    expect(out.messages).toEqual([expect.objectContaining({ chat: "School Parents", text: "[photo] Sports day notice" })]);
    const byName: any = await w.wa.search({ query: "school" });
    expect(byName.chats.map((c: any) => c.name)).toEqual(["School Parents"]);
  });

  it("new messages that arrive while connected are added and counted unread", async () => {
    const w = track(linkedWorld((sock, n) => {
      if (n === 1) sock.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "N1", remoteJid: "919811111111@s.whatsapp.net" }, message: { extendedTextMessage: { text: "Call me" } }, messageTimestamp: Math.floor(Date.now() / 1000) }] });
    }));
    await w.wa.listChats({});
    const out: any = await w.wa.readChat({ chat: "Mom" });
    expect(out.messages.at(-1).text).toBe("Call me");
  });

  it("is kept in the data folder only, capped", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    expect(readdirSync(w.dir).sort()).toEqual(["limits.json", "store.json"]);
  });
});

describe("no media is ever downloaded", () => {
  it("a read of chats full of photos and documents downloads nothing and fetches nothing", async () => {
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => { fetched++; throw new Error("no fetch"); }) as any;
    try {
      const w = track(linkedWorld());
      await w.wa.readChat({ chat: "School Parents" });
      await w.wa.search({ query: "circular" });
      expect(fetched).toBe(0);
      expect(w.sockets.flatMap((s) => s.forbidden)).toEqual([]);
    } finally { globalThis.fetch = realFetch; }
  });

  it("no script of the connector calls a media download, a profile picture or presence", () => {
    const dir = join(import.meta.dir, "../../skills/whatsapp/scripts");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const call of ["downloadMediaMessage", "downloadContentFromMessage", "updateMediaMessage", "profilePictureUrl", "presenceSubscribe", "sendPresenceUpdate", "fetchMessageHistory"]) {
        expect(`${f}: ${src.includes(call) ? call : ""}`).toBe(`${f}: `);
      }
    }
  });
});

describe("sending", () => {
  it("sends one text to the chat named, with no link preview, then closes", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.sendMessage({ chat: "Mom", text: "Reaching by 8 https://maps.example/x" });
    expect(out).toMatchObject({ chat: "Mom", sent: true });
    const sent = w.sockets.flatMap((s) => s.sent);
    expect(sent).toEqual([{ jid: "919811111111@s.whatsapp.net", content: { text: "Reaching by 8 https://maps.example/x", linkPreview: null } }]);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
    expect(limits(w).sends.length).toBe(1);
  });

  it("refuses lists, mass mentions and a missing text before connecting, and a chat not in the list before sending", async () => {
    const w = track(linkedWorld());
    expect(await codeOf(w.wa.sendMessage({ chat: ["Mom", "Ravi"], text: "hi" }))).toBe("ONE_RECIPIENT");
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", to: "919800000000", text: "hi" }))).toBe("ONE_RECIPIENT");
    expect(await codeOf(w.wa.sendMessage({ chat: "School Parents", text: "@everyone meeting" }))).toBe("MASS_MENTION");
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "  " }))).toBe("MISSING_PARAM");
    expect(await codeOf(w.wa.sendMessage({ chat: "x".repeat(3), text: "a".repeat(4001) }))).toBe("TOO_LONG");
    expect(w.sockets.length).toBe(0);
    expect(await codeOf(w.wa.sendMessage({ chat: "+919800000000", text: "hi" }))).toBe("CHAT_NOT_FOUND");
    expect(w.sockets.flatMap((s) => s.sent)).toEqual([]);
  });

  it("stops at 5 sends an hour", async () => {
    const w = track(linkedWorld());
    for (let i = 0; i < LIMITS.sendsPerHour; i++) await w.wa.sendMessage({ chat: "Mom", text: `note ${i}` });
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "one more" }))).toBe("SEND_LIMIT_HOUR");
    expect(w.sockets.flatMap((s) => s.sent).length).toBe(LIMITS.sendsPerHour);
  });

  it("a send WhatsApp did not take says it may not have gone, never that it went", async () => {
    const w = track(linkedWorld((sock) => { sock.sendMessage = async () => { throw new Error("socket closed"); }; }));
    const err = await w.wa.sendMessage({ chat: "Mom", text: "hi" }).catch((e) => e);
    expect(err.code).toBe("SEND_FAILED");
    expect(err.message).toMatch(/may not have gone out/);
  });
});

describe("unlink", () => {
  it("logs this device out and forgets the link and every chat", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    const out: any = await w.wa.unlink();
    expect(out).toMatchObject({ unlinked: true, loggedOut: true });
    expect(w.sockets.at(-1)!.loggedOut).toBe(true);
    expect(w.auth.linked).toBe(false);
    expect(w.wa.store.chatCount).toBe(0);
  });
});
