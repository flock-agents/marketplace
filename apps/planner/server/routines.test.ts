// The four routines, run by hand with a context that records each wake of the agent: the Sunday plan, the 15:00 and 19:00
// reminders, the order clock; and the family gate in front of them.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";
import { weeklyPlan, WEEKLY_PROMPT } from "./routines/weekly-plan";
import { dailyTime, reminder, REMINDER_PROMPT, scheduleTime } from "./routines/reminders";
import { orderClock } from "./routines/order-clock";

const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const MON = "2026-11-23";
const SUN_MORNING = new Date(2026, 10, 22, 11, 0);   // Sun 22 Nov, 11:00: the weekly run
const WEEKLY = { type: "schedule", cron: "0 11 * * 0" }, DAILY_3PM = { type: "schedule", cron: "0 15 * * *" }, DAILY_7PM = { type: "schedule", cron: "0 19 * * *" };

type Wake = { message: string; data: any };
// What Flock carries of a wake (flock-app/server/src/app-routine-runs.ts wakeAppRoutineAgent): a message of 4,000 characters
// and data of 20,000 characters as JSON.stringify(data, null, 2). A wake over either is refused there, so it is here.
const WAKE_MESSAGE_MAX_CHARS = 4_000, WAKE_DATA_MAX_CHARS = 20_000;
const dataChars = (data: unknown): number => (data === undefined ? 0 : JSON.stringify(data, null, 2).length);
function flockRefusal(message: string, data: unknown): string | null {
  if (message.trim().length > WAKE_MESSAGE_MAX_CHARS) return `message is longer than ${WAKE_MESSAGE_MAX_CHARS} characters`;
  return dataChars(data) > WAKE_DATA_MAX_CHARS ? `data is larger than ${WAKE_DATA_MAX_CHARS} characters as JSON` : null;
}

/** An app and a routine context on it that records the wakes. */
async function app(opts: { family?: boolean; now?: () => Date } = {}) {
  const k = await boot({ now: opts.now });
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
  const house = () => k.rows("house")[0];
  return { ...k, wakes, ctx, house };
}

