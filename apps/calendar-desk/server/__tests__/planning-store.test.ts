import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-planning-"));
const S = await import("../store");
const P = await import("../planning-store");

function wipe() { for (const t of ["events", "cursors", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

const NOW = new Date(2026, 9, 6, 12, 0, 0); // local 2026-10-06 noon
const T0 = NOW.getTime();
const HOUR = 3600_000;
function seed(key: string, localDate: string, startAt: number | null = null, over: { details?: boolean; fact?: boolean; acct?: string } = {}) {
  const acct = over.acct ?? "acct";
  if (over.fact) {
    S.upsertFactEvent({ accountId: acct, factId: Number(key.replace(/\D/g, "") || 1), title: key, localDate, startAt, sourceLink: null }, T0);
    return;
  }
  S.upsertEvents(acct, [{ eventKey: key, calendar: null, title: key, startAt, endAt: null, allDay: startAt == null, localDate, attendeesText: null, location: null, rawTimeText: null, googleEventId: key }], T0);
  if (over.details !== false) S.saveEventDetails(acct, key, { location: "x" }, T0);
}
const ref = (key: string, date: string, startAt: number | null = null, acct = "acct") => ({ accountId: acct, eventKey: key, date, startAt });
const keys = (now = NOW) => P.eventsToPlan(now).map((e) => e.eventKey);

describe("planned-event markers", () => {
  test("a new event is offered as new", () => {
    seed("a", "2026-11-01");
    expect(P.eventsToPlan(NOW).map((e) => e.change)).toEqual(["new"]);
  });
  test("a marked event is not offered", () => {
    seed("a", "2026-11-01", 5);
    P.markPlanned([ref("a", "2026-11-01", 5)], 1000);
    expect(keys()).toEqual([]);
    expect(P.plannedMark("acct", "a")).toEqual({ date: "2026-11-01", startAt: 5, plannedAt: 1000 });
  });
  test("a moved date is changed", () => {
    seed("a", "2026-11-02");
    P.markPlanned([ref("a", "2026-11-01")], 1);
    expect(P.eventsToPlan(NOW).map((e) => e.change)).toEqual(["changed"]);
  });
  test("a moved start time is changed", () => {
    seed("a", "2026-11-01", 9);
    P.markPlanned([ref("a", "2026-11-01", 5)], 1);
    expect(P.eventsToPlan(NOW).map((e) => e.change)).toEqual(["changed"]);
  });
  test("nearest first", () => {
    seed("b", "2026-12-01"); seed("a", "2026-11-01", 9); seed("c", "2026-11-01", 3);
    expect(keys()).toEqual(["c", "a", "b"]);
  });
  test("prune drops past marks only", () => {
    P.markPlanned([ref("old", "2026-10-01"), ref("new", "2026-10-05")], 1);
    P.prunePlanned("2026-10-05");
    expect(P.plannedMark("acct", "old")).toBeNull();
    expect(P.plannedMark("acct", "new")).not.toBeNull();
  });
  test("marks are per account", () => {
    P.markPlanned([ref("a", "2026-11-01", null, "one")], 1);
    expect(P.plannedMark("two", "a")).toBeNull();
  });
  test("events outside today..+90d and missing events are not offered", () => {
    seed("past", "2026-10-05"); seed("far", "2027-02-01"); seed("gone", "2026-11-01");
    S.markMissingEvents("acct", ["2026-11-01"], [], 5);
    expect(keys()).toEqual([]);
  });
});

describe("selection", () => {
  test("details not read, 5 days out: waits 2h after first seen, then is offered", () => {
    seed("w", "2026-10-11", null, { details: false });
    expect(keys(NOW)).toEqual([]);
    expect(keys(new Date(T0 + HOUR))).toEqual([]);
    expect(keys(new Date(T0 + 2 * HOUR + 1))).toEqual(["w"]);
  });
  test("the wait survives a restart (persisted cursor)", () => {
    seed("w", "2026-10-11", null, { details: false });
    keys(NOW);
    expect(S.getCursor("details_wait:acct:w")).toBe(String(T0));
  });
  test("details not read but dated tomorrow: offered at once", () => {
    seed("t", "2026-10-07", null, { details: false });
    expect(keys()).toEqual(["t"]);
  });
  test("details read clears the wait", () => {
    seed("w", "2026-10-11", null, { details: false });
    keys(NOW);
    S.saveEventDetails("acct", "w", { location: "x" }, T0 + 1);
    expect(keys(NOW)).toEqual(["w"]);
    expect(S.getCursor("details_wait:acct:w")).toBeNull();
  });
  test("25 eligible events: 20, nearest first", () => {
    for (let i = 0; i < 25; i++) seed(`e${String(i).padStart(2, "0")}`, `2026-11-${String(i + 1).padStart(2, "0")}`);
    const out = keys();
    expect(out.length).toBe(P.PLAN_EVENTS_MAX);
    expect(out[0]).toBe("e00"); expect(out[19]).toBe("e19");
  });
  test("memory (fact:) events are offered", () => {
    seed("f1", "2026-11-03", null, { fact: true });
    expect(keys()).toEqual(["fact:1"]);
  });
});

describe("plans and steps", () => {
  const evs = () => [{ ref: "e1", ...ref("a", "2026-11-01", 5) }, { ref: "e2", ...ref("b", "2026-11-02") }];
  test("create, open, session, answer", () => {
    const p = P.createPlan(evs(), 100);
    expect(P.openPlan()!.planId).toBe(p.planId);
    P.setPlanSession(p.planId, "s1");
    expect(P.getPlan(p.planId)).toMatchObject({ sessionId: "s1", createdAt: 100, answeredAt: null, abandonedAt: null, badReports: 0 });
    expect(P.getPlan(p.planId)!.events.length).toBe(2);
    P.answerPlan(p.planId, 200);
    expect(P.openPlan()).toBeNull();
    expect(P.getPlan(p.planId)!.answeredAt).toBe(200);
  });
  test("noteBadReport counts", () => {
    const p = P.createPlan(evs(), 1);
    expect(P.noteBadReport(p.planId)).toBe(1);
    expect(P.noteBadReport(p.planId)).toBe(2);
  });
  test("abandon twice for the same event marks it planned; once keeps it offered", () => {
    seed("a", "2026-11-01", 5);
    const e = [{ ref: "e1", ...ref("a", "2026-11-01", 5) }];
    const p1 = P.createPlan(e, 1);
    P.abandonPlan(p1.planId, 2);
    expect(P.openPlan()).toBeNull();
    expect(keys()).toEqual(["a"]);
    const p2 = P.createPlan(e, 3);
    P.abandonPlan(p2.planId, 4);
    expect(P.plannedMark("acct", "a")).toMatchObject({ date: "2026-11-01", startAt: 5, plannedAt: 4 });
    expect(keys()).toEqual([]);
    expect(P.stepKeysFor("acct", "a")).toEqual([]);
  });
  test("countTry:false abandons without counting", () => {
    seed("a", "2026-11-01");
    const e = [{ ref: "e1", ...ref("a", "2026-11-01") }];
    for (let i = 0; i < 3; i++) P.abandonPlan(P.createPlan(e, i).planId, i, { countTry: false });
    expect(keys()).toEqual(["a"]);
  });
  test("a moved event starts its tries again", () => {
    seed("a", "2026-11-01");
    P.abandonPlan(P.createPlan([{ ref: "e1", ...ref("a", "2026-11-01") }], 1).planId, 2);
    P.abandonPlan(P.createPlan([{ ref: "e1", ...ref("a", "2026-11-02") }], 3).planId, 4);
    expect(P.plannedMark("acct", "a")).toBeNull();
  });
  test("step keys: record, list, forget with the mark", () => {
    P.markPlanned([ref("a", "2026-11-01")], 1);
    P.recordStep("acct", "a", "book-cab"); P.recordStep("acct", "a", "book-cab"); P.recordStep("acct", "a", "pack");
    expect(P.stepKeysFor("acct", "a").sort()).toEqual(["book-cab", "pack"]);
    P.forgetEvent("acct", "a");
    expect(P.stepKeysFor("acct", "a")).toEqual([]);
    expect(P.plannedMark("acct", "a")).toBeNull();
  });
});
