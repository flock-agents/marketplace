// The four routines, run by hand with a context that records each wake of the agent: the weekly plan, the two daily
// check-ins and the order clock; and the family gate in front of them.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";
import { weeklyPlan, WEEKLY_PROMPT } from "./routines/weekly-plan";
import { dailyTime, dinnerCheck, tomorrowCheck } from "./routines/check-ins";
import { orderClock } from "./routines/order-clock";

const MON = "2026-11-23", TUE = "2026-11-24";
const SAT_EVENING = new Date(2026, 10, 21, 18, 5);   // Sat 21 Nov, 18:05: the weekly run
const SUN_7PM = new Date(2026, 10, 22, 19, 0);
const MON_3PM = new Date(2026, 10, 23, 15, 0);
const at = (h: number, min: number, day = 21) => new Date(2026, 10, day, h, min);

type Wake = { message: string; data: any };
const DAILY_3PM = { type: "schedule", cron: "0 15 * * *" }, DAILY_7PM = { type: "schedule", cron: "0 19 * * *" };

const monLunch = { date: MON, slot: "Lunch", dishes: [
  { name: "Rice", ingredients: [{ item: "rice", amount: 400, unit: "g", keeps: "long" }] },
  { name: "Aloo gobi", video_url: "https://youtu.be/aloo", ingredients: [{ item: "cauliflower", amount: 1, unit: "pc" }, { item: "potato", amount: 500, unit: "g" }] } ] };
const monDinner = { date: MON, slot: "Dinner", dishes: [
  { name: "Rotis", ingredients: [{ item: "atta", amount: 300, unit: "g", keeps: "long" }] },
  { name: "Palak paneer", for: ["Asha"], ingredients: [{ item: "spinach", amount: 2, unit: "bunch" }, { item: "paneer", amount: 200, unit: "g" }] } ] };
const tueLunch = { date: TUE, slot: "Lunch", dishes: [{ name: "Onion sabzi", ingredients: [{ item: "onion", amount: 2, unit: "pc" }] }] };

/** An app at a time the test can move, and a routine context on it that records the wakes. */
async function app(opts: { family?: boolean } = {}) {
  const clock = { now: SAT_EVENING };
  const k = await boot({ now: () => clock.now });
  if (opts.family !== false) await k.op("set_person", { name: "Asha", group: "adult" });
  const wakes: Wake[] = [];
  /** `answer` is what the platform says to a wake; by default every wake goes. A wake that did not go is not in `wakes`. */
  const ctx = (trigger: unknown = null, answer: (data: any) => { ok: boolean; reason?: string; data?: unknown } = () => ({ ok: true, data: {} })) => ({
    kit: { db: k.kit.db, sqlite: k.kit.sqlite, emitChange: k.kit.emitChange },
    routine: { trigger },
    wakeAgent: async (message: string, data?: unknown) => { const r = answer(data); if (r.ok) wakes.push({ message, data }); return r; },
  });
  const order = (id: string) => k.rows("orders").find((o) => o.id === id);
  const house = () => k.rows("house")[0];
  return { ...k, clock, wakes, ctx, order, house };
}

/** The same with the week of Mon 23 Nov planned final on Saturday evening: its first order (Sun and Mon) is due at once. */
async function plannedWeek(meals: object[] = [monLunch, monDinner, tueLunch], opts: { family?: boolean } = {}) {
  const k = await app(opts);
  const r = await k.op("plan_week", { week_start: MON, mode: "final", meals });
  return { ...k, orders: r.orders as any[], first: r.orders[0], second: r.orders[1] };
}

