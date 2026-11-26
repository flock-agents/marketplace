// WhatsApp connector: the safety limits (_limits.ts), kept in the connection's data folder so they hold
// across calls and restarts. Sessions (6 an hour, 40 a day), connected time (2 hours a calendar day in the
// Flock's timezone), the runaway guard (120 calls an hour), sends (20 an hour, 100 a day, 5 s apart),
// different chats (10 an hour, 30 a day), the same text (3 chats a day), and the pause. Each test gets
// its own data folder; `now` is passed in, so no test waits.
//
// Run: bun test tests/whatsapp.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  LIMITS, LimitHit, takeSession, takeCall, reserveSend, addConnectedTime, minutesLeftToday, connectedMsLeft, nextMidnight, dayOf,
  timeZoneOf, textHash, pause, clearPause, pausedState, noteConnect,
} from "../../skills/whatsapp/server/_limits";

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
let dir = "";

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wa-limits-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** The refusal `fn` throws, or null when it does not. */
function refusal(fn: () => unknown): LimitHit | null {
  try { fn(); return null; } catch (e) { if (e instanceof LimitHit) return e; throw e; }
}
const at = (now: number, timeZone = "UTC") => ({ dir, now, timeZone });
const state = () => JSON.parse(readFileSync(join(dir, "limits.json"), "utf8"));
/** A send at `now` with no pacing, so counting tests need not space their sends. */
const send = (chat: string, text: string, now: number) => reserveSend(chat, text, { ...at(now), gapMs: 0 });

describe("sessions", () => {
  it("allow 6 a rolling hour, then refuse until the oldest ages out", () => {
    for (let i = 0; i < LIMITS.sessionsPerHour; i++) takeSession(at(T0 + i * MIN));
    const hit = refusal(() => takeSession(at(T0 + 30 * MIN)));
    expect(hit?.code).toBe("SESSION_LIMIT_HOUR");
    expect(hit?.freesAt).toBe(T0 + HOUR);
    expect(hit?.message).toContain("frees up in about 30 minutes");
    expect(refusal(() => takeSession(at(T0 + HOUR)))).toBeNull();
  });

  it("allow 40 a rolling day", () => {
    for (let i = 0; i < LIMITS.sessionsPerDay; i++) takeSession(at(T0 + Math.floor(i / 6) * HOUR + (i % 6) * MIN));
    const hit = refusal(() => takeSession(at(T0 + 7 * HOUR + 30 * MIN)));
    expect(hit?.code).toBe("SESSION_LIMIT_DAY");
    expect(hit?.freesAt).toBe(T0 + 24 * HOUR);
  });

  it("answer the connected time left today", () => {
    expect(takeSession(at(T0))).toBe(LIMITS.connectedMsPerDay);
    addConnectedTime(30 * MIN, at(T0));
    expect(takeSession(at(T0 + MIN))).toBe(LIMITS.connectedMsPerDay - 30 * MIN);
  });
});

