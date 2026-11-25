// WhatsApp skill: the limits (_limits.ts), kept in a file so they hold across runs. Opens of WhatsApp
// Web (10 an hour, 60 a day), minutes it is open (30 a calendar day in the Flock's timezone), sends
// (5 an hour, 20 a day). Each test gets its own data folder; `now` is passed in, so no test waits.
//
// Run: bun test tests/whatsapp.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LIMITS, LimitHit, takeSlot, addOpenTime, nextMidnight, dayOf, timeZoneOf } from "../../skills/whatsapp/scripts/_limits";

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
const at = (now: number, timeZone = "UTC") => ({ dir, now, timeZone });
const state = () => JSON.parse(readFileSync(join(dir, "whatsapp", "limits.json"), "utf8"));

describe("opens of WhatsApp Web", () => {
  it("allow 10 a rolling hour, then refuse until the oldest ages out", () => {
    for (let i = 0; i < LIMITS.opensPerHour; i++) takeSlot("read", at(T0 + i * MIN));
    const hit = refusal(() => takeSlot("read", at(T0 + 30 * MIN)));
    expect(hit?.code).toBe("OPEN_LIMIT_HOUR");
    expect(hit?.freesAt).toBe(T0 + HOUR);
    expect(hit?.message).toContain("frees up in about 30 minutes");
    expect(refusal(() => takeSlot("read", at(T0 + HOUR)))).toBeNull();
  });

  it("allow 60 a rolling day", () => {
    for (let h = 0; h < 6; h++) for (let i = 0; i < 10; i++) takeSlot("read", at(T0 + h * HOUR + i * MIN));
    const hit = refusal(() => takeSlot("read", at(T0 + 7 * HOUR)));
    expect(hit?.code).toBe("OPEN_LIMIT_DAY");
    expect(hit?.freesAt).toBe(T0 + 24 * HOUR);
  });

  it("a send counts as an open too", () => {
    for (let i = 0; i < 9; i++) takeSlot("read", at(T0 + i * 1000));
    takeSlot("send", at(T0 + MIN));
    expect(refusal(() => takeSlot("read", at(T0 + 2 * MIN)))?.code).toBe("OPEN_LIMIT_HOUR");
  });
});

describe("minutes WhatsApp Web is open", () => {
  it("add up across runs, failed ones too, and answer the minutes left", () => {
    takeSlot("read", at(T0));
    expect(addOpenTime(10 * MIN, at(T0 + 10 * MIN))).toBe(20);
    expect(addOpenTime(4.5 * MIN, at(T0 + 20 * MIN))).toBe(15);
    expect(state().usage).toEqual({ day: "2026-11-25", ms: 14.5 * MIN });
  });

  it("refuse to start once 30 minutes are spent today, until midnight in the Flock's timezone", () => {
    addOpenTime(30 * MIN, at(T0, "Asia/Kolkata"));
    const hit = refusal(() => takeSlot("read", at(T0 + MIN, "Asia/Kolkata")));
    expect(hit?.code).toBe("TIME_LIMIT_DAY");
    expect(hit?.message).toContain("Asia/Kolkata");
    expect(hit?.freesAt).toBe(Date.UTC(2026, 10, 25, 18, 30));
    expect(refusal(() => takeSlot("read", at(Date.UTC(2026, 10, 25, 18, 31), "Asia/Kolkata")))).toBeNull();
  });

  it("still start with a little left, answering how much is left so the run caps its waits", () => {
    addOpenTime(29 * MIN, at(T0));
    expect(takeSlot("read", at(T0 + MIN))).toBe(MIN);
    expect(addOpenTime(80_000, at(T0 + 3 * MIN))).toBe(0);
    expect(refusal(() => takeSlot("read", at(T0 + 4 * MIN)))?.code).toBe("TIME_LIMIT_DAY");
  });

  it("count the calendar day in UTC when no timezone is given", () => {
    const before = process.env.FLOCK_TIMEZONE;
    delete process.env.FLOCK_TIMEZONE;
    try {
      expect(timeZoneOf({})).toBe("UTC");
      expect(timeZoneOf({ timeZone: "Not/AZone" })).toBe("UTC");
    } finally { if (before !== undefined) process.env.FLOCK_TIMEZONE = before; }
    expect(dayOf(Date.UTC(2026, 10, 25, 23, 0), "UTC")).toBe("2026-11-25");
    expect(nextMidnight(Date.UTC(2026, 10, 25, 23, 0), "UTC")).toBe(Date.UTC(2026, 10, 26));
    expect(nextMidnight(Date.UTC(2026, 2, 7, 12, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 8, 5));
    expect(nextMidnight(Date.UTC(2026, 2, 8, 12, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 9, 4));
  });
});

describe("sends", () => {
  it("allow 5 a rolling hour and 20 a rolling day", () => {
    for (let i = 0; i < 5; i++) takeSlot("send", at(T0 + i * MIN));
    const hour = refusal(() => takeSlot("send", at(T0 + 20 * MIN)));
    expect(hour?.code).toBe("SEND_LIMIT_HOUR");
    expect(hour?.freesAt).toBe(T0 + HOUR);
    for (let h = 1; h < 4; h++) for (let i = 0; i < 5; i++) takeSlot("send", at(T0 + h * 2 * HOUR + i * MIN));
    const day = refusal(() => takeSlot("send", at(T0 + 8 * HOUR)));
    expect(day?.code).toBe("SEND_LIMIT_DAY");
    expect(day?.freesAt).toBe(T0 + 24 * HOUR);
  });

  it("have no gap between them and no rule about the same text", () => {
    expect(refusal(() => { takeSlot("send", at(T0)); takeSlot("send", at(T0 + 1000)); })).toBeNull();
  });

  it("a refused send takes no open", () => {
    for (let i = 0; i < 5; i++) takeSlot("send", at(T0 + i * MIN));
    refusal(() => takeSlot("send", at(T0 + 6 * MIN)));
    expect(state().opens.length).toBe(5);
  });
});

describe("the state file", () => {
  it("a broken file starts fresh instead of failing every run", () => {
    takeSlot("read", at(T0));
    writeFileSync(join(dir, "whatsapp", "limits.json"), "{not json");
    expect(refusal(() => takeSlot("read", at(T0 + MIN)))).toBeNull();
    writeFileSync(join(dir, "whatsapp", "limits.json"), JSON.stringify({ opens: "x", sends: [1, "y"], usage: { day: 3 } }));
    expect(addOpenTime(MIN, at(T0 + 2 * MIN))).toBe(29);
  });

  it("refuse without a data folder rather than run unlimited", () => {
    const before = process.env.SKILL_DATA_DIR;
    delete process.env.SKILL_DATA_DIR;
    try { expect(refusal(() => takeSlot("read", { now: T0 }))?.code).toBe("NO_DATA_DIR"); }
    finally { if (before !== undefined) process.env.SKILL_DATA_DIR = before; }
  });

  it("a lock left by a run that died is taken over after 30 seconds", () => {
    takeSlot("read", at(T0));
    const lock = join(dir, "whatsapp", "limits.json.lock");
    writeFileSync(lock, "");
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(lock, old, old);
    expect(refusal(() => takeSlot("read", at(T0 + MIN)))).toBeNull();
    expect(existsSync(lock)).toBe(false);
  });
});
