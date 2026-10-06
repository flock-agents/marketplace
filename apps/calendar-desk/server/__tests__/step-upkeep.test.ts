import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-step-upkeep-"));
const S = await import("../store");
const P = await import("../planning-store");
const { syncAccount } = await import("../sync");
const { handlePlanReport } = await import("../plan-report");

beforeEach(() => { for (const t of ["events", "cursors", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); });
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const TITLE = "Stay at The Loft - Aadhya Homestay Hampi";
function platform(getEventExists = false) {
  const published: any[] = [], withdrawn: any[] = [];
  const ctx = { configured: true,
    tasks: { publish: async (t: any) => { published.push(t); return ok({}); }, withdraw: async (ref: string, o: any) => { withdrawn.push([ref, o]); return ok({}); },
      list: async () => ok({ tasks: [] }) },
    connectors: { exec: async (req: any) => req.functionName === "getEvent" ? ok({ ok: true, exists: getEventExists }) : ok({ ok: true, events: [{ title: "Other", time: "11am", date: "Tue, 6 Oct" }] }) },
  } as unknown as PlatformContext;
  return { ctx, published, withdrawn };
}
function seed(key: string, localDate: string) {
  S.upsertEvents("acct", [{ eventKey: key, calendar: null, title: TITLE, startAt: null, endAt: null, allDay: true, localDate, attendeesText: null, location: null, rawTimeText: null, googleEventId: key }], NOW.getTime());
  S.saveEventDetails("acct", key, { guestSummary: "" }, NOW.getTime());
}
const pack = (due: string) => ({ key: "pack", title: "Pack", dueDate: due, why: "w" });

describe("step upkeep", () => {
  test("a deletion Google confirms withdraws each step with the reason and forgets the event", async () => {
    seed("g1", "2026-10-07");
    P.markPlanned([{ accountId: "acct", eventKey: "g1", date: "2026-10-07", startAt: null }], 1);
    P.recordStep("acct", "g1", "pack"); P.recordStep("acct", "g1", "cab");
    const p = platform(false);
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(p.withdrawn).toEqual([
      ["step:g1:pack", { reason: `${TITLE} was deleted from your calendar` }],
      ["step:g1:cab", { reason: `${TITLE} was deleted from your calendar` }]]);
    expect(P.stepKeysFor("acct", "g1")).toEqual([]);
    expect(P.plannedMark("acct", "g1")).toBeNull();
    expect(S.listEvents({ fromDate: "2026-10-06", toDate: "2026-10-30", includeMissing: true }).find((e) => e.eventKey === "g1")!.missingSince).not.toBeNull();
  });
  test("an event Google still has is not withdrawn", async () => {
    seed("g1", "2026-10-07"); P.recordStep("acct", "g1", "pack");
    const p = platform(true);
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(p.withdrawn).toEqual([]); expect(P.stepKeysFor("acct", "g1")).toEqual(["pack"]);
  });
  test("an unchanged planned event is never re-offered or re-published across two runs", async () => {
    seed("g1", "2026-10-12"); const p = platform();
    const pl = P.createPlan([{ ref: "e1", accountId: "acct", eventKey: "g1", date: "2026-10-12", startAt: null }], NOW.getTime());
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack("2026-10-11")] }] }, p.ctx, NOW);
    expect(p.published.length).toBe(1);
    for (let i = 0; i < 2; i++) expect(P.eventsToPlan(NOW)).toEqual([]);
    expect(p.published.length).toBe(1);
  });
  test("an event moved earlier is offered changed and re-published with the new due and maxDue", async () => {
    seed("g1", "2026-10-12"); const p = platform();
    const pl = P.createPlan([{ ref: "e1", accountId: "acct", eventKey: "g1", date: "2026-10-12", startAt: null }], NOW.getTime());
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack("2026-10-11")] }] }, p.ctx, NOW);
    seed("g1", "2026-10-09");
    const offered = P.eventsToPlan(NOW);
    expect(offered.map((e) => [e.eventKey, e.change])).toEqual([["g1", "changed"]]);
    const pl2 = P.createPlan([{ ref: "e1", accountId: "acct", eventKey: "g1", date: "2026-10-09", startAt: null }], NOW.getTime());
    await handlePlanReport({ planId: pl2.planId, events: [{ event: "e1", steps: [pack("2026-10-08")] }] }, p.ctx, NOW);
    expect(p.published.length).toBe(2);
    expect(p.published[1]).toMatchObject({ sourceRef: "step:g1:pack", due: new Date(2026, 9, 8).getTime(), maxDue: new Date(2026, 9, 9, 23, 59, 59, 999).getTime() });
  });
});
