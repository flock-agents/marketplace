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
    expect(P.plannedMark("acct", "a")).toEqual({ date: "2026-11-01", startAt: 5, plannedAt: 1000, type: null });
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
  test("abandoning a moved, planned event keeps its mark; SILENT_END_MAX marks it at the new date/start", () => {
    seed("a", "2026-11-02", 9);
    P.markPlanned([ref("a", "2026-11-01", 5)], 10);
    const e = [{ ref: "e1", ...ref("a", "2026-11-02", 9) }];
    P.abandonPlan(P.createPlan(e, 1).planId, 2);
    expect(P.plannedMark("acct", "a")).toEqual({ date: "2026-11-01", startAt: 5, plannedAt: 10, type: null });
    expect(P.eventsToPlan(NOW).map((x) => x.change)).toEqual(["changed"]);
    P.abandonPlan(P.createPlan(e, 3).planId, 4);
    expect(P.plannedMark("acct", "a")).toEqual({ date: "2026-11-02", startAt: 9, plannedAt: 4, type: null });
    expect(keys()).toEqual([]);
    expect(P.stepKeysFor("acct", "a")).toEqual([]);
  });
  test("prune also drops details_wait cursors of past events", () => {
    seed("p", "2026-10-05", null, { details: false });
    S.setCursor("details_wait:acct:p", "1"); S.setCursor("details_wait:acct:q", "1");
    seed("q", "2026-10-09", null, { details: false });
    P.prunePlanned("2026-10-06");
    expect(S.getCursor("details_wait:acct:p")).toBeNull();
    expect(S.getCursor("details_wait:acct:q")).toBe("1");
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

describe("step kinds and event types", () => {
  test("recordStep remembers a kind and stepKindsFor maps source refs to it", () => {
    P.recordStep("acct", "e1", "gift", "gift");
    P.recordStep("acct", "e1", "x");
    P.recordStep("other", "e1", "pack", "pack");
    expect(P.stepKindsFor("acct")).toEqual(new Map([["step:e1:gift", "gift"]]));
    expect(P.stepKeysFor("acct", "e1")).toEqual(["gift", "x"]);
  });
  test("a recorded step keeps its first kind", () => {
    P.recordStep("acct", "e1", "k", "pack"); P.recordStep("acct", "e1", "k", "gift");
    expect(P.stepKindsFor("acct").get("step:e1:k")).toBe("pack");
  });
  test("a planned mark carries its type; an old mark reads null; re-marking without a type keeps it", () => {
    P.markPlanned([{ ...ref("a", "2026-11-01"), type: "meeting" }, ref("b", "2026-11-01")], 5);
    expect(P.plannedMark("acct", "a")?.type).toBe("meeting");
    expect(P.plannedMark("acct", "b")?.type).toBeNull();
    P.markPlanned([ref("a", "2026-11-02")], 6);
    expect(P.plannedMark("acct", "a")?.type).toBe("meeting");
    P.markPlanned([{ ...ref("a", "2026-11-02"), type: "stay" }], 7);
    expect(P.plannedMark("acct", "a")?.type).toBe("stay");
  });
  test("setStepCovered marks only that step", () => {
    P.recordStep("acct", "e1", "a", "gift"); P.recordStep("acct", "e1", "b", "pack");
    P.setStepCovered("acct", "e1", "a");
    const rows = S._db.query("SELECT step_key, covered FROM plan_steps ORDER BY step_key").all();
    expect(rows).toEqual([{ step_key: "a", covered: 1 }, { step_key: "b", covered: null }]);
  });
  test("backfillKind reads the title: airport, station, else local", () => {
    for (const k of ["c1", "c2", "c3"]) P.recordStep("acct", "e1", k);
    expect(P.backfillKind("acct", "e1", "c1", "Book a cab to the Airport")).toBe("cab-airport");
    expect(P.backfillKind("acct", "e1", "c2", "Ride to Pune station")).toBe("cab-station");
    expect(P.backfillKind("acct", "e1", "c3", "Book a cab for the dentist")).toBe("cab-local");
  });
  test("backfillKind never overwrites a kind", () => {
    P.recordStep("acct", "e1", "cab", "cab-station");
    expect(P.backfillKind("acct", "e1", "cab", "cab to the airport")).toBeNull();
    expect(P.stepKindsFor("acct").get("step:e1:cab")).toBe("cab-station");
  });
});

describe("step places", () => {
  test("recordStep keeps a place; allStepPlaces maps source refs to kind and place; a step without one is left out", () => {
    P.recordStep("acct", "e1", "cab", "cab-local", "apollo clinic");
    P.recordStep("acct", "e1", "pack", "pack");
    P.recordStep("acct", "e1", "cab", "cab-local", "other place"); // first one wins
    expect(P.allStepPlaces()).toEqual(new Map([["step:e1:cab", { kind: "cab-local", place: "apollo clinic" }]]));
  });
});

describe("migration of a database from before kinds", () => {
  test("gains the columns and backfills kinds from keys, leaving cab and travel null", async () => {
    const { Database } = await import("bun:sqlite");
    const { spawnSync } = await import("child_process");
    const dir = mkdtempSync(join(tmpdir(), "calendar-desk-old-"));
    const old = new Database(join(dir, "calendar-desk.db"));
    const upto = S.KINDS_MIGRATION_IDX + 1; // every migration before the kinds one
    expect(upto).toBeGreaterThan(0);
    old.exec("CREATE TABLE _migrations (idx INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    for (let i = 0; i < upto - 1; i++) old.query("INSERT INTO _migrations VALUES (?, 1)").run(i);
    old.exec(`CREATE TABLE planned (account_id TEXT NOT NULL, event_key TEXT NOT NULL, date TEXT NOT NULL, start_at INTEGER, planned_at INTEGER, failed_tries INTEGER NOT NULL DEFAULT 0, try_date TEXT, try_start_at INTEGER, PRIMARY KEY (account_id, event_key));
      CREATE TABLE plan_steps (account_id TEXT NOT NULL, event_key TEXT NOT NULL, step_key TEXT NOT NULL, PRIMARY KEY (account_id, event_key, step_key));
      INSERT INTO planned (account_id, event_key, date, planned_at) VALUES ('a', 'e', '2026-11-01', 9);`);
    for (const k of ["checkin", "pack", "gift", "book-tickets", "cab", "travel"]) old.query("INSERT INTO plan_steps VALUES ('a', 'e', ?)").run(k);
    old.close();
    const script = `const S = await import(${JSON.stringify(join(import.meta.dir, "../store"))}); const P = await import(${JSON.stringify(join(import.meta.dir, "../planning-store"))});
      console.log(JSON.stringify({ kinds: [...P.stepKindsFor("a")], mark: P.plannedMark("a", "e"), covered: S._db.query("SELECT covered FROM plan_steps LIMIT 1").get() }));`;
    const r = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, APP_DATA_DIR: dir }, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      kinds: [["step:e:checkin", "checkin"], ["step:e:pack", "pack"], ["step:e:gift", "gift"], ["step:e:book-tickets", "book-opening"]],
      mark: { date: "2026-11-01", startAt: null, plannedAt: 9, type: null }, covered: { covered: null },
    });
  });
});

