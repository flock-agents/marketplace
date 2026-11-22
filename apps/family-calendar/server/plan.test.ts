// The plan-prep routine and plan_done: imported events that are new or moved are offered to the agent once an hour (none: no
// wake), and what it reports becomes the event's to-dos on Flock's list, within the rules the app keeps. Since the planner-parity
// addendum these are Calendar Desk's rules: each event reported with a type, each step with a kind from the table that fits it,
// a kind the family dismissed twice refused, a step Flock finds an existing TODO for covered by it.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { planPrep, PLAN_MESSAGE } from "./calendar";
import { planPrepRoutine } from "./routines";

// Sunday 22 Nov 2026, 10 am.
const NOW = new Date(2026, 10, 22, 10, 0);
const SRC = { source: "email:shiva", label: "Shiva's email" };
const DAY = 86400_000;

async function start() {
  const k = await boot({ now: () => NOW });
  const wakes: { message: string; data: any }[] = [];
  let ok = true;
  const wake = async (message: string, data?: unknown) => { if (!ok) return { ok: false, reason: "busy" }; wakes.push({ message, data }); return { ok: true }; };
  const run = () => planPrep(k.cal, wake);
  return Object.assign(k, { wakes, run, fail: (v: boolean) => { ok = !v; }, imp: (...items: object[]) => k.op("import_events", { ...SRC, items }) });
}
const idOf = (k: Awaited<ReturnType<typeof start>>, title: string) => k.rows("events").find((e) => e.title === title)!.id;
/** The family closes a to-do on Flock's list: done, or dismissed as not important. */
const closeOnFlock = (k: Awaited<ReturnType<typeof start>>, ref: string, how: "done" | "skipped", at: number) => {
  const r = k.tasks.rows.get(ref)!;
  r.status = how === "done" ? "done" : "dismissed";
  Object.assign(r, how === "skipped" ? { skipped: true } : {}, { closedAt: at });
};

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
      { ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", notes: "costume: farmer", location: "School hall" },
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
    expect(data).toMatchObject({ planId: `p-${NOW.getTime()}`, appId: "t", today: "2026-11-22", nowLocal: "10:00", members: ["Agastya"], habits: {} });
    expect(data.timezone).toBeString();
    expect(data.events.map((e: any) => [e.ref, e.title, e.change])).toEqual([["e1", "Today's assembly", "new"], ["e2", "Annual Day", "new"], ["e3", "Day 90", "new"]]);
    const annual = idOf(k, "Annual Day");
    // `event` is the pointer a TODO is tied to: the app's id and the event's (Flock's schedule feed serves the same id).
    expect(data.events[1]).toEqual({ ref: "e2", event: `t:${annual}`, id: annual, title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya",
      location: "School hall", notes: "costume: farmer", kind: "event", sources: ["Shiva's email"], change: "new", steps: [] });
  });

  it("an event planned and not moved is not offered again; one moved since is, with where it was, its type and its steps", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00" }, { ref: "b", title: "PTM", date: "2026-12-05" });
    await k.run();
    const plan = k.wakes[0].data;
    const done = await k.op("plan_done", { planId: plan.planId, events: [
      { event: "e1", type: "meeting", steps: [] },
      { event: "e2", type: "occasion", steps: [{ key: "buy-costume", kind: "buy-for-event", title: "Buy the costume", due: "2026-12-08", show_from: "2026-12-04", why: "The school asked for one." }] }] });
    expect(done).toEqual({ accepted: ["e2/buy-costume"], refused: [] });
    expect(await k.run()).toEqual({ woke: false, skipped: "nothing" });
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-10", start_time: "10:00" });   // moved two days earlier by its own mail
    await k.run();
    expect(k.wakes).toHaveLength(2);
    expect(k.wakes[1].data.events).toEqual([expect.objectContaining({ ref: "e1", title: "Annual Day", date: "2026-12-10", change: "moved", type: "occasion",
      was: { date: "2026-12-12", start_time: "10:00" }, steps: [{ key: "buy-costume", kind: "buy-for-event", title: "Buy the costume", due: "2026-12-08", show_from: "2026-12-04", closed: false }] })]);
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
    // The pointer is this copy's own id, as the SDK's platform says it.
    expect(wakes[0]).toMatchObject({ appId: "t-copy", events: [{ event: `t-copy:${idOf(k, "School trip")}` }] });
    expect(k.rows("todos")[0].status).toBe("done");
  });

  it("habits: a kind the family dismissed twice as not important shows off; one done last shows on; at a place, its pattern", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Flight to Pune", date: "2026-12-01", start_time: "11:00" }, { ref: "b", title: "Dentist", date: "2026-12-02", start_time: "10:00", location: "Smile Dental, Indiranagar" },
      { ref: "c", title: "Flight to Goa", date: "2026-12-20", start_time: "09:00" });
    await k.run();
    let plan = k.wakes[0].data;
    await k.op("plan_done", { planId: plan.planId, events: [
      { event: "e1", type: "journey", steps: [{ key: "cab-airport", kind: "cab-airport", title: "Book a cab to the airport for the Pune flight", due: "2026-12-01", show_from: "2026-11-30" }] },
      { event: "e2", type: "appointment", steps: [{ key: "cab", kind: "cab-local", title: "Book a cab to Smile Dental", due: "2026-12-02", show_from: "2026-12-02" }] },
      { event: "e3", type: "journey", steps: [{ key: "cab-airport", kind: "cab-airport", title: "Book a cab to the airport for the Goa flight", due: "2026-12-20", show_from: "2026-12-19" }] }] });
    // The family dismissed both airport cabs as not important, and booked the dentist's.
    for (const t of ["Flight to Pune", "Flight to Goa"]) closeOnFlock(k, `event:${idOf(k, t)}:cab-airport`, "skipped", NOW.getTime() - DAY);
    closeOnFlock(k, `event:${idOf(k, "Dentist")}:cab`, "done", NOW.getTime() - DAY);
    await k.imp({ ref: "d", title: "Flight to Delhi", date: "2026-12-24", start_time: "07:00" }, { ref: "e", title: "Dentist follow-up", date: "2026-12-28", start_time: "10:00", location: "Smile Dental, Indiranagar" });
    k.setNow(new Date(NOW.getTime() + 4 * 3600_000));
    await k.run();
    plan = k.wakes[1].data;
    expect(plan.habits).toEqual({ "cab-airport": { tier: 1, tally: "off", facts: [] }, "cab-local": { tier: 2, tally: "on", facts: [] } });
    expect(plan.events.find((e: any) => e.title === "Dentist follow-up").pattern).toEqual({ "cab-local": "on" });
  });
});