describe("connected time", () => {
  it("allows 2 hours a calendar day, then refuses until midnight in the Flock's timezone", () => {
    addConnectedTime(LIMITS.connectedMsPerDay, at(T0, "Asia/Kolkata"));
    const hit = refusal(() => takeSession(at(T0 + MIN, "Asia/Kolkata")));
    expect(hit?.code).toBe("TIME_LIMIT_DAY");
    expect(hit?.freesAt).toBe(nextMidnight(T0 + MIN, "Asia/Kolkata"));
    expect(dayOf(hit!.freesAt, "Asia/Kolkata")).not.toBe(dayOf(T0, "Asia/Kolkata"));
    expect(refusal(() => takeSession(at(hit!.freesAt + SEC, "Asia/Kolkata")))).toBeNull();
  });

  it("adds up across connections, failed ones too, and reports what is left", () => {
    expect(addConnectedTime(20 * MIN, at(T0))).toBe(100);
    expect(addConnectedTime(-5, at(T0))).toBe(100);
    expect(minutesLeftToday(at(T0))).toBe(100);
    expect(connectedMsLeft(at(T0))).toBe(100 * MIN);
  });

  it("midnight is right in a timezone ahead of UTC and on a DST change", () => {
    expect(nextMidnight(Date.UTC(2026, 10, 25, 20, 0), "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 26, 18, 30));
    expect(nextMidnight(Date.UTC(2026, 2, 8, 6, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 9, 4, 0));
    expect(timeZoneOf({ timeZone: "Not/AZone" })).toBe("UTC");
  });
});

describe("the runaway guard", () => {
  it("allows 120 calls a rolling hour, reads included, then refuses", () => {
    for (let i = 0; i < LIMITS.callsPerHour; i++) takeCall("read-chat", at(T0 + i * 10 * SEC));
    const hit = refusal(() => takeCall("list-chats", at(T0 + 25 * MIN)));
    expect(hit?.code).toBe("CALL_LIMIT_HOUR");
    expect(hit?.message).toMatch(/looping/);
    expect(refusal(() => takeCall("list-chats", at(T0 + HOUR + SEC)))).toBeNull();
  });
});

describe("sends", () => {
  it("allow 20 a rolling hour", () => {
    for (let i = 0; i < LIMITS.sendsPerHour; i++) send("a@s.whatsapp.net", `note ${i}`, T0 + i * MIN);
    const hit = refusal(() => send("a@s.whatsapp.net", "one more", T0 + 30 * MIN));
    expect(hit?.code).toBe("SEND_LIMIT_HOUR");
    expect(hit?.freesAt).toBe(T0 + HOUR);
  });

  it("allow 100 a rolling day", () => {
    for (let h = 0; h < 5; h++) for (let i = 0; i < 20; i++) send(`c${i % 5}@s.whatsapp.net`, `h${h} n${i}`, T0 + h * HOUR + i * MIN);
    const hit = refusal(() => send("c0@s.whatsapp.net", "more", T0 + 6 * HOUR));
    expect(hit?.code).toBe("SEND_LIMIT_DAY");
  });

  it("are paced at least 5 seconds apart: the next one waits, counted at the time it goes", () => {
    expect(reserveSend("a@s.whatsapp.net", "one", at(T0))).toBe(0);
    expect(reserveSend("a@s.whatsapp.net", "two", at(T0 + 1 * SEC))).toBe(4 * SEC);
    expect(reserveSend("a@s.whatsapp.net", "three", at(T0 + 2 * SEC))).toBe(8 * SEC);
    expect(reserveSend("a@s.whatsapp.net", "four", at(T0 + 60 * SEC))).toBe(0);
    expect(state().sends.map((s: any) => s.at)).toEqual([T0, T0 + 5 * SEC, T0 + 10 * SEC, T0 + 60 * SEC]);
  });

  it("go to at most 10 different chats a rolling hour; chats already messaged still work", () => {
    for (let i = 0; i < LIMITS.chatsPerHour; i++) send(`c${i}@s.whatsapp.net`, `hello ${i}`, T0 + i * MIN);
    const hit = refusal(() => send("new@s.whatsapp.net", "hi", T0 + 20 * MIN));
    expect(hit?.code).toBe("CHAT_LIMIT_HOUR");
    expect(hit?.freesAt).toBe(T0 + HOUR);
    expect(refusal(() => send("c3@s.whatsapp.net", "again", T0 + 20 * MIN))).toBeNull();
    expect(refusal(() => send("new@s.whatsapp.net", "hi", T0 + HOUR + SEC))).toBeNull();
  });

  it("go to at most 30 different chats a rolling day", () => {
    for (let i = 0; i < LIMITS.chatsPerDay; i++) send(`c${i}@s.whatsapp.net`, `hello ${i}`, T0 + Math.floor(i / 10) * HOUR + (i % 10) * MIN);
    const hit = refusal(() => send("new@s.whatsapp.net", "hi", T0 + 5 * HOUR));
    expect(hit?.code).toBe("CHAT_LIMIT_DAY");
    expect(refusal(() => send("c0@s.whatsapp.net", "again", T0 + 5 * HOUR))).toBeNull();
  });

  it("send the same text, case and spacing aside, to at most 3 chats a day", () => {
    send("a@s.whatsapp.net", "Meeting at 5 today", T0);
    send("b@s.whatsapp.net", "meeting  at 5\ntoday ", T0 + MIN);
    send("c@s.whatsapp.net", "MEETING AT 5 TODAY", T0 + 2 * MIN);
    const hit = refusal(() => send("d@s.whatsapp.net", "Meeting at 5 today", T0 + 3 * MIN));
    expect(hit?.code).toBe("SAME_TEXT_LIMIT");
    expect(hit?.message).toMatch(/spam/);
    expect(refusal(() => send("a@s.whatsapp.net", "Meeting at 5 today", T0 + 4 * MIN))).toBeNull();
    expect(refusal(() => send("d@s.whatsapp.net", "Meeting at 6 today", T0 + 5 * MIN))).toBeNull();
    expect(refusal(() => send("d@s.whatsapp.net", "Meeting at 5 today", T0 + 24 * HOUR + 5 * MIN))).toBeNull();
  });

  it("keep only a hash of the text, never the text", () => {
    send("a@s.whatsapp.net", "Pick up the kids at 4", T0);
    const raw = readFileSync(join(dir, "limits.json"), "utf8");
    expect(raw).not.toContain("kids");
    expect(state().sends[0].text).toBe(textHash("pick up the KIDS at 4"));
  });
});

describe("the pause", () => {
  it("after a logout: every tool refuses but the status, unlink and a new link", () => {
    pause("logged_out", "WhatsApp logged this device out.", at(T0));
    for (const tool of ["list-chats", "read-chat", "search", "send-message"]) expect(refusal(() => takeCall(tool, at(T0)))?.code).toBe("PAUSED_LOGGED_OUT");
    for (const tool of ["link-status", "unlink", "link"]) expect(refusal(() => takeCall(tool, at(T0)))).toBeNull();
  });

  it("after a refusal: even a new link is refused; only unlink clears it", () => {
    pause("refused", "WhatsApp refused this account (forbidden).", at(T0));
    expect(refusal(() => takeCall("link", at(T0)))?.code).toBe("PAUSED_REFUSED");
    expect(refusal(() => takeCall("send-message", at(T0)))?.message).toMatch(/never retry/);
    expect(refusal(() => takeCall("unlink", at(T0)))).toBeNull();
    clearPause(at(T0));
    expect(pausedState(at(T0))).toBeNull();
    expect(refusal(() => takeCall("read-chat", at(T0)))).toBeNull();
  });

  it("3 failed connections in a row pause; a good one in between resets the count", () => {
    expect(noteConnect(false, "408 timed out", at(T0))).toBe(false);
    expect(noteConnect(false, "408 timed out", at(T0))).toBe(false);
    expect(noteConnect(true, "", at(T0))).toBe(false);
    expect(noteConnect(false, "408 timed out", at(T0))).toBe(false);
    expect(noteConnect(false, "408 timed out", at(T0))).toBe(false);
    expect(noteConnect(false, "408 timed out", at(T0))).toBe(true);
    expect(pausedState(at(T0))).toMatchObject({ kind: "refused" });
    expect(pausedState(at(T0))!.reason).toContain("408 timed out");
  });

  it("holds across restarts and days (kept in the data folder)", () => {
    pause("refused", "flagged", at(T0));
    expect(state().paused).toMatchObject({ kind: "refused", reason: "flagged" });
    expect(pausedState(at(T0 + 3 * 24 * HOUR))).toMatchObject({ kind: "refused" });
  });
});

describe("the state file", () => {
  it("a broken file starts fresh rather than failing every call", () => {
    writeFileSync(join(dir, "limits.json"), "{not json");
    expect(refusal(() => takeSession(at(T0)))).toBeNull();
    expect(state().sessions).toEqual([T0]);
  });

  it("wrong shapes inside are dropped, readable parts kept", () => {
    writeFileSync(join(dir, "limits.json"), JSON.stringify({ sessions: ["x", T0], sends: [{ at: "no" }, { at: T0, chat: "a", text: "h" }], usage: 5, paused: { kind: "bogus" }, failedConnects: "2" }));
    takeCall("read-chat", at(T0 + MIN));
    const s = state();
    expect(s.sessions).toEqual([T0]);
    expect(s.sends).toEqual([{ at: T0, chat: "a", text: "h" }]);
    expect(s.paused).toBeNull();
    expect(s.failedConnects).toBe(0);
  });

  it("drops what no limit looks at any more", () => {
    takeSession(at(T0));
    takeCall("read-chat", at(T0));
    send("a@s.whatsapp.net", "hi", T0);
    takeCall("read-chat", at(T0 + 25 * HOUR));
    const s = state();
    expect(s.sessions).toEqual([]);
    expect(s.sends).toEqual([]);
    expect(s.calls).toEqual([T0 + 25 * HOUR]);
  });

  it("a stale lock from a crashed call is taken over", () => {
    const lock = join(dir, "limits.json.lock");
    writeFileSync(lock, "");
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(lock, old, old);
    expect(refusal(() => takeSession(at(T0)))).toBeNull();
    expect(existsSync(lock)).toBe(false);
  });

  it("refuses to run with no data folder", () => {
    const saved = process.env.MCP_DATA_DIR;
    delete process.env.MCP_DATA_DIR;
    try { expect(refusal(() => takeSession({ now: T0 }))?.code).toBe("NO_DATA_DIR"); } finally { if (saved) process.env.MCP_DATA_DIR = saved; }
  });
});
