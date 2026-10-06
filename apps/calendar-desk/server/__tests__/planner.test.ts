import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, failed, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-planner-"));
const S = await import("../store");
const P = await import("../planning-store");
const { runPlanning, capitalisedRuns } = await import("../planner");

function wipe() { for (const t of ["events", "cursors", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const HOUR = 3600_000;

type TaskState = { sourceRef: string; status: "open" | "done" | "dismissed"; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };
function platform(o: { intent?: () => any; tasks?: TaskState[]; facts?: (q: string) => string[] } = {}) {
  const intents: any[] = [], searches: any[] = [], lists: any[] = [];
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    agent: { intent: async (name: string, payload: any) => { intents.push({ name, payload }); return o.intent ? o.intent() : ok({ sessionId: `s-${intents.length}`, reused: false }); } },
    tasks: { list: async (opts: { prefix?: string } = {}) => { lists.push(opts); return ok({ tasks: (o.tasks ?? []).filter((t) => t.sourceRef.startsWith(opts.prefix ?? "")) }); } },
    memory: { search: async (q: string, opts: any) => { searches.push({ q, opts }); return ok({ facts: o.facts ? o.facts(q) : [] }); } },
  } as unknown as PlatformContext;
  return { ctx, intents, searches, lists };
}
function seed(key: string, title: string, localDate: string, startAt: number | null = null, details: Parameters<typeof S.saveEventDetails>[2] = {}) {
  S.upsertEvents("acct", [{ eventKey: key, calendar: null, title, startAt, endAt: null, allDay: startAt == null, localDate, attendeesText: null, location: null, rawTimeText: null, googleEventId: key }], NOW.getTime());
  S.saveEventDetails("acct", key, details, NOW.getTime());
}

describe("runPlanning", () => {
  test("nothing to plan: no wake", async () => {
    const p = platform();
    expect(await runPlanning(p.ctx, NOW)).toEqual({ woke: false, skipped: "nothing" });
    expect(p.intents).toEqual([]);
  });

  test("one new event: one plan_events wake with its bundle; the plan is stored with the session", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const p = platform();
    const r = await runPlanning(p.ctx, NOW);
    expect(r.woke).toBe(true);
    expect(p.intents).toHaveLength(1);
    expect(p.intents[0].name).toBe("plan_events");
    expect(p.intents[0].payload).toMatchObject({ planId: r.planId, today: "2026-10-06", nowLocal: "12:00",
      events: [{ ref: "e1", event: "calendar-desk:g1", title: "Stay at Hampi", date: "2026-10-12", allDay: true, change: "new", facts: [], steps: [] }] });
    expect(typeof p.intents[0].payload.timezone).toBe("string");
    expect(p.intents[0].payload.events[0].time).toBeUndefined();
    const plan = P.openPlan()!;
    expect(plan.planId).toBe(r.planId!);
    expect(plan.sessionId).toBe("s-1");
    expect(plan.events).toEqual([{ ref: "e1", accountId: "acct", eventKey: "g1", date: "2026-10-12", startAt: null }]);
  });

  test("a timed event carries its time, location and guests", async () => {
    const start = new Date(2026, 9, 9, 9, 30).getTime();
    seed("g2", "Dentist", "2026-10-09", start, { location: "Sunrise Dental, Jayanagar", guests: [{ email: "desk@sunrise.example", name: "Sunrise Desk" }, { email: "x@y.example" }] });
    const p = platform();
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0]).toMatchObject({ time: "09:30", allDay: false, location: "Sunrise Dental, Jayanagar", guests: ["Sunrise Desk <desk@sunrise.example>", "x@y.example"] });
    expect(P.openPlan()!.events[0].startAt).toBe(start);
  });

  test("an open plan younger than 2 h blocks the run; an older one is given up (a try counted) and a new plan opens", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const p = platform();
    const first = await runPlanning(p.ctx, NOW);
    expect(await runPlanning(p.ctx, new Date(NOW.getTime() + HOUR))).toEqual({ woke: false, skipped: "in-flight" });
    expect(p.intents).toHaveLength(1);
    const later = new Date(NOW.getTime() + 2 * HOUR + 1);
    const second = await runPlanning(p.ctx, later);
    expect(second.woke).toBe(true);
    expect(second.planId).not.toBe(first.planId);
    expect(P.getPlan(first.planId!)!.abandonedAt).toBe(later.getTime());
    const tries = S._db.query("SELECT failed_tries FROM planned WHERE event_key = 'g1'").get() as any;
    expect(tries.failed_tries).toBe(1);
    expect(p.intents).toHaveLength(2);
  });

  test("a wake refused for paused usage: skipped, no plan left open, no try counted, offered again next run", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const paused = platform({ intent: () => failed("USAGE_PAUSED Claude usage is paused; try again later") });
    expect(await runPlanning(paused.ctx, NOW)).toEqual({ woke: false, skipped: "usage" });
    expect(P.openPlan()).toBeNull();
    expect(S._db.query("SELECT * FROM planned").all()).toEqual([]);
    const p = platform();
    const r = await runPlanning(p.ctx, new Date(NOW.getTime() + HOUR));
    expect(r.woke).toBe(true);
    expect(p.intents[0].payload.events.map((e: any) => e.event)).toEqual(["calendar-desk:g1"]);
  });

  test("any other refused wake is skipped as failed, with no try counted", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const p = platform({ intent: () => failed("agent offline") });
    expect(await runPlanning(p.ctx, NOW)).toEqual({ woke: false, skipped: "failed" });
    expect(P.openPlan()).toBeNull();
    expect(S._db.query("SELECT * FROM planned").all()).toEqual([]);
  });

  test("facts: a capitalised name is searched as a person (a possessive 's dropped); a title without one is searched whole", async () => {
    seed("g1", "Asha's birthday", "2026-10-10");
    seed("g2", "dentist cleaning", "2026-10-11");
    const p = platform({ facts: (q) => q === "Asha's" || q === "Asha" ? ["Asha is your sister"] : ["Teeth cleaning every 6 months"] });
    await runPlanning(p.ctx, NOW);
    expect(p.searches[0]).toEqual({ q: "Asha", opts: { person: true, limit: 3 } });
    expect(p.searches).toContainEqual({ q: "dentist cleaning", opts: { person: false, limit: 3 } });
    const [e1, e2] = p.intents[0].payload.events;
    expect(e1.facts).toEqual(["Asha is your sister"]);
    expect(e2.facts).toEqual(["Teeth cleaning every 6 months"]);
  });

  test("facts: at most 3, deduplicated across the searched names", async () => {
    seed("g1", "Dinner with Asha and Ravi Kumar", "2026-10-10");
    const p = platform({ facts: (q) => q === "Dinner" ? ["a", "b"] : ["b", "c", "d"] });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0].facts).toEqual(["a", "b", "c"]);
  });

  test("steps: the event's own steps from Flock, with a closed one marked closed; other events' steps are not its", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const due = new Date(2026, 9, 11).getTime(), show = new Date(2026, 9, 10).getTime();
    const p = platform({ tasks: [
      { sourceRef: "step:g1:pack", status: "dismissed", title: "Pack for Hampi", due, dueTimed: false, showFrom: show, updatedAt: 1 },
      { sourceRef: "step:g1:cab", status: "open", title: "Book a cab", due, dueTimed: false, showFrom: null, updatedAt: 1 },
      { sourceRef: "step:g10:x", status: "open", title: "Other", due: null, dueTimed: false, showFrom: null, updatedAt: 1 },
    ] });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0].steps).toEqual([
      { key: "pack", title: "Pack for Hampi", due: "2026-10-11", showFrom: "2026-10-10", closed: true },
      { key: "cab", title: "Book a cab", due: "2026-10-11", showFrom: null },
    ]);
  });
});

describe("capitalisedRuns (ported from core)", () => {
  test("runs of up to 3 capitalised words", () => {
    expect(capitalisedRuns("Asha birthday")).toEqual(["Asha"]);
    expect(capitalisedRuns("Design Review with Asha Rao")).toEqual(["Design Review", "Asha Rao"]);
    expect(capitalisedRuns("all lower case")).toEqual([]);
  });
});
