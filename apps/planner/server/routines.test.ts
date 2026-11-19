// The four routines, run by hand with a context that records each wake of the agent: the weekly plan, the two daily
// check-ins and the order clock; and the family gate in front of them.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";
import { weeklyPlan, WEEKLY_PROMPT } from "./routines/weekly-plan";
import { dailyTime, dinnerCheck, tomorrowCheck } from "./routines/check-ins";
import { orderClock } from "./routines/order-clock";

const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const MON = "2026-11-23", TUE = "2026-11-24";
const SAT_EVENING = new Date(2026, 10, 21, 18, 5);   // Sat 21 Nov, 18:05: the weekly run
const SUN_7PM = new Date(2026, 10, 22, 19, 0);
const MON_3PM = new Date(2026, 10, 23, 15, 0);
const at = (h: number, min: number, day = 21) => new Date(2026, 10, day, h, min);

type Wake = { message: string; data: any };
// What Flock carries of a wake (flock-app/server/src/app-routine-runs.ts wakeAppRoutineAgent): a message of 4,000 characters
// and data of 20,000 characters as JSON.stringify(data, null, 2). A wake over either is refused there, so it is here.
const WAKE_MESSAGE_MAX_CHARS = 4_000, WAKE_DATA_MAX_CHARS = 20_000;
const dataChars = (data: unknown): number => (data === undefined ? 0 : JSON.stringify(data, null, 2).length);
function flockRefusal(message: string, data: unknown): string | null {
  if (message.trim().length > WAKE_MESSAGE_MAX_CHARS) return `message is longer than ${WAKE_MESSAGE_MAX_CHARS} characters`;
  return dataChars(data) > WAKE_DATA_MAX_CHARS ? `data is larger than ${WAKE_DATA_MAX_CHARS} characters as JSON` : null;
}
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
    wakeAgent: async (message: string, data?: unknown) => {
      const refused = flockRefusal(message, data);
      const r = refused ? { ok: false, reason: refused } : answer(data);
      if (r.ok) wakes.push({ message, data });
      return r;
    },
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

  /** A family with long answers, everyday items, saved recipes and last week planned in full. */
  const family = async (size: { people: number; items: number; recipes: number }) => {
    const k = await app({ family: false });
    const everyone = [["Shivashankar", "me", "adult"], ["Ananya", "wife", "adult"], ["Agastya", "son", "child"], ["Meera", "daughter", "child"], ["Lakshmi", "mother", "elder"], ["Raman", "father", "elder"]];
    for (const [name, relationship, group] of everyone.slice(0, size.people))
      await k.op("set_person", { name, relationship, group, portions: "3 rotis at dinner, a small bowl of rice at lunch, 2 idlis at breakfast", diet: "vegetarian, eggs on weekends",
        allergies: "peanuts", dislikes: "bitter gourd, brinjal, anything too spicy", targets: "more protein, around 1800 kcal", note: "eats lunch at the office on weekdays" });
    await k.op("set_house_rules", { rules: [{ kind: "veg", days: ["Tue", "Thu"], note: "no eggs either" }, { kind: "fasting", days: ["Ekadashi"] }, { kind: "no_onion_garlic", days: ["Mon"] }],
      notes: "Dinner by 8 pm. Sunday lunch is the big meal of the week." });
    await k.op("set_cook", { name: "Lakshmi akka", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], arrival: "07:30", makes_well: "sambar, rasam, poriyal, chapati, lemon rice", note: "leaves by 11" });
    await k.op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }], order_in: [{ day: "Sun", slot: "Dinner", note: "pizza night" }] });
    const items = ["milk", "curd", "bread", "eggs", "bananas", "coffee powder", "tender coconut", "paneer", "butter", "idli batter", "tomatoes", "onions", "green chillies", "coriander", "apples"];
    for (const [i, item] of items.slice(0, size.items).entries()) await k.op("set_regular", i % 3 === 2 ? { item, amount: 6, unit: "pc", every: "weekdays", weekdays: ["Mon", "Wed", "Fri"], for_whom: "Agastya" }
      : i % 3 ? { item, amount: 500, unit: "g", every: "week", times_per_week: 2 } : { item, amount: 1, unit: "l", every: "day" });
    for (let i = 0; i < size.recipes; i++) await k.op("save_recipe", { name: `Grandmother's recipe number ${i + 1} with coconut`, links: [`https://www.instagram.com/reel/recipe${i}`], tags: ["breakfast", "tiffin", "quick"], for: ["Agastya", "Meera"] });
    const lastWeek = ["16", "17", "18", "19", "20", "21", "22"].flatMap((d) => ["Breakfast", "Lunch", "Agastya's tiffin", "Dinner"].map((slot) => ({ date: `2026-11-${d}`, slot,
      dishes: [{ name: `${slot} main with gravy` }, { name: `${slot} side, dry` }, { name: `${slot} salad or raita` }] })));
    await k.op("plan_week", { week_start: "2026-11-16", mode: "draft", meals: lastWeek });
    return k;
  };

  it("the context goes without the rows' bookkeeping, inside Flock's 20,000 characters of wake data", async () => {
    const k = await family({ people: 4, items: 8, recipes: 12 });
    await weeklyPlan(k.ctx(), SAT_EVENING);
    expect(k.wakes).toHaveLength(1);
    const { data } = k.wakes[0];
    expect(dataChars(data)).toBeLessThanOrEqual(WAKE_DATA_MAX_CHARS);
    const c = data.context;
    expect([c.people.length, c.regulars.length, c.recipes.length, c.last_week.length]).toEqual([4, 8, 12, 28]);
    for (const row of [...c.people, ...c.regulars, c.house]) for (const col of ["id", "created_at", "updated_at", "updated_by"]) expect(col in row).toBe(false);
    // What the plan is made from is all there.
    expect(c.people[0]).toMatchObject({ name: "Shivashankar", group: "adult", portions: "3 rotis at dinner, a small bowl of rice at lunch, 2 idlis at breakfast", allergies: "peanuts" });
    expect(c.regulars[0]).toMatchObject({ item: "milk", amount: 1, unit: "l", every: "day" });
    expect(c.house).toMatchObject({ cook_name: "Lakshmi akka", rules: [{ kind: "veg" }, { kind: "fasting" }, { kind: "no_onion_garlic" }] });
    expect(c.recipes[0].id).toBeString();
  });

  it("a family of 6 with 15 everyday items and 40 recipes is still woken: its context is too long for a wake, so the wake names the week and the prompt says where to read it", async () => {
    const k = await family({ people: 6, items: 15, recipes: 40 });
    await weeklyPlan(k.ctx(), SAT_EVENING);
    expect(k.wakes).toEqual([{ message: WEEKLY_PROMPT("2026-11-23"), data: { week_start: "2026-11-23" } }]);
    expect(dataChars(k.wakes[0].data)).toBeLessThanOrEqual(WAKE_DATA_MAX_CHARS);
    expect(WEEKLY_PROMPT("2026-11-23")).toContain("when it has `context`");
    // The whole context is the agent's to read: an operation's answer has no such limit.
    const { context } = await k.op("plan_week", { week_start: "2026-11-23", mode: "draft" });
    expect([context.people.length, context.regulars.length, context.recipes.length]).toEqual([6, 15, 40]);
    expect(dataChars(context)).toBeGreaterThan(WAKE_DATA_MAX_CHARS);
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
    // A run over a week already under way places nothing early, and an order is acted on once.
    expect(p).toContain("only if it is scheduled");
    expect(p).toContain("if it is already placed, paid or being placed, place none: the later ones go out at their own time");
    expect(p).toContain("If you were already handed this order_id, act once.");
    expect(p).toContain("names from `items`");
    expect(p).toContain("Cancel nothing on the grocery app");
    expect(p).not.toContain("ask_pending");
    // The long-life items are on the second order, where the answer can still change them; an order nobody pays for is closed by the app.
    expect(p).toContain("the week's long-life items wait on the second order");
    expect(p).toContain("The items they have come off the second order; the ones low or out stay on it.");
    expect(p).toContain("still waiting for its payment 24 hours after it was placed is closed as not paid by the app");
    const g = guide.replace(/\s+/g, " ");
    for (const said of ["the long-life ones go on the second (a week of one order keeps them)", "bought once, in the week's second order", "The items wait on the week's second order",
      "still waiting for payment 24 hours after it was placed is closed the same way by the app", "Monday's order wasn't paid, so I've moved its items to Wednesday's."]) expect(g, said).toContain(said);
    expect(g).not.toContain("week's first order");
  });

  it("with a migrated 2.0 profile, the weekly run only asks to structure it", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults and Agastya (6). Veg on Tuesdays.");
    await weeklyPlan(k.ctx(), SAT_EVENING);
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data).toEqual({ profile: "2 adults and Agastya (6). Veg on Tuesdays." });
    expect(k.wakes[0].message).toContain("set_person / set_house_rules / set_cook / set_slots / set_regular");
    expect(k.wakes[0].message).toContain("structured: true");
    // Then the family hears of the new app and gets a plan in the same run, not a week later.
    const m = k.wakes[0].message;
    expect(m).toContain("tell the family the app was rebuilt, and plan the week of Mon 23 Nov (week_start 2026-11-23) as the weekly run does (call guide)");
    expect(m.indexOf("structured: true")).toBeLessThan(m.indexOf("the app was rebuilt"));
    expect(k.wakes[0].data.week_start).toBeUndefined();
    expect(guide.replace(/\s+/g, " ")).toContain("tell the family the app was rebuilt and plan the coming week as the weekly run does");
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

