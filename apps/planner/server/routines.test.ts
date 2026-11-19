// The weekly-plan routine, run by hand with a context that records each wake of the agent; and the family gate in front of
// it. (The reminders and the order clock return with their own tests in a later step.)
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";
import { weeklyPlan, WEEKLY_PROMPT } from "./routines/weekly-plan";

const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const MON = "2026-11-23";
const SAT_EVENING = new Date(2026, 10, 21, 18, 5);   // Sat 21 Nov, 18:05: the weekly run

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
async function app(opts: { family?: boolean } = {}) {
  const k = await boot();
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
  return { ...k, wakes, ctx };
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

  it("the prompt plans a day a call, makes the week final, and sends the plan; it orders nothing", () => {
    const p = WEEKLY_PROMPT(MON);
    const order = ["plan_week", `mode: "draft"`, "keep_rest: true", `mode: "final"`, "set_meal"].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(p).toContain(MON);
    expect(p).toContain("Mon 23 Nov");
    for (const gone of ["place_order", "record_order", "ask_low_or_out", "add_to_order"]) expect(p).not.toContain(gone);
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


describe("a wake that does not go", () => {
  const busy = () => ({ ok: false, reason: "agent busy" });

  it("fails the weekly run, so the run is not recorded as done", async () => {
    const k = await app();
    await expect(weeklyPlan(k.ctx(null, busy), SAT_EVENING)).rejects.toThrow("the agent was not woken: agent busy");
    expect(k.wakes).toEqual([]);

    const old = await app({ family: false });
    carryOldProfile(old, "2 adults");
    await expect(weeklyPlan(old.ctx(null, busy), SAT_EVENING)).rejects.toThrow("agent busy");
  });
});

describe("the family gate", () => {
  it("has the weekly plan as its one routine", () => {
    expect(Object.keys(routines)).toEqual(["weekly-plan"]);
  });

  it("gated: no person and no pending profile → no wake", async () => {
    const k = await app({ family: false });
    await routines["weekly-plan"](k.ctx(), SAT_EVENING);
    expect(k.wakes).toEqual([]);

    // The same app once a person is known: it speaks.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await routines["weekly-plan"](k.ctx(), SAT_EVENING);
    expect(k.wakes.map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start"]);
  });

  it("a carried-over profile and nobody yet: the weekly run wakes only to structure it", async () => {
    const k = await app({ family: false });
    carryOldProfile(k, "2 adults, veg");
    await routines["weekly-plan"](k.ctx(), SAT_EVENING);
    expect(k.wakes.map((w) => Object.keys(w.data))).toEqual([["profile"]]);
    expect(k.wakes[0].data.profile).toBe("2 adults, veg");

    // Once the profile is structured into a person, the routine plans.
    await k.op("set_person", { name: "Asha", group: "adult" });
    await k.op("set_house_rules", { structured: true });
    await routines["weekly-plan"](k.ctx(), SAT_EVENING);
    expect(k.wakes.slice(1).map((w) => Object.keys(w.data).sort().join())).toEqual(["context,week_start"]);
  });
});
