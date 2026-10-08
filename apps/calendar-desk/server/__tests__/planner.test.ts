import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, failed, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-planner-"));
const S = await import("../store");
const P = await import("../planning-store");
const { runPlanning, capitalisedRuns } = await import("../planner");
const { handlePlanReport } = await import("../plan-report");

function wipe() { for (const t of ["events", "cursors", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const HOUR = 3600_000;

type TaskState = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; skipped?: true; closedAt?: number; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };
function platform(o: { intent?: () => any; tasks?: TaskState[]; facts?: (q: string) => string[] } = {}) {
  const intents: any[] = [], searches: any[] = [], lists: any[] = [], withdrawals: any[] = [], published: any[] = [];
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    agent: { intent: async (name: string, payload: any) => { intents.push({ name, payload }); return o.intent ? o.intent() : ok({ sessionId: `s-${intents.length}`, reused: false }); } },
    tasks: { publish: async (t: any) => {
        published.push(t);
        const rows = o.tasks ?? [];
        const i = rows.findIndex((r) => r.sourceRef === t.sourceRef);
        const r: TaskState = { sourceRef: t.sourceRef, status: "open", title: t.title, due: t.due ?? null, dueTimed: !!t.dueTimed, showFrom: null, updatedAt: 0 };
        if (i >= 0) rows[i] = { ...rows[i]!, ...r }; else rows.push(r);
        return ok({});
      },
      list: async (opts: { prefix?: string } = {}) => { lists.push(opts); return ok({ tasks: (o.tasks ?? []).filter((t) => t.sourceRef.startsWith(opts.prefix ?? "")) }); },
      withdraw: async (ref: string, opts?: { reason?: string }) => {
        withdrawals.push({ ref, reason: opts?.reason });
        const r = (o.tasks ?? []).find((t) => t.sourceRef === ref && t.status === "open");
        if (!r) return failed("not found");
        r.status = "dismissed"; r.withdrawn = true;
        return ok({});
      } },
    memory: { search: async (q: string, opts: any) => { searches.push({ q, opts }); return ok({ facts: o.facts ? o.facts(q) : [] }); }, extract: async () => ok({}) },
  } as unknown as PlatformContext;
  return { ctx, intents, searches, lists, withdrawals, published };
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

  test("a changed event carries `was`, the date and time it was planned at; a new one has none", async () => {
    const start = new Date(2026, 9, 10, 6, 10).getTime();
    seed("g3", "Flight", "2026-10-10", start);
    P.markPlanned([{ accountId: "acct", eventKey: "g3", date: "2026-10-08", startAt: new Date(2026, 9, 8, 6, 10).getTime() }], NOW.getTime() - HOUR);
    seed("g4", "Stay", "2026-10-12");
    P.markPlanned([{ accountId: "acct", eventKey: "g4", date: "2026-10-11", startAt: null }], NOW.getTime() - HOUR);
    seed("g5", "Dentist", "2026-10-13");
    const p = platform();
    await runPlanning(p.ctx, NOW);
    const [flight, stay, dentist] = p.intents[0].payload.events;
    expect(flight).toMatchObject({ change: "changed", date: "2026-10-10", time: "06:10", was: { date: "2026-10-08", time: "06:10" } });
    expect(stay).toMatchObject({ change: "changed", was: { date: "2026-10-11" } });
    expect(stay.was.time).toBeUndefined();
    expect(dentist.change).toBe("new");
    expect(dentist.was).toBeUndefined();
  });

  test("a timed event carries its time, location and guests", async () => {
    const start = new Date(2026, 9, 9, 9, 30).getTime();
    seed("g2", "Dentist", "2026-10-09", start, { location: "Sunrise Dental, Jayanagar", guests: [{ email: "desk@sunrise.example", name: "Sunrise Desk" }, { email: "x@y.example" }] });
    const p = platform();
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0]).toMatchObject({ time: "09:30", allDay: false, location: "Sunrise Dental, Jayanagar", guests: ["Sunrise Desk <desk@sunrise.example>", "x@y.example"] });
    expect(P.openPlan()!.events[0].startAt).toBe(start);
  });

  test("two concurrent runs send ONE plan_events: the second skips as in-flight (final review F3)", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const p = platform();
    const [a, b] = await Promise.all([runPlanning(p.ctx, NOW), runPlanning(p.ctx, NOW)]);
    expect(p.intents).toHaveLength(1);
    expect([a, b].filter((r) => r.woke)).toHaveLength(1);
    expect([a, b].find((r) => !r.woke)).toEqual({ woke: false, skipped: "in-flight" });
    // The lock is released: a later run is guarded by the open plan as before, not by a stuck lock.
    expect(await runPlanning(p.ctx, new Date(NOW.getTime() + HOUR))).toEqual({ woke: false, skipped: "in-flight" });
    expect(p.intents).toHaveLength(1);
  });

  test("the lock is released after a run that throws", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const p = platform();
    let boom = true;
    (p.ctx as any).tasks.list = async () => { if (boom) throw new Error("socket closed"); return ok({ tasks: [] }); };
    await expect(runPlanning(p.ctx, NOW)).rejects.toThrow("socket closed");
    boom = false;
    expect((await runPlanning(p.ctx, NOW)).woke).toBe(true);
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
    expect(p.searches.find((x) => "person" in x.opts)).toEqual({ q: "Asha", opts: { person: true, limit: 3 } });
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

  test("an existing timed step carries its time; an all-day one has none", async () => {
    seed("g1", "Dinner", "2026-10-10", new Date(2026, 9, 10, 18, 0).getTime());
    P.markPlanned([{ accountId: "acct", eventKey: "g1", date: "2026-10-09", startAt: new Date(2026, 9, 9, 18, 0).getTime() }], NOW.getTime() - HOUR);
    const p = platform({ tasks: [
      { sourceRef: "step:g1:cab", status: "open", title: "Book a cab", due: new Date(2026, 9, 10, 17, 30).getTime(), dueTimed: true, showFrom: null, updatedAt: 0 },
      { sourceRef: "step:g1:gift", status: "open", title: "Buy a gift", due: new Date(2026, 9, 10).getTime(), dueTimed: false, showFrom: null, updatedAt: 0 },
    ] });
    await runPlanning(p.ctx, NOW);
    const steps = p.intents[0].payload.events[0].steps;
    expect(steps[0]).toEqual({ key: "cab", title: "Book a cab", due: "2026-10-10", showFrom: null, dueTime: "17:30" });
    expect(steps[1]).toEqual({ key: "gift", title: "Buy a gift", due: "2026-10-10", showFrom: null });
    expect("dueTime" in steps[1]).toBe(false);
  });
});

