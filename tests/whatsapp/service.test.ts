// WhatsApp connector: what the server does on a (pretend) Baileys socket. Linking with a link code or a
// QR code, the reconnect cap, the store and its placeholders, the limits, and the send's safety checks.
//
// Run: bun test tests/whatsapp.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { MAX_RECONNECTS, MAX_SESSION_RECONNECTS, closeKind, formatCode, isTransportFailure, phoneDigits } from "../../skills/whatsapp/server/_whatsapp";
import { LIMITS, pause } from "../../skills/whatsapp/server/_limits";
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
    expect(limits(w).sessions.length).toBe(1);
    expect(limits(w).usage.ms).toBeGreaterThan(0);
  });

  it("a finished link clears a pause left by a logout", async () => {
    const w = track(world((sock, n, w) => {
      if (n === 0) { sock.qr(); setTimeout(() => { w.auth.linked = true; sock.close(515, "restart required"); }, 20); }
      else { sock.open(); sock.emit("messaging-history.set", history()); }
    }));
    pause("logged_out", "WhatsApp logged this device out.", { dir: w.dir, timeZone: "UTC" });
    await w.wa.startLink({ phone: "919812345678" });
    for (let i = 0; i < 50 && (await w.wa.linkStatus() as any).link.phase === "waiting"; i++) await sleep(10);
    await sleep(50);
    expect(limits(w).paused).toBeNull();
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

describe("connecting for a read: one session reused while calls keep coming", () => {
  it("connects once for a run of calls, then closes after the idle minutes", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.listChats({});
    expect(out.chats.map((c: any) => c.name)).toEqual(["Mom", "School Parents"]);
    await w.wa.readChat({ chat: "Mom" });
    await w.wa.search({ query: "sports" });
    expect(w.sockets.length).toBe(1);
    expect(w.sockets[0].ended).toBe(false);
    expect(limits(w).sessions.length).toBe(1);
    expect(limits(w).calls.length).toBe(3);
    await sleep(150);
    expect(w.sockets[0].ended).toBe(true);
    expect(limits(w).usage.ms).toBeGreaterThan(0);
    expect(typeof out.minutesLeftToday).toBe("number");
  });

  it("each call pushes the idle close back", async () => {
    const w = track(world((sock, n) => { sock.open(); if (n === 0) sock.emit("messaging-history.set", history()); }, { linked: true, timings: { idleCloseMs: 400 } }));
    await w.wa.listChats({});
    for (let i = 0; i < 4; i++) { await sleep(200); await w.wa.readChat({ chat: "Mom" }); }
    expect(w.sockets[0].ended).toBe(false);
    expect(w.sockets.length).toBe(1);
  });

  it("after the idle close the next call is a new session", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    await sleep(150);
    await w.wa.listChats({});
    expect(w.sockets.length).toBe(2);
    expect(limits(w).sessions.length).toBe(2);
  });

  it("stops at 6 sessions an hour, naming when it frees up", async () => {
    const w = track(linkedWorld());
    for (let i = 0; i < LIMITS.sessionsPerHour; i++) { await w.wa.listChats({}); await w.wa.shutdown(); }
    const err = await w.wa.listChats({}).catch((e) => e);
    expect(err.code).toBe("SESSION_LIMIT_HOUR");
    expect(err.message).toMatch(/frees up in about/);
  });

  it("a connection dropped inside a session (a lease move) reconnects without a new session", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    w.sockets[0].close(428, "connection lost");
    await w.wa.readChat({ chat: "Mom" });
    expect(w.sockets.length).toBe(2);
    expect(limits(w).sessions.length).toBe(1);
  });

  it(`after ${MAX_SESSION_RECONNECTS} drops in one session the next call counts as a new session`, async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    for (let i = 0; i < MAX_SESSION_RECONNECTS; i++) { w.sockets.at(-1)!.close(428, "connection lost"); await w.wa.listChats({}); }
    expect(limits(w).sessions.length).toBe(1);
    w.sockets.at(-1)!.close(428, "connection lost");
    await w.wa.listChats({});
    expect(limits(w).sessions.length).toBe(2);
  });

  it("reconnects at most MAX_RECONNECTS times in one call, then gives up; one session counted", async () => {
    const w = track(world((sock) => sock.close(408, "timed out"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(w.sockets.length).toBe(1 + MAX_RECONNECTS);
    expect(limits(w).sessions.length).toBe(1);
    expect(limits(w).failedConnects).toBe(1);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
  });

  it("a connection that never answers counts its time and is closed", async () => {
    const w = track(world(() => {}, { linked: true }));
    expect(await codeOf(w.wa.readChat({ chat: "Mom" }))).toBe("CONNECT_FAILED");
    expect(w.sockets.length).toBe(1 + MAX_RECONNECTS);
    expect(limits(w).usage.ms).toBeGreaterThan(0);
  });

  it("not linked: refused without connecting", async () => {
    const w = track(world(() => {}));
    expect(await codeOf(w.wa.search({ query: "x" }))).toBe("NOT_LINKED");
    expect(w.sockets.length).toBe(0);
  });

  it("shutdown closes an open session and counts its time", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    await w.wa.shutdown();
    expect(w.sockets[0].ended).toBe(true);
    expect(limits(w).usage.ms).toBeGreaterThan(0);
  });
});

