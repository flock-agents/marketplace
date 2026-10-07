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
function platform(o: { tasks?: TaskState[]; publish?: () => any; facts?: (q: string) => string[]; tie?: (req: any) => any } = {}) {
  const published: any[] = [], searches: any[] = [], ties: any[] = [];
  const tasks: any = {
    publish: async (t: any) => { published.push(t); return o.publish ? o.publish() : ok({}); },
    list: async (opts: { prefix?: string } = {}) => ok({ tasks: (o.tasks ?? []).filter((t) => t.sourceRef.startsWith(opts.prefix ?? "")) }),
  };
  // Only a newer SDK has tie: leave it out unless the test gives one.
  if (o.tie) tasks.tie = async (req: any) => { ties.push(req); return o.tie!(req); };
  const ctx = { tasks, memory: { search: async (q: string, opts: any) => { searches.push({ q, opts }); return ok({ facts: o.facts ? o.facts(q) : [] }); } } } as unknown as PlatformContext;
  return { ctx, published, searches, ties };
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
const pack = { key: "pack", kind: "pack", title: "Pack for Hampi trip", dueDate: "2026-10-11", showFrom: "2026-10-10", why: "a trip" };

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
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack", "step:g1:cab"]);
    expect(p.published[1]).toEqual({ sourceRef: "step:g1:cab", title: "Book a cab", maxDue: ms(2026, 9, 12, 23, 59) + 59_999, maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct" });
  });

  test("moved earlier past a step's due: the due comes back to the event's day (date only), show-from with it", async () => {
    seed("g2", "Dentist", "2026-10-09", ms(2026, 9, 9, 18, 0)); plannedAt("g2", "2026-10-12", ms(2026, 9, 12, 18, 0)); P.recordStep("acct", "g2", "cab");
    const pl = plan("g2");
    const p = platform({ tasks: [openStep("step:g2:cab", "Book a cab", ms(2026, 9, 11, 8, 0), ms(2026, 9, 10), true)] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: [], refused: [], done: true });
    expect(p.published).toEqual([{ sourceRef: "step:g2:cab", title: "Book a cab", maxDue: ms(2026, 9, 9, 18, 0), maxDueReason: "Dentist, Fri 9 Oct 18:00",
      due: ms(2026, 9, 9), dueTimed: false, showFrom: "2026-10-09" }]);
  });

  test("moved earlier, the step still fits: only the cap; a show-from already before the new day is kept", async () => {
    seed("g2", "Dentist", "2026-10-09", ms(2026, 9, 9, 18, 0)); plannedAt("g2", "2026-10-12", ms(2026, 9, 12, 18, 0)); P.recordStep("acct", "g2", "cab");
    const pl = plan("g2");
    const p = platform({ tasks: [openStep("step:g2:cab", "Book a cab", ms(2026, 9, 8), ms(2026, 9, 7))] });
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW);
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
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack"]);
  });

  test("a cap update Flock refuses is reported and leaves the event unplanned for the next run, with no bad report", async () => {
    hampi(); plannedAt("g1", "2026-10-10"); P.recordStep("acct", "g1", "cab");
    const pl = plan("g1");
    let n = 0;
    const p = platform({ tasks: [openStep("step:g1:cab", "Book a cab", ms(2026, 9, 9), null)], publish: () => (++n === 1 ? ok({}) : failed("nope")) });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
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
    const r = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published).toEqual([{ sourceRef: "step:g1:pack", title: "Pack for Hampi trip", due: new Date(2026, 9, 11).getTime(), dueTimed: false, showFrom: "2026-10-10", status: "backlog",
      maxDue: new Date(2026, 9, 12, 23, 59, 59, 999).getTime(), maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct", context: { eventKey: "calendar-desk:g1", why: "a trip", kind: "pack" },
      cover: { kind: "pack", eventTitle: "Stay at The Loft - Aadhya Homestay Hampi", eventLocation: undefined, eventDate: "2026-10-12" } }]);
    expect(P.stepKeysFor("acct", "g1")).toEqual(["pack"]);
    expect(P.plannedMark("acct", "g1")).not.toBeNull();
    expect(P.openPlan()).toBeNull();
    expect(P.getPlan(pl.planId)!.answeredAt).not.toBeNull();
  });

  test("a timed step carries dueTime", async () => {
    seed("g2", "Dentist", "2026-10-09", new Date(2026, 9, 9, 9, 30).getTime()); const pl = plan("g2"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "appointment", steps: [{ key: "cab", kind: "other", title: "Book a cab", dueDate: "2026-10-09", dueTime: "08:00", why: "w" }] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/cab"]);
    expect(p.published[0]).toMatchObject({ due: new Date(2026, 9, 9, 8, 0).getTime(), dueTimed: true, showFrom: "2026-10-09", maxDue: new Date(2026, 9, 9, 9, 30).getTime() });
  });

  test("refusals: each with its reason, others still accepted", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [
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
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [
      { ...pack, key: "BAD KEY" }, { ...pack, key: "gone" }, { ...pack, key: "past", dueDate: "2026-10-05", showFrom: "2026-10-05" },
    ] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual([]);
    expect(r.refused.map((x: any) => x.reason)).toEqual(["key must match /^[a-z0-9-]{1,40}$/", "step gone was already done or dismissed by the owner", "dueDate is before today"]);
    expect(p.published).toEqual([]);
  });

  test("a step Calendar Desk withdrew (event deleted, then restored in Google) is not owner-closed: it is published again", async () => {
    hampi(); const pl = plan("g1"); const p = platform({ tasks: [{ ...closedTask("step:g1:pack"), withdrawn: true }] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack"]);
  });

  test("four steps refuse the event; dueTime today must be after now; timed event refuses a step after its start", async () => {
    seed("g2", "Dentist", "2026-10-06", new Date(2026, 9, 6, 15, 0).getTime()); const pl = plan("g2"); const p = platform();
    const s = (key: string, dueTime: string) => ({ key, kind: "other", title: "t", dueDate: "2026-10-06", dueTime, why: "w" });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "appointment", steps: [s("a", "11:00"), s("b", "15:30"), s("c", "14:00")] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/c"]);
    expect(r.refused.map((x: any) => x.reason)).toEqual(["it is already past", "it is due after its event"]);
    const r4: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "appointment", steps: [s("a", "13:00"), s("b", "13:00"), s("c", "13:00"), s("d", "13:00")] }] }, p.ctx, NOW);
    expect(r4.refused).toEqual([{ item: "e1", reason: "at most 3 steps per event" }]);
  });

  test("steps: [] plans the event with nothing published", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    expect(await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW)).toEqual({ accepted: [], refused: [], done: true });
    expect(p.published).toEqual([]);
    expect(P.plannedMark("acct", "g1")).not.toBeNull();
  });

  test("unknown plan, and a second identical report after the plan was answered: PLAN_UNKNOWN, no second publish", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    expect(await handlePlanReport({ planId: "nope", events: [] }, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN", status: 409 });
    const body = { planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] };
    await handlePlanReport(body, p.ctx, NOW);
    expect(await handlePlanReport(body, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN", status: 409, error: "plan already answered or given up" });
    expect(p.published).toHaveLength(1);
  });

  test("a report for an abandoned plan: PLAN_UNKNOWN, nothing published", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    P.abandonPlan(pl.planId, NOW.getTime());
    expect(await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW)).toMatchObject({ code: "PLAN_UNKNOWN" });
    expect(p.published).toEqual([]);
  });

  test("three refused reports give the plan up", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const bad = { planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [{ ...pack, key: "BAD" }] }] };
    for (let i = 0; i < 2; i++) { expect((await handlePlanReport(bad, p.ctx, NOW) as any).done).toBe(false); expect(P.openPlan()).not.toBeNull(); }
    expect((await handlePlanReport(bad, p.ctx, NOW) as any).done).toBe(false);
    expect(P.openPlan()).toBeNull();
    expect(P.getPlan(pl.planId)!.abandonedAt).not.toBeNull();
  });

  test("a refused event is fixed in a second report; the plan answers when all are planned", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    const r1: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }, { event: "e2", type: "appointment", steps: [{ ...pack, key: "BAD" }] }] }, p.ctx, NOW);
    expect(r1.done).toBe(false);
    const r2: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e2", type: "appointment", steps: [{ key: "x", kind: "other", title: "t", dueDate: "2026-10-08", why: "w" }] }] }, p.ctx, NOW);
    expect(r2).toEqual({ accepted: ["e2/x"], refused: [], done: true });
  });

  test("an unknown ref is refused; a failed publish is refused and not recorded", async () => {
    hampi(); const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e9", type: "stay", steps: [] }, { event: "e1", type: "stay", steps: [pack] }] }, platform({ publish: () => failed("boom") }).ctx, NOW);
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
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, platform({ publish: () => failed("boom") }).ctx, NOW);
    expect(r.refused[0].reason).toMatch(/could not publish/);
    expect(r.done).toBe(false);
    expect(P.openPlan()!.badReports).toBe(0);
    expect(P.plannedMark("acct", "g1")).toBeNull();
  });

  test("re-posting after a partial acceptance re-publishes the same sourceRef, no duplicates", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack, { ...pack, key: "BAD" }] }] }, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack, { ...pack, key: "cab", kind: "other", title: "Book a cab" }] }] }, p.ctx, NOW);
    expect(r.done).toBe(true);
    expect(p.published.map((t) => t.sourceRef)).toEqual(["step:g1:pack", "step:g1:pack", "step:g1:cab"]);
    expect(P.stepKeysFor("acct", "g1")).toEqual(["pack", "cab"]);
  });

  test("an already planned event re-listed is refused as already planned, without a bad report", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW);
    expect(r.refused).toEqual([{ item: "e1", reason: "already planned" }]);
    expect(P.openPlan()!.badReports).toBe(0);
  });

  test("a third report that plans everything with a stray refusal answers the plan", async () => {
    hampi(); seed("g2", "Dentist", "2026-10-09"); const pl = plan("g1", "g2"); const p = platform();
    const bad = { planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [{ ...pack, key: "BAD" }] }] };
    await handlePlanReport(bad, p.ctx, NOW); await handlePlanReport(bad, p.ctx, NOW);
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }, { event: "e2", type: "appointment", steps: [] }, { event: "e9", type: "stay", steps: [] }] }, p.ctx, NOW);
    expect(r.done).toBe(true);
    expect(P.getPlan(pl.planId)!.answeredAt).not.toBeNull();
    expect(P.getPlan(pl.planId)!.abandonedAt).toBeNull();
  });

  test("refs are stripped from title and why; a title of only refs is refused; an empty why gets a plain one", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [
      { key: "a", kind: "pack", title: "Pack the bag (e1)", dueDate: "2026-10-11", why: "a trip (e1)" },
      { key: "b", kind: "pack", title: "(e1)", dueDate: "2026-10-11", why: "w" },
      { key: "c", kind: "other", title: "Book a cab [[e1]]", dueDate: "2026-10-11", why: "(e1)" },
    ] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/a", "e1/c"]);
    expect(r.refused).toEqual([{ item: "e1/b", reason: "title is required" }]);
    expect(p.published[0]).toMatchObject({ title: "Pack the bag", context: { why: "a trip" } });
    expect(p.published[1]).toMatchObject({ title: "Book a cab", context: { why: "planned for Stay at The Loft - Aadhya Homestay Hampi" } });
  });

  test("registered as the plan_events_done op", async () => {
    hampi(); const pl = plan("g1"); const p = platform();
    const r = await ops.plan_events_done!({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, { platform: p.ctx } as any);
    expect(r).toMatchObject({ done: true });
  });
});

