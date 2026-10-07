// The planner eval fixtures and their grader agree, without a model: every case's own expected answer, run through the
// real bundle builder and handlePlanReport, passes its expectations; and a do-nothing answer fails every case that needs action.
import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-eval-fixtures-"));
const { PLAN_CASES, TODAY, isoAdd } = await import("../../evals/fixtures");
const H = await import("../../evals/harness");

describe("planner eval fixtures", () => {
  test("28 cases with unique ids", () => {
    expect(PLAN_CASES.length).toBe(28);
    expect(new Set(PLAN_CASES.map((c) => c.id)).size).toBe(28);
    expect(PLAN_CASES.map((c) => c.id)).toContain("multi-day-stay-gets-a-packing-step");
    expect(PLAN_CASES.map((c) => c.id)).toContain("moved-timed-step-keeps-lead-time");
  });
  for (const c of PLAN_CASES) {
    test(`${c.id}: its own answer passes the grader`, async () => {
      const pl = await H.plan(c);
      expect(pl.payload.events.length).toBe(c.events.filter((e) => e.offered !== false).length);
      expect(await H.grade(c, pl, H.callsFor(c, pl))).toEqual([]);
    });
  }
  test("the bundle carries the shape the instructions describe", async () => {
    const c = PLAN_CASES.find((x) => x.id === "changed-event-redates-same-step")!;
    const { payload } = await H.plan(c);
    expect(Object.keys(payload).sort()).toEqual(["events", "habits", "nowLocal", "planId", "timezone", "today"]);
    expect(payload.events[0]).toMatchObject({ ref: "e1", change: "changed", allDay: false, time: "06:10", was: { date: isoAdd(TODAY, 2), time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512" }] });
    expect(payload.events[0].event).toStartWith("calendar-desk:");
  });
  test("a timed existing step shows its time in the bundle", async () => {
    const c = PLAN_CASES.find((x) => x.id === "moved-timed-step-keeps-lead-time")!;
    const { payload } = await H.plan(c);
    expect(payload.events[0].steps[0]).toMatchObject({ key: "cab", dueTime: "17:30" });
    expect(payload.events[0].was).toMatchObject({ time: "18:00" });
  });
  test("a reply without calls, or with a bad step, fails", async () => {
    const c = PLAN_CASES[0]!;
    const pl = await H.plan(c);
    expect((await H.grade(c, pl, null))[0]).toContain("no parseable");
    const bad = [{ method: "POST", path: "/api/apps/calendar-desk/ops/plan_events_done", body: { planId: pl.payload.planId, events: [{ event: "e1", type: "journey", steps: [{ key: "x", kind: "other", title: "Late", dueDate: "2000-01-01", why: "w" }] }] } }];
    expect((await H.grade(c, pl, bad)).some((p) => p.startsWith("refused e1/x"))).toBe(true);
  });
  test("a do-nothing answer fails the cases that need a step", async () => {
    for (const id of ["flight-in-2-days", "multi-day-stay-gets-a-packing-step", "birthday-close-family", "moved-timed-step-keeps-lead-time"]) {
      const c = PLAN_CASES.find((x) => x.id === id)!;
      const pl = await H.plan(c);
      const empty = [{ method: "POST", path: "/api/apps/calendar-desk/ops/plan_events_done", body: { planId: pl.payload.planId, events: pl.payload.events.map((e: any) => ({ event: e.ref, type: H.typeOfTitle(c.events.find((x) => x.ref === pl.refOf[e.ref])?.title ?? ""), steps: [] })) } }];
      expect((await H.grade(c, pl, empty)).length).toBeGreaterThan(0);
    }
  });
  test("extractCalls reads every calls block, in order", () => {
    expect(H.extractCalls("x\n```calls\n[{\"method\":\"GET\",\"path\":\"/a\"}]\n```")).toEqual([{ method: "GET", path: "/a" }]);
    expect(H.extractCalls("```calls\n[{\"method\":\"PATCH\",\"path\":\"/t\"}]\n```\n```calls\n[{\"method\":\"POST\",\"path\":\"/r\"}]\n```"))
      .toEqual([{ method: "PATCH", path: "/t" }, { method: "POST", path: "/r" }]);
    expect(H.extractCalls("```calls\n[]\n```\n```calls\nnot json\n```")).toBeNull();
    expect(H.extractCalls("no block")).toBeNull();
  });
});