describe("when WhatsApp pushes back: pause, never retry", () => {
  it("logged out on the phone: the link and the stored chats are forgotten, tools pause until a new link", async () => {
    const w = track(world((sock) => sock.close(401, "logged out"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("NOT_LINKED");
    expect(w.sockets.length).toBe(1);
    expect(w.auth.linked).toBe(false);
    expect(w.wa.store.chatCount).toBe(0);
    expect(limits(w).paused).toMatchObject({ kind: "logged_out" });
    expect(await codeOf(w.wa.readChat({ chat: "Mom" }))).toBe("PAUSED_LOGGED_OUT");
    expect(w.sockets.length).toBe(1);
    expect((await w.wa.linkStatus() as any).paused).toMatchObject({ kind: "logged_out" });
  });

  it("logged out while the session sat idle: found on the next call, no reconnect", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    w.sockets[0].close(401, "logged out");
    expect(await codeOf(w.wa.listChats({}))).toBe("NOT_LINKED");
    expect(w.sockets.length).toBe(1);
    expect(limits(w).paused).toMatchObject({ kind: "logged_out" });
  });

  it("a refused account pauses everything, even a new link; only unlink clears it, without contacting WhatsApp", async () => {
    const w = track(world((sock) => sock.close(403, "forbidden"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("WHATSAPP_REFUSED");
    expect(w.sockets.length).toBe(1);
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "hi" }))).toBe("PAUSED_REFUSED");
    expect(await codeOf(w.wa.startLink({ phone: "919812345678" }))).toBe("PAUSED_REFUSED");
    expect(w.sockets.length).toBe(1);
    const out: any = await w.wa.unlink();
    expect(out).toMatchObject({ unlinked: true, loggedOut: false });
    expect(out.note).toMatch(/paused/);
    expect(w.sockets.length).toBe(1);
    expect(limits(w).paused).toBeNull();
  });

  it("3 failed calls in a row pause WhatsApp; the 4th call never connects", async () => {
    const w = track(world((sock) => sock.close(408, "timed out"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(await codeOf(w.wa.listChats({}))).toBe("WHATSAPP_REFUSED");
    const made = w.sockets.length;
    expect(await codeOf(w.wa.listChats({}))).toBe("PAUSED_REFUSED");
    expect(w.sockets.length).toBe(made);
  });

  it("a link the phone confirmed clears a logout pause even when WhatsApp's restart then fails to reconnect", async () => {
    const w = track(world((sock, n, w) => {
      if (n === 0) { sock.qr(); setTimeout(() => { w.auth.linked = true; sock.close(515, "restart required"); }, 20); }
      else sock.close(428, "connection lost");
    }));
    pause("logged_out", "WhatsApp logged this device out.", { dir: w.dir, timeZone: "UTC" });
    await w.wa.startLink({ phone: "919812345678" });
    for (let i = 0; i < 50 && (await w.wa.linkStatus() as any).link.phase === "waiting"; i++) await sleep(10);
    const status: any = await w.wa.linkStatus();
    expect(status.link.phase).toBe("linked");
    expect(status.paused).toBeUndefined();
    expect(w.sockets.length).toBe(1 + MAX_RECONNECTS);
  });

  it("an account refused while a link waits pauses everything, a new link too", async () => {
    const w = track(world((sock) => { sock.qr(); setTimeout(() => sock.close(403, "forbidden"), 20); }));
    await w.wa.startLink({ phone: "919812345678" });
    await sleep(80);
    expect((await w.wa.linkStatus() as any).link.phase).toBe("failed");
    expect(limits(w).paused).toMatchObject({ kind: "refused" });
    expect(await codeOf(w.wa.startLink({ phone: "919812345678" }))).toBe("PAUSED_REFUSED");
    expect(w.sockets.length).toBe(1);
  });

  it("a link refused at once pauses; one that cannot connect 3 times in a row pauses too, never looping", async () => {
    const refused = track(world((sock) => sock.close(403, "forbidden")));
    expect(await codeOf(refused.wa.startLink({ phone: "919812345678" }))).toBe("WHATSAPP_REFUSED");
    expect(limits(refused).paused).toMatchObject({ kind: "refused" });
    expect(refused.sockets.every((s) => s.ended)).toBe(true);
    const failing = track(world((sock) => sock.close(408, "timed out")));
    expect(await codeOf(failing.wa.startLink({ qr: true }))).toBe("CONNECT_FAILED");
    expect(await codeOf(failing.wa.startLink({ qr: true }))).toBe("CONNECT_FAILED");
    expect(await codeOf(failing.wa.startLink({ qr: true }))).toBe("WHATSAPP_REFUSED");
    expect(await codeOf(failing.wa.startLink({ qr: true }))).toBe("PAUSED_REFUSED");
    expect(failing.sockets.length).toBe(3);
  });

  it("a link that gets its QR code resets the failed-connection count", async () => {
    let n = 0;
    const w = track(world((sock) => { if (n++ === 1) sock.qr(); else sock.close(408, "timed out"); }));
    expect(await codeOf(w.wa.startLink({ qr: true }))).toBe("CONNECT_FAILED");
    expect(await codeOf(w.wa.startLink({ qr: true }))).toBeNull();
    expect(limits(w).failedConnects).toBe(0);
  });

  it("a WebSocket that cannot connect (code 500 or an HTTP status from the egress) is a failed connect, never a logout", async () => {
    for (const [code, message] of [[500, "WebSocket Error (WebSocket connection to 'wss://web.whatsapp.com/ws/chat' failed: Failed to connect)"], [500, "WebSocket Error (Proxy connection failed)"], [403, "WebSocket Error (Unexpected server response: 403)"]] as const) {
      const linking = track(world((sock) => sock.close(code, message)));
      expect(await codeOf(linking.wa.startLink({ qr: true }))).toBe("CONNECT_FAILED");
      expect(limits(linking).paused).toBeNull();
      expect(limits(linking).failedConnects).toBe(1);
      expect(await codeOf(linking.wa.listChats({}))).toBe("NOT_LINKED");
      const linked = track(world((sock) => sock.close(code, message), { linked: true }));
      expect(await codeOf(linked.wa.listChats({}))).toBe("CONNECT_FAILED");
      expect(linked.auth.linked).toBe(true);
      expect(linked.auth.cleared).toBe(0);
      expect(limits(linked).paused).toBeNull();
      expect(linked.sockets.length).toBe(1 + MAX_RECONNECTS);
    }
  });

  it("a 500 Failed to connect before open on a linked device keeps the link and the stored chats", async () => {
    const w = track(world((sock) => sock.close(500, "WebSocket Error (WebSocket connection to 'wss://web.whatsapp.com/ws/chat' failed: Failed to connect)"), { linked: true }));
    w.wa.store.addMessages(history().messages);
    const chats = w.wa.store.chatCount;
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(w.auth.cleared).toBe(0);
    expect(w.wa.store.chatCount).toBe(chats);
    expect(limits(w).paused).toBeNull();
  });

  it("a 500 with a transport message after the session was open reconnects, the link kept", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    w.sockets[0].close(500, "WebSocket Error (socket hang up)");
    expect(await codeOf(w.wa.readChat({ chat: "Mom" }))).toBeNull();
    expect(w.sockets.length).toBe(2);
    expect(w.auth.cleared).toBe(0);
    expect(limits(w).paused).toBeNull();
  });

  it("a bad session WhatsApp reports during the handshake, before open, forgets the link and pauses", async () => {
    const w = track(world((sock) => sock.close(500, "Stream Errored (bad-session)"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("NOT_LINKED");
    expect(w.auth.linked).toBe(false);
    expect(limits(w).paused).toMatchObject({ kind: "logged_out" });
    expect(w.sockets.length).toBe(1);
  });

  it("Baileys' own 500 (Cancelled) is a failed connect: the link kept", async () => {
    const w = track(world((sock) => sock.close(500, "Cancelled"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("CONNECT_FAILED");
    expect(w.auth.cleared).toBe(0);
    expect(limits(w).paused).toBeNull();
  });

  it("a real bad session (500 on an open connection, WhatsApp's own words) still forgets the link and pauses", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    w.sockets[0].close(500, "Stream Errored (bad-session)");
    expect(await codeOf(w.wa.listChats({}))).toBe("NOT_LINKED");
    expect(w.auth.linked).toBe(false);
    expect(w.wa.store.chatCount).toBe(0);
    expect(limits(w).paused).toMatchObject({ kind: "logged_out" });
    expect(w.sockets.length).toBe(1);
  });

  it("another device taking over is reported, not fought over", async () => {
    const w = track(world((sock) => sock.close(440, "replaced"), { linked: true }));
    expect(await codeOf(w.wa.listChats({}))).toBe("REPLACED");
    expect(w.sockets.length).toBe(1);
  });
});

describe("what a close means (closeKind)", () => {
  const transport = [
    "WebSocket Error (WebSocket connection to 'wss://web.whatsapp.com/ws/chat' failed: Failed to connect)",
    "WebSocket Error (WebSocket connection to 'wss://web.whatsapp.com/ws/chat' failed: Proxy connection failed)",
    "WebSocket Error (Unexpected server response: 403)", "connect ECONNREFUSED 127.0.0.1:443", "read ECONNRESET", "connect ETIMEDOUT",
    "getaddrinfo ENOTFOUND web.whatsapp.com", "getaddrinfo EAI_AGAIN web.whatsapp.com", "socket hang up", "TLS handshake failed", "unable to verify the first certificate",
  ];
  it("knows each transport message shape, and WhatsApp's own words are none", () => {
    for (const m of transport) expect(`${m}: ${isTransportFailure(m)}`).toBe(`${m}: true`);
    for (const m of ["Stream Errored (bad-session)", "Stream Errored (conflict)", "Connection Failure", "Intentional Logout", "Connection Terminated"]) expect(`${m}: ${isTransportFailure(m)}`).toBe(`${m}: false`);
  });

  it("a 500 ends the link only as WhatsApp's stream error, before or after open; Baileys' own 500s and transport failures never", () => {
    for (const m of transport) expect(closeKind(500, m)).toBe("failed");
    expect(closeKind(500, "Stream Errored (bad-session)")).toBe("logged_out");
    expect(closeKind(500, "Stream Errored (WebSocket Error (socket hang up))")).toBe("failed");
    for (const m of ["Cancelled", "All encryptions failed", "Media upload failed on all hosts", "Connection Failure"]) expect(`${m}: ${closeKind(500, m)}`).toBe(`${m}: failed`);
  });

  it("401 and 411 are a logout either way; 403 a refusal unless the network gave it; 440 replaced; the rest a failed connect", () => {
    expect(closeKind(401, "Connection Failure")).toBe("logged_out");
    expect(closeKind(411, "Multidevice mismatch")).toBe("logged_out");
    expect(closeKind(403, "Connection Failure")).toBe("refused");
    expect(closeKind(403, "WebSocket Error (Unexpected server response: 403)")).toBe("failed");
    expect(closeKind(440, "Stream Errored (conflict)")).toBe("replaced");
    for (const code of [0, 408, 428, 503, 515]) expect(closeKind(code, "x")).toBe("failed");
  });
});

describe("the runaway guard", () => {
  it("refuses the 121st call in an hour without connecting", async () => {
    const w = track(linkedWorld());
    const now = Date.now();
    writeFileSync(join(w.dir, "limits.json"), JSON.stringify({ calls: Array.from({ length: LIMITS.callsPerHour }, (_, i) => now - i * 1000) }));
    expect(await codeOf(w.wa.listChats({}))).toBe("CALL_LIMIT_HOUR");
    expect(w.sockets.length).toBe(0);
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

  it("new messages that arrive while the session is open are added and read on the next call", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    w.sockets[0].emit("messages.upsert", { type: "notify", messages: [{ key: { id: "N1", remoteJid: "919811111111@s.whatsapp.net" }, message: { extendedTextMessage: { text: "Call me" } }, messageTimestamp: Math.floor(Date.now() / 1000) }] });
    const out: any = await w.wa.readChat({ chat: "Mom" });
    expect(out.messages.at(-1).text).toBe("Call me");
  });

  it("two chats with one name: refused, without giving out their numbers", async () => {
    const w = track(linkedWorld());
    w.wa.store.applyContacts([{ id: "919833333333@s.whatsapp.net", name: "Mom" }]);
    w.wa.store.applyChats([{ id: "919833333333@s.whatsapp.net", conversationTimestamp: Math.floor(Date.now() / 1000) }]);
    const err = await w.wa.readChat({ chat: "Mom" }).catch((e) => e);
    expect(err.code).toBe("CHAT_AMBIGUOUS");
    expect(err.message).not.toMatch(/\d{6,}/);
  });

  it("a broken chat in the saved store is dropped; the rest still reads", async () => {
    const w0 = track(linkedWorld());
    await w0.wa.listChats({});
    w0.wa.shutdown();
    const saved = JSON.parse(readFileSync(join(w0.dir, "store.json"), "utf8"));
    saved.chats["bad@s.whatsapp.net"] = null;
    saved.chats["worse@s.whatsapp.net"] = { jid: "worse@s.whatsapp.net", name: "Worse", kind: "person", lastAt: 1, unread: 0, messages: "x" };
    saved.chats["919811111111@s.whatsapp.net"].messages.push({ id: 5 });
    writeFileSync(join(w0.dir, "store.json"), JSON.stringify(saved));
    const { Store } = await import("../../skills/whatsapp/server/_store");
    const store = new Store(w0.dir);
    expect(store.listChats(10).map((c) => c.name)).toEqual(["Mom", "School Parents"]);
    expect(store.findChats("Mom")[0].messages.map((m) => m.text)).toEqual(["Dinner at 8?"]);
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
    const dir = join(import.meta.dir, "../../skills/whatsapp/server");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const call of ["downloadMediaMessage", "downloadContentFromMessage", "updateMediaMessage", "profilePictureUrl", "presenceSubscribe", "sendPresenceUpdate", "fetchMessageHistory"]) {
        expect(`${f}: ${src.includes(call) ? call : ""}`).toBe(`${f}: `);
      }
    }
  });
});

describe("sending", () => {
  it("sends one text to the chat named, with no link preview, on the session's connection", async () => {
    const w = track(linkedWorld());
    const out: any = await w.wa.sendMessage({ chat: "Mom", text: "Reaching by 8 https://maps.example/x" });
    expect(out).toMatchObject({ chat: "Mom", sent: true });
    const sent = w.sockets.flatMap((s) => s.sent);
    expect(sent).toEqual([{ jid: "919811111111@s.whatsapp.net", content: { text: "Reaching by 8 https://maps.example/x", linkPreview: null } }]);
    expect(limits(w).sends.length).toBe(1);
    expect(JSON.stringify(limits(w))).not.toContain("Reaching");
    await sleep(150);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
  });

  it("refuses lists, mass mentions and a missing text before connecting, and a chat not in the list before sending", async () => {
    const w = track(linkedWorld());
    expect(await codeOf(w.wa.sendMessage({ chat: ["Mom", "Ravi"], text: "hi" }))).toBe("ONE_RECIPIENT");
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", to: "919800000000", text: "hi" }))).toBe("ONE_RECIPIENT");
    expect(await codeOf(w.wa.sendMessage({ chat: "School Parents", text: "@everyone meeting" }))).toBe("MASS_MENTION");
    for (const text of ["(@all) meeting", "hi,@everyone", "@Here now", "meet\n@group"]) expect(await codeOf(w.wa.sendMessage({ chat: "School Parents", text }))).toBe("MASS_MENTION");
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "  " }))).toBe("MISSING_PARAM");
    expect(await codeOf(w.wa.sendMessage({ chat: "x".repeat(3), text: "a".repeat(4001) }))).toBe("TOO_LONG");
    expect(w.sockets.length).toBe(0);
    expect(await codeOf(w.wa.sendMessage({ chat: "+919800000000", text: "hi" }))).toBe("CHAT_NOT_FOUND");
    expect(w.sockets.flatMap((s) => s.sent)).toEqual([]);
    expect(limits(w).sends).toEqual([]);
  });

  it("waits between sends: the gap plus a random 1 to 3 second pause, never a refusal", async () => {
    const w = track(world((sock, n) => { sock.open(); if (n === 0) sock.emit("messaging-history.set", history()); }, { linked: true, random: () => 0.25, timings: { sendGapMs: 5_000 } }));
    await w.wa.sendMessage({ chat: "Mom", text: "first" });
    await w.wa.sendMessage({ chat: "Mom", text: "second" });
    const waits = w.sleeps.filter((ms) => ms >= 1_000);
    expect(waits.length).toBe(2);
    expect(waits[0]).toBe(1_500);
    expect(waits[1]).toBeGreaterThan(5_000 + 1_500);
    expect(waits[1]).toBeLessThanOrEqual(1_500 + 5_000 + 1_500);
    expect(w.sockets.flatMap((s) => s.sent).length).toBe(2);
  });

  it("the pause before a send counts toward the gap after it: sends really go at least the gap plus a pause apart", async () => {
    let jitter = 0.99;
    const w = track(world((sock, n) => { sock.open(); if (n === 0) sock.emit("messaging-history.set", history()); }, { linked: true, random: () => jitter, timings: { sendGapMs: 5_000 } }));
    await w.wa.sendMessage({ chat: "Mom", text: "first" });
    jitter = 0;
    await w.wa.sendMessage({ chat: "Mom", text: "second" });
    const [a, b] = limits(w).sends.map((x: any) => x.at);
    expect(b - a).toBe(5_000 + 1_000);
  });

  it("refuses a new chat past 10 different chats in an hour, but a chat already messaged still works", async () => {
    const w = track(linkedWorld());
    const now = Date.now();
    writeFileSync(join(w.dir, "limits.json"), JSON.stringify({ sends: Array.from({ length: LIMITS.chatsPerHour }, (_, i) => ({ at: now - 60_000 * (i + 1), chat: i === 0 ? "919811111111@s.whatsapp.net" : `c${i}@s.whatsapp.net`, text: `h${i}` })) }));
    expect(await codeOf(w.wa.sendMessage({ chat: "School Parents", text: "hello" }))).toBe("CHAT_LIMIT_HOUR");
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "hello" }))).toBeNull();
  });

  it("refuses the same text to a 4th chat in a day", async () => {
    const w = track(linkedWorld());
    const now = Date.now();
    const { textHash } = await import("../../skills/whatsapp/server/_limits");
    writeFileSync(join(w.dir, "limits.json"), JSON.stringify({ sends: ["a", "b", "c"].map((c, i) => ({ at: now - 60_000 * (i + 1), chat: `${c}@s.whatsapp.net`, text: textHash("Meeting at 5") })) }));
    expect(await codeOf(w.wa.sendMessage({ chat: "Mom", text: "meeting AT 5" }))).toBe("SAME_TEXT_LIMIT");
    expect(w.sockets.flatMap((s) => s.sent)).toEqual([]);
  });

  it("stops at 20 sends an hour", async () => {
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

  it("a connection that drops during the wait sends nothing and says so", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    const realSleep = (w.wa as any).sleep;
    (w.wa as any).sleep = async (ms: number) => { w.sockets[0].close(428, "connection lost"); return realSleep(Math.min(ms, 5)); };
    const err = await w.wa.sendMessage({ chat: "Mom", text: "hi" }).catch((e) => e);
    expect(err.code).toBe("SEND_FAILED");
    expect(err.message).toMatch(/nothing went out/);
    expect(w.sockets.flatMap((s) => s.sent)).toEqual([]);
  });
});