describe("withdrawn steps", () => {
  test("a step Calendar Desk withdrew is left out of the bundle: a restored event is planned afresh", async () => {
    seed("g1", "Stay at Hampi", "2026-10-12");
    const due = new Date(2026, 9, 11).getTime();
    const p = platform({ tasks: [
      { sourceRef: "step:g1:pack", status: "dismissed", withdrawn: true, title: "Pack for Hampi", due, dueTimed: false, showFrom: null, updatedAt: 1 },
      { sourceRef: "step:g1:cab", status: "dismissed", title: "Book a cab", due, dueTimed: false, showFrom: null, updatedAt: 1 },
    ] });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0].steps).toEqual([
      { key: "cab", title: "Book a cab", due: "2026-10-11", showFrom: null, closed: true },
    ]);
  });
});

describe("habits: what the owner did with past steps of each kind (planning step tiers M7)", () => {
  const DAY = 86_400_000;
  const row = (ref: string, status: TaskState["status"], extra: Partial<TaskState> = {}): TaskState => ({ sourceRef: ref, status, title: "x", due: null, dueTimed: false, showFrom: null, updatedAt: 0, ...extra });
  const CAB_Q = "cab Uber Ola drive";

  test("(a) one done cab-local step and a fact: tier 2, tally on, the facts", async () => {
    seed("g1", "Dentist", "2026-10-12");
    P.recordStep("acct", "g0", "cab", "cab-local");
    const p = platform({ tasks: [row("step:g0:cab", "done", { closedAt: NOW.getTime() - DAY })], facts: (q) => (q === CAB_Q ? ["Takes an Uber to the dentist."] : []) });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.habits["cab-local"]).toEqual({ tier: 2, tally: "on", facts: ["Takes an Uber to the dentist."] });
  });

  test("(b) a kind with nothing to say is left out; keys are sorted", async () => {
    seed("g1", "Dentist", "2026-10-12");
    P.recordStep("acct", "g0", "pack", "pack");
    P.recordStep("acct", "g0", "checkin", "checkin");
    const p = platform({ tasks: [row("step:g0:pack", "done", { closedAt: NOW.getTime() - DAY }), row("step:g0:checkin", "done", { closedAt: NOW.getTime() - DAY })] });
    await runPlanning(p.ctx, NOW);
    const habits = p.intents[0].payload.habits;
    expect(Object.keys(habits)).toEqual(["checkin", "pack"]);
    expect(habits.pack).toEqual({ tier: 1, tally: "on", facts: [] });
    const empty = platform();
    wipe(); seed("g1", "Dentist", "2026-10-12");
    await runPlanning(empty.ctx, NOW);
    expect(empty.intents[0].payload.habits).toEqual({});
  });

  test("no card is published, no ask row is read, and no entry says asked", async () => {
    seed("g1", "Dentist", "2026-10-12", new Date(2026, 9, 12, 10, 0).getTime(), { location: "Apollo Clinic, Jayanagar" });
    const p = platform();
    const r = await runPlanning(p.ctx, NOW);
    expect(p.lists.filter((o) => o.prefix === "ask:")).toHaveLength(1); // the one-time retirement read
    const r2: any = await handlePlanReport({ planId: r.planId, events: [{ event: "e1", type: "appointment", steps: [] }] }, p.ctx, NOW);
    expect(r2).toEqual({ accepted: [], refused: [], done: true });
    expect(p.published).toEqual([]);
    expect(JSON.stringify(p.intents[0].payload)).not.toContain("asked");
  });

  test("(c) steps carry their kind; a re-offered event carries its stored type", async () => {
    const start = new Date(2026, 9, 12, 10, 0).getTime();
    seed("g1", "Dentist", "2026-10-12", start);
    P.markPlanned([{ accountId: "acct", eventKey: "g1", date: "2026-10-11", startAt: start - DAY, type: "appointment" }], NOW.getTime() - HOUR);
    P.recordStep("acct", "g1", "cab", "cab-local");
    seed("g2", "Stay at Hampi", "2026-10-13");
    const p = platform({ tasks: [row("step:g1:cab", "open", { title: "Book a cab", due: start - HOUR, dueTimed: true })] });
    await runPlanning(p.ctx, NOW);
    const [dentist, stay] = p.intents[0].payload.events;
    expect(dentist.type).toBe("appointment");
    expect(dentist.steps).toEqual([{ key: "cab", kind: "cab-local", title: "Book a cab", due: "2026-10-12", dueTime: "09:00", showFrom: null }]);
    expect(stay.type).toBeUndefined();
  });

  test("(d) one any-word memory search per kind with a query, 3 facts read and shown", async () => {
    seed("g1", "dentist", "2026-10-12");
    const p = platform({ facts: (q) => (q === CAB_Q ? ["f1 cab", "f2 cab", "f3 cab", "f4 cab"] : []) });
    await runPlanning(p.ctx, NOW);
    const kindSearches = p.searches.filter((x) => !("person" in x.opts));
    expect(kindSearches.map((x) => x.q).sort()).toEqual(["cab Uber Ola drive", "drive airport cab", "gift", "table reservation"]);
    for (const x of kindSearches) expect(x.opts).toEqual({ limit: 3, any: true });
    expect(p.intents[0].payload.habits["cab-local"].facts).toEqual(["f1 cab", "f2 cab", "f3 cab"]);
  });

  test("C4: habits pool every account's steps, not only the accounts being planned", async () => {
    seed("g1", "Dentist", "2026-10-12");
    P.recordStep("acct2", "h0", "cab", "cab-local");
    const p = platform({ tasks: [row("step:h0:cab", "done", { closedAt: NOW.getTime() - DAY })] });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.habits["cab-local"]).toEqual({ tier: 2, tally: "on", facts: [] });
  });

  test("pattern: an event at a place the owner went by cab shows on; one skipped twice there shows off; no history, no pattern", async () => {
    const at = (h: number) => new Date(2026, 9, 12, h, 0).getTime();
    seed("g1", "Dentist", "2026-10-12", at(10), { location: "Apollo Clinic, Jayanagar" });
    seed("g2", "Physio", "2026-10-12", at(12), { location: "Smile Dental, Koramangala" });
    seed("g3", "Salon", "2026-10-12", at(15), { location: "Toni and Guy, Indiranagar" });
    P.recordStep("acct", "p1", "cab", "cab-local", "apollo clinic");
    P.recordStep("acct", "p2", "cab", "cab-local", "smile dental");
    P.recordStep("acct", "p3", "cab", "cab-local", "smile dental");
    const p = platform({ tasks: [
      row("step:p1:cab", "done", { closedAt: NOW.getTime() - 60 * DAY }),
      row("step:p2:cab", "dismissed", { skipped: true, closedAt: NOW.getTime() - 3 * DAY }),
      row("step:p3:cab", "dismissed", { skipped: true, closedAt: NOW.getTime() - 2 * DAY }),
    ] });
    await runPlanning(p.ctx, NOW);
    const [dentist, physio, salon] = p.intents[0].payload.events;
    expect(dentist.pattern).toEqual({ "cab-local": "on" });
    expect(physio.pattern).toEqual({ "cab-local": "off" });
    expect(salon).not.toHaveProperty("pattern");
  });

  test("pattern: a gift done for the same person 300 days ago shows on, while the kind-wide tally has forgotten it", async () => {
    seed("g1", "Asha's birthday", "2026-10-12");
    P.recordStep("acct", "p1", "gift", "gift", "asha");
    const p = platform({ tasks: [row("step:p1:gift", "done", { closedAt: NOW.getTime() - 300 * DAY })] });
    await runPlanning(p.ctx, NOW);
    expect(p.intents[0].payload.events[0].pattern).toEqual({ gift: "on" });
    expect(p.intents[0].payload.habits.gift).toBeUndefined();
  });

  test("(h) the bundle is byte-identical across two runs with the same rows", async () => {
    seed("g1", "Asha's birthday", "2026-10-12");
    seed("g2", "Dentist", "2026-10-13", new Date(2026, 9, 13, 10, 0).getTime(), { location: "Apollo Clinic, Jayanagar" });
    P.recordStep("acct", "g0", "cab", "cab-local", "apollo clinic");
    P.recordStep("acct", "g0", "gift", "gift");
    const tasks = [row("step:g0:cab", "done", { closedAt: NOW.getTime() - DAY }), row("step:g0:gift", "dismissed", { skipped: true, closedAt: NOW.getTime() - 2 * DAY })];
    const facts = (q: string) => (q === "gift" ? ["Buys books as gifts."] : q === "Asha" ? ["Asha is your sister"] : []);
    const bundle = (x: any) => JSON.stringify({ events: x.events, habits: x.habits });
    const a = platform({ tasks, facts });
    await runPlanning(a.ctx, NOW);
    S._db.exec("DELETE FROM plans");
    const b = platform({ tasks, facts });
    await runPlanning(b.ctx, NOW);
    expect(bundle(b.intents[0].payload)).toBe(bundle(a.intents[0].payload));
    expect(Object.keys(a.intents[0].payload.habits)).toEqual(["cab-local", "gift"]);
    expect(a.intents[0].payload.events.find((e: any) => e.title === "Dentist").pattern).toEqual({ "cab-local": "on" });
  });

  test("(i) a listed cab or travel step with no kind gets one from its title; other keys stay null", async () => {
    seed("g1", "Dentist", "2026-10-12");
    P.recordStep("acct", "g0", "cab");
    P.recordStep("acct", "g0", "travel");
    P.recordStep("acct", "g0", "misc");
    const p = platform({ tasks: [
      row("step:g0:cab", "done", { title: "Cab to the airport", closedAt: NOW.getTime() - DAY }),
      row("step:g0:travel", "open", { title: "Book a ride to Apollo" }),
      row("step:g0:misc", "open", { title: "Airport lounge" }),
    ] });
    await runPlanning(p.ctx, NOW);
    const kinds = P.stepKindsFor("acct");
    expect(kinds.get("step:g0:cab")).toBe("cab-airport");
    expect(kinds.get("step:g0:travel")).toBe("cab-local");
    expect(kinds.has("step:g0:misc")).toBe(false);
    expect(p.intents[0].payload.habits["cab-airport"]).toEqual({ tier: 1, tally: "on", facts: [] });
  });
});

describe("capitalisedRuns (ported from core)", () => {
  test("runs of up to 3 capitalised words", () => {
    expect(capitalisedRuns("Asha birthday")).toEqual(["Asha"]);
    expect(capitalisedRuns("Design Review with Asha Rao")).toEqual(["Design Review", "Asha Rao"]);
    expect(capitalisedRuns("all lower case")).toEqual([]);
  });
});

describe("the ask cards of an older Calendar Desk", () => {
  test("the first run withdraws an open ask card even with nothing to plan; later runs do not read ask: again", async () => {
    wipe();
    const p = platform({ tasks: [{ sourceRef: "ask:cab-local", status: "open", title: "q", due: 0, dueTimed: false, showFrom: null, updatedAt: 0 }] });
    expect(await runPlanning(p.ctx, NOW)).toEqual({ woke: false, skipped: "nothing" });
    expect(p.withdrawals).toEqual([{ ref: "ask:cab-local", reason: "no longer used" }]);
    await runPlanning(p.ctx, NOW);
    expect(p.lists.filter((o) => o.prefix === "ask:")).toHaveLength(1);
  });
});
