// The food rules the app checks before a plan is kept (docs/specs/2026-11-21-planner-food-rules-check.md): the matcher, the
// breaks of each kind of rule, and run 11's week, refused naming each break and passed once corrected.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { breaksText, dishHas, matches, ruleBreaks, type RuleWeek } from "./rules";

describe("matches", () => {
  it("drops a negation from a dish's name: in brackets, and 'without X' / 'no X'", () => {
    expect(matches("Lemon rice (no peanuts)", "peanut", { name: true })).toBe(false);
    expect(matches("Lemon rice (without peanuts)", "@peanut", { name: true })).toBe(false);
    expect(matches("Lemon rice [minus groundnut]", "@peanut", { name: true })).toBe(false);
    expect(matches("Poha without onion", "onion", { name: true })).toBe(false);
    expect(matches("Upma no onion, with peas", "onion", { name: true })).toBe(false);
    expect(matches("Upma no onion, with peas", "peas", { name: true })).toBe(true);
    expect(matches("Sambar without onion and garlic", "garlic", { name: true })).toBe(false);
    expect(matches("Lemon rice (no peanuts)", "rice", { name: true })).toBe(true);
    // An ingredient is matched as given.
    expect(matches("no peanuts", "peanut")).toBe(true);
    // "no" is a word: "Dal Makhani" is not a negation.
    expect(matches("Dal makhani", "dal", { name: true })).toBe(true);
  });

  it("drops a trailing plural s / es on both sides", () => {
    expect(matches("Potatoes", "potato")).toBe(true);
    expect(matches("potato", "potatoes")).toBe(true);
    expect(matches("Chapatis", "chapati")).toBe(true);
    expect(matches("Dates", "date")).toBe(true);
    expect(matches("peanuts", "peanut")).toBe(true);
    expect(matches("Cheeses", "cheese")).toBe(true);
    expect(matches("Radishes", "radish")).toBe(true);
  });

  it("matches a phrase as consecutive words, whatever the capitals and punctuation", () => {
    expect(matches("Plain idli", "plain idli")).toBe(true);
    expect(matches("Plain Idli, with chutney", "plain idli")).toBe(true);
    expect(matches("Rava idli", "plain idli")).toBe(false);
    expect(matches("Idli plain", "plain idli")).toBe(false);
    expect(matches("Coconut chutney", "nut")).toBe(false);
    expect(matches("Eggplant bharta", "egg")).toBe(false);
  });

  it("matches a category by its words", () => {
    expect(matches("groundnut oil", "@peanut")).toBe(true);
    expect(matches("Peanut chikki", "@nuts")).toBe(true);
    expect(matches("Coconut chutney", "@nuts")).toBe(false);
    expect(matches("Aloo gobi", "@root_veg")).toBe(false);
    expect(matches("potato", "@root_veg")).toBe(true);
    expect(matches("Sweet potato chaat", "@root_veg")).toBe(true);
    expect(matches("Palak paneer", "@green_leafy")).toBe(true);
    expect(matches("Palak paneer", "@protein")).toBe(true);
    expect(matches("Chicken curry", "@meat")).toBe(true);
    expect(matches("Prawn fry", "@fish")).toBe(true);
    expect(matches("Masala omelette", "@egg")).toBe(true);
    expect(matches("Mushroom masala", "@mushroom")).toBe(true);
    expect(matches("Banana walnut cake", "@baked")).toBe(true);
    expect(matches("Garlic bread", "@baked")).toBe(true);
  });

  it("white rice is rice and what is made of it; millet, brown, red and ragi rice (and a millet idli) are not", () => {
    for (const yes of ["Lemon rice", "Idli", "Plain dosa", "Neer dosa", "Appam", "Poha", "rice flour", "basmati", "Sona masoori", "Jeera rice"])
      expect(matches(yes, "@white_rice")).toBe(true);
    for (const no of ["Millet rice", "Brown rice", "Red rice", "Ragi rice", "Millet idli", "Ragi dosa", "Foxtail millet pongal", "Rava idli", "Oats dosa"])
      expect(matches(no, "@white_rice")).toBe(false);
  });

  it("a dish has an item when its name (negations dropped) or one of its ingredients has it", () => {
    expect(dishHas({ name: "Lemon rice (no peanuts)", ingredients: ["rice", "lemon"] }, "@peanut")).toBe(false);
    expect(dishHas({ name: "Lemon rice (no peanuts)", ingredients: ["rice", "groundnut oil"] }, "@peanut")).toBe(true);
    expect(dishHas({ name: "Oats dosa", ingredients: ["oats", "rice flour"] }, "@white_rice")).toBe(true);
  });
});