describe("plan_done: the rules the app keeps", () => {
  async function planned() {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", start_time: "10:00", location: "School hall" }, { ref: "b", title: "Fee due", date: "2026-12-10", kind: "deadline" });
    await k.run();
    return Object.assign(k, { planId: k.wakes[0].data.planId as string });
  }
  // e1 = Fee due (10 Dec, a deadline), e2 = Annual Day (12 Dec, an occasion).
  const step = (key: string, due: string, extra: object = {}) => ({ key, kind: key === "pay" ? "payment" : "buy-for-event", title: `Step ${key}`, due, ...extra });
  const report = (k: Awaited<ReturnType<typeof planned>>, ...events: object[]) => k.op("plan_done", { planId: k.planId, events });

  it("makes each accepted step a to-do on Flock's list, shown from its show_from (else 3 days before)", async () => {
    const k = await planned();
    const r = await report(k, { event: "e1", type: "deadline", steps: [step("pay", "2026-12-10")] }, { event: "e2", type: "occasion", steps: [step("buy-costume", "2026-12-08", { show_from: "2026-12-01" })] });
    expect(r).toEqual({ accepted: ["e1/pay", "e2/buy-costume"], refused: [] });
    const annual = idOf(k, "Annual Day");
    expect(k.tasks.published.map((t) => [t.sourceRef, t.showFrom])).toEqual([[`event:${idOf(k, "Fee due")}:pay`, "2026-12-07"], [`event:${annual}:buy-costume`, "2026-12-01"]]);
    expect(k.rows("todos").map((t) => [t.key, t.kind])).toEqual([["pay", "payment"], ["buy-costume", "buy-for-event"]]);
    // Every listed event is planned, for the date and time it was offered on.
    expect(k.rows("events").map((e) => [e.title, e.plan_basis, e.planned_at])).toEqual([["Annual Day", "2026-12-12T10:00", NOW.getTime()], ["Fee due", "2026-12-10", NOW.getTime()]]);
  });

  it("refuses a step due after its event, a show_from after its due, a due before today, and a fourth open step", async () => {
    const k = await planned();
    const r = await report(k, { event: "e2", type: "occasion", steps: [
      step("late", "2026-12-13"), step("backwards", "2026-12-05", { show_from: "2026-12-06" }), step("past", "2026-11-20"),
      step("one", "2026-12-01"), step("two", "2026-12-02"), step("three", "2026-12-03"), step("four", "2026-12-04")] });
    expect(r.accepted).toEqual(["e2/one", "e2/two", "e2/three"]);
    expect(r.refused.map((x: any) => x.step)).toEqual(["e2/late", "e2/backwards", "e2/past", "e2/four"]);
    for (const x of r.refused) expect(x.reason).toBeString();
    // The event is still planned: the agent fixes the refused steps by sending the plan again.
    expect(k.rows("events").find((e) => e.title === "Annual Day").planned_at).toBe(NOW.getTime());
  });

  it("each event needs a type; each step a kind from the table that fits its type; a reminder, block or other gets none", async () => {
    const k = await planned();
    const r = await report(k,
      { event: "e1", type: "party", steps: [] },
      { event: "e2", type: "occasion", steps: [{ ...step("x", "2026-12-08"), kind: "laundry" }, { ...step("y", "2026-12-08"), kind: "checkin" }, { ...step("z", "2026-12-08"), kind: undefined }] });
    expect(r.accepted).toEqual([]);
    expect(r.refused).toEqual([
      { step: "e1", reason: expect.stringContaining("type must be one of") },
      { step: "e2/x", reason: expect.stringContaining("kind must be one of") },
      { step: "e2/y", reason: "checkin does not fit an occasion" },
      { step: "e2/z", reason: expect.stringContaining("kind must be one of") }]);
    // A type that takes no steps.
    const none = await report(k, { event: "e1", type: "reminder", steps: [step("pay", "2026-12-10")] });
    expect(none.refused).toEqual([{ step: "e1", reason: "a reminder gets no steps" }]);
    // An event refused for its type is not planned: it is offered again.
    expect(k.rows("events").find((e) => e.title === "Fee due").planned_at).toBeNull();
  });

  it("a kind the family dismissed the last two of is refused; a cab-local needs the event's location", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Dentist", date: "2026-12-02", start_time: "10:00", location: "Smile Dental" }, { ref: "b", title: "Eye check-up", date: "2026-12-03", start_time: "10:00" },
      { ref: "c", title: "Riya's birthday", date: "2026-12-04" }, { ref: "d", title: "Kabir's birthday", date: "2026-12-05" });
    await k.run();
    let plan = k.wakes[0].data;
    const r = await k.op("plan_done", { planId: plan.planId, events: [
      { event: "e1", type: "appointment", steps: [] },
      { event: "e2", type: "appointment", steps: [{ key: "cab", kind: "cab-local", title: "Book a cab", due: "2026-12-03", show_from: "2026-12-03" }] },
      { event: "e3", type: "occasion", steps: [{ key: "gift", kind: "gift", title: "Buy Riya a gift", due: "2026-12-03", show_from: "2026-12-01" }] },
      { event: "e4", type: "occasion", steps: [{ key: "gift", kind: "gift", title: "Buy Kabir a gift", due: "2026-12-04", show_from: "2026-12-01" }] }] });
    expect(r.refused).toEqual([{ step: "e2/cab", reason: "cab-local needs the event's location" }]);
    for (const t of ["Riya's birthday", "Kabir's birthday"]) closeOnFlock(k, `event:${idOf(k, t)}:gift`, "skipped", NOW.getTime() - DAY);
    await k.imp({ ref: "e", title: "Meera's birthday", date: "2026-12-06" });
    k.setNow(new Date(NOW.getTime() + 4 * 3600_000));
    await k.run();
    plan = k.wakes.at(-1)!.data;
    const meera = plan.events.find((e: any) => e.title === "Meera's birthday").ref;
    const again = await k.op("plan_done", { planId: plan.planId, events: [{ event: meera, type: "occasion", steps: [{ key: "gift", kind: "gift", title: "Buy Meera a gift", due: "2026-12-05" }] }] });
    expect(again.refused).toEqual([{ step: `${meera}/gift`, reason: "the family dismissed the last two gift steps" }]);
  });

  it("a step at a time: due_time is kept and published as a timed due; one already past, or after its event's start, is refused", async () => {
    const k = await planned();
    const r = await report(k, { event: "e2", type: "occasion", steps: [
      step("costume", "2026-12-12", { due_time: "08:30" }), step("late-time", "2026-12-12", { due_time: "11:00" }), step("now-past", "2026-11-22", { due_time: "09:00" }), step("bad-time", "2026-12-10", { due_time: "25:00" })] });
    expect(r.accepted).toEqual(["e2/costume"]);
    expect(r.refused.map((x: any) => [x.step, x.reason])).toEqual([["e2/late-time", "it is due after its event"], ["e2/now-past", "it is already past"], ["e2/bad-time", "due_time must be HH:MM"]]);
    const t = k.tasks.published.find((x) => x.sourceRef.endsWith(":costume"))!;
    expect(t).toMatchObject({ dueTimed: true, due: new Date(2026, 11, 12, 8, 30).getTime() });
    expect(k.rows("todos").find((x) => x.key === "costume").due_time).toBe("08:30");
  });

  it("a step Flock finds an existing TODO for is covered by it: answered as such, kept closed, never made again", async () => {
    const k = await planned();
    // A step that follows from the event or the family's habits is offered as a cover; a judgement one (a payment) is not.
    k.tasks.coverNext(`event:${idOf(k, "Annual Day")}:gift`);
    const r = await report(k, { event: "e1", type: "deadline", steps: [step("pay", "2026-12-10")] },
      { event: "e2", type: "occasion", steps: [{ key: "gift", kind: "gift", title: "Buy a gift", due: "2026-12-11" }] });
    expect(r).toEqual({ accepted: ["e1/pay", "e2/gift covered by a TODO"], refused: [] });
    expect(k.tasks.published[0].cover).toBeUndefined();
    expect(k.tasks.published[1]).toMatchObject({ cover: { kind: "gift", eventTitle: "Annual Day", eventLocation: "School hall", eventDate: "2026-12-12" } });
    expect(k.rows("todos").map((t) => [t.key, t.status])).toEqual([["pay", "open"], ["gift", "covered"]]);
    const re = await report(k, { event: "e2", type: "occasion", steps: [{ key: "gift", kind: "gift", title: "Buy a gift", due: "2026-12-11" }] });
    expect(re.refused[0].reason).toContain("never made again");
  });

  it("an open step re-sent with its key is re-dated, not doubled; a closed key is never made again", async () => {
    const k = await planned();
    await report(k, { event: "e2", type: "occasion", steps: [step("buy-costume", "2026-12-08"), step("rsvp", "2026-12-01")] });
    const again = await report(k, { event: "e2", type: "occasion", steps: [step("buy-costume", "2026-12-09")] });
    expect(again.accepted).toEqual(["e2/buy-costume"]);
    expect(k.rows("todos").filter((t) => t.key === "buy-costume").map((t) => t.due)).toEqual(["2026-12-09"]);
    await k.owner("POST", "/api/todos/done", { event_id: idOf(k, "Annual Day"), key: "rsvp", done: true });
    const re = await report(k, { event: "e2", type: "occasion", steps: [step("rsvp", "2026-12-02")] });
    expect(re).toEqual({ accepted: [], refused: [{ step: "e2/rsvp", reason: expect.stringContaining("never made again") }] });
  });

  it("an unknown plan or event is refused; a cancelled event's steps are refused and its open ones withdrawn", async () => {
    const k = await planned();
    expect((await k.op("plan_done", { planId: "p-1", events: [] })).error).toContain("planId");
    expect((await report(k, { event: "e9", type: "other", steps: [] })).refused).toEqual([{ step: "e9", reason: "event is not in this plan" }]);
    await report(k, { event: "e2", type: "occasion", steps: [step("buy-costume", "2026-12-08")] });
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12", cancelled: true });
    expect(k.tasks.withdrawn).toEqual([`event:${idOf(k, "Annual Day")}:buy-costume`]);
    const r = await report(k, { event: "e2", type: "occasion", steps: [step("rsvp", "2026-12-01")] });
    expect(r.refused).toEqual([{ step: "e2/rsvp", reason: "the event was cancelled" }]);
  });

  it("a step Flock could not take is sent on the next run", async () => {
    const k = await planned();
    k.tasks.down(true);
    expect((await report(k, { event: "e2", type: "occasion", steps: [step("buy-costume", "2026-12-08")] })).accepted).toEqual(["e2/buy-costume"]);
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
    await k.op("plan_done", { planId: plan.planId, events: plan.events.map((e: any) => ({ event: e.ref, type: "other", steps: [] })) });
    await k.run();
    expect(k.wakes[1].data.events.map((e: any) => e.title)).toEqual(["Event 16", "Event 17", "Event 18", "Event 19", "Event 20"]);
  });
});