describe("sessions and links overlapping", () => {
  it("an idle close that comes due while a call waits its turn leaves the session to that call", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    const hold = (w.wa as any).exclusive(() => sleep(100));
    const read = w.wa.readChat({ chat: "Mom" });
    await hold;
    await read;
    await sleep(20);
    expect(w.sockets[0].ended).toBe(false);
    expect(w.sockets.length).toBe(1);
    await sleep(100);
    expect(w.sockets[0].ended).toBe(true);
  });

  it("a link asked for while a session is open leaves it alone when WhatsApp is linked", async () => {
    const w = track(linkedWorld());
    await w.wa.listChats({});
    expect(await w.wa.startLink({ phone: "919812345678" })).toMatchObject({ linked: true });
    expect(w.sockets.length).toBe(1);
    expect(w.sockets[0].ended).toBe(false);
  });

  it("unlink while a link waits ends the link without contacting WhatsApp", async () => {
    const w = track(world((sock) => sock.qr()));
    await w.wa.startLink({ phone: "919812345678" });
    const out: any = await w.wa.unlink();
    expect(out).toMatchObject({ unlinked: true, loggedOut: false });
    expect(w.sockets.length).toBe(1);
    expect(w.sockets[0].ended).toBe(true);
    expect((await w.wa.linkStatus() as any).link.phase).toBe("none");
  });

  it("a fresh link forgets the chats of the link before it", async () => {
    const w = track(world((sock) => sock.qr()));
    w.wa.store.addMessages(history().messages);
    expect(w.wa.store.chatCount).toBeGreaterThan(0);
    await w.wa.startLink({ phone: "919812345678" });
    expect(w.wa.store.chatCount).toBe(0);
  });
});