const people = ["Shiva", "Ankita", "Lakshmi", "Agastya", "Meera"].map((name) => ({ name }));
type D = { name: string; for_people?: string[] | null; portion_note?: string | null; ingredients?: string[] };
const week = (meals: { date: string; slot: string; ordered_in?: boolean; dishes: D[] }[]): RuleWeek =>
  ({ days: [...new Set(meals.map((m) => m.date))].map((date) => ({ date, meals: meals.filter((m) => m.date === date)
    .map((m) => ({ ...m, dishes: m.dishes.map((d) => ({ for_people: null, portion_note: null, ingredients: [], ...d })) })) })) });
const keys = (b: { meal: string; dish?: string; who?: string }[]) => b.map((x) => `${x.meal}|${x.dish ?? ""}|${x.who ?? ""}`);

describe("ruleBreaks", () => {
  it("who eats a dish: the dishes naming them, else every dish for no one in particular", () => {
    const rules = [{ kind: "only" as const, who: "Meera", slots: ["Breakfast"], items: ["plain idli"], days: [] }];
    const own = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Plain idli", for_people: ["Meera"] }, { name: "Rava idli" }] }]);
    expect(ruleBreaks(own, { rules }, people)).toEqual([]);
    const shared = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Rava idli" }, { name: "Milk", for_people: ["Agastya"] }] }]);
    expect(keys(ruleBreaks(shared, { rules }, people))).toEqual(["Mon 2026-11-23 Breakfast|Rava idli|Meera"]);
    // Named on no dish while every dish names someone: she eats nothing, and the rule says what she eats.
    const none = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Milk", for_people: ["Agastya"] }] }]);
    expect(ruleBreaks(none, { rules }, people)).toMatchObject([{ meal: "Mon 2026-11-23 Breakfast", who: "Meera", fix: "add a dish for Meera: one of plain idli" }]);
  });

  it("avoid holds on its days and slots only, and for its person only when one is named", () => {
    const rules = [{ kind: "avoid" as const, days: ["Tue"], items: ["@root_veg"] }, { kind: "avoid" as const, who: "Agastya", items: ["@nuts"], days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Aloo gobi", ingredients: ["potato"] }] },
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Aloo gobi", ingredients: ["potato"] }, { name: "Kaju katli", for_people: ["Shiva"] }] },
      { date: "2026-11-24", slot: "Dinner", dishes: [{ name: "Kaju katli" }] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Tue 2026-11-24 Lunch|Aloo gobi|", "Tue 2026-11-24 Dinner|Kaju katli|Agastya"]);
    expect(b[0].rule).toBe("no root vegetables on Tue");
    expect(b[0].fix).toContain("potato");
  });

  it("swap: a dish they eat with the item carries a note naming them and the swap, or they get a dish of their own", () => {
    const rules = [{ kind: "swap" as const, who: "Lakshmi", items: ["@white_rice"], to: "millet", days: [] }];
    const bad = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice", portion_note: "less for Meera" }, { name: "Dal" }] }]);
    expect(keys(ruleBreaks(bad, { rules }, people))).toEqual(["Mon 2026-11-23 Lunch|Jeera rice|Lakshmi"]);
    const noted = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice", portion_note: "millet rice for Lakshmi" }, { name: "Dal" }] }]);
    expect(ruleBreaks(noted, { rules }, people)).toEqual([]);
    const own = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice" }, { name: "Millet khichdi", for_people: ["Lakshmi"] }] }]);
    expect(ruleBreaks(own, { rules }, people)).toEqual([]);
  });

  it("require: in each of its slots the person eats a dish with one of the items; everyone when nobody is named", () => {
    const rules = [{ kind: "require" as const, who: "Shiva", slots: ["Lunch", "Dinner"], items: ["@protein"], days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Upma" }] },
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Bhindi fry" }, { name: "Rice", ingredients: ["rice"] }] },
      { date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Aloo sabzi" }, { name: "Egg bhurji", for_people: ["Shiva"] }] },
      { date: "2026-11-24", slot: "Dinner", ordered_in: true, dishes: [] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Mon 2026-11-23 Lunch||Shiva"]);
    expect(b[0]).toMatchObject({ rule: "Shiva has protein at Lunch, Dinner", fix: "add a dish with protein that Shiva eats" });
    const all = ruleBreaks(w, { rules: [{ kind: "require", slots: ["Dinner"], items: ["@protein"], days: [] }] }, people);
    expect(all.map((x) => x.who)).toEqual(["Ankita", "Lakshmi", "Agastya", "Meera"]);
  });

  it("cap: dishes with the items in at most per_week meals; each meal over it is named", () => {
    const rules = [{ kind: "cap" as const, items: ["chapati", "phulka"], per_week: 2, days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Phulka" }] },
      { date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Chapatis" }] },
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Chapati" }] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Tue 2026-11-24 Lunch|Chapati|"]);
    expect(b[0].fix).toContain("Mon Lunch, Mon Dinner, Tue Lunch");
  });

  it("the older kinds are checked as the spec maps them; fasting and other are not", () => {
    const w = week([
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Egg curry", ingredients: ["eggs", "onion"] }, { name: "Chicken 65" }] },
      { date: "2026-11-25", slot: "Lunch", dishes: [{ name: "Fish fry" }] }]);
    const rule = (kind: string, days: string[] = []) => ({ kind: kind as any, days });
    expect(keys(ruleBreaks(w, { rules: [rule("no_eggs", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Egg curry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("veg")] }, people))).toEqual(["Tue 2026-11-24 Lunch|Chicken 65|", "Wed 2026-11-25 Lunch|Fish fry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("egg", ["Wed"])] }, people))).toEqual(["Wed 2026-11-25 Lunch|Fish fry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("no_meat", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Chicken 65|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("no_onion_garlic", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Egg curry|"]);
    expect(ruleBreaks(w, { rules: [rule("fasting", ["Tue"]), { kind: "other", days: [], note: "no fish" }] }, people)).toEqual([]);
    // A day in the family's own words ("Ekadashi") is not a weekday the app can check.
    expect(ruleBreaks(w, { rules: [rule("veg", ["Ekadashi"])] }, people)).toEqual([]);
  });

  it("names each break in one line: meal, dish, the rule, and the fix", () => {
    const rules = [{ kind: "only" as const, who: "Meera", slots: ["Breakfast"], items: ["plain idli", "plain dosa", "banana sheera"], days: [] }];
    const b = ruleBreaks(week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Rava idli" }] }]), { rules }, people);
    expect(breaksText(b)).toBe("Mon 2026-11-23 Breakfast: Rava idli — Meera eats only plain idli, plain dosa, banana sheera at Breakfast (add a dish for Meera)");
  });
});

// ── Run 11 (the plan saved for 23–29 Nov), through the agent's operations ──

const RUN11_RULES = [
  { kind: "only", who: "Meera", slots: ["Breakfast"], items: ["plain idli", "plain dosa", "banana sheera"], note: "Meera only eats these for breakfast" },
  { kind: "swap", who: "Lakshmi", items: ["@white_rice"], to: "millet", note: "diabetic" },
  { kind: "only", who: "Lakshmi", days: ["Thu"], items: ["sabudana khichdi", "fruit"], note: "Thursday fast" },
  { kind: "require", who: "Shiva", slots: ["Lunch", "Dinner"], items: ["@protein"] },
  { kind: "avoid", items: ["@peanut"] },
  { kind: "avoid", items: ["@mushroom", "@baked"] },
  { kind: "cap", items: ["chapati", "phulka"], per_week: 2 },
  { kind: "avoid", days: ["Tue"], items: ["@root_veg"] },
  { kind: "veg" },
  { kind: "no_eggs" },
];

const ing = (...items: string[]) => items.map((item) => ({ item, amount: 100, unit: "g" }));
const dish = (name: string, items: string[], more: Record<string, unknown> = {}) => ({ name, ingredients: ing(...items), ...more });

/** The week as it was saved in run 11, near enough: each rule broken somewhere. */
const BROKEN = [
  { date: "2026-11-23", slot: "Breakfast", dishes: [dish("Rava idli", ["rava", "curd"])] },
  { date: "2026-11-23", slot: "Lunch", dishes: [dish("Dal tadka", ["toor dal", "tomato"]), dish("Phulka", ["atta"])] },
  { date: "2026-11-23", slot: "Dinner", dishes: [dish("Mushroom masala", ["mushroom", "tomato", "onion"]), dish("Chapati", ["atta"])] },
  { date: "2026-11-24", slot: "Lunch", dishes: [dish("Aloo gobi", ["potato", "cauliflower", "ginger"]), dish("Chapati", ["atta"]), dish("Moong dal", ["moong dal"])] },
  { date: "2026-11-24", slot: "Dinner", dishes: [dish("Lemon rice (no peanuts)", ["rice", "lemon", "curry leaves"]), dish("Curd", ["curd"])] },
  { date: "2026-11-26", slot: "Breakfast", dishes: [dish("Oats dosa", ["oats", "rice flour", "curd"])] },
  { date: "2026-11-27", slot: "Dinner", dishes: [dish("Veg pulao", ["basmati rice", "carrot", "peas"]), dish("Cucumber salad", ["cucumber", "lemon"])] },
  { date: "2026-11-28", slot: "Breakfast", dishes: [dish("Banana walnut cake", ["banana", "walnut", "maida"])] },
  { date: "2026-11-28", slot: "Lunch", dishes: [dish("Egg curry", ["eggs", "tomato"]), dish("Jeera rice", ["basmati rice", "cumin"])] },
];

const RUN11_BREAKS = [
  "Mon 2026-11-23 Breakfast|Rava idli|Meera",
  "Mon 2026-11-23 Dinner|Mushroom masala|",
  "Mon 2026-11-23 Dinner||Shiva",
  "Tue 2026-11-24 Lunch|Aloo gobi|",
  "Tue 2026-11-24 Lunch|Chapati|",
  "Tue 2026-11-24 Dinner|Lemon rice (no peanuts)|Lakshmi",
  "Thu 2026-11-26 Breakfast|Oats dosa|Meera",
  "Thu 2026-11-26 Breakfast|Oats dosa|Lakshmi",
  "Thu 2026-11-26 Breakfast|Oats dosa|Lakshmi",
  "Fri 2026-11-27 Dinner|Veg pulao|Lakshmi",
  "Fri 2026-11-27 Dinner||Shiva",
  "Sat 2026-11-28 Breakfast|Banana walnut cake|",
  "Sat 2026-11-28 Breakfast|Banana walnut cake|Meera",
  "Sat 2026-11-28 Lunch|Egg curry|",
  "Sat 2026-11-28 Lunch|Jeera rice|Lakshmi",
].sort();

/** The same week with every rule kept. */
const FIXED = [
  { date: "2026-11-23", slot: "Breakfast", dishes: [dish("Plain idli", ["idli rice", "urad dal"], { for: ["Meera"] }), dish("Rava idli", ["rava", "curd"])] },
  { date: "2026-11-23", slot: "Lunch", dishes: [dish("Dal tadka", ["toor dal", "tomato"]), dish("Phulka", ["atta"])] },
  { date: "2026-11-23", slot: "Dinner", dishes: [dish("Paneer butter masala", ["paneer", "tomato", "cream"]), dish("Chapati", ["atta"])] },
  { date: "2026-11-24", slot: "Lunch", dishes: [dish("Cabbage poriyal", ["cabbage", "coconut"]), dish("Bajra roti", ["bajra flour"]), dish("Moong dal", ["moong dal"])] },
  { date: "2026-11-24", slot: "Dinner", dishes: [dish("Lemon rice (no peanuts)", ["rice", "lemon", "curry leaves"], { portion_note: "millet lemon rice for Lakshmi" }), dish("Curd", ["curd"])] },
  { date: "2026-11-26", slot: "Breakfast", dishes: [dish("Plain dosa", ["dosa rice", "urad dal"], { for: ["Meera"] }),
    dish("Sabudana khichdi", ["sabudana", "potato", "ghee"], { for: ["Lakshmi"] }), dish("Oats upma", ["oats", "carrot", "beans"])] },
  { date: "2026-11-27", slot: "Dinner", dishes: [dish("Veg pulao", ["basmati rice", "carrot", "peas"], { portion_note: "millet pulao for Lakshmi" }), dish("Rajma", ["rajma", "tomato", "onion"])] },
  { date: "2026-11-28", slot: "Breakfast", dishes: [dish("Banana sheera", ["sooji", "banana", "ghee"], { for: ["Meera"] }), dish("Vegetable upma", ["sooji", "carrot", "peas"])] },
  { date: "2026-11-28", slot: "Lunch", dishes: [dish("Chole", ["chole", "onion", "tomato"]), dish("Jeera rice", ["basmati rice", "cumin"], { portion_note: "millet for Lakshmi" })] },
];

async function run11() {
  const k = await boot();
  for (const name of ["Shiva", "Ankita", "Lakshmi", "Agastya", "Meera"]) await k.op("set_person", { name, group: name === "Agastya" ? "child" : "adult" });
  const saved = await k.op("set_house_rules", { rules: RUN11_RULES });
  expect(saved.house.rules).toHaveLength(RUN11_RULES.length);
  return k;
}

describe("run 11: the plan for 23–29 Nov", () => {
  it("a final plan_week with meals that breaks the family's rules is refused, naming every break, and nothing is saved", async () => {
    const { op, rows } = await run11();
    const r = await op("plan_week", { week_start: "2026-11-23", mode: "final", meals: BROKEN });
    expect(r.code).toBe("RULE_BROKEN");
    expect(keys(r.detail.rule_breaks).sort()).toEqual(RUN11_BREAKS);
    expect(r.error).toContain("Mon 2026-11-23 Breakfast: Rava idli — Meera eats only plain idli, plain dosa, banana sheera at Breakfast (add a dish for Meera)");
    expect(r.error).toContain("Fri 2026-11-27 Dinner: Shiva has protein at Lunch, Dinner");
    expect(rows("plan_meals")).toHaveLength(0);
  });

  it("the corrected week passes, and closes with its message", async () => {
    const { op } = await run11();
    const r = await op("plan_week", { week_start: "2026-11-23", mode: "final", meals: FIXED });
    expect(r.code).toBeUndefined();
    expect(r.week.status).toBe("final");
    const closed = await op("plan_week", { week_start: "2026-11-23", mode: "final" });
    expect(closed.code).toBeUndefined();
    expect(closed.message).toBeDefined();
  });

  it("a draft that breaks the rules is kept as a draft; making it final is refused with every break", async () => {
    const { op, rows } = await run11();
    expect((await op("plan_week", { week_start: "2026-11-23", mode: "draft", meals: BROKEN })).week.status).toBe("draft");
    const r = await op("plan_week", { week_start: "2026-11-23", mode: "final" });
    expect(r.code).toBe("RULE_BROKEN");
    expect(keys(r.detail.rule_breaks).sort()).toEqual(RUN11_BREAKS);
    expect(rows("plan_meals").every((m) => m.status === "draft")).toBe(true);
  });

  it("rule breaks and missing ingredients are told together, so one round fixes both", async () => {
    const { op } = await run11();
    const meals = [{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Rava idli" }] }];
    const r = await op("plan_week", { week_start: "2026-11-23", mode: "final", meals });
    expect(r.code).toBe("RULE_BROKEN");
    expect(r.detail.missing_ingredients).toEqual(["Mon 2026-11-23 Breakfast: Rava idli"]);
    expect(keys(r.detail.rule_breaks)).toEqual(["Mon 2026-11-23 Breakfast|Rava idli|Meera"]);
    expect(r.error).toContain("Without ingredients");
    // The closing call too: a dish on two days and a rule broken in one refusal.
    await op("plan_week", { week_start: "2026-11-23", mode: "draft", meals: [...FIXED.slice(0, 2),
      { date: "2026-11-25", slot: "Lunch", dishes: [dish("Dal tadka", ["toor dal"]), dish("Mushroom curry", ["mushroom"])] }] });
    const closing = await op("plan_week", { week_start: "2026-11-23", mode: "final" });
    expect(closing.code).toBe("RULE_BROKEN");
    expect(closing.detail.repeated).toEqual(["Dal tadka (Mon, Wed)"]);
    expect(keys(closing.detail.rule_breaks)).toEqual(["Wed 2026-11-25 Lunch|Mushroom curry|"]);
  });

  it("with keep_rest, a day's meals are checked, and a cap over the week the day adds to", async () => {
    const { op } = await run11();
    expect((await op("plan_week", { week_start: "2026-11-23", mode: "final", keep_rest: true, meals: FIXED.slice(0, 3) })).code).toBeUndefined();
    const r = await op("plan_week", { week_start: "2026-11-23", mode: "final", keep_rest: true,
      meals: [{ date: "2026-11-24", slot: "Lunch", dishes: [dish("Chapati", ["atta"]), dish("Moong dal", ["moong dal"])] }] });
    expect(r.code).toBe("RULE_BROKEN");
    expect(keys(r.detail.rule_breaks)).toEqual(["Tue 2026-11-24 Lunch|Chapati|"]);
  });

  it("set_meal and set_dish by the agent on a final week are refused when they break a rule; nothing changes", async () => {
    const { op, rows } = await run11();
    const { week } = await op("plan_week", { week_start: "2026-11-23", mode: "final", meals: FIXED });
    const r = await op("set_meal", { date: "2026-11-23", slot: "Breakfast", dishes: [dish("Rava idli", ["rava", "curd"])] });
    expect(r.code).toBe("RULE_BROKEN");
    expect(keys(r.detail.rule_breaks)).toEqual(["Mon 2026-11-23 Breakfast|Rava idli|Meera"]);
    const monB = week.days[0].meals.find((m: any) => m.slot === "Breakfast");
    expect(rows("dishes").filter((d) => d.meal_id === monB.id).map((d) => d.name).sort()).toEqual(["Plain idli", "Rava idli"]);
    // Taking Shiva's protein away from a dinner.
    const paneer = week.days[0].meals.find((m: any) => m.slot === "Dinner").dishes[0];
    const removed = await op("set_dish", { dish_id: paneer.id, remove: true });
    expect(removed.code).toBe("RULE_BROKEN");
    expect(keys(removed.detail.rule_breaks)).toEqual(["Mon 2026-11-23 Dinner||Shiva"]);
    expect(rows("dishes").some((d) => d.id === paneer.id)).toBe(true);
    // A third chapati meal: the cap over the week.
    const cap = await op("set_dish", { date: "2026-11-25", slot: "Dinner", ...dish("Chapati", ["atta"]) });
    expect(cap.code).toBe("RULE_BROKEN");
    // The new dinner also has no protein for Shiva: both are named.
    expect(keys(cap.detail.rule_breaks).sort()).toEqual(["Wed 2026-11-25 Dinner|Chapati|", "Wed 2026-11-25 Dinner||Shiva"]);
    expect(rows("plan_meals").some((m) => m.date === "2026-11-25")).toBe(false);
    // A change that keeps the rules goes through.
    expect((await op("set_dish", { dish_id: paneer.id, name: "Palak paneer", ingredients: ing("palak", "paneer") })).dish.name).toBe("Palak paneer");
  });

  it("set_meal by the agent on a draft week is not checked: the final call is", async () => {
    const { op } = await run11();
    await op("plan_week", { week_start: "2026-11-23", mode: "draft", meals: FIXED });
    expect((await op("set_meal", { date: "2026-11-23", slot: "Breakfast", dishes: [dish("Rava idli", ["rava"])] })).meal).toBeDefined();
  });

  it("the family's own edits are never checked", async () => {
    const { op, owner } = await run11();
    await op("plan_week", { week_start: "2026-11-23", mode: "final", meals: FIXED });
    const r = await owner("POST", "/api/meals", { date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Mushroom toast" }] });
    expect(r.status).toBe(200);
    expect((await owner("POST", "/api/dishes", { date: "2026-11-24", slot: "Lunch", name: "Chapati" })).status).toBe(200);
  });
});
