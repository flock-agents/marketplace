// The harvest hour: the routine is dispatched hourly, the work is daily, and a NEW day's work
// waits for the owner's hour. Only a new day is gated — a day that stopped on its budget keeps
// catching up on the hourly ticks, before the hour as much as after it.

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";

process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "slack-desk-hour-"));

const { readConfig, harvestDayKey, harvestOnce, DEFAULT_HARVEST_HOUR } = await import("../harvest");
const { _db, markHarvestRan, markPartialSpend } = await import("../store");

const ACCT = "hour-acct";

beforeEach(() => {
  for (const t of ["messages", "cursors", "init_state", "harvest_days", "workspace",
                   "user_names", "threads", "ledger", "channel_engagement"]) {
    _db.exec(`DELETE FROM ${t}`);
  }
});

/** Records which connector functions a pass called; answers everything with nothing. */
function platform(): { ctx: PlatformContext; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    connectors: {
      exec: async (req: any) => {
        if (req.functionName === "checkTokenHealth") {
          return ok({ healthy: true, userId: "U-ME", user: "me", url: "https://acme.slack.com/" });
        }
        calls.push(req.functionName);
        return ok([]);
      },
    },
    memory: { extract: async () => ok(undefined as unknown) },
  } as unknown as PlatformContext;
  return { ctx, calls };
}

// Local wall-clock moments: the harvest hour is local time.
const at = (d: number, h: number, m = 17) => new Date(2026, 8, d, h, m);
const cfg = (hour?: unknown) => readConfig({ channels: ["C1"], ...(hour === undefined ? {} : { harvestHour: hour }) });

describe("harvestDayKey", () => {
  test("the day turns over at the harvest hour, not at midnight", () => {
    expect(harvestDayKey(at(28, 4, 59), 5)).toBe("2026-09-27");
    expect(harvestDayKey(at(28, 5, 0), 5)).toBe("2026-09-28");
    expect(harvestDayKey(at(28, 0, 0), 0)).toBe("2026-09-28");
    expect(harvestDayKey(at(28, 22, 0), 23)).toBe("2026-09-27");
  });
});

describe("the harvest hour gates a NEW day only", () => {
  test("before the hour, with yesterday finished, no new day starts", async () => {
    markHarvestRan(ACCT, harvestDayKey(at(27, 20), 5), 3);
    const p = platform();
    const out = await harvestOnce(ACCT, cfg(), { platform: p.ctx, now: () => at(28, 3) });
    expect(out.skipped).toBe("already-ran-today");
    expect(p.calls).toEqual([]);
  });

  test("at or after the hour, the new day runs", async () => {
    markHarvestRan(ACCT, harvestDayKey(at(27, 20), 5), 3);
    const p = platform();
    const out = await harvestOnce(ACCT, cfg(), { platform: p.ctx, now: () => at(28, 5) });
    expect(out.skipped).toBeUndefined();
    expect(p.calls).toContain("conversations_history");
  });

  test("an unfinished day keeps resuming before the hour", async () => {
    // Yesterday's pass stopped on its block budget: the day is owed, and 03:17 is still inside it.
    markPartialSpend(ACCT, harvestDayKey(at(27, 20), 5), 4, "block-budget");
    const p = platform();
    const out = await harvestOnce(ACCT, cfg(), { platform: p.ctx, now: () => at(28, 3) });
    expect(out.skipped).toBeUndefined();
    expect(p.calls).toContain("conversations_history");
  });

  test("the owner's own hour is honoured", async () => {
    markHarvestRan(ACCT, harvestDayKey(at(27, 20), 9), 3);
    const early = platform();
    expect((await harvestOnce(ACCT, cfg(9), { platform: early.ctx, now: () => at(28, 8) })).skipped).toBe("already-ran-today");
    const onTime = platform();
    expect((await harvestOnce(ACCT, cfg(9), { platform: onTime.ctx, now: () => at(28, 9) })).skipped).toBeUndefined();
  });
});

describe("readConfig harvestHour", () => {
  test("an integer 0-23 is kept, 0 included; anything else is the default", () => {
    expect(DEFAULT_HARVEST_HOUR).toBe(5);
    expect(cfg().harvestHour).toBe(5);
    expect(cfg(0).harvestHour).toBe(0);
    expect(cfg(23).harvestHour).toBe(23);
    for (const bad of [24, -1, 3.5, "7", null, Number.NaN]) expect(cfg(bad).harvestHour).toBe(5);
  });
});