describe("what a wake carries", () => {
  it("a check-in for a full day is far below Flock's limits", async () => {
    const day = (date: string) => ["Breakfast", "Lunch", "Dinner"].map((slot) => ({ date, slot, dishes: ["main with gravy", "side, dry", "salad or raita"].map((d) => ({
      name: `${slot} ${d}`, for: ["Asha"], portion_note: "4 for me, 1 for wife", video_url: `https://www.youtube.com/watch?v=${slot}${d.length}`,
      ingredients: ["cauliflower florets", "green chillies", "coriander leaves", "paneer cubes", "fresh cream", "spinach"].map((item) => ({ item: `${item} for ${slot} ${d}`, amount: 200, unit: "g" })) })) }));
    const k = await plannedWeek(day(MON));
    await k.op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30" });
    await k.op("cancel_order", { order_id: k.first.id });   // every fresh item is then "not on any order yet": the longest text
    await dinnerCheck(k.ctx(DAILY_3PM), MON_3PM);
    await tomorrowCheck(k.ctx(DAILY_7PM), SUN_7PM);
    expect(k.wakes).toHaveLength(2);
    for (const w of k.wakes) { expect(dataChars(w.data)).toBeLessThan(WAKE_DATA_MAX_CHARS / 4); expect(w.message.length).toBeLessThan(WAKE_MESSAGE_MAX_CHARS / 4); }
  });

  it("the weekly prompt fits in a wake's message", () => {
    expect(WEEKLY_PROMPT(MON).length).toBeLessThanOrEqual(WAKE_MESSAGE_MAX_CHARS);
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
    expect(Object.keys(data)).toEqual(["order_id", "app", "message", "lines", "needs_product", "needs_qty"]);
    expect(data.order_id).toBe(k.first.id);
    expect(data.app).toBe("zepto");
    expect(data.lines.map((l: any) => l.item).sort()).toEqual(["cauliflower", "paneer", "potato", "spinach"]);
    // A line carries what placing needs, and nothing of the row's bookkeeping.
    expect(data.lines.find((l: any) => l.item === "potato")).toEqual({ item: "potato", unit: "g", amount: 500, qty: 1, qty_checked: 0, product_id: null, name_on_app: null, pack: null, price: null });
    expect(data.message).toStartWith("Ordering this now: ");
    expect(data.message).toEndWith(" on Zepto");
    expect([...data.needs_product].sort()).toEqual(["cauliflower", "paneer", "potato", "spinach"]);
    expect([...data.needs_qty].sort()).toEqual(["cauliflower", "paneer", "potato", "spinach"]);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T18:15");
    for (const s of ["`message`", "needs_product", "needs_qty", "add_to_order { order_id, item", "Zepto", "placed: true", "paid: true", "paid: false", "Cancel nothing on Zepto"]) expect(message).toContain(s);
    expect(message.indexOf("placed: true")).toBeLessThan(message.indexOf("paid: true"));
    expect(message).toContain("If you were already handed this order_id, act once.");
    expect(message).not.toContain("handed to you before");

    await orderClock(k.ctx(), at(18, 30));
    expect(k.wakes).toHaveLength(1);
    // The second order (Tue and Wed) is due on Monday evening, not before.
    expect(k.second.place_at).toBe("2026-11-23T18:00");
    await orderClock(k.ctx(), at(17, 45, 23));
    expect(k.wakes.filter((w) => w.data.order_id === k.second.id)).toEqual([]);
    await orderClock(k.ctx(), at(18, 0, 23));
    expect(k.wakes.filter((w) => w.data.order_id === k.second.id)).toHaveLength(1);
  });

  it("hands over what place_order answers, slimmed: the same message, lines and needs, and the order marked the same", async () => {
    const a = await plannedWeek(), b = await plannedWeek();
    for (const k of [a, b]) await k.op("remember_product", { item: "paneer", app: "zepto", product_id: "z-paneer", name_on_app: "Amul Paneer 200 g", pack: "200 g", pack_amount: 200, pack_unit: "g", price: 95 });
    await orderClock(a.ctx(), SAT_EVENING);
    const placed = await b.op("place_order", { order_id: b.first.id });
    const woken = a.wakes[0].data;
    const slim = (l: any) => ({ item: l.item, unit: l.unit, amount: l.amount, qty: l.qty, qty_checked: l.qty_checked, product_id: l.product_id, name_on_app: l.name_on_app, pack: l.pack, price: l.price });
    expect(woken.message).toBe(placed.message);
    expect(woken.app).toBe(placed.order.app);
    expect(woken.lines).toEqual(placed.order.lines.map(slim));
    expect(woken.lines.find((l: any) => l.item === "paneer")).toMatchObject({ product_id: "z-paneer", name_on_app: "Amul Paneer 200 g", pack: "200 g", price: 95, qty: 1, qty_checked: 1 });
    expect(woken.needs_product).toEqual(placed.needs_product.map((l: any) => l.item));
    expect(woken.needs_qty).toEqual(placed.needs_qty.map((l: any) => l.item));
    expect(woken.needs_product).not.toContain("paneer");
    expect(a.order(a.first.id).wake_sent_at).toBe(placed.order.wake_sent_at);
  });

  /** A week whose first order (Sun and Mon) has `n` lines, none with a product: Monday's lunch and dinner, n fresh ingredients. */
  const longOrder = async (n: number) => {
    const names = ["basmati rice", "toor dal", "cauliflower florets", "green chillies", "coriander leaves", "cold pressed mustard oil", "whole wheat atta", "kashmiri red chilli powder"];
    const ingredients = Array.from({ length: n }, (_, i) => ({ item: `${names[i % names.length]} ${i + 1}`, amount: 250 + i, unit: i % 2 ? "g" : "ml", keeps: "fresh" }));
    const dishes = (from: number, to: number, slot: string) => Array.from({ length: Math.ceil((to - from) / 5) }, (_, d) => ({
      name: `${slot} dish number ${d + 1} with gravy`, ingredients: ingredients.slice(from + d * 5, Math.min(from + d * 5 + 5, to)) }));
    const half = Math.ceil(n / 2);
    return plannedWeek([{ date: MON, slot: "Lunch", dishes: dishes(0, half, "Lunch") }, { date: MON, slot: "Dinner", dishes: dishes(half, n, "Dinner") }]);
  };

  it("a 40-line order with no products is handed over whole, inside Flock's 20,000 characters of wake data", async () => {
    const k = await longOrder(40);
    expect(k.first.lines).toHaveLength(40);
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toHaveLength(1);
    const { data } = k.wakes[0];
    expect(data.lines).toHaveLength(40);
    expect(data.needs_product).toHaveLength(40);
    expect(data.needs_qty).toHaveLength(40);
    expect(dataChars(data)).toBeLessThanOrEqual(WAKE_DATA_MAX_CHARS);
    expect(dataChars(data)).toBeLessThanOrEqual(18_000);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T18:15");
  });

  it("an order too long for a wake is handed over by its id and message alone, and the prompt says to call place_order", async () => {
    const k = await longOrder(120);
    await orderClock(k.ctx(), at(18, 15));
    expect(k.wakes).toHaveLength(1);
    const { message, data } = k.wakes[0];
    expect(Object.keys(data)).toEqual(["order_id", "message"]);
    expect(data.order_id).toBe(k.first.id);
    expect(data.message).toStartWith("Ordering this now: ");
    expect(dataChars(data)).toBeLessThanOrEqual(WAKE_DATA_MAX_CHARS);
    expect(message).toContain("no `lines`");
    expect(message).toContain("place_order { order_id }");
    // The order is still the agent's to read in full.
    const placed = await k.op("place_order", { order_id: k.first.id });
    expect(placed.order.lines).toHaveLength(120);
    expect(placed.needs_product).toHaveLength(120);
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
    expect(k.wakes[1].data.order_id).toBe(k.first.id);
    expect(k.wakes[1].data.lines.map((l: any) => l.item)).toContain("tomato");
    expect(k.wakes[1].data.message).not.toBe(k.wakes[0].data.message);
    // The second hand-over says it is one, so an order already in the cart is not placed twice.
    expect(k.wakes[1].message).toStartWith("This order was handed to you before at 6:15 pm on Sat 21 Nov and never recorded. First check the grocery app: if it is already in the cart or placed, do not place it again; record it.\n");
    expect(k.wakes[1].message.slice(k.wakes[1].message.indexOf("\n") + 1)).toBe(k.wakes[0].message);
    expect(k.order(k.first.id).wake_sent_at).toBe("2026-11-21T19:30");

    await orderClock(k.ctx(), at(19, 45));
    expect(k.wakes).toHaveLength(2);
  });

  it("never wakes again for an order recorded placed; one recorded not placed is tried again an hour later, not at the next run", async () => {
    const k = await plannedWeek();
    await orderClock(k.ctx(), at(18, 15));
    k.clock.now = at(18, 20);
    await k.op("record_order", { order_id: k.first.id, placed: false, note: "Zepto was closed" });
    expect(k.order(k.first.id)).toMatchObject({ status: "scheduled", wake_sent_at: null, place_at: "2026-11-21T19:20" });
    await orderClock(k.ctx(), at(18, 35));    // 15 minutes on
    await orderClock(k.ctx(), at(19, 15));
    expect(k.wakes).toHaveLength(1);
    await orderClock(k.ctx(), at(19, 20));    // 60 minutes on
    expect(k.wakes).toHaveLength(2);
    // It was recorded, so this is a fresh try, not a hand-over that went missing.
    expect(k.wakes[1].message).toBe(k.wakes[0].message);
    k.clock.now = at(19, 40);
    await k.op("record_order", { order_id: k.first.id, placed: true });
    await orderClock(k.ctx(), at(21, 30));
    await orderClock(k.ctx(), at(9, 0, 22));
    expect(k.wakes).toHaveLength(2);
  });

  it("an order whose days have passed is cancelled, not handed over; one for added items has no days and still goes", async () => {
    const k = await plannedWeek([monLunch, monDinner, tueLunch, { date: "2026-11-26", slot: "Lunch", dishes: [{ name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }] }] }]);
    await k.op("record_order", { order_id: k.first.id, placed: true, paid: true });
    expect([k.second.covers_from, k.second.covers_to, k.second.place_at]).toEqual([TUE, "2026-11-25", "2026-11-23T18:00"]);
    const third = k.orders[2];
    // Nothing ran from Monday evening to Thursday morning: the order for Tuesday and Wednesday is of no use now.
    await orderClock(k.ctx(), at(9, 0, 26));
    expect(k.order(k.second.id)).toMatchObject({ status: "cancelled", note: "its days had passed", wake_sent_at: null });
    // The order for Thursday and Friday is late, and still wanted.
    expect(k.wakes.map((w) => w.data.order_id)).toEqual([third.id]);
    // On its last day an order is still placed.
    const late = await plannedWeek();
    await late.op("record_order", { order_id: late.first.id, placed: true, paid: true });
    await orderClock(late.ctx(), at(23, 45, 25));
    expect(late.wakes.map((w) => w.data.order_id)).toEqual([late.second.id]);

    const added = await app();
    const { order } = await added.op("add_to_order", { item: "coriander" });
    expect(order).toMatchObject({ week_start: null, covers_to: "2026-11-21" });
    await orderClock(added.ctx(), at(9, 0, 23));
    expect(added.wakes.map((w) => w.data.order_id)).toEqual([order.id]);
    expect(added.order(order.id).status).toBe("scheduled");
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
    expect(k.wakes[0].data.lines.map((l: any) => l.item)).toEqual(["cucumber"]);
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

describe("an order nobody paid for", () => {
  const SUN_6PM = at(18, 0, 22), SUN_605PM = at(18, 5, 22);   // the first order is placed on Sat 21 Nov at 18:05
  const linesOf = (k: Awaited<ReturnType<typeof plannedWeek>>, id: string) => k.rows("order_lines").filter((l) => l.order_id === id).map((l) => l.item).sort();

  it("a placed order still waiting for payment 24 hours on is closed as not paid, its lines roll on, and the agent is given one line to say", async () => {
    const k = await plannedWeek();
    await k.op("record_order", { order_id: k.first.id, placed: true });
    expect(k.order(k.first.id).placed_at).toBe("2026-11-21T18:05");
    await orderClock(k.ctx(), SUN_6PM);   // 23 hours 55 minutes: still waiting
    expect(k.order(k.first.id).status).toBe("placed");
    expect(k.wakes).toEqual([]);

    await orderClock(k.ctx(), SUN_605PM);   // 24 hours
    expect(k.order(k.first.id)).toMatchObject({ status: "not_paid", note: "not paid within 24 hours" });
    expect(linesOf(k, k.first.id)).toEqual([]);
    // As for an order the family did not pay: the same lines, now added ones, on the week's next scheduled order.
    expect(linesOf(k, k.second.id)).toEqual(["atta", "cauliflower", "onion", "paneer", "potato", "rice", "spinach"]);
    expect(k.rows("order_lines").find((l) => l.item === "spinach")).toMatchObject({ order_id: k.second.id, source: "added" });
    expect(k.rows("orders")).toHaveLength(k.orders.length);
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data).toEqual({ order_id: k.first.id, rolled_into: k.second.id, message: "Saturday's order wasn't paid, so I've moved its items to Monday's." });
    for (const s of ["`message`", "word for word", "Cancel nothing on the grocery app", "do not call record_order or cancel_order"]) expect(k.wakes[0].message).toContain(s);

    // Said once: the next runs have nothing to close, and the order it rolled into goes out at its own time, with the lines.
    await orderClock(k.ctx(), at(18, 20, 22));
    expect(k.wakes).toHaveLength(1);
    await orderClock(k.ctx(), at(18, 0, 23));
    expect(k.wakes).toHaveLength(2);
    expect(k.wakes[1].data.order_id).toBe(k.second.id);
    expect(k.wakes[1].data.lines.map((l: any) => l.item)).toContain("spinach");
  });

  it("with no later scheduled order none is made: the lines stay, and the line says so", async () => {
    const k = await plannedWeek();
    await k.op("record_order", { order_id: k.first.id, placed: true });
    for (const o of k.orders.slice(1)) await k.op("cancel_order", { order_id: o.id });
    const had = linesOf(k, k.first.id);
    await orderClock(k.ctx(), SUN_605PM);
    expect(k.order(k.first.id).status).toBe("not_paid");
    expect(linesOf(k, k.first.id)).toEqual(had);
    expect(k.rows("orders")).toHaveLength(k.orders.length);
    expect(k.rows("orders").filter((o) => o.status === "scheduled")).toEqual([]);
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data).toEqual({ order_id: k.first.id, rolled_into: null,
      message: "Saturday's order wasn't paid, and there is no later order to move its items to. Tell me if you still want them." });
  });

  it("a paid order, one closed already and one never placed are left alone; a note the order had is kept", async () => {
    const k = await plannedWeek();
    await k.op("record_order", { order_id: k.first.id, placed: true, paid: true });
    await orderClock(k.ctx(), at(9, 0, 23));
    expect(k.order(k.first.id).status).toBe("paid");
    expect(k.wakes).toEqual([]);

    const closed = await plannedWeek();
    await closed.op("record_order", { order_id: closed.first.id, placed: true });
    await closed.op("record_order", { order_id: closed.first.id, paid: false });
    await orderClock(closed.ctx(), SUN_605PM);
    expect(closed.wakes).toEqual([]);

    const noted = await plannedWeek();
    await noted.op("record_order", { order_id: noted.first.id, placed: true, note: "UPI link sent to Asha" });
    await orderClock(noted.ctx(), SUN_605PM);
    expect(noted.order(noted.first.id)).toMatchObject({ status: "not_paid", note: "UPI link sent to Asha" });
  });

  it("an order closed without its line reaching the agent fails the run, and the due orders are still handed over", async () => {
    const k = await plannedWeek();
    await k.op("record_order", { order_id: k.first.id, placed: true });
    const busy = (data: any) => (data.message?.includes("wasn't paid") ? { ok: false, reason: "agent busy" } : { ok: true });
    await expect(orderClock(k.ctx(null, busy), at(18, 0, 23))).rejects.toThrow(`1 unpaid orders closed without the family being told (${k.first.id}: the agent was not woken: agent busy)`);
    expect(k.order(k.first.id).status).toBe("not_paid");
    expect(k.wakes.map((w) => w.data.order_id)).toEqual([k.second.id]);
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
    const run = orderClock(k.ctx(null, (data) => (data.order_id === k.first.id ? busy() : { ok: true })), monEvening);
    await expect(run).rejects.toThrow(`1 of 2 due orders not handed to the agent (${k.first.id}: the agent was not woken: agent busy)`);
    expect(k.wakes.map((w) => w.data.order_id)).toEqual([k.second.id]);
    expect(k.order(k.first.id).wake_sent_at).toBeNull();
    expect(k.order(k.second.id).wake_sent_at).toBe("2026-11-23T18:00");

    // Not being placed by anyone: it follows the plan again, and the next run hands it over.
    await k.op("set_dish", { date: MON, slot: "Dinner", name: "Kachumber", ingredients: [{ item: "tomato", amount: 2, unit: "pc" }] });
    k.settle();
    expect(k.rows("order_lines").filter((l) => l.order_id === k.first.id).map((l) => l.item)).toContain("tomato");
    await orderClock(k.ctx(), at(18, 15, 23));
    expect(k.wakes.map((w) => w.data.order_id)).toEqual([k.second.id, k.first.id]);
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
    expect(k.wakes.map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start", "app,lines,message,needs_product,needs_qty,order_id", "meal_id,text", "date,meal_ids,text"]);
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
    expect(k.wakes.slice(1).map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start", "app,lines,message,needs_product,needs_qty,order_id", "meal_id,text", "date,meal_ids,text"]);
  });
});
