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
type TaskState = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };
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

describe("a moved event's other steps get the new limit (final review finding 2)", () => {
  const ms = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m, d, h, mi).getTime();
  const openStep = (ref: string, title: string, due: number, showFrom: number | null, dueTimed = false): TaskState => ({ sourceRef: ref, status: "open", title, due, dueTimed, showFrom, updatedAt: 0 });
  const plannedAt = (key: string, date: string, startAt: number | null = null) => P.markPlanned([{ accountId: "acct", eventKey: key, date, startAt }], NOW.getTime() - 86_400_000);

  test("moved later: a recorded open step the report leaves out is re-published with the new cap only, no dates", async () => {
    hampi(); plannedAt("g1", "2026-10-10"); P.recordStep("acct", "g1", "cab");
    const pl = plan("g1");
    const p = platform({ tasks: [openStep("step:g1:cab", "Book a cab", ms(2026, 9, 9), ms(2026, 9, 8))] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack", "step:g1:cab"]);
    expect(p.published[1]).toEqual({ sourceRef: "step:g1:cab", title: "Book a cab", maxDue: ms(2026, 9, 12, 23, 59) + 59_999, maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct" });
  });

  test("moved earlier past a step's due: the due comes back to the event's day (date only), show-from with it", async () => {
    seed("g2", "Dentist", "2026-10-09", ms(2026, 9, 9, 18, 0)); plannedAt("g2", "2026-10-12", ms(2026, 9, 12, 18, 0)); P.recordStep("acct", "g2", "cab");
    const pl = plan("g2");
    const p = platform({ tasks: [openStep("step:g2:cab", "Book a cab", ms(2026, 9, 11, 8, 0), ms(2026, 9, 10), true)] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: [], refused: [], done: true });
    expect(p.published).toEqual([{ sourceRef: "step:g2:cab", title: "Book a cab", maxDue: ms(2026, 9, 9, 18, 0), maxDueReason: "Dentist, Fri 9 Oct 18:00",
      due: ms(2026, 9, 9), dueTimed: false, showFrom: "2026-10-09" }]);
  });

  test("moved earlier, the step still fits: only the cap; a show-from already before the new day is kept", async () => {
    seed("g2", "Dentist", "2026-10-09", ms(2026, 9, 9, 18, 0)); plannedAt("g2", "2026-10-12", ms(2026, 9, 12, 18, 0)); P.recordStep("acct", "g2", "cab");
    const pl = plan("g2");
    const p = platform({ tasks: [openStep("step:g2:cab", "Book a cab", ms(2026, 9, 8), ms(2026, 9, 7))] });
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, p.ctx, NOW);
    expect(p.published).toEqual([{ sourceRef: "step:g2:cab", title: "Book a cab", maxDue: ms(2026, 9, 9, 18, 0), maxDueReason: "Dentist, Fri 9 Oct 18:00" }]);
  });

  test("re-reported, closed and unrecorded steps are not touched again", async () => {
    hampi(); plannedAt("g1", "2026-10-10"); P.recordStep("acct", "g1", "pack"); P.recordStep("acct", "g1", "done-one");
    const pl = plan("g1");
    const p = platform({ tasks: [
      openStep("step:g1:pack", "Pack", ms(2026, 9, 9), null),
      { ...closedTask("step:g1:done-one", "done") },
      openStep("step:g1:stranger", "Not ours", ms(2026, 9, 9), null),
    ] });
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW);
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack"]);
  });

  test("a cap update Flock refuses is reported and leaves the event unplanned for the next run, with no bad report", async () => {
    hampi(); plannedAt("g1", "2026-10-10"); P.recordStep("acct", "g1", "cab");
    const pl = plan("g1");
    let n = 0;
    const p = platform({ tasks: [openStep("step:g1:cab", "Book a cab", ms(2026, 9, 9), null)], publish: () => (++n === 1 ? ok({}) : failed("nope")) });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/pack"]);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].item).toBe("e1/cab");
    expect(r.refused[0].reason).toMatch(/^could not update its limit: /);
    expect(r.done).toBe(false);
    expect(P.plannedMark("acct", "g1")!.date).toBe("2026-10-10");
    expect(P.openPlan()!.badReports).toBe(0);
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

  test("a step Calendar Desk withdrew (event deleted, then restored in Google) is not owner-closed: it is published again", async () => {
    hampi(); const pl = plan("g1"); const p = platform({ tasks: [{ ...closedTask("step:g1:pack"), withdrawn: true }] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack"]);
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

  test("a 150-char title keeps the reason within 120 chars, ending in the date", () => {
    seed("g3", "A".repeat(150), "2026-10-12");
    const r = maxDueOf(S.getEvent("acct", "g3")!).maxDueReason;
    expect(r.length).toBeLessThanOrEqual(120);
    expect(r).toMatch(/…, Mon 12 Oct$/);
  });

  test("a publish failure is shown but is not a bad report; the plan stays open and the event unplanned", async () => {
    hampi(); const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack] }] }, platform({ publish: () => failed("boom") }).ctx, NOW);
    expect(r.refused[0].reason).toMatch(/could not publish/);
    expect(r.done).toBe(false);
    expect(P.openPlan()!.badReports).toBe(0);
    expect(P.plannedMark("acct", "g1")).toBeNull();
  });

  test("re-posting after a partial acceptance re-publishes the same sourceRef, no duplicates", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack, { ...pack, key: "BAD" }] }] }, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [pack, { ...pack, key: "cab", title: "Book a cab" }] }] }, p.ctx, NOW);
    expect(r.done).toBe(true);
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack", "step:g1:pack", "step:g1:cab"]);
    expect(P.stepKeysFor("acct", "g1")).toEqual(["pack", "cab"]);
  });

  test("an already planned event re-listed is refused as already planned, without a bad report", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, p.ctx, NOW);
    expect(r.refused).toEqual([{ item: "e1", reason: "already planned" }]);
    expect(P.openPlan()!.badReports).toBe(0);
  });

  test("a third report that plans everything with a stray refusal answers the plan", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    const bad = { planId: pl.planId, events: [{ event: "e1", steps: [{ ...pack, key: "BAD" }] }] };
    await handlePlanReport(bad, p.ctx, NOW); await handlePlanReport(bad, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [] }, { event: "e2", steps: [] }, { event: "e9", steps: [] }] }, p.ctx, NOW);
    expect(r.done).toBe(true);
    expect(P.getPlan(pl.planId)!.answeredAt).not.toBeNull();
    expect(P.getPlan(pl.planId)!.abandonedAt).toBeNull();
  });

  test("refs are stripped from title and why; a title of only refs is refused; an empty why gets a plain one", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", steps: [
      { key: "a", title: "Pack the bag (e1)", dueDate: "2026-10-11", why: "a trip (e1)" },
      { key: "b", title: "(e1)", dueDate: "2026-10-11", why: "w" },
      { key: "c", title: "Book a cab [[e1]]", dueDate: "2026-10-11", why: "(e1)" },
    ] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/a", "e1/c"]);
    expect(r.refused).toEqual([{ item: "e1/b", reason: "title is required" }]);
    expect(p.published[0]).toMatchObject({ title: "Pack the bag", context: { why: "a trip" } });
    expect(p.published[1]).toMatchObject({ title: "Book a cab", context: { why: "planned for Stay at The Loft - Aadhya Homestay Hampi" } });
  });

  test("registered as the plan_events_done op", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r = await ops.plan_events_done!({ planId: pl.planId, events: [{ event: "e1", steps: [] }] }, { platform: p.ctx } as any);
    expect(r).toMatchObject({ done: true });
  });
});