describe("migration of a database from before places", () => {
  test("a database from before places gains plan_steps.place, existing rows null", async () => {
    const { Database } = await import("bun:sqlite");
    const { spawnSync } = await import("child_process");
    const dir = mkdtempSync(join(tmpdir(), "calendar-desk-old-place-"));
    const old = new Database(join(dir, "calendar-desk.db"));
    const upto = (S._db.query("SELECT MAX(idx) AS m FROM _migrations").get() as { m: number }).m; // every migration but this one
    old.exec("CREATE TABLE _migrations (idx INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    for (let i = 0; i < upto; i++) old.query("INSERT INTO _migrations VALUES (?, 1)").run(i);
    old.exec(`CREATE TABLE plan_steps (account_id TEXT NOT NULL, event_key TEXT NOT NULL, step_key TEXT NOT NULL, kind TEXT, covered INTEGER, PRIMARY KEY (account_id, event_key, step_key));
      INSERT INTO plan_steps VALUES ('a', 'e', 'cab', 'cab-local', NULL);`);
    old.close();
    const script = `const S = await import(${JSON.stringify(join(import.meta.dir, "../store"))});
      console.log(JSON.stringify(S._db.query("SELECT step_key, place FROM plan_steps").all()));`;
    const r = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, APP_DATA_DIR: dir }, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual([{ step_key: "cab", place: null }]);
  });
});

describe("an instance upgraded from the ask card", () => {
  test("plan_asks and plan_held rows on disk are left alone and nothing fails without them", () => {
    S._db.exec(`CREATE TABLE IF NOT EXISTS plan_asks (kind TEXT PRIMARY KEY, published_at INTEGER NOT NULL, facts_json TEXT NOT NULL, answer_reported TEXT, memory_written TEXT);
      CREATE TABLE IF NOT EXISTS plan_held (account_id TEXT NOT NULL, event_key TEXT NOT NULL, kind TEXT NOT NULL, held_at INTEGER NOT NULL, PRIMARY KEY (account_id, event_key, kind));
      INSERT OR IGNORE INTO plan_asks VALUES ('cab-local', 1, '[]', 'yes', 'yes');
      INSERT OR IGNORE INTO plan_held VALUES ('acct', 'a', 'cab-local', 1);`);
    P.markPlanned([ref("a", "2026-11-01")], 1);
    P.recordStep("acct", "a", "cab", "cab-local");
    P.forgetEvent("acct", "a");
    expect(P.plannedMark("acct", "a")).toBeNull();
    expect(S._db.query("SELECT COUNT(*) AS n FROM plan_held").get()).toEqual({ n: 1 });
    expect(S._db.query("SELECT COUNT(*) AS n FROM plan_asks").get()).toEqual({ n: 1 });
    S._db.exec("DROP TABLE plan_asks; DROP TABLE plan_held");
    P.markPlanned([ref("b", "2026-11-01")], 1);
    expect(() => P.forgetEvent("acct", "b")).not.toThrow();
  });
});
