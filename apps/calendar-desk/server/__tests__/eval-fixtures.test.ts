// The planner eval fixtures and their grader agree, without a model: every case's own expected answer, run through the
// real bundle builder and handlePlanReport, passes its expectations; its wrong answer fails them; a do-nothing answer fails
// every case that needs action; and every scripted report a case says Calendar Desk refuses is refused.
import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-eval-fixtures-"));
const { PLAN_CASES, TODAY, isoAdd } = await import("../../evals/fixtures");
const H = await import("../../evals/harness");

describe("planner eval fixtures", () => {
  test("62 cases with unique ids, every event typed", () => {
    expect(PLAN_CASES.length).toBe(62);
    expect(new Set(PLAN_CASES.map((c) => c.id)).size).toBe(62);
    const ids = PLAN_CASES.map((c) => c.id);
    for (const id of ["multi-day-stay-gets-a-packing-step", "moved-timed-step-keeps-lead-time", "stay-far-away-pack-only", "birthday-daughter-A", "birthday-daughter-B", "birthday-daughter-C",
      "appointment-tally-on", "appointment-uber-fact", "dinner-table-on", "work-flight-office-calendar",
      "place-done-once", "place-skipped-twice", "place-on-beats-kind-off", "place-off-beats-kind-on", "kind-on-new-place", "first-time-office-room",
      "first-time-dinner-restaurant", "birthday-yearly-gift", "stated-no-beats-place"]) expect(ids).toContain(id);
    expect(ids).not.toContain("birthday-close-family");
    for (const c of PLAN_CASES) for (const e of c.events) expect(`${c.id}/${e.ref}:${e.type ?? "untyped"}`).not.toEndWith(":untyped");
  });
  for (const c of PLAN_CASES) {
    test(`${c.id}: its own answer passes the grader${c.runs ? ` on each of ${c.runs} runs` : ""}`, async () => {
      for (let i = 0; i < (c.runs ?? 1); i++) {
        const pl = await H.plan(c);
        expect(pl.payload.events.length).toBe(c.events.filter((e) => e.offered !== false).length);
        expect(await H.grade(c, pl, H.callsFor(c, pl))).toEqual([]);
      }
    });
    test(`${c.id}: its wrong answer fails the grader`, async () => {
      const pl = await H.plan(c);
      expect((await H.grade(c, pl, H.callsFor(c, pl, c.wrong))).length).toBeGreaterThan(0);
    });
    for (const d of c.dry ?? []) {
      test(`${c.id}: dry, ${d.name} is refused`, async () => {
        const pl = await H.plan(c);
        expect(await H.dryCheck(c, pl, d)).toEqual([]);
      });
    }
  }
  test("the bundle carries the shape the instructions describe", async () => {
    const c = PLAN_CASES.find((x) => x.id === "changed-event-redates-same-step")!;
    const { payload } = await H.plan(c);
    expect(Object.keys(payload).sort()).toEqual(["events", "habits", "nowLocal", "planId", "timezone", "today"]);
    expect(payload.events[0]).toMatchObject({ ref: "e1", change: "changed", allDay: false, time: "06:10", was: { date: isoAdd(TODAY, 2), time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512" }] });
    expect(payload.events[0].event).toStartWith("calendar-desk:");
  });
  test("a habit recorded at a place reaches the bundle as that event's pattern", async () => {
    const c = PLAN_CASES.find((x) => x.id === "place-done-once")!;
    const { payload } = await H.plan(c);
    expect(payload.events[0].pattern).toEqual({ "cab-local": "on" });
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
  test("a report that types an event otherwise fails, whatever its steps", async () => {
    const c = PLAN_CASES.find((x) => x.id === "work-flight-office-calendar")!;
    const pl = await H.plan(c);
    expect((await H.grade(c, pl, H.callsFor(c, pl, { ...c.answer, types: { e1: "stay" } }))).some((p) => p.includes("reported as type \"stay\", expected journey"))).toBe(true);
  });
  test("a scripted report that is not refused fails its dry check", async () => {
    const c = PLAN_CASES.find((x) => x.id === "flight-cab-skip-then-done")!;
    const pl = await H.plan(c);
    // cab-airport is on here (a done after the skip), so the off guard must not fire.
    const problems = await H.dryCheck(c, pl, { name: "cab-airport", report: { e1: { steps: [c.answer.steps.e1![1]!] } }, refused: /dismissed the last two/ });
    expect(problems[0]).toContain("expected a refusal");
  });
  test("a do-nothing answer fails the cases that need a step", async () => {
    // A moved dentist may keep its cab step as it is (its limit is refreshed), so doing nothing is a right answer there.
    const needs = PLAN_CASES.filter((c) => c.id !== "moved-event-later-keeps-step" && (Object.values(c.answer.steps).some((s) => s.length > 0) || c.answer.ties.length > 0));
    expect(needs.length).toBeGreaterThan(30);
    for (const c of needs) {
      const pl = await H.plan(c);
      expect(`${c.id}: ${(await H.grade(c, pl, H.callsFor(c, pl, { steps: {}, ties: [] }))).length}`).not.toBe(`${c.id}: 0`);
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