describe("steps must fit the event's type and kind (planning step tiers M4)", () => {
  const meeting = (loc: string | null = null) => {
    seed("m1", "Investor pitch", "2026-10-09", new Date(2026, 9, 9, 15, 0).getTime());
    if (loc) S._db.query("UPDATE events SET location = ? WHERE event_key = 'm1'").run(loc);
  };
  const step = (kind: string, key = kind, extra: object = {}) => ({ key, kind, title: "t", dueDate: "2026-10-08", why: "w", ...extra });
  const report = async (type: unknown, steps: any[], p = platform()) => {
    S._db.exec("DELETE FROM plans"); // each report is its own plan
    const pl = plan("m1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", ...(type === undefined ? {} : { type }), steps }] }, p.ctx, NOW);
    return { r, p };
  };

  test("an entry with no type, or an unknown one, is refused and the event stays unplanned", async () => {
    meeting();
    for (const type of [undefined, "trip"]) {
      const { r } = await report(type, []);
      expect(r.refused).toEqual([{ item: "e1", reason: "type must be one of journey, stay, occasion, appointment, meeting, reminder, block, other" }]);
      expect(P.plannedMark("acct", "m1")).toBeNull();
    }
  });

  test("reminder, block and other get no steps; with steps: [] they are planned, and the type is stored", async () => {
    meeting();
    for (const type of ["reminder", "block", "other"]) {
      const { r, p } = await report(type, [step("other")]);
      expect(r.refused).toEqual([{ item: "e1", reason: `a ${type} gets no steps` }]);
      expect(p.published).toEqual([]);
      expect(P.plannedMark("acct", "m1")).toBeNull();
    }
    const { r } = await report("reminder", []);
    expect(r.done).toBe(true);
    expect(P.plannedMark("acct", "m1")!.type).toBe("reminder");
  });

  test("a kind that does not fit the type is refused: checkin on a meeting, pack on an appointment, cab-local on a stay", async () => {
    meeting();
    expect((await report("meeting", [step("checkin")])).r.refused[0].reason).toBe("checkin does not fit a meeting");
    expect((await report("appointment", [step("pack")])).r.refused[0].reason).toBe("pack does not fit an appointment");
    hampi(); S._db.exec("DELETE FROM plans");
    const pl = plan("g1"); const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("cab-local", "cab")] }] }, p.ctx, NOW);
    expect(r.refused).toEqual([{ item: "e1/cab", reason: "cab-local does not fit a stay" }]);
    expect(p.published).toEqual([]);
  });

  test("an unknown or missing kind is refused with the list", async () => {
    meeting();
    const { r } = await report("meeting", [step("teleport"), { ...step("other", "nokind"), kind: undefined }]);
    expect(r.refused.map((x: any) => x.reason)).toEqual(Array(2).fill(expect.stringMatching(/^kind must be one of checkin, cab-airport, .*, other$/)));
  });

  test("cab-local needs the event's location", async () => {
    meeting();
    expect((await report("meeting", [step("cab-local")])).r.refused[0].reason).toBe("cab-local needs the event's location");
    S._db.query("UPDATE events SET location = 'WeWork, Indiranagar' WHERE event_key = 'm1'").run();
    expect((await report("meeting", [step("cab-local")])).r.accepted).toEqual(["e1/cab-local"]);
  });

  test("at most one prepare-ahead per meeting, within a report and against an open one", async () => {
    meeting();
    const { r } = await report("meeting", [step("prepare-ahead", "prep-a"), step("prepare-ahead", "prep-b")]);
    expect(r.accepted).toEqual(["e1/prep-a"]);
    expect(r.refused).toEqual([{ item: "e1/prep-b", reason: "at most one prepare-ahead per meeting" }]);
    const openPrep: TaskState = { sourceRef: "step:m1:prep-a", status: "open", title: "Prepare", due: null, dueTimed: false, showFrom: null, updatedAt: 0 };
    const again = await report("meeting", [step("prepare-ahead", "prep-c")], platform({ tasks: [openPrep] }));
    expect(again.r.refused[0].reason).toBe("at most one prepare-ahead per meeting");
    expect((await report("meeting", [step("prepare-ahead", "prep-a")], platform({ tasks: [openPrep] }))).r.accepted).toEqual(["e1/prep-a"]);
  });

  test("a kind the owner skipped twice is refused with the guard text; a skip then a done is not", async () => {
    hampi();
    const day = 86_400_000, closed = (key: string, ago: number, skipped: boolean): any => ({ ...closedTask(`step:g0:${key}`, skipped ? "dismissed" : "done"), ...(skipped ? { skipped: true } : {}), closedAt: NOW.getTime() - ago * day });
    for (const k of ["a", "b", "c"]) P.recordStep("acct", "g0", k, "cab-airport");
    const pl = plan("g1"); const p = platform({ tasks: [closed("a", 5, true), closed("b", 3, true)] });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("cab-airport", "cab")] }] }, p.ctx, NOW);
    expect(r.refused).toEqual([{ item: "e1/cab", reason: "the user dismissed the last two cab-airport steps" }]);
    expect(p.published).toEqual([]);
    const p2 = platform({ tasks: [closed("a", 5, true), closed("b", 3, true), closed("c", 1, false)] });
    expect(((await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("cab-airport", "cab")] }] }, p2.ctx, NOW)) as any).accepted).toEqual(["e1/cab"]);
  });

  test("judgement kinds are never switched off: two skipped other steps do not refuse a third", async () => {
    hampi();
    const closed = (key: string): any => ({ ...closedTask(`step:g0:${key}`), skipped: true, closedAt: NOW.getTime() - 86_400_000 });
    for (const k of ["a", "b"]) P.recordStep("acct", "g0", k, "other");
    const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("other", "misc")] }] }, platform({ tasks: [closed("a"), closed("b")] }).ctx, NOW);
    expect(r.accepted).toEqual(["e1/misc"]);
  });

  test("skips of steps recorded as covered do not switch a kind off", async () => {
    hampi();
    const closed = (key: string): any => ({ ...closedTask(`step:g0:${key}`), skipped: true, closedAt: NOW.getTime() - 86_400_000 });
    for (const k of ["a", "b"]) { P.recordStep("acct", "g0", k, "cab-airport"); P.setStepCovered("acct", "g0", k); }
    const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("cab-airport", "cab")] }] }, platform({ tasks: [closed("a"), closed("b")] }).ctx, NOW);
    expect(r.accepted).toEqual(["e1/cab"]);
  });

  test("the published task carries its kind; a re-dated step keeps it (the cap update sends no context); a pre-migration step with no kind is not refused", async () => {
    hampi();
    const { r, p } = await (async () => { const pl = plan("g1"); const p = platform(); return { r: await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW) as any, p }; })();
    expect(r.accepted).toEqual(["e1/pack"]);
    expect(p.published[0].context.kind).toBe("pack");
    expect(P.stepKindsFor("acct").get("step:g1:pack")).toBe("pack");

    S._db.exec("DELETE FROM plans; DELETE FROM planned; DELETE FROM plan_steps");
    P.markPlanned([{ accountId: "acct", eventKey: "g1", date: "2026-10-10", startAt: null }], NOW.getTime() - 86_400_000);
    P.recordStep("acct", "g1", "cab"); // recorded before kinds existed
    const pl = plan("g1");
    const open: TaskState = { sourceRef: "step:g1:cab", status: "open", title: "Book a cab", due: new Date(2026, 9, 9).getTime(), dueTimed: false, showFrom: null, updatedAt: 0 };
    const p2 = platform({ tasks: [open] });
    const r2: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p2.ctx, NOW);
    expect(r2).toEqual({ accepted: [], refused: [], done: true });
    expect(p2.published).toHaveLength(1);
    expect(p2.published[0]).not.toHaveProperty("context");
    expect(P.plannedMark("acct", "g1")!.type).toBe("stay");
  });
  test("C4: another account's two skips switch a kind off here", async () => {
    hampi();
    for (const k of ["a", "b"]) P.recordStep("acct2", "h1", k, "cab-airport");
    const skip = (k: string, ago: number): any => ({ ...closedTask(`step:h1:${k}`), skipped: true, closedAt: NOW.getTime() - ago * 86_400_000 });
    const pl = plan("g1");
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [step("cab-airport", "cab")] }] }, platform({ tasks: [skip("a", 3), skip("b", 2)] }).ctx, NOW);
    expect(r.refused).toEqual([{ item: "e1/cab", reason: "the user dismissed the last two cab-airport steps" }]);
  });
  test("a report reads no ask: rows", async () => {
    hampi();
    const lists: any[] = [];
    const p = platform();
    const list = (p.ctx as any).tasks.list;
    (p.ctx as any).tasks.list = async (o: any) => { lists.push(o); return list(o); };
    await handlePlanReport({ planId: plan("g1").planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(lists.map((o) => o.prefix)).toEqual(["step:"]);
  });
});