describe("shutting down", () => {
  it("closes a link still waiting for its first QR code at once, its time counted", async () => {
    const w = track(world(() => {}));
    const link = w.wa.startLink({ phone: "919812345678" }).catch((e) => e);
    await sleep(30);
    w.wa.shutdown();
    expect(w.sockets[0].ended).toBe(true);
    expect(limits(w).usage.ms).toBeGreaterThan(0);
    await link;
  });

  it("closes a waiting link and an open session without waiting for a send in progress", async () => {
    const w = track(world((sock) => sock.qr()));
    await w.wa.startLink({ phone: "919812345678" });
    w.wa.shutdown();
    expect(w.sockets[0].ended).toBe(true);
    const sending = track(linkedWorld());
    await sending.wa.listChats({});
    (sending.wa as any).sleep = () => sleep(200);
    const send = sending.wa.sendMessage({ chat: "Mom", text: "hi" }).catch((e) => e);
    await sleep(20);
    sending.wa.shutdown();
    expect(sending.sockets[0].ended).toBe(true);
    expect(limits(sending).usage.ms).toBeGreaterThan(0);
    expect((await send).code).toBe("SEND_FAILED");
    expect(sending.sockets[0].sent).toEqual([]);
  });

  it("counts each connection's time exactly once: a link's two connections, then shutdowns and status calls", async () => {
    let clock = Date.UTC(2026, 10, 25, 9, 0, 0);
    const w = track(world((sock, n, w) => {
      if (n === 0) { sock.qr(); setTimeout(() => { clock += 10_000; w.auth.linked = true; sock.close(515, "restart required"); }, 20); }
      else { clock += 5_000; sock.open(); sock.emit("messaging-history.set", history()); }
    }, { now: () => clock, timings: { linkWindowMs: 60_000 } }));
    await w.wa.startLink({ phone: "919812345678" });
    for (let i = 0; i < 50 && (await w.wa.linkStatus() as any).link.phase === "waiting"; i++) await sleep(10);
    await sleep(50);
    expect(w.sockets.every((s) => s.ended)).toBe(true);
    expect(limits(w).usage.ms).toBe(15_000);
    w.wa.shutdown();
    w.wa.shutdown();
    await w.wa.linkStatus();
    expect(limits(w).usage.ms).toBe(15_000);
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
