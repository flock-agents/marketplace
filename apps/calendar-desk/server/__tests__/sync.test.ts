// server/__tests__/sync.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-sync-"));
const S = await import("../store");
const { syncAccount, shouldScrape, DAILY_SCRAPE_CAP, lastFault } = await import("../sync");

const NOW = new Date(2026, 9, 5, 9, 0);
function platform(answer: () => any): { ctx: PlatformContext; calls: any[] } {
  const calls: any[] = [];
  const ctx = { appId: "calendar-desk", pairedAgent: { id: "pa", name: "PA" }, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined) }, tasks: { publish: async () => ok(undefined), withdraw: async () => ok(undefined) },
    connectors: { exec: async (req: any) => { calls.push(req); return answer(); } },
    memory: { extract: async () => ok(undefined), factsSince: async () => ok({ facts: [], nextSince: "" }) },
    agent: { intent: async () => ok({ sessionId: "s", reused: false }) },
  } as unknown as PlatformContext;
  return { ctx, calls };
}
beforeEach(() => { for (const t of ["events", "cursors"]) S._db.exec(`DELETE FROM ${t}`); });

describe("syncAccount", () => {
  test("stores the scrape, asks for today, and marks events that vanished", async () => {
    const p = platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30 – 10am", date: "Mon, 5 Oct" }], source: "browser_session" }));
    const r = await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(r).toMatchObject({ ok: true, events: 1, fault: null });
    expect(p.calls[0]).toMatchObject({ skillId: "google-calendar", functionName: "listEvents", accountHint: "acct", params: { timeMin: "2026-10-05" } });
    expect(p.calls[0].timeoutMs).toBeGreaterThanOrEqual(45_000);
    // Next scrape: Standup gone, Review present → Standup missing, not deleted.
    const p2 = platform(() => ok({ ok: true, events: [{ title: "Review", time: "11am", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: p2.ctx, now: () => new Date(NOW.getTime() + 3 * 3600_000) }, "pre-prep");
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.find((e) => e.title === "Standup")!.missingSince).not.toBeNull();
    expect(all.find((e) => e.title === "Review")!.missingSince).toBeNull();
  });
  test("a faulted scrape keeps yesterday's events and records the fault (Review Focus 3)", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const r = await syncAccount("acct", { platform: platform(() => ({ ok: false, reason: "BROWSER_ERROR: login wall" })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    expect(r.ok).toBe(false);
    expect(r.fault).toMatch(/login/);
    expect(lastFault("acct")).toMatch(/login/);
    expect(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05" }).length).toBe(1);
  });
  test("an honest empty scrape clears the day", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [] })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    expect(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05" }).length).toBe(0);
  });
  test("the daily cap and the freshness rule", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    for (let i = 0; i < DAILY_SCRAPE_CAP; i++) await syncAccount("acct", { platform: p.ctx, now: () => new Date(NOW.getTime() + i * 30 * 60_000) }, "scheduled");
    const r = await syncAccount("acct", { platform: p.ctx, now: () => new Date(2026, 9, 5, 23, 50) }, "scheduled");
    expect(r.skipped).toBe("cap");
    expect(p.calls.length).toBe(DAILY_SCRAPE_CAP);
    // pre-prep within 2h of a scrape is "fresh" and skipped
    S._db.exec("DELETE FROM cursors");
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(shouldScrape("acct", new Date(NOW.getTime() + 30 * 60_000), "pre-prep")).toBe(false);
    expect(shouldScrape("acct", new Date(NOW.getTime() + 3 * 3600_000), "pre-prep")).toBe(true);
  });
});
