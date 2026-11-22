// The plan-prep routine and plan_done: imported events that are new or moved are offered to the agent once an hour (none: no
// wake), and what it reports becomes the event's to-dos on Flock's list, within the rules the app keeps.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { planPrep, PLAN_MESSAGE } from "./calendar";
import { planPrepRoutine } from "./routines";

// Sunday 22 Nov 2026, 10 am.
const NOW = new Date(2026, 10, 22, 10, 0);
const SRC = { source: "email:shiva", label: "Shiva's email" };

async function start() {
  const k = await boot({ now: () => NOW });
  const wakes: { message: string; data: any }[] = [];
  let ok = true;
  const wake = async (message: string, data?: unknown) => { if (!ok) return { ok: false, reason: "busy" }; wakes.push({ message, data }); return { ok: true }; };
  const run = () => planPrep(k.cal, wake);
  return Object.assign(k, { wakes, run, fail: (v: boolean) => { ok = !v; }, imp: (...items: object[]) => k.op("import_events", { ...SRC, items }) });
}
const idOf = (k: Awaited<ReturnType<typeof start>>, title: string) => k.rows("events").find((e) => e.title === title)!.id;

describe("plan-prep: which events are offered", () => {
  it("nothing imported, or only typed-in and repeating events: no wake at all", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Dentist", date: "2026-11-27", start_time: "11:00" }, { title: "Skating", weekdays: ["Tue"], start_time: "16:00" },
      { title: "Grandma's birthday", date: "1950-11-28", repeat: "yearly" }] });
    expect(await k.run()).toEqual({ woke: false, skipped: "nothing" });
    expect(k.wakes).toEqual([]);
  });

  it("offers new imports from today to 90 days ahead; not past ones, later ones or cancelled ones", async () => {
    const k = await start();
    await k.imp(
      { ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", notes: "costume: farmer" },
      { ref: "b", title: "Today's assembly", date: "2026-11-22" },
      { ref: "c", title: "Last week's fair", date: "2026-11-15" },
      { ref: "d", title: "Summer camp", date: "2027-02-21" },   // 91 days ahead
      { ref: "e", title: "Day 90", date: "2027-02-20" },
      { ref: "f", title: "Called-off match", date: "2026-12-01" });
    await k.imp({ ref: "f", title: "Called-off match", date: "2026-12-01", cancelled: true });
    const r = await k.run();
    expect(r.woke).toBe(true);
    expect(k.wakes).toHaveLength(1);
    const { message, data } = k.wakes[0];
    expect(message).toBe(PLAN_MESSAGE);
    expect(data).toMatchObject({ planId: `p-${NOW.getTime()}`, today: "2026-11-22", nowLocal: "10:00" });
    expect(data.timezone).toBeString();
    expect(data.events.map((e: any) => [e.ref, e.title, e.change])).toEqual([["e1", "Today's assembly", "new"], ["e2", "Annual Day", "new"], ["e3", "Day 90", "new"]]);
    expect(data.events[1]).toEqual({ ref: "e2", id: idOf(k, "Annual Day"), title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", location: null,
      notes: "costume: farmer", kind: "event", sources: ["Shiva's email"], change: "new", steps: [] });
  });

  it("an event planned and not moved is not offered again; one moved since is, with where it was and its steps", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00" }, { ref: "b", title: "PTM", date: "2026-12-05" });
    await k.run();
    const plan = k.wakes[0].data;
    const done = await k.op("plan_done", { planId: plan.planId, events: [
      { event: "e1", steps: [] },
      { event: "e2", steps: [{ key: "buy-costume", title: "Buy the costume", due: "2026-12-08", show_from: "2026-12-04", why: "The school asked for one." }] }] });
    expect(done).toEqual({ accepted: ["e2/buy-costume"], refused: [] });
    expect(await k.run()).toEqual({ woke: false, skipped: "nothing" });
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-10", start_time: "10:00" });   // moved two days earlier by its own mail
    await k.run();
    expect(k.wakes).toHaveLength(2);
    expect(k.wakes[1].data.events).toEqual([expect.objectContaining({ ref: "e1", title: "Annual Day", date: "2026-12-10", change: "moved",
      was: { date: "2026-12-12", start_time: "10:00" }, steps: [{ key: "buy-costume", title: "Buy the costume", due: "2026-12-08", show_from: "2026-12-04", closed: false }] })]);
  });

  it("a plan still waiting for its answer is not sent again within 3 hours; a wake that did not go is a failed run", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12" });
    await k.run();
    expect(await k.run()).toEqual({ woke: false, skipped: "waiting" });
    k.setNow(new Date(NOW.getTime() + 3 * 3600_000 + 1));
    k.fail(true);
    await expect(k.run()).rejects.toThrow("the agent was not woken: busy");
  });

  it("the routine runs it with its wake, and settles to-dos ticked on Flock's list first", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "School trip", date: "2026-12-04", todos: [{ title: "Sign the form", due: "2026-11-27" }] });
    const ref = `event:${idOf(k, "School trip")}:sign-the-form`;
    k.tasks.close(ref, "done");
    const wakes: unknown[] = [];
    await planPrepRoutine({ kit: k.kit, platform: k.tasks.platform, wakeAgent: async (_m: string, d: unknown) => { wakes.push(d); return { ok: true }; } } as any, NOW);
    expect(wakes).toHaveLength(1);
    expect((wakes[0] as any).events[0].steps).toEqual([{ key: "sign-the-form", title: "Sign the form", due: "2026-11-27", show_from: "2026-11-24", closed: true }]);
    expect(k.rows("todos")[0].status).toBe("done");
  });
});