/** A 2.0 install's household profile, carried over as at boot. */
function carryOldProfile(k: Awaited<ReturnType<typeof app>>, text: string) {
  k.kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES ('s1', '', '', 'app', 'household.profile', ?, 'owner')`, [JSON.stringify(text)]);
  expect(migrateOldProfile(k.kit.sqlite)).toBe("migrated");
}

describe("weekly plan", () => {
  it("weekly run on Sat 21 Nov plans the week of Mon 23 Nov", async () => {
    const k = await app();
    await weeklyPlan(k.ctx(), new Date(2026, 10, 21, 18, 0));
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data.week_start).toBe("2026-11-23");
    expect(k.wakes[0].data.context.week_start).toBe("2026-11-23");
    expect(k.wakes[0].data.context.people.map((p: any) => p.name)).toEqual(["Asha"]);
    expect(k.wakes[0].message).toBe(WEEKLY_PROMPT("2026-11-23"));
  });

  it("a run on a Monday plans the week after", async () => {
    const k = await app();
    await weeklyPlan(k.ctx(), new Date(2026, 10, 23, 18, 0));
    expect(k.wakes[0].data.week_start).toBe("2026-11-30");
  });

  it("the prompt places the first order right away, then asks low or out with the plan, and records paid or not paid", () => {
    const p = WEEKLY_PROMPT(MON);
    const order = ["plan_week", `mode: "final"`, "place_order", "record_order", "intro", "ask_low_or_out", "low_or_out", "paid: true", "paid: false"].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(p).toContain(MON);
    expect(p).toContain("Mon 23 Nov");
    expect(p).toContain("Never ask for a yes before placing");
    expect(p).toContain("names from `items`");
    expect(p).toContain("Cancel nothing on the grocery app");
    expect(p).not.toContain("ask_pending");
  });

  it("with a migrated 2.0 profile, the weekly run only asks to structure it", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults and Agastya (6). Veg on Tuesdays.");
    await weeklyPlan(k.ctx(), SAT_EVENING);
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data).toEqual({ profile: "2 adults and Agastya (6). Veg on Tuesdays." });
    expect(k.wakes[0].message).toContain("set_person / set_house_rules / set_cook / set_slots / set_regular");
    expect(k.wakes[0].message).toContain("structured: true");
    expect(k.wakes[0].data.week_start).toBeUndefined();
  });
});

describe("dinner check-in", () => {
  it("dinner check is silent with no dinner or an ordered-in dinner; else sends the exact text", async () => {
    const none = await plannedWeek([monLunch]);
    await dinnerCheck(none.ctx(DAILY_3PM), MON_3PM);
    expect(none.wakes).toEqual([]);

    const orderedIn = await plannedWeek([monLunch, { date: MON, slot: "Dinner", ordered_in: true }]);
    await dinnerCheck(orderedIn.ctx(DAILY_3PM), MON_3PM);
    expect(orderedIn.wakes).toEqual([]);

    const k = await plannedWeek();
    await dinnerCheck(k.ctx(DAILY_3PM), MON_3PM);
    const dinner = k.rows("plan_meals").find((m) => m.slot === "Dinner");
    expect(k.wakes).toEqual([{
      message: "Send the family this check-in exactly, then handle replies (set_dish, set_meal, add_to_order)",
      data: { text: "Tonight's dinner: Rotis, Palak paneer (for Asha).\nFresh items on an order: spinach, paneer.\nAnything to change?", meal_id: dinner.id },
    }]);
  });

  it("names the fresh items that are on no order: a dish added since the orders were built, and everything once the order is cancelled", async () => {
    const k = await plannedWeek();
    // Added just now: the orders have not caught up yet (the rebuild is still waiting).
    await k.op("set_dish", { date: MON, slot: "Dinner", name: "Kachumber", ingredients: [{ item: "Tomato", amount: 2, unit: "pc" }, { item: "salt", amount: 5, unit: "g", keeps: "long" }] });
    await dinnerCheck(k.ctx(), MON_3PM);
    expect(k.wakes[0].data.text).toBe("Tonight's dinner: Rotis, Palak paneer (for Asha), Kachumber.\nFresh items on an order: spinach, paneer.\nNot on any order yet: Tomato.\nAnything to change?");

    // A cancelled order covers nothing.
    await k.op("cancel_order", { order_id: k.first.id });
    await dinnerCheck(k.ctx(), MON_3PM);
    expect(k.wakes[1].data.text).toBe("Tonight's dinner: Rotis, Palak paneer (for Asha), Kachumber.\nNot on any order yet: spinach, paneer, Tomato.\nAnything to change?");
  });

  it("a placed, paid or unpaid order still covers its day", async () => {
    const k = await plannedWeek();
    await k.op("record_order", { order_id: k.first.id, placed: true });
    await dinnerCheck(k.ctx(), MON_3PM);
    await k.op("record_order", { order_id: k.first.id, paid: true });
    await dinnerCheck(k.ctx(), MON_3PM);
    expect(k.wakes.map((w) => w.data.text.split("\n")[1])).toEqual(["Fresh items on an order: spinach, paneer.", "Fresh items on an order: spinach, paneer."]);
  });

  it("says nothing about a week that is still a draft", async () => {
    const k = await app();
    await k.op("plan_week", { week_start: MON, mode: "draft", meals: [monDinner] });
    await dinnerCheck(k.ctx(), MON_3PM);
    expect(k.wakes).toEqual([]);
  });
});

describe("tomorrow's meals check-in", () => {
  it("sends tomorrow's meals as the cook's brief on a day the cook comes, with each dish's video", async () => {
    const k = await app();
    await k.op("set_cook", { name: "Lakshmi", days: ["Mon", "Wed"], arrival: "07:30" });
    const saved = await k.op("save_recipe", { name: "Palak paneer", links: ["https://www.instagram.com/reel/palak", "https://example.com/palak"] });
    const dinner = { date: MON, slot: "Dinner", dishes: [monDinner.dishes[0], { ...monDinner.dishes[1], recipe_id: saved.recipe.id }] };
    await k.op("plan_week", { week_start: MON, mode: "final", meals: [monLunch, dinner, { date: MON, slot: "Breakfast", ordered_in: true }] });
    await tomorrowCheck(k.ctx(DAILY_7PM), SUN_7PM);
    const ids = ["Breakfast", "Lunch", "Dinner"].map((slot) => k.rows("plan_meals").find((m) => m.slot === slot).id);
    expect(k.wakes).toEqual([{
      message: "Send the family this check-in exactly, then handle replies (set_dish, set_meal, add_to_order)",
      data: { date: MON, meal_ids: ids, text: [
        "Tomorrow, Mon 23 Nov:",
        "Breakfast: ordering in",
        "Lunch: Rice, Aloo gobi",
        "Dinner: Rotis, Palak paneer (for Asha)",
        "For Lakshmi (comes 7:30): Aloo gobi https://youtu.be/aloo, Palak paneer https://www.instagram.com/reel/palak",
        "Anything to change?",
      ].join("\n") },
    }]);
  });

  it("lists the videos without the cook on a day the cook does not come, and the fresh items on no order", async () => {
    const k = await plannedWeek();
    await k.op("set_cook", { name: "Lakshmi", days: ["Tue"], arrival: "07:30" });
    await k.op("set_dish", { date: MON, slot: "Lunch", name: "Raita", ingredients: [{ item: "curd", amount: 200, unit: "g" }] });
    await tomorrowCheck(k.ctx(), SUN_7PM);
    expect(k.wakes[0].data.text).toBe([
      "Tomorrow, Mon 23 Nov:",
      "Lunch: Rice, Aloo gobi, Raita",
      "Dinner: Rotis, Palak paneer (for Asha)",
      "Videos: Aloo gobi https://youtu.be/aloo",
      "Not on any order yet: curd.",
      "Anything to change?",
    ].join("\n"));
  });

  it("is silent when nothing is planned for tomorrow", async () => {
    const k = await plannedWeek([tueLunch]);
    await tomorrowCheck(k.ctx(), SUN_7PM);
    expect(k.wakes).toEqual([]);
  });
});

describe("the check-ins record when they really run", () => {
  it("reads a fixed daily time from a schedule trigger, and nothing from any other", () => {
    expect(dailyTime({ type: "schedule", cron: "0 15 * * *" })).toBe("15:00");
    expect(dailyTime({ type: "schedule", cron: "30 16 * * *", timezone: "Asia/Kolkata" })).toBe("16:30");
    expect(dailyTime({ type: "schedule", cron: " 5  7 * * * " })).toBe("07:05");
    expect(dailyTime("30 16 * * *")).toBe("16:30");
    for (const cron of ["*/15 * * * *", "0 15 * * 1", "0 15 1 * *", "0 9,15 * * *", "0 9-17 * * *", "60 15 * * *", "0 24 * * *", "0 15 * *", ""])
      expect(dailyTime({ type: "schedule", cron })).toBeNull();
    for (const trigger of [null, undefined, 7, {}, { type: "event", sourceId: "gmail" }, { type: "schedule" }, { type: "schedule", cron: 15 }])
      expect(dailyTime(trigger)).toBeNull();
  });

  it("a check-in run with no family writes its time and wakes nobody", async () => {
    const k = await plannedWeek([monLunch, monDinner], { family: false });
    await dinnerCheck(k.ctx(DAILY_3PM), MON_3PM);
    await tomorrowCheck(k.ctx(DAILY_7PM), SUN_7PM);
    expect(k.wakes).toEqual([]);
    expect(k.house().dinner_check_time).toBe("15:00");
    expect(k.house().tomorrow_check_time).toBe("19:00");
  });

  it("a cron of 30 16 * * * stores 16:30, and each check-in writes only its own time", async () => {
    const k = await app();
    await dinnerCheck(k.ctx({ type: "schedule", cron: "30 16 * * *" }), MON_3PM);
    expect(k.house().dinner_check_time).toBe("16:30");
    expect(k.house().tomorrow_check_time).toBeNull();
    await tomorrowCheck(k.ctx({ type: "schedule", cron: "15 20 * * *" }), SUN_7PM);
    expect(k.house().dinner_check_time).toBe("16:30");
    expect(k.house().tomorrow_check_time).toBe("20:15");
    // The schedule moved: the next run writes the new time.
    await dinnerCheck(k.ctx(DAILY_3PM), MON_3PM);
    expect(k.house().dinner_check_time).toBe("15:00");
  });

  it("a non-daily cron, or a trigger that cannot be read, stores nothing and clears a time stored before", async () => {
    const k = await app();
    await dinnerCheck(k.ctx({ type: "schedule", cron: "0 15 * * 1-5" }), MON_3PM);
    await tomorrowCheck(k.ctx(null), SUN_7PM);
    expect(k.house()?.dinner_check_time ?? null).toBeNull();
    expect(k.house()?.tomorrow_check_time ?? null).toBeNull();

    await dinnerCheck(k.ctx(DAILY_3PM), MON_3PM);
    await tomorrowCheck(k.ctx(DAILY_7PM), SUN_7PM);
    expect([k.house().dinner_check_time, k.house().tomorrow_check_time]).toEqual(["15:00", "19:00"]);
    // The schedules stop being one daily time: the stored times no longer hold.
    await dinnerCheck(k.ctx({ type: "schedule", cron: "0 15 * * 1-5" }), MON_3PM);
    expect([k.house().dinner_check_time, k.house().tomorrow_check_time]).toEqual([null, "19:00"]);
    await tomorrowCheck({ ...k.ctx(), routine: undefined } as any, SUN_7PM);
    expect([k.house().dinner_check_time, k.house().tomorrow_check_time]).toEqual([null, null]);
  });

  it("the intro falls back to 3 pm and 7 pm once the stored times are cleared", async () => {
    const k = await plannedWeek();
    await dinnerCheck(k.ctx({ type: "schedule", cron: "30 16 * * *" }), SAT_EVENING);
    await dinnerCheck(k.ctx({ type: "schedule", cron: "*/30 * * * *" }), SAT_EVENING);
    const r = await k.op("record_order", { order_id: k.first.id, placed: true });
    expect(r.intro).toContain("I check in at 3 pm about dinner and 7 pm about tomorrow");
  });

  it("the intro names the times the check-ins recorded", async () => {
    const k = await plannedWeek();
    await dinnerCheck(k.ctx({ type: "schedule", cron: "30 16 * * *" }), SAT_EVENING);
    await tomorrowCheck(k.ctx({ type: "schedule", cron: "0 20 * * *" }), SAT_EVENING);
    await k.op("place_order", { order_id: k.first.id });
    const r = await k.op("record_order", { order_id: k.first.id, placed: true });
    expect(r.intro).toContain("I check in at 4:30 pm about dinner and 8 pm about tomorrow");
  });
});

describe("order clock", () => {
  it("wakes once per due order with the place payload, and not again 15 minutes later", async () => {
    const k = await plannedWeek();
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toHaveLength(1);
    const { message, data } = k.wakes[0];
    expect(data.order.id).toBe(k.first.id);
    expect(data.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "paneer", "potato", "rice", "spinach"]);
    expect(data.message).toStartWith("Ordering this now: ");
    expect(data.message).toEndWith(" on Zepto");
    expect(data.needs_product).toHaveLength(6);
    expect(data.needs_qty).toHaveLength(6);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T18:15");
    for (const s of ["`message`", "needs_product", "needs_qty", "Zepto", "placed: true", "paid: true", "paid: false", "Cancel nothing on Zepto"]) expect(message).toContain(s);
    expect(message.indexOf("placed: true")).toBeLessThan(message.indexOf("paid: true"));

    await orderClock(k.ctx(), at(18, 30));
    expect(k.wakes).toHaveLength(1);
    // The second order (Tue and Wed) is due on Monday evening, not before.
    expect(k.second.place_at).toBe("2026-11-23T18:00");
    await orderClock(k.ctx(), at(17, 45, 23));
    expect(k.wakes.filter((w) => w.data.order.id === k.second.id)).toEqual([]);
    await orderClock(k.ctx(), at(18, 0, 23));
    expect(k.wakes.filter((w) => w.data.order.id === k.second.id)).toHaveLength(1);
  });

  it("gives the same payload as place_order", async () => {
    const a = await plannedWeek(), b = await plannedWeek();
    await orderClock(a.ctx(), SAT_EVENING);
    const placed = await b.op("place_order", { order_id: b.first.id });
    const shape = (p: any) => ({ message: p.message, lines: p.order.lines.map((l: any) => [l.item, l.amount, l.unit, l.qty]), wake_sent_at: p.order.wake_sent_at,
      needs_product: p.needs_product.map((l: any) => l.item), needs_qty: p.needs_qty.map((l: any) => l.item) });
    expect(Object.keys(a.wakes[0].data).sort()).toEqual(Object.keys(placed).sort());
    expect(shape(a.wakes[0].data)).toEqual(shape(placed));
  });

  it("an order the agent already began placing through place_order is not woken for", async () => {
    const k = await plannedWeek();
    await k.op("place_order", { order_id: k.first.id });
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toEqual([]);
  });

  it("wakes again for an order still scheduled 60 minutes after its wake, caught up with the plan", async () => {
    const k = await plannedWeek();
    await orderClock(k.ctx(), at(18, 15));
    // The plan changes while the order is being placed: the order is left as it was read.
    await k.op("set_dish", { date: MON, slot: "Dinner", name: "Kachumber", ingredients: [{ item: "tomato", amount: 2, unit: "pc" }] });
    k.settle();
    expect(k.rows("order_lines").filter((l) => l.order_id === k.first.id).map((l) => l.item)).not.toContain("tomato");

    await orderClock(k.ctx(), at(19, 0));     // 45 minutes on
    await orderClock(k.ctx(), at(19, 15));    // exactly 60: not older than 60 yet
    expect(k.wakes).toHaveLength(1);

    await orderClock(k.ctx(), at(19, 30));    // 75 minutes on
    expect(k.wakes).toHaveLength(2);
    expect(k.wakes[1].data.order.id).toBe(k.first.id);
    expect(k.wakes[1].data.order.lines.map((l: any) => l.item)).toContain("tomato");
    expect(k.wakes[1].data.message).not.toBe(k.wakes[0].data.message);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T19:30");

    await orderClock(k.ctx(), at(19, 45));
    expect(k.wakes).toHaveLength(2);
  });

  it("never wakes again for an order recorded placed; one recorded not placed is tried at the next run", async () => {
    const k = await plannedWeek();
    await orderClock(k.ctx(), at(18, 15));
    await k.op("record_order", { order_id: k.first.id, placed: false, note: "Zepto was closed" });
    await orderClock(k.ctx(), at(18, 30));
    expect(k.wakes).toHaveLength(2);
    k.clock.now = at(18, 40);
    await k.op("record_order", { order_id: k.first.id, placed: true });
    await orderClock(k.ctx(), at(20, 30));
    await orderClock(k.ctx(), at(9, 0, 22));
    expect(k.wakes).toHaveLength(2);
  });

  it("skips an order with nothing on it, and wakes for it once it has lines", async () => {
    const k = await plannedWeek([{ date: MON, slot: "Lunch", dishes: [{ name: "Leftovers" }] }]);
    expect(k.rows("order_lines")).toEqual([]);
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toEqual([]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();

    await k.op("set_dish", { date: MON, slot: "Lunch", name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }] });
    await orderClock(k.ctx(), at(18, 30));   // the clock builds the order from the plan as it stands
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data.order.lines.map((l: any) => l.item)).toEqual(["cucumber"]);
  });

  it("an order woken for, emptied, and still scheduled an hour later is not woken for again", async () => {
    const k = await plannedWeek([{ date: MON, slot: "Lunch", dishes: [{ name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }] }] }]);
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toHaveLength(1);
    await k.op("set_dish", { date: MON, slot: "Lunch", name: "Salad", remove: true });
    await orderClock(k.ctx(), at(19, 30));
    expect(k.wakes).toHaveLength(1);
    expect(k.rows("order_lines")).toEqual([]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
  });
});

describe("a wake that does not go", () => {
  const busy = () => ({ ok: false, reason: "agent busy" });

  it("fails the weekly run and a check-in, so the run is not recorded as done", async () => {
    const k = await plannedWeek();
    await expect(weeklyPlan(k.ctx(null, busy), SAT_EVENING)).rejects.toThrow("the agent was not woken: agent busy");
    await expect(dinnerCheck(k.ctx(DAILY_3PM, busy), MON_3PM)).rejects.toThrow("agent busy");
    await expect(tomorrowCheck(k.ctx(DAILY_7PM, busy), SUN_7PM)).rejects.toThrow("agent busy");
    expect(k.wakes).toEqual([]);
    // The time was recorded all the same.
    expect(k.house().dinner_check_time).toBe("15:00");

    const old = await app({ family: false });
    carryOldProfile(old, "2 adults");
    await expect(weeklyPlan(old.ctx(null, busy), SAT_EVENING)).rejects.toThrow("agent busy");
  });

  it("the order clock takes its mark off the order, still hands over the other due orders, then fails once", async () => {
    const k = await plannedWeek();
    const monEvening = at(18, 0, 23);   // both the first order (never placed) and the second are due
    const run = orderClock(k.ctx(null, (data) => (data.order.id === k.first.id ? busy() : { ok: true })), monEvening);
    await expect(run).rejects.toThrow(`1 of 2 due orders not handed to the agent (${k.first.id}: the agent was not woken: agent busy)`);
    expect(k.wakes.map((w) => w.data.order.id)).toEqual([k.second.id]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
    expect(k.order(k.second.id).wake_sent_at).toBe("2026-11-23T18:00");

    // Not being placed by anyone: it follows the plan again, and the next run hands it over.
    await k.op("set_dish", { date: MON, slot: "Dinner", name: "Kachumber", ingredients: [{ item: "tomato", amount: 2, unit: "pc" }] });
    k.settle();
    expect(k.rows("order_lines").filter((l) => l.order_id === k.first.id).map((l) => l.item)).toContain("tomato");
    await orderClock(k.ctx(), at(18, 15, 23));
    expect(k.wakes.map((w) => w.data.order.id)).toEqual([k.second.id, k.first.id]);
  });

  it("a wake that throws is treated the same", async () => {
    const k = await plannedWeek();
    const ctx = { ...k.ctx(), wakeAgent: async () => { throw new Error("socket closed"); } };
    await expect(orderClock(ctx, at(18, 15))).rejects.toThrow("socket closed");
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
  });

  it("a wake held for later went: the order keeps its mark and is not handed over again", async () => {
    const k = await plannedWeek();
    await orderClock(k.ctx(null, () => ({ ok: true, data: { heldUntil: "2026-11-21T20:00:00.000Z" } })), at(18, 15));
    expect(k.wakes).toHaveLength(1);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T18:15");
    await orderClock(k.ctx(), at(18, 30));
    expect(k.wakes).toHaveLength(1);
  });
});

describe("the family gate", () => {
  /** Every routine through the app's own map, as the kit calls it, each at a time it has something to say at. */
  const TIMES: Record<string, Date> = { "weekly-plan": SAT_EVENING, "order-clock": MON_3PM, "dinner-check": MON_3PM, "tomorrow-check": SUN_7PM };
  const runAll = async (k: Awaited<ReturnType<typeof app>>) => {
    expect(Object.keys(routines).sort()).toEqual(Object.keys(TIMES).sort());
    for (const id of Object.keys(TIMES)) await routines[id](k.ctx(id === "tomorrow-check" ? DAILY_7PM : DAILY_3PM), TIMES[id]);
  };

  it("gated: no person and no pending profile → no wake from any routine", async () => {
    // A plan and a due order are there, so each routine would have something to say.
    const k = await plannedWeek([monLunch, monDinner], { family: false });
    expect(k.first.lines.length).toBeGreaterThan(0);
    await runAll(k);
    expect(k.wakes).toEqual([]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
    expect([k.house().dinner_check_time, k.house().tomorrow_check_time]).toEqual(["15:00", "19:00"]);

    // The same app once a person is known: every routine speaks.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await runAll(k);
    expect(k.wakes.map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start", "message,needs_product,needs_qty,order", "meal_id,text", "date,meal_ids,text"]);
  });

  it("a carried-over profile and nobody yet: only the weekly run wakes, to structure it; the check-ins and the clock are silent", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults, veg");
    await runAll(k);
    expect(k.wakes.map((w) => Object.keys(w.data))).toEqual([["profile"]]);
    expect(k.wakes[0].data.profile).toBe("2 adults, veg");
    expect(k.house().dinner_check_time).toBe("15:00");
    expect(k.rows("orders")).toEqual([]);
  });

  it("a carried-over profile, nobody yet, and a final plan with a due order: still only the structure wake", async () => {
    const k = await plannedWeek([monLunch, monDinner], { family: false });
    carryOldProfile(k, "2 adults, veg");
    await runAll(k);
    expect(k.wakes.map((w) => Object.keys(w.data))).toEqual([["profile"]]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
    expect([k.house().dinner_check_time, k.house().tomorrow_check_time]).toEqual(["15:00", "19:00"]);

    // Once the profile is structured into a person, the routines speak.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await k.op("set_house_rules", { structured: true });
    await runAll(k);
    expect(k.wakes.slice(1).map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start", "message,needs_product,needs_qty,order", "meal_id,text", "date,meal_ids,text"]);
  });
});
