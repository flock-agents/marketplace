// WhatsApp skill: the read and send limits (_limits.ts), kept in a file so they hold across runs.
// Each test gets its own data folder; `now` is passed in, so no test waits.
//
// Run: bun test tests/whatsapp.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LIMITS, LimitHit, cachedRead, keepRead, forgetRead, takeReadSlot, takeSendSlot, chatKey, textHash } from "../../skills/whatsapp/scripts/_limits";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
let dir = "";

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wa-limits-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** The refusal `fn` throws, or null when it does not. */
function refusal(fn: () => unknown): LimitHit | null {
  try { fn(); return null; } catch (e) { if (e instanceof LimitHit) return e; throw e; }
}

describe("reads", () => {
  it("allow 20 an hour, then refuse with when the next frees up", () => {
    for (let i = 0; i < LIMITS.readsPerHour; i++) takeReadSlot({ dir, now: T0 + i * MIN });
    const hit = refusal(() => takeReadSlot({ dir, now: T0 + 30 * MIN }));
    expect(hit?.code).toBe("READ_LIMIT_HOUR");
    expect(hit?.freesAt).toBe(T0 + HOUR);
    expect(hit?.message).toContain("frees up in about 30 minutes");
    expect(refusal(() => takeReadSlot({ dir, now: T0 + HOUR }))).toBeNull();
  });

  it("allow 100 a day", () => {
    for (let h = 0; h < 5; h++) for (let i = 0; i < 20; i++) takeReadSlot({ dir, now: T0 + h * HOUR + i * MIN });
    const hit = refusal(() => takeReadSlot({ dir, now: T0 + 6 * HOUR }));
    expect(hit?.code).toBe("READ_LIMIT_DAY");
    expect(hit?.freesAt).toBe(T0 + 24 * HOUR);
  });

  it("keep a read for 10 minutes, with its age, and forget it after", () => {
    keepRead("chat:mom", { chat: "Mom", messages: [] }, { dir, now: T0 });
    expect(cachedRead("chat:mom", { dir, now: T0 + 4 * MIN })).toEqual({ result: { chat: "Mom", messages: [] }, ageSeconds: 240 });
    expect(cachedRead("chat:mom", { dir, now: T0 + 10 * MIN })).toBeNull();
    keepRead("chat:mom", { chat: "Mom", messages: [] }, { dir, now: T0 });
    forgetRead("chat:mom", { dir, now: T0 + MIN });
    expect(cachedRead("chat:mom", { dir, now: T0 + 2 * MIN })).toBeNull();
  });

  it("hold across runs: the state is a file in the skill's data folder", () => {
    takeReadSlot({ dir, now: T0 });
    const state = JSON.parse(readFileSync(join(dir, "whatsapp", "limits.json"), "utf8"));
    expect(state.reads).toEqual([T0]);
  });

  it("refuse without a data folder rather than run unlimited", () => {
    const before = process.env.SKILL_DATA_DIR;
    delete process.env.SKILL_DATA_DIR;
    try { expect(refusal(() => takeReadSlot({ now: T0 }))?.code).toBe("NO_DATA_DIR"); }
    finally { if (before !== undefined) process.env.SKILL_DATA_DIR = before; }
  });
});

describe("sends", () => {
  it("are at least a minute apart", () => {
    takeSendSlot("Mom", "hi", { dir, now: T0 });
    const hit = refusal(() => takeSendSlot("Mom", "hello again", { dir, now: T0 + 30_000 }));
    expect(hit?.code).toBe("SEND_TOO_SOON");
    expect(hit?.freesAt).toBe(T0 + MIN);
    expect(refusal(() => takeSendSlot("Mom", "hello again", { dir, now: T0 + MIN }))).toBeNull();
  });

  it("allow 5 an hour and 20 a day", () => {
    for (let i = 0; i < 5; i++) takeSendSlot("Mom", `message ${i}`, { dir, now: T0 + i * 2 * MIN });
    expect(refusal(() => takeSendSlot("Mom", "message 5", { dir, now: T0 + 20 * MIN }))?.code).toBe("SEND_LIMIT_HOUR");
    for (let h = 1; h < 4; h++) for (let i = 0; i < 5; i++) takeSendSlot("Mom", `m ${h} ${i}`, { dir, now: T0 + h * 2 * HOUR + i * 2 * MIN });
    const hit = refusal(() => takeSendSlot("Mom", "one more", { dir, now: T0 + 8 * HOUR }));
    expect(hit?.code).toBe("SEND_LIMIT_DAY");
    expect(hit?.freesAt).toBe(T0 + 24 * HOUR);
  });

  it("never send the same text to a second chat within 24 hours (case and spacing aside)", () => {
    takeSendSlot("Mom", "Happy Diwali!", { dir, now: T0 });
    const hit = refusal(() => takeSendSlot("Dad", "  happy   diwali! ", { dir, now: T0 + 2 * HOUR }));
    expect(hit?.code).toBe("SAME_TEXT_OTHER_CHAT");
    expect(hit?.freesAt).toBe(T0 + 24 * HOUR);
    expect(refusal(() => takeSendSlot("mom", "Happy Diwali!", { dir, now: T0 + 2 * HOUR }))).toBeNull();
    expect(refusal(() => takeSendSlot("Dad", "Happy Diwali!", { dir, now: T0 + 27 * HOUR }))).toBeNull();
  });

  it("count as a read of WhatsApp too", () => {
    for (let i = 0; i < 19; i++) takeReadSlot({ dir, now: T0 + i * 1000 });
    takeSendSlot("Mom", "hi", { dir, now: T0 + MIN });
    expect(refusal(() => takeReadSlot({ dir, now: T0 + 2 * MIN }))?.code).toBe("READ_LIMIT_HOUR");
  });

  it("keep only a hash of what was sent", () => {
    takeSendSlot("Mom", "a private note", { dir, now: T0 });
    const raw = readFileSync(join(dir, "whatsapp", "limits.json"), "utf8");
    expect(raw).not.toContain("private");
    expect(raw).toContain(textHash("a private note"));
    expect(chatKey("  Family  🏡 ")).toBe("family 🏡");
  });
});

describe("the state file", () => {
  it("a broken file starts fresh instead of failing every run", () => {
    takeReadSlot({ dir, now: T0 });
    writeFileSync(join(dir, "whatsapp", "limits.json"), "{not json");
    expect(refusal(() => takeReadSlot({ dir, now: T0 + MIN }))).toBeNull();
  });

  it("a lock left by a run that died is taken over after 30 seconds", () => {
    takeReadSlot({ dir, now: T0 });
    const lock = join(dir, "whatsapp", "limits.json.lock");
    writeFileSync(lock, "");
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(lock, old, old);
    expect(refusal(() => takeReadSlot({ dir, now: T0 + MIN }))).toBeNull();
    expect(existsSync(lock)).toBe(false);
  });
});