/** A 2.0 install's household profile, carried over as at boot. */
function carryOldProfile(k: Awaited<ReturnType<typeof app>>, text: string) {
  k.kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES ('s1', '', '', 'app', 'household.profile', ?, 'owner')`, [JSON.stringify(text)]);
  expect(migrateOldProfile(k.kit.sqlite)).toBe("migrated");
}

describe("weekly plan", () => {
  it("Sunday 11:00 plans next week (Monday tomorrow), one wake, under Flock's limits, and the prompt never mentions an order or Saturday", async () => {
    const k = await app();
    await weeklyPlan(k.ctx(WEEKLY), SUN_MORNING);
    expect(k.wakes).toHaveLength(1);
    expect(flockRefusal(k.wakes[0].message, k.wakes[0].data)).toBeNull();
    expect(k.house().plan_time).toBe("11:00");
    for (const banned of ["order", "saturday", "long-life", "long life"]) expect(k.wakes[0].message.toLowerCase()).not.toContain(banned);
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
    await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    await k.op("plan_week", { week_start: "2026-11-16", mode: "draft", meals: lastWeek });
    return k;
  };

  it("the context goes without the rows' bookkeeping, inside Flock's 20,000 characters of wake data", async () => {
    const k = await family({ people: 4, items: 8, recipes: 12 });
    await weeklyPlan(k.ctx(), SUN_MORNING);
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
    await weeklyPlan(k.ctx(), SUN_MORNING);
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

  it("the prompt plans the cooking days a day a call as final, then one closing call whose message and intro are sent word for word", () => {
    const p = WEEKLY_PROMPT(MON);
    const steps = [`mode: "draft" } without meals`, "cooking_days", `mode: "final", keep_rest: true, meals`, "answer no message",
      `plan_week { week_start: "${MON}", mode: "final" } without meals`, "`instructions`", "`message` word for word", "only link", "`intro` word for word", "end your turn", "Do not wait for a reply"].map((s) => p.indexOf(s));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(p).toContain("one day a call");
    expect(p).toContain("Mon 23 Nov");
    // What the plan is made from: the cook's limits, every slot (a child's tiffin), variety and every dish's ingredients.
    for (const said of ["cook_wont_make", "cook_time_limit", "cook_new_recipes", "extra_slots", "tiffin", "no dish twice in the week unless the family asked", "Every dish gets its ingredients"])
      expect(p).toContain(said);
    expect(p).not.toMatch(/\b(he|she|his|her|him)\b/i);
    for (const gone of ["place_order", "record_order", "ask_low_or_out", "add_to_order", "order_cart", "set_cart_line"]) expect(p).not.toContain(gone);
    for (const banned of ["order", "saturday", "long-life", "long life", "\u2014"]) expect(p.toLowerCase()).not.toContain(banned);
    expect(p.length).toBeLessThanOrEqual(WAKE_MESSAGE_MAX_CHARS);
  });

  it("a weekly cron of 30 10 * * 0 stores 10:30; one that is not one time a week stores nothing", async () => {
    const k = await app();
    await weeklyPlan(k.ctx({ type: "schedule", cron: "30 10 * * 0" }), SUN_MORNING);
    expect(k.house().plan_time).toBe("10:30");
    await weeklyPlan(k.ctx({ type: "schedule", cron: "0 11 * * 0,3" }), SUN_MORNING);
    expect(k.house().plan_time).toBeNull();
  });

  it("a carried-over profile is structured first: the weekly run only asks to structure it", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults and Agastya (6). Veg on Tuesdays.");
    await weeklyPlan(k.ctx(), SUN_MORNING);
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


describe("a wake that does not go", () => {
  const busy = () => ({ ok: false, reason: "agent busy" });

  it("fails the weekly run, so the run is not recorded as done", async () => {
    const k = await app();
    await expect(weeklyPlan(k.ctx(null, busy), SUN_MORNING)).rejects.toThrow("the agent was not woken: agent busy");
    expect(k.wakes).toEqual([]);

    const old = await app({ family: false });
    carryOldProfile(old, "2 adults");
    await expect(weeklyPlan(old.ctx(null, busy), SUN_MORNING)).rejects.toThrow("agent busy");
  });
});

describe("the family gate", () => {
  it("has the four routines, by their handlers", () => {
    expect(Object.keys(routines).sort()).toEqual(["afternoon-reminder", "evening-reminder", "order-clock", "weekly-plan"]);
  });

  it("a carried-over profile and nobody yet: the reminders and the clock are silent", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults, veg");
    await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
    await routines["afternoon-reminder"](k.ctx(DAILY_3PM), new Date(2026, 10, 23, 15, 0));
    await routines["evening-reminder"](k.ctx(DAILY_7PM), new Date(2026, 10, 23, 19, 0));
    await routines["order-clock"](k.ctx(), new Date(2026, 10, 23, 19, 0));
    expect(k.wakes).toEqual([]);
  });

  it("gated: no person and no pending profile → no wake", async () => {
    const k = await app({ family: false });
    await routines["weekly-plan"](k.ctx(), SUN_MORNING);
    expect(k.wakes).toEqual([]);

    // The same app once a person is known: it speaks.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await routines["weekly-plan"](k.ctx(), SUN_MORNING);
    expect(k.wakes.map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start"]);
  });

  it("a carried-over profile and nobody yet: the weekly run wakes only to structure it", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults, veg");
    await routines["weekly-plan"](k.ctx(), SUN_MORNING);
    expect(k.wakes.map((w) => Object.keys(w.data))).toEqual([["profile"]]);
    expect(k.wakes[0].data.profile).toBe("2 adults, veg");

    // Once the profile is structured into a person, the routine plans.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await k.op("set_house_rules", { structured: true });
    await routines["weekly-plan"](k.ctx(), SUN_MORNING);
    expect(k.wakes.slice(1).map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start"]);
  });
});

describe("the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));

  it("the manifest has the four routines at Sun 11:00, 15:00, 19:00 and every 15 minutes", () => {
    expect(manifest.routines.map((r: any) => [r.id, r.trigger.type, r.trigger.cron, r.executionMode, r.handler])).toEqual([
      ["weekly-plan", "schedule", "0 11 * * 0", "app-relay", "weekly-plan"],
      ["afternoon-reminder", "schedule", "0 15 * * *", "app-relay", "afternoon-reminder"],
      ["evening-reminder", "schedule", "0 19 * * *", "app-relay", "evening-reminder"],
      ["order-clock", "schedule", "*/15 * * * *", "app-relay", "order-clock"]]);
    for (const r of manifest.routines) {
      expect(routines[r.handler], r.handler).toBeFunction();
      expect(r.name && r.description, r.id).toBeTruthy();
      for (const banned of ["Saturday", "long-life", "\u2014"]) expect(r.description, r.id).not.toContain(banned);
    }
  });
});

describe("the run's time of day", () => {
  it("reads a fixed daily time from a schedule trigger, and a weekly one for the plan", () => {
    expect(dailyTime({ type: "schedule", cron: "0 15 * * *" })).toBe("15:00");
    expect(dailyTime("30 16 * * *")).toBe("16:30");
    for (const cron of ["*/15 * * * *", "0 15 * * 1", "0 9,15 * * *", "60 15 * * *", ""]) expect(dailyTime({ type: "schedule", cron })).toBeNull();
    for (const trigger of [null, undefined, {}, { type: "schedule", cron: 15 }]) expect(dailyTime(trigger)).toBeNull();
    expect(scheduleTime(WEEKLY, "weekly")).toBe("11:00");
    expect(scheduleTime({ type: "schedule", cron: "5 9 * * 6" }, "weekly")).toBe("09:05");
    for (const cron of ["0 11 * * *", "0 11 * * 0,3", "0 11 * * 1-5", "0 11 1 * 0", "0 11 * * 8"]) expect(scheduleTime({ type: "schedule", cron }, "weekly")).toBeNull();
  });
});

describe("the reminders", () => {
  const MON_3PM = new Date(2026, 10, 23, 15, 0), MON_7PM = new Date(2026, 10, 23, 19, 0), TUE = "2026-11-24";
  const run = (k: Awaited<ReturnType<typeof app>>, which: "afternoon" | "evening", now: Date, answer?: (data: any) => { ok: boolean; reason?: string }) =>
    reminder(k.ctx(which === "afternoon" ? DAILY_3PM : DAILY_7PM, answer), which, now);
  /** A family with tonight's dinner planned (Mon 23 Nov), curd every day, and Zepto connected. */
  const family = async (o: { dinner?: boolean; curd?: boolean; connected?: boolean } = {}) => {
    let t = MON_7PM.getTime();
    const k = await app({ now: () => new Date(t) });
    // The main app is always among the connected ones: a family with none connected has not set its shopping apps.
    if (o.connected !== false) await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
    if (o.curd) await k.op("set_regular", { item: "curd", amount: 400, unit: "g", every: "day" });
    if (o.dinner) await k.op("plan_week", { week_start: MON, mode: "final", keep_rest: true, meals: [
      { date: MON, slot: "Dinner", dishes: [{ name: "methi thepla", ingredients: [{ item: "methi", amount: 1, unit: "pc" }] }] }] });
    return Object.assign(k, { clock: (d: Date) => { t = d.getTime(); } });
  };

  it("each reminder records its time; nothing for a family the app does not know", async () => {
    const k = await app({ family: false });
    await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
    await reminder(k.ctx(DAILY_3PM), "afternoon", MON_3PM);
    await reminder(k.ctx({ type: "schedule", cron: "15 20 * * *" }), "evening", MON_7PM);
    expect(k.wakes).toEqual([]);
    expect([k.house().afternoon_time, k.house().evening_time]).toEqual(["15:00", "20:15"]);
    // Each writes only its own; a trigger that is not one daily time clears it.
    await reminder(k.ctx({ type: "schedule", cron: "0 15 * * 1-5" }), "afternoon", MON_3PM);
    expect([k.house().afternoon_time, k.house().evening_time]).toEqual([null, "20:15"]);
  });

  it("the afternoon run with nothing to say does not wake; the evening run wakes for the history read when an app is connected", async () => {
    const k = await family();
    await run(k, "afternoon", MON_3PM);
    expect(k.wakes).toEqual([]);
    await run(k, "evening", MON_7PM);
    expect(k.wakes).toEqual([{ message: REMINDER_PROMPT("evening"), data: { which: "evening", date: TUE, connected: ["zepto"], since: {} } }]);
    // The dry run changed nothing.
    expect(k.rows("orders")).toEqual([]);
    expect(k.rows("item_events")).toEqual([]);

    // With no app connected and nothing to say, the evening is silent too.
    const none = await family({ connected: false });
    await run(none, "evening", MON_7PM);
    expect(none.wakes).toEqual([]);
  });

  it("the afternoon run wakes when tonight's dinner is planned, and the dry run puts nothing on a cart", async () => {
    const k = await family({ dinner: true, curd: true });
    await run(k, "afternoon", MON_3PM);
    expect(k.wakes).toEqual([{ message: REMINDER_PROMPT("afternoon"), data: { which: "afternoon", date: MON, connected: ["zepto"], since: {} } }]);
    expect(k.rows("orders")).toEqual([]);
    expect(k.rows("order_lines")).toEqual([]);
  });

  it("the reminder wake's message and data fit Flock's limits and name get_reminder", async () => {
    const k = await family({ curd: true });
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-10-20", order_ref: "Z1", items: [{ item: "atta", group: "monthly", pack: "10 kg" }] }] });
    await run(k, "evening", MON_7PM);
    expect(k.wakes).toHaveLength(1);
    const { message, data } = k.wakes[0];
    expect(flockRefusal(message, data)).toBeNull();
    expect(data).toEqual({ which: "evening", date: TUE, connected: ["zepto"], since: { zepto: "2026-10-20" } });
    for (const s of ["get_reminder", "`date`", "import_order_history", "about 8 orders a call", "one app a call", "3 months", "`since`", "`empty`", "`text`", "word for word",
      "`app_text`", "`block`", "sync: true", "sync_cart", "`ordered`", "record_order", "delivery_gap", "the app's cart as it is", "answer_running_low", "set_cart_line",
      "order_cart", "set_meal", "set_dish"]) expect(message, s).toContain(s);
    // The steps in their order: history, the reminder, copy its carts to the apps, the reminder again, send, check out, replies.
    // The carts are copied before anything is sent, so the delivery gap the sent text quotes is the app's cart as it now is.
    for (const p of [message, REMINDER_PROMPT("afternoon")]) {
      const at = (s: string, from = 0) => p.indexOf(s, from);
      const first = at("get_reminder"), again = at("get_reminder", first + 1);
      const steps = [at("import_order_history"), first, at("sync_cart"), again, at("word for word"), at("`ordered`"), at("answer_running_low")];
      expect(steps.every((i) => i >= 0)).toBe(true);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(p).toContain("again with the same date");
      expect(p).toContain("Send that answer's `text`");
      expect(p).not.toContain("\u2014");
      expect(p).not.toMatch(/about 20 orders/);
    }
    // Both reminders read the history first: something bought on a connected app is not asked about again.
    expect(REMINDER_PROMPT("afternoon")).toContain("import_order_history oldest first, delivered or paid orders only, about 8 orders a call, one app a call");
    expect(REMINDER_PROMPT("afternoon")).toContain("15:00");
  });

  it("a reminder whose wake did not go fails the run", async () => {
    const k = await family({ dinner: true });
    await expect(run(k, "afternoon", MON_3PM, () => ({ ok: false, reason: "agent busy" }))).rejects.toThrow("the agent was not woken: agent busy");
    expect(k.house().afternoon_time).toBe("15:00");
  });

  it("a wake near midnight: the agent's get_reminder builds the reminder the routine checked, by the date in the wake", async () => {
    const k = await family({ curd: true });
    await run(k, "evening", new Date(2026, 10, 23, 23, 59));
    expect(k.wakes[0].data.date).toBe(TUE);
    // The agent answers after midnight: with the wake's date it is still Monday evening's reminder, for Tuesday.
    k.clock(new Date(2026, 10, 24, 0, 10));
    const r = await k.op("get_reminder", { which: "evening", date: k.wakes[0].data.date });
    expect(r).toMatchObject({ which: "evening", date: TUE, added: [{ app: "zepto", item: "curd" }] });
    expect(k.rows("order_lines").map((l) => [l.item, l.for_date])).toEqual([["curd", TUE]]);
    // A retry is the same reminder: nothing added twice.
    expect((await k.op("get_reminder", { which: "evening", date: TUE })).added).toEqual([]);
    // Without a date it is the reminder of the agent's own clock: Tuesday evening's, for Wednesday.
    expect((await k.op("get_reminder", { which: "evening" })).date).toBe("2026-11-25");
    // A date that is not this reminder's, yesterday's or today's, is refused.
    for (const date of ["2026-11-20", "2026-11-27", "24 Nov"]) expect((await k.op("get_reminder", { which: "evening", date })).code, date).toBe("APP_REFUSED");
  });
});

describe("the order clock", () => {
  const T0 = new Date(2026, 10, 23, 18, 5);   // Mon 23 Nov, 18:05
  const later = (min: number) => new Date(T0.getTime() + min * 60_000);
  /** Rice on the Zepto cart, ordered at T0. */
  const ordering = async () => {
    let t = T0.getTime();
    const k = await app({ now: () => new Date(t) });
    await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
    await k.op("set_cart_line", { item: "rice", qty: 1 });
    const id = (await k.op("order_cart", { app: "zepto" })).order_id as string;
    expect(id).toBeString();
    const order = () => k.rows("orders").find((o) => o.id === id);
    return Object.assign(k, { id, order, clock: (d: Date) => { t = d.getTime(); } });
  };
  const placed = async () => {
    const k = await ordering();
    await k.op("record_order", { order_id: k.id, placed: true });
    expect(k.order().status).toBe("placed");
    return k;
  };

  it("the clock closes an order unpaid for 24 hours once and tells the family in one line", async () => {
    const k = await placed();
    await orderClock(k.ctx(), later(24 * 60 - 5));
    expect(k.order().status).toBe("placed");
    expect(k.wakes).toEqual([]);

    await orderClock(k.ctx(), later(24 * 60));
    expect(k.order()).toMatchObject({ status: "not_paid", unpaid_notice: "sent" });
    // Its purchase stops counting and its line is back on Zepto's open cart.
    expect(k.rows("item_events").map((e) => e.void)).toEqual([1]);
    const open = k.rows("orders").filter((o) => o.status === "open");
    expect(open).toHaveLength(1);
    expect(k.rows("order_lines").filter((l) => l.order_id === open[0].id).map((l) => [l.item, l.qty, l.source, l.rolled_from])).toEqual([["rice", 1, "returned", k.id]]);
    expect(k.wakes).toHaveLength(1);
    expect(k.wakes[0].data).toEqual({ order_id: k.id, message: "Monday's Zepto order wasn't paid, so its items are back in your cart." });
    for (const s of ["`message`", "word for word", "Cancel nothing", "do not call record_order or cancel_order", "paid: true"]) expect(k.wakes[0].message).toContain(s);
    expect(flockRefusal(k.wakes[0].message, k.wakes[0].data)).toBeNull();

    // Said once: the next runs have nothing to close or say.
    await orderClock(k.ctx(), later(24 * 60 + 15));
    await orderClock(k.ctx(), later(48 * 60));
    expect(k.wakes).toHaveLength(1);
  });

  it("a failed wake is told on the next run; the order is closed once", async () => {
    const k = await placed();
    await expect(orderClock(k.ctx(null, () => ({ ok: false, reason: "agent busy" })), later(24 * 60))).rejects.toThrow(`${k.id}: the agent was not woken: agent busy`);
    expect(k.order()).toMatchObject({ status: "not_paid", unpaid_notice: "pending" });
    expect(k.wakes).toEqual([]);
    const lines = JSON.stringify(k.rows("order_lines"));
    await orderClock(k.ctx(), later(24 * 60 + 15));
    expect(k.wakes.map((w) => w.data.order_id)).toEqual([k.id]);
    expect(k.order().unpaid_notice).toBe("sent");
    expect(JSON.stringify(k.rows("order_lines"))).toBe(lines);
  });

  it("an order the agent recorded not paid, or cancelled once placed, is not told again by the clock", async () => {
    const k = await placed();
    await k.op("record_order", { order_id: k.id, paid: false });
    expect(k.order()).toMatchObject({ status: "not_paid", unpaid_notice: "sent" });
    await orderClock(k.ctx(), later(48 * 60));
    expect(k.wakes).toEqual([]);

    const c = await placed();
    await c.op("cancel_order", { order_id: c.id });
    await orderClock(c.ctx(), later(48 * 60));
    expect(c.order().status).toBe("not_paid");
    expect(c.wakes).toEqual([]);
  });

  it("a paid order is left alone", async () => {
    const k = await placed();
    await k.op("record_order", { order_id: k.id, paid: true });
    await orderClock(k.ctx(), later(48 * 60));
    expect(k.order().status).toBe("paid");
    expect(k.wakes).toEqual([]);
  });

  it("an order stuck ordering for an hour goes back to the open cart without a wake", async () => {
    const k = await ordering();
    // Eggs added while rice was being ordered went on a new open cart.
    k.clock(later(10));
    await k.op("set_cart_line", { item: "eggs", qty: 2 });
    expect(k.rows("orders").map((o) => o.status).sort()).toEqual(["open", "ordering"]);
    await orderClock(k.ctx(), later(59));
    expect(k.order().status).toBe("ordering");

    await orderClock(k.ctx(), later(60));
    expect(k.wakes).toEqual([]);
    // One open cart again, the one that was being ordered, with both lines and why it is back.
    expect(k.rows("orders").map((o) => [o.id, o.status])).toEqual([[k.id, "open"]]);
    expect(k.order()).toMatchObject({ note: "couldn't order yet", ordering_at: null });
    expect(k.rows("order_lines").map((l) => [l.item, l.qty, l.order_id])).toEqual([["rice", 1, k.id], ["eggs", 2, k.id]]);
    // Nothing was bought.
    expect(k.rows("item_events")).toEqual([]);
  });
});