describe("cover: a step the owner already has as a TODO is recorded as covered", () => {
  const cab = { key: "cab", kind: "cab-airport", title: "Book a cab to the airport", dueDate: "2026-10-11", why: "a flight" };
  const coveredRow = (S._db.query("SELECT covered FROM plan_steps WHERE account_id = 'acct' AND event_key = ? AND step_key = ?"));

  test("covered answer: reported as covered, plan_steps.covered = 1, the event is planned", async () => {
    seed("g1", "Flight to Goa", "2026-10-12"); const pl = plan("g1");
    const p = platform({ publish: () => ok({ covered: { todoId: "t1" } }) });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "journey", steps: [cab] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/cab covered by a TODO"], refused: [], done: true });
    expect(p.published[0].cover).toEqual({ kind: "cab-airport", eventTitle: "Flight to Goa", eventLocation: undefined, eventDate: "2026-10-12" });
    expect((coveredRow.get("g1", "cab") as any).covered).toBe(1);
    expect(P.plannedMark("acct", "g1")).toBeTruthy();
  });

  test("a judgement kind sends no cover", async () => {
    seed("g1", "Flight to Goa", "2026-10-12"); const pl = plan("g1");
    const p = platform();
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "journey", steps: [{ key: "docs", kind: "documents", title: "Carry passport", dueDate: "2026-10-11", why: "abroad" }] }] }, p.ctx, NOW);
    expect("cover" in p.published[0]).toBe(false);
  });

  test("an answer without data (older Flock) is recorded as published", async () => {
    seed("g1", "Flight to Goa", "2026-10-12"); const pl = plan("g1");
    const p = platform();
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "journey", steps: [cab] }] }, p.ctx, NOW);
    expect(r.accepted).toEqual(["e1/cab"]);
    expect((coveredRow.get("g1", "cab") as any).covered).toBeNull();
  });
});