describe("plan_done: the rules the app keeps", () => {
  async function planned() {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00" }, { ref: "b", title: "Fee due", date: "2026-12-10", kind: "deadline" });
    await k.run();
    return Object.assign(k, { planId: k.wakes[0].data.planId as string });
  }
  const step = (key: string, due: string, extra: object = {}) => ({ key, title: `Step ${key}`, due, ...extra });

  it("makes each accepted step a to-do on Flock's list, shown from its show_from (else 3 days before)", async () => {
    const k = await planned();
    const r = await k.op("plan_done", { planId: k.planId, events: [{ event: "e1", steps: [step("pay", "2026-12-10")] }, { event: "e2", steps: [step("buy-costume", "2026-12-08", { show_from: "2026-12-01" })] }] });
    expect(r).toEqual({ accepted: ["e1/pay", "e2/buy-costume"], refused: [] });
    const annual = idOf(k, "Annual Day");
    expect(k.tasks.published.map((t) => [t.sourceRef, t.showFrom])).toEqual([[`event:${idOf(k, "Fee due")}:pay`, "2026-12-07"], [`event:${annual}:buy-costume`, "2026-12-01"]]);
    // Every listed event is planned, for the date and time it was offered on.
    expect(k.rows("events").map((e) => [e.title, e.plan_basis, e.planned_at])).toEqual([["Annual Day", "2026-12-12T10:00", NOW.getTime()], ["Fee due", "2026-12-10", NOW.getTime()]]);
  });

  it("refuses a step due after its event, a show_from after its due, a due before today, and a fourth open step", async () => {
    const k = await planned();
    const r = await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [
      step("late", "2026-12-13"), step("backwards", "2026-12-05", { show_from: "2026-12-06" }), step("past", "2026-11-20"),
      step("one", "2026-12-01"), step("two", "2026-12-02"), step("three", "2026-12-03"), step("four", "2026-12-04")] }] });
    expect(r.accepted).toEqual(["e2/one", "e2/two", "e2/three"]);
    expect(r.refused.map((x: any) => x.step)).toEqual(["e2/late", "e2/backwards", "e2/past", "e2/four"]);
    for (const x of r.refused) expect(x.reason).toBeString();
    // The event is still planned: the agent fixes the refused steps by sending the plan again.
    expect(k.rows("events").find((e) => e.title === "Annual Day").planned_at).toBe(NOW.getTime());
  });

  it("an open step re-sent with its key is re-dated, not doubled; a closed key is never made again", async () => {
    const k = await planned();
    await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("buy-costume", "2026-12-08"), step("rsvp", "2026-12-01")] }] });
    const again = await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("buy-costume", "2026-12-09")] }] });
    expect(again.accepted).toEqual(["e2/buy-costume"]);
    expect(k.rows("todos").filter((t) => t.key === "buy-costume").map((t) => t.due)).toEqual(["2026-12-09"]);
    await k.owner("POST", "/api/todos/done", { event_id: idOf(k, "Annual Day"), key: "rsvp", done: true });
    const re = await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("rsvp", "2026-12-02")] }] });
    expect(re).toEqual({ accepted: [], refused: [{ step: "e2/rsvp", reason: expect.stringContaining("never made again") }] });
  });

  it("an unknown plan or event is refused; a cancelled event's steps are refused and its open ones withdrawn", async () => {
    const k = await planned();
    expect((await k.op("plan_done", { planId: "p-1", events: [] })).error).toContain("planId");
    expect((await k.op("plan_done", { planId: k.planId, events: [{ event: "e9", steps: [] }] })).refused).toEqual([{ step: "e9", reason: "event is not in this plan" }]);
    await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("buy-costume", "2026-12-08")] }] });
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", cancelled: true });
    expect(k.tasks.withdrawn).toEqual([`event:${idOf(k, "Annual Day")}:buy-costume`]);
    const r = await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("rsvp", "2026-12-01")] }] });
    expect(r.refused).toEqual([{ step: "e2/rsvp", reason: "the event was cancelled" }]);
  });

  it("a step Flock could not take is sent on the next run", async () => {
    const k = await planned();
    k.tasks.down(true);
    expect((await k.op("plan_done", { planId: k.planId, events: [{ event: "e2", steps: [step("buy-costume", "2026-12-08")] }] })).accepted).toEqual(["e2/buy-costume"]);
    expect(k.tasks.published).toEqual([]);
    k.tasks.down(false);
    await k.run();
    expect(k.tasks.published.map((t) => t.sourceRef)).toEqual([`event:${idOf(k, "Annual Day")}:buy-costume`]);
  });
});

describe("plan-prep: one wake's size", () => {
  it("offers at most 15 events, soonest first, and the rest once those are planned", async () => {
    const k = await start();
    await k.op("import_events", { ...SRC, items: Array.from({ length: 20 }, (_, i) => ({ ref: `r${i}`, title: `Event ${i + 1}`, date: `2026-12-${String(i + 1).padStart(2, "0")}` })) });
    await k.run();
    const plan = k.wakes[0].data;
    expect(plan.events.map((e: any) => e.title)).toEqual(Array.from({ length: 15 }, (_, i) => `Event ${i + 1}`));
    expect(JSON.stringify(plan, null, 2).length).toBeLessThan(20_000);
    await k.op("plan_done", { planId: plan.planId, events: plan.events.map((e: any) => ({ event: e.ref, steps: [] })) });
    await k.run();
    expect(k.wakes[1].data.events.map((e: any) => e.title)).toEqual(["Event 16", "Event 17", "Event 18", "Event 19", "Event 20"]);
  });
});
