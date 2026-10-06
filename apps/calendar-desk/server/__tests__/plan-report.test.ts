import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, failed, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-plan-report-"));
const S = await import("../store");
const P = await import("../planning-store");
const { handlePlanReport, maxDueOf } = await import("../plan-report");
const { ops } = await import("../ops");

function wipe() { for (const t of ["events", "cursors", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

const NOW = new Date(2026, 9, 6, 12, 0, 0);
type TaskState = { sourceRef: string; status: "open" | "done" | "dismissed"; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };
function platform(o: { tasks?: TaskState[]; publish?: () => any } = {}) {
  const published: any[] = [];
  const ctx = { tasks: {
    publish: async (t: any) => { published.push(t); return o.publish ? o.publish() : ok({}); },
    list: async (opts: { prefix?: string } = {}) => ok({ tasks: (o.tasks ?? []).filter((t) => t.sourceRef.startsWith(opts.prefix ?? "")) }),
  } } as unknown as PlatformContext;
  return { ctx, published };
}
const closedTask = (ref: string, status: "done" | "dismissed" = "dismissed"): TaskState => ({ sourceRef: ref, status, title: "x", due: null, dueTimed: false, showFrom: null, updatedAt: 0 });
function seed(key: string, title: string, localDate: string, startAt: number | null = null) {
  S.upsertEvents("acct", [{ eventKey: key, calendar: null, title, startAt, endAt: null, allDay: startAt == null, localDate, attendeesText: null, location: null, rawTimeText: null, googleEventId: key }], NOW.getTime());
}
function plan(...keys: string[]) {
  const refs = keys.map((k, i) => { const e = S.getEvent("acct", k)!; return { ref: `e${i + 1}`, accountId: "acct", eventKey: k, date: e.localDate, startAt: e.allDay ? null : e.startAt }; });
  return P.createPlan(refs, NOW.getTime());
}
const hampi = () => seed("g1", "Stay at The Loft - Aadhya Homestay Hampi", "2026-10-12");
const pack = { key: "pack", title: "Pack for Hampi trip", dueDate: "2026-10-11", showFrom: "2026-10-10", why: "a trip" };

describe("maxDueOf", () => {
  test("all-day: end of the day; timed: the start with HH:MM", () => {
    hampi();
    expect(maxDueOf(S.getEvent("acct", "g1")!)).toEqual({ maxDue: new Date(2026, 9, 12, 23, 59, 59, 999).getTime(), maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct" });
    const start = new Date(2026, 9, 9, 9, 5).getTime();
    seed("g2", "Dentist", "2026-10-09", start);
    expect(maxDueOf(S.getEvent("acct", "g2")!)).toEqual({ maxDue: start, maxDueReason: "Dentist, Fri 9 Oct 09:05" });
  });
});

describe("handlePlanReport", () => {
  test("Hampi example: published, recorded, planned, plan answered", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published).toEqual([{ sourceRef: "step:g1:pack", title: "Pack for Hampi trip", due: new Date(2026, 9, 11).getTime(), dueTimed: false, showFrom: "2026-10-10", status: "backlog",
      maxDue: new Date(2026, 9, 12, 23, 59, 59, 999).getTime(), maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct", context: { eventKey: "calendar-desk:g1", why: "a trip" } }]);
    expect(P.stepKeysFor("acct", "g1")).toEqual(["pack"]);
    expect(P.plannedMark("acct", "g1")).not.toBeNull();
    expect(P.openPlan()).toBeNull();
    expect(P.getPlan(pl.planId)!.answeredAt).not.toBeNull();
  });

  test("a timed step carries dueTime", async () => {
    seed("g2", "Dentist", "2026-10-09", new Date(2026, 9, 9, 9, 30).getTime()); const pl = plan("g2"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [{ key: "cab", title: "Book a cab", dueDate: "2026-10-09", dueTime: "08:00", why: "w" }] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/cab"]);
    expect(p.published[0]).toMatchObject({ due: new Date(2026, 9, 9, 8, 0).getTime(), dueTimed: true, showFrom: "2026-10-09", maxDue: new Date(2026, 9, 9, 9, 30).getTime() });
  });

  test("refusals: each with its reason, others still accepted", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [
      { ...pack, key: "late", dueDate: "2026-10-13", showFrom: "2026-10-12" },
      { ...pack, key: "show", showFrom: "2026-10-12" },
      { ...pack, key: "ok" },
    ] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/ok"]);
    expect(r.refused.map((x: any) => x.item)).toEqual(["e1/late", "e1/show"]);
    expect(r.refused[0].reason).toMatch(/after its event/);
    expect(r.refused[1].reason).toMatch(/showFrom is after/);
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:ok"]);
    expect(r.done).toBe(false);
    expect(P.plannedMark("acct", "g1")).toBeNull();
    expect(P.openPlan()!.badReports).toBe(1);
  });

  test("a bad key, a key the owner closed and a past date are refused", async () => {
    hampi(); const pl = plan("g1"); const p = platform({ tasks: [closedTask("step:g1:gone")] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [
      { ...pack, key: "BAD KEY" }, { ...pack, key: "gone" }, { ...pack, key: "past", dueDate: "2026-10-05", showFrom: "2026-10-05" },
    ] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual([]);
    expect(r.refused.map((x: any) => x.reason)).toEqual(["key must match /^[a-z0-9-]{1,40}$/", "step gone was already done or dismissed by the owner", "dueDate is before today"]);
    expect(p.published).toEqual([]);
  });

  test("four steps refuse the event; dueTime today must be after now; timed event refuses a step after its start", async () => {
    seed("g2", "Dentist", "2026-10-06", new Date(2026, 9, 6, 15, 0).getTime()); const pl = plan("g2"); const p = platform();
    const s = (key: string, dueTime: string) => ({ key, title: "t", dueDate: "2026-10-06", dueTime, why: "w" });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [s("a", "11:00"), s("b", "15:30"), s("c", "14:00")] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/c"]);
    expect(r.refused.map((x: any) => x.reason)).toEqual(["it is already past", "it is due after its event"]);
    const r4: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [s("a", "13:00"), s("b", "13:00"), s("c", "13:00"), s("d", "13:00")] }] }, p.ctx, NOW);
    expect(r4.refused).toEqual([{ item: "e1", reason: "at most 3 steps per event" }]);
  });

  test("steps: [] plans the event with nothing published", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    expect(await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, p.ctx, NOW)).toEqual({ accepted: [], refused: [], done: true });
    expect(p.published).toEqual([]);
    expect(P.plannedMark("acct", "g1")).not.toBeNull();
  });

  test("unknown plan, and a second identical report after the plan was answered: PLAN_UNKNOWN, no second publish", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    expect(await handlePlanReport({ planId: "nope", events: [] }, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN", status: 409 });
    const body = { planId: pl.planId, events: [{ event: "e1", steps: [pack] }] };
    await handlePlanReport(body, p.ctx, NOW);
    expect(await handlePlanReport(body, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN", status: 409, error: "plan already answered or given up" });
    expect(p.published).toHaveLength(1);
  });

  test("a report for an abandoned plan: PLAN_UNKNOWN, nothing published", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    P.abandonPlan(pl.planId, NOW.getTime());
    expect(await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN" });
    expect(p.published).toEqual([]);
  });

  test("three refused reports give the plan up", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const bad = { planId: pl.planId, events: [{ event: "e1", steps: [{ ...pack, key: "BAD" }] }] };
    for (let i = 0; i < 2; i++) { expect((await handlePlanReport(bad, p.ctx, NOW) as any).done).toBe(false); expect(P.openPlan()).not.toBeNull(); }
    expect((await handlePlanReport(bad, p.ctx, NOW) as any).done).toBe(false);
    expect(P.openPlan()).toBeNull();
    expect(P.getPlan(pl.planId)!.abandonedAt).not.toBeNull();
  });

  test("a refused event is fixed in a second report; the plan answers when all are planned", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    const r1: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }, { event: "e2", steps: [{ ...pack, key: "BAD" }] }] }, p.ctx, NOW);
    expect(r1.done).toBe(false);
    const r2: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e2", steps: [{ key: "x", title: "t", dueDate: "2026-10-08", why: "w" }] }] }, p.ctx, NOW);
    expect(r2).toEqual({ accepted: ["e2/x"], refused: [], done: true });
  });

  test("an unknown ref is refused; a failed publish is refused and not recorded", async () => {
    hampi(); const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e9", steps: [] }, { event: "e1", steps: [pack] }] }, platform({ publish: () => failed("boom") }).ctx, NOW);
    expect(r.refused[0]).toEqual({ item: "e9", reason: "event is not in this plan" });
    expect(r.refused[1].item).toBe("e1/pack");
    expect(P.stepKeysFor("acct", "g1")).toEqual([]);
  });

  test("registered as the plan_events_done op", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r = await ops.plan_events_done!({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, { platform: p.ctx } as any);
    expect(r).toMatchObject({ done: true });
  });
});