describe("tie: the owner's TODOs that match a planned event are tied to it (amendment 1, B2)", () => {
  test("a planned event is tied once, with its pointer, title, date and limit; no location or link when it has none", async () => {
    hampi(); const pl = plan("g1");
    const p = platform({ tie: () => ok({ tied: 1 }) });
    const r: any = await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "stay", steps: [pack] }] }, p.ctx, NOW);
    expect(r).toEqual({ accepted: ["e1/pack"], refused: [], done: true });
    expect(p.ties).toEqual([{ pointer: "calendar-desk:g1", eventTitle: "Stay at The Loft - Aadhya Homestay Hampi", eventDate: "2026-10-12",
      maxDue: new Date(2026, 9, 12, 23, 59, 59, 999).getTime(), maxDueReason: "Stay at The Loft - Aadhya Homestay Hampi, Mon 12 Oct" }]);
  });
  test("an event from a memory fact sends its mail link; a located event sends its location; steps: [] is tied too", async () => {
    S.upsertFactEvent({ accountId: "acct", factId: 7, title: "Flight to Goa", localDate: "2026-10-12", startAt: null, sourceLink: "https://mail.google.com/mail/?authuser=a%40b.com#all/thr7" }, NOW.getTime());
    seed("d1", "Dentist", "2026-10-09", new Date(2026, 9, 9, 10, 0).getTime());
    S._db.query("UPDATE events SET location = ? WHERE event_key = 'd1'").run("Apollo Clinic, Jayanagar");
    const pl = plan(S.factEventKey(7), "d1");
    const p = platform({ tie: () => ok({ tied: 0 }) });
    await handlePlanReport({ planId: pl.planId, events: [{ event: "e1", type: "journey", steps: [] }, { event: "e2", type: "appointment", steps: [] }] }, p.ctx, NOW);
    expect(p.ties.map((t) => [t.pointer, t.sourceLink, t.eventLocation])).toEqual([
      [`calendar-desk:${S.factEventKey(7)}`, "https://mail.google.com/mail/?authuser=a%40b.com#all/thr7", undefined],
      ["calendar-desk:d1", undefined, "Apollo Clinic, Jayanagar"],
    ]);
  });
  test("an older Flock (404) or an older SDK (no tie) plans the event as before, without a warning for the 404", async () => {
    const warn = console.warn; const warned: unknown[] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
    try {
      hampi();
      const p404 = platform({ tie: () => failed("platform 404: Not Found", 404) });
      expect(await handlePlanReport({ planId: plan("g1").planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p404.ctx, NOW)).toEqual({ accepted: [], refused: [], done: true });
      expect(warned).toEqual([]);
      S._db.exec("DELETE FROM plans; DELETE FROM planned");
      expect(await handlePlanReport({ planId: plan("g1").planId, events: [{ event: "e1", type: "stay", steps: [] }] }, platform().ctx, NOW)).toEqual({ accepted: [], refused: [], done: true });
    } finally { console.warn = warn; }
  });
  test("any other failure is logged once and the event stays planned", async () => {
    const warn = console.warn; const warned: unknown[] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
    try {
      hampi();
      const p = platform({ tie: () => failed("platform 500", 500) });
      const r: any = await handlePlanReport({ planId: plan("g1").planId, events: [{ event: "e1", type: "stay", steps: [] }] }, p.ctx, NOW);
      expect(r.done).toBe(true);
      expect(P.plannedMark("acct", "g1")).toBeTruthy();
      expect(warned).toHaveLength(1);
    } finally { console.warn = warn; }
  });
  test("an event left unplanned (a refused step) is not tied", async () => {
    hampi();
    const p = platform({ tie: () => ok({ tied: 0 }) });
    await handlePlanReport({ planId: plan("g1").planId, events: [{ event: "e1", type: "stay", steps: [{ ...pack, dueDate: "2000-01-01" }] }] }, p.ctx, NOW);
    expect(p.ties).toEqual([]);
  });
});
