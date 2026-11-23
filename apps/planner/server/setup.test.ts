// apply_setup (setup.ts) with a fake model: the profile the model reads is checked and written by code, one thing at a time,
// in a fixed order; a rule the family never said is dropped; one the app cannot take is kept as a note; nothing sinks the rest.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { clockOf, cookVisits, cookTimesOf, daysOf, dishOftenSaid, mergeDishes, ruleOftenSaid, saidByFamily, familyLines, plainWords, SETUP_PARTS } from "./setup";
import type { ModelRequest, ModelResult } from "./model";

const HOUSEHOLD = {
  "household.people": [{ name: "Kiran", relation: "self", group: "adult" }, { name: "Nisha", relation: "wife", group: "adult" },
    { name: "Ishaan", age: 7, group: "child" }, { name: "Padma", age: 68, group: "elder" }],
  "household.help": [{ role: "cook", name: "Rani", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], times: "8am", meals: ["Breakfast", "Lunch"] }],
};
const TRANSCRIPT = [
  "Q: Rani cooks Breakfast and Lunch at 8am. Is that right?",
  "A: yes, and dinner at 5pm",
  "A: actually Rani comes at 8:15",
  "Q: Any food rules? Some families say no onion garlic on Tuesdays.",
  "A: pure veg at home. Padma has no sugar, she fasts Mondays till evening. Ishaan's tiffin must be nut-free.",
  "Q: Weekends?",
  "A: Nisha cooks on Saturday, Sunday we eat out for lunch. The adults have chai and a snack at 5 every day.",
  "Q: Which grocery app?",
  "A: blinkit mostly, bigbasket otherwise. Akshayakalpa milk every morning.",
];
const PROFILE = {
  people: [{ name: "Kiran", group: "adult" }, { name: "Nisha", group: "adult", relationship: "wife" }, { name: "Ishaan", group: "child", age: 7 }],
  cook: { name: "Rani", days: ["Mon-Fri"], visits: [{ at: "8:15", meals: ["breakfast", "lunch"] }, { at: "5pm", meals: ["Dinner"] }], timeLimit: null, newRecipes: null, note: null },
  homeCook: [{ day: "Saturday", slots: ["Breakfast", "Lunch", "Dinner"], by: "Nisha" }],
  slots: [{ name: "Ishaan's tiffin", days: ["Mon-Fri"], for: ["Ishaan"] }, { name: "Evening snack", days: [], for: ["adults"] }],
  orderIn: [{ day: "Sun", slot: "lunch", note: "eaten out" }],
  rules: [
    { kind: "vegetarian", quote: "pure veg at home" },
    { kind: "avoid", who: "Padma", items: ["@sweet"], quote: "Padma has no sugar" },
    { kind: "fasting", who: "Padma", days: ["Mon"], slots: ["Breakfast", "Lunch"], quote: "she fasts Mondays till evening" },
    { kind: "avoid", items: ["@nuts"], slots: ["Tiffin"], quote: "tiffin must be nut-free" },
    // From the question's example, not from the family: dropped.
    { kind: "no_onion_garlic", days: ["Tue"], quote: "no onion garlic on Tuesdays" },
  ],
  dishes: [{ name: "Poha", slots: ["Breakfast"], for: [] }, { name: "Sandwich", slots: ["tiffin"], for: ["Ishaan"] }, { name: "Ragi mudde", slots: ["Lunch"], for: ["Padma"] }],
  groceryApps: { main: "blinkit", fallback: "bigbasket" },
  subscriptions: [{ item: "milk", source: "Akshayakalpa", note: "every morning" }],
  unplaced: [],
};

type Part = "home" | "rules" | "dishes";
const partOf = (req: ModelRequest): Part => (/rules/.test(req.purpose ?? "") ? "rules" : /dishes/.test(req.purpose ?? "") ? "dishes" : "home");
const isResult = (v: unknown): v is ModelResult => !!v && typeof v === "object" && "ok" in (v as object);
/** A model per reader: each part's slice of `answer` (or `answer` itself when it is a failure); `over` answers a part its own
 *  way (a result, a JSON value, or a function of the try's number). */
function fake(answer: unknown, over: Partial<Record<Part, unknown>> = {}) {
  const asked: ModelRequest[] = [];
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    asked.push(req);
    const part = partOf(req);
    let a: unknown = part in over ? over[part] : answer;
    if (typeof a === "function") a = await a(asked.filter((x) => partOf(x) === part).length);
    if (isResult(a)) return a;
    if (!(part in over)) {
      const { rules, unplaced, dishes, ...home } = a as Record<string, unknown>;
      a = part === "home" ? home : part === "rules" ? { rules, unplaced } : { dishes };
    }
    return { ok: true, json: a, model: "fake" };
  };
  const sys = (part: Part) => asked.find((x) => partOf(x) === part)!.system;
  return { model, asked, sys };
}

describe("apply_setup: the model reads, code writes", () => {
  it("three balanced calls at once, each with the household and the transcript; everything saved in order, the late correction kept", async () => {
    const f = fake(PROFILE);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(f.asked.map(partOf).sort()).toEqual(["dishes", "home", "rules"]);
    for (const a of f.asked) {
      expect(a.tier).toBe("balanced");
      expect(JSON.parse(a.user).transcript).toContain("actually Rani comes at 8:15");
      expect(JSON.parse(a.user).household).toEqual(HOUSEHOLD);
    }
    // Each reader is asked only its own part.
    expect(Object.keys((f.asked.find((x) => partOf(x) === "rules")!.schema as any).properties)).toEqual(["rules", "unplaced"]);
    expect(Object.keys((f.asked.find((x) => partOf(x) === "dishes")!.schema as any).properties)).toEqual(["dishes"]);
    expect(f.sys("home")).not.toContain("- rules:");
    const fam = (await k.owner("GET", "/api/family")).body;
    // Padma was left out by the model: the household facts bring her, an elder.
    expect(fam.people.map((p: any) => [p.name, p.group])).toEqual([["Kiran", "adult"], ["Nisha", "adult"], ["Ishaan", "child"], ["Padma", "elder"]]);
    const h = fam.house;
    expect(h.cook_name).toBe("Rani");
    expect(h.cook_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(h.cook_visits).toEqual([{ at: "08:15", meals: ["Breakfast", "Lunch"] }, { at: "17:00", meals: ["Dinner"] }]);
    // Every day is planned: Saturday Nisha cooks; Sunday, which nobody said who cooks, is still cooked but for the lunch out.
    expect(h.cooking_days).toBeUndefined();
    expect(h.extra_slots).toEqual([{ name: "Ishaan's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Ishaan"] }, { name: "Evening snack", for: ["Kiran", "Nisha"] }]);
    expect(h.order_in).toEqual([{ day: "Sun", slot: "Lunch", note: "eaten out" }]);
    const kinds = h.rules.map((x: any) => `${x.kind}${x.who ? ` ${x.who}` : ""}${x.slots ? ` @${x.slots.join(",")}` : ""}`);
    expect(kinds).toEqual(["veg", "avoid Padma", "fasting Padma @Breakfast,Lunch", "avoid @Ishaan's tiffin", "other @Breakfast,Lunch,Dinner"]);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]).toContain("no onion garlic on Tuesdays");
    const book = k.rows("dish_book").map((d) => [d.name, JSON.parse(d.slots), d.eaten_by ? JSON.parse(d.eaten_by) : null]);
    expect(book).toContainEqual(["Sandwich", ["Ishaan's tiffin"], ["Ishaan"]]);
    expect(book).toContainEqual(["Ragi mudde", ["Lunch"], ["Padma"]]);
    expect(fam.shopping.main).toBe("zomato-blinkit");
    expect(fam.shopping.fallback).toBe("bigbasket");
    expect(k.rows("items").find((i) => i.subscription === "Akshayakalpa")).toBeTruthy();
    expect(r.said).toContain("Rani cooks Mon–Fri");
    expect(r.said).toContain("at 08:15");
    expect(r.said).toContain("Padma: eats no sweet things");
    expect(r.said).toContain("On Saturday Nisha cooks. On Sunday the family cooks.");
    expect(r.said).toContain("Sunday lunch you eat out.");
    expect(r.said).not.toContain("Nisha cooks at");   // who cooks is said once, not again as a food rule
  });

  // Owner, 23 Nov: unnamed is everyone. A meal said without names is everyone's, whatever answer it came in.
  it("an extra meal said without names is everyone's, even when the model gave it to the adults, and said so", async () => {
    const transcript = TRANSCRIPT.map((l) => l.replace("The adults have chai and a snack at 5 every day.", "We have chai and a snack at 5 every day."));
    const f = fake({ ...PROFILE, slots: [PROFILE.slots[0], { name: "Evening snack", days: [], for: ["adults"], quote: "a snack at 5" }] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript });
    const h = (await k.owner("GET", "/api/family")).body.house;
    expect(h.extra_slots[1]).toEqual({ name: "Evening snack" });
    expect(r.said).toContain("Evening snack every day for everyone");
    expect(r.noted.join()).toContain("no names said with it, so it is for everyone");
    expect(f.sys("home")).toContain("a meal said without names is everyone's");
  });

  // Owner, 23 Nov: every day is planned. A day the cook does not come is cooked by the family, every meal of it; only a meal
  // the family says is eaten out or ordered in is not.
  it("a day the family cooks only some meals of is still cooked whole: only the meal said to be eaten out is not", async () => {
    const f = fake({ ...PROFILE, homeCook: [{ day: "Sun", slots: ["Breakfast", "Dinner"], by: "Nisha", note: "quick" }], orderIn: [] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    const h = (await k.owner("GET", "/api/family")).body.house;
    expect(h.order_in).toEqual([]);
    expect(r.said).toContain("On Saturday the family cooks. On Sunday Nisha cooks.");
    expect(f.sys("home")).toContain("Every day of the week is planned");
    expect(f.sys("home")).not.toContain("cookingDays");
  });

  it("a rule the app cannot take is kept as a note and said; the rules after it are still saved", async () => {
    const f = fake({ ...PROFILE, rules: [{ kind: "swap", items: ["@white_rice"], to: "millets", quote: "pure veg at home" }, PROFILE.rules[0]] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const rules = (await k.owner("GET", "/api/family")).body.house.rules;
    expect(rules.map((x: any) => x.kind)).toEqual(["other", "veg", "other"]);
    expect(r.noted.join("\n")).toContain("kept as a note");
    expect(r.said).toContain("Noted, not checked by the planner");
  });

  it("a person's rule quoted from the app's read-back is kept when a line of theirs naming the person says it; a drink is no dish", async () => {
    const f = fake({ ...PROFILE, rules: [{ kind: "avoid", who: "Padma", items: ["@sweet"], quote: "Padma eats no sugar, jaggery" }, { kind: "avoid", who: "Padma", items: ["salt"], quote: "Padma eats no salt" }],
      dishes: [{ name: "Milk", slots: ["Breakfast"], for: [] }, { name: "Poha", slots: ["Breakfast"], for: [] }] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.rules.map((x: any) => x.quote)).toContain("no sugar");
    expect(r.dropped.join()).toContain("Padma eats no salt");
    expect(k.rows("dish_book").map((d) => d.name)).toEqual(["Poha"]);
  });

  it("a meal the family never named is no slot", async () => {
    const f = fake({ ...PROFILE, slots: [...PROFILE.slots, { name: "Afternoon tea", days: [], for: [], quote: "tea at 4" }] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect((await k.owner("GET", "/api/family")).body.house.extra_slots.map((x: any) => x.name)).toEqual(["Ishaan's tiffin", "Evening snack"]);
    expect(r.dropped.join()).toContain("Afternoon tea");
  });

  it("a person the family page does not have: the rule holds for the house and is said; a group word is each of its people", async () => {
    const f = fake({ ...PROFILE, rules: [{ kind: "no_eggs", who: "Grandpa Joe", quote: "pure veg at home" }, { kind: "avoid", who: "adults", items: ["@sweet"], quote: "Padma has no sugar" }] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    const rules = (await k.owner("GET", "/api/family")).body.house.rules;
    expect(rules.filter((x: any) => x.kind !== "other").map((x: any) => [x.kind, x.who ?? null])).toEqual([["no_eggs", null], ["avoid", "Kiran"], ["avoid", "Nisha"]]);
    expect(r.noted.join("\n")).toContain("Grandpa Joe is not on the Family page");
  });

  // Live run 2026-11-23: the dishes named in the adults' answer were saved as the adults' (rice, sambar, curd for two people),
  // and a dish read in two answers kept only the last one's eaters ("Chapati" the child's only). A question's group only
  // splits the asking; the same dish read twice is one dish.
  it("a dish is someone's only when the family's sentence that names it names them: the question's group is not who eats it", async () => {
    const transcript = [...TRANSCRIPT,
      "Q: What did the children have for breakfast over the past week?",
      "A: Upma twice, dosa, and Padma had ragi dosa.",
      "Q: The adults' dinner over the past week?",
      "A: Same as Ishaan most days - phulka with dal. Curd rice when he's tired.",
    ];
    const f = fake(PROFILE, { dishes: { dishes: [["Upma", "Breakfast", "Ishaan"], ["Dosa", "Breakfast", "Ishaan"], ["Ragi dosa", "Breakfast", "Padma"],
      ["Phulka", "Dinner", "Kiran, Nisha"], ["Dal", "Dinner", "Ishaan"], ["Curd rice", "Dinner", "Ishaan"], ["Sandwich", "Tiffin", "Ishaan"]] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript });
    expect(r.ok).toBe(true);
    const book = k.rows("dish_book").filter((d) => d.slots).map((d) => [d.name, d.eaten_by ? JSON.parse(d.eaten_by) : null]);
    expect(book).toContainEqual(["Upma", null]);
    expect(book).toContainEqual(["Dosa", null]);
    expect(book).toContainEqual(["Ragi dosa", ["Padma"]]);
    expect(book).toContainEqual(["Phulka", null]);
    expect(book).toContainEqual(["Dal", null]);   // "Same as Ishaan" is its own sentence
    expect(book).toContainEqual(["Curd rice", ["Ishaan"]]);   // "when he's tired"
    expect(book).toContainEqual(["Sandwich", ["Ishaan"]]);   // a tiffin dish keeps its child
  });

  // Owner, 23 Nov: the week is planned in the family's own shape of a meal. The home reader copies each meal's description
  // from the family's replies; code keeps only the family's words and saves them on the house.
  it("what each meal looks like is saved in the family's words, per group when told apart; words they never said are dropped", async () => {
    const transcript = [...TRANSCRIPT,
      "Q: The adults' lunch over the past week?",
      "A: Roti, a dal, one vegetable, salad. Pulao on Sunday.",
      "Q: The children's lunch over the past week?",
      "A: Khichdi most days.",
    ];
    const f = fake({ ...PROFILE, meals: [{ slot: "Lunch", group: "adults", words: "Roti, a dal, one vegetable, salad. Pulao on Sunday." },
      { slot: "lunch", group: "children", words: "Khichdi most days." }, { slot: "Dinner", words: "a hearty three-course dinner with dessert" },
      { slot: "Tiffin", group: null, words: "nut-free" }] });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript });
    expect(r.ok).toBe(true);
    expect(f.sys("home")).toContain("meals: what each meal looks like in this home");
    const h = (await k.owner("GET", "/api/family")).body.house;
    expect(h.meal_examples).toEqual([{ slot: "Lunch", group: "adults", words: "Roti, a dal, one vegetable, salad. Pulao on Sunday." },
      { slot: "Lunch", group: "children", words: "Khichdi most days." }, { slot: "Ishaan's tiffin", words: "nut-free" }]);
    expect(r.dropped.join("\n")).toContain("a hearty three-course dinner");
    // Nothing of it in the read-back.
    expect(r.said).not.toContain("Khichdi");
  });

  it("the same dish read in several rows is one dish: its meals and eaters joined, everyone's when any row is", async () => {
    const f = fake(PROFILE, { dishes: { dishes: [["Rice", "Lunch", "Kiran, Nisha"], ["Rice", "Lunch", "Ishaan"], ["Chapati", "Dinner", "Ishaan"], ["chapati", "Dinner", ""],
      ["Dal", "Lunch", "Kiran"], ["Dal", "Dinner", "Padma"], ["Curd", "Lunch", "Kiran, Nisha, Ishaan, Padma"], ["Sandwich", "Tiffin", "Ishaan"]] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const book = k.rows("dish_book").filter((d) => d.slots).map((d) => [d.name, JSON.parse(d.slots), d.eaten_by ? JSON.parse(d.eaten_by) : null]);
    expect(book).toContainEqual(["Rice", ["Lunch"], ["Kiran", "Nisha", "Ishaan"]]);
    expect(book).toContainEqual(["Chapati", ["Dinner"], null]);
    expect(book).toContainEqual(["Dal", ["Lunch", "Dinner"], ["Kiran", "Padma"]]);
    expect(book).toContainEqual(["Curd", ["Lunch"], null]);   // the whole family named: everyone
    expect(book).toContainEqual(["Sandwich", ["Ishaan's tiffin"], ["Ishaan"]]);   // a tiffin dish keeps its child
    expect(book.filter((d) => /chapati/i.test(d[0] as string))).toHaveLength(1);
  });

  it("mergeDishes: union of meals; eaters joined, or everyone", () => {
    const fam = ["A", "B", "C"];
    expect(mergeDishes([{ name: "Idli", slots: ["Breakfast"], who: ["A"] }, { name: " idli ", slots: ["Dinner"], who: null }], fam))
      .toEqual([{ name: "Idli", slots: ["Breakfast", "Dinner"], who: null }]);
    expect(mergeDishes([{ name: "Oats", slots: ["Breakfast"], who: ["C"] }, { name: "Oats", slots: ["Breakfast"], who: ["C"] }], fam))
      .toEqual([{ name: "Oats", slots: ["Breakfast"], who: ["C"] }]);
    expect(mergeDishes([{ name: "Rice", slots: ["Lunch"], who: ["A", "B"] }, { name: "Rice", slots: ["Lunch"], who: ["C"] }], fam))
      .toEqual([{ name: "Rice", slots: ["Lunch"], who: null }]);
  });

  it("the dishes reader is told a question's group is not who eats the dish, and a meal told as its parts is a dish each", () => {
    const sys = SETUP_PARTS.find((p) => p.id === "dishes")!.system;
    expect(sys).toContain("only splits the asking");
    expect(sys).toContain("\"Same as us\" / \"same as the adults\" means the same dishes for everyone");
    expect(sys).toContain("is each part a dish of that meal");
  });

  it("dishes come back as short rows [name, meals, who]", async () => {
    const f = fake(PROFILE, { dishes: { dishes: [["Poha", "Breakfast", ""], ["Sandwich", "Tiffin", "Ishaan"], ["Ragi mudde", "Lunch, Dinner", "Padma"], ["Chai", "Evening snack", ""]] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const book = k.rows("dish_book").map((d) => [d.name, JSON.parse(d.slots), d.eaten_by ? JSON.parse(d.eaten_by) : null]);
    expect(book).toContainEqual(["Poha", ["Breakfast"], null]);
    expect(book).toContainEqual(["Sandwich", ["Ishaan's tiffin"], ["Ishaan"]]);
    expect(book).toContainEqual(["Ragi mudde", ["Lunch", "Dinner"], ["Padma"]]);
  });

  it("the dishes reader fails: the rest is saved and the missing dishes are said", async () => {
    const f = fake(PROFILE, { dishes: { ok: false, code: "invalid_output", message: "no JSON in the output" } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    // Tried once more on its own; the other readers were asked once.
    expect(f.asked.map(partOf).sort()).toEqual(["dishes", "dishes", "home", "rules"]);
    expect(k.rows("dish_book")).toHaveLength(0);
    expect((await k.owner("GET", "/api/family")).body.house.cook_name).toBe("Rani");
    expect(r.noted.join()).toContain("dishes could not be read");
  });

  it("a reader that did not fit is asked once more on its own, and its second answer is used", async () => {
    const f = fake(PROFILE, { rules: (n: number) => (n === 1 ? { ok: false, code: "invalid_output", message: "no JSON" } : { rules: PROFILE.rules, unplaced: [] }) });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(f.asked.filter((x) => partOf(x) === "rules")).toHaveLength(2);
    expect(f.asked.filter((x) => partOf(x) === "home")).toHaveLength(1);
    expect((await k.owner("GET", "/api/family")).body.house.rules.some((x: any) => x.kind === "veg")).toBe(true);
  });

  for (const part of ["home", "rules"] as const) {
    it(`the ${part} reader fails twice: nothing saved, a plain line to say`, async () => {
      const f = fake(PROFILE, { [part]: { ok: false, code: "unavailable", message: "down" } });
      const k = await boot({ model: f.model });
      const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("unavailable");
      expect(f.asked.filter((x) => partOf(x) === part)).toHaveLength(2);
      expect(k.rows("people")).toHaveLength(0);
    });
  }

  it("a reader that does not answer within the setup's time is a timeout, not a wait without end", async () => {
    const never = () => new Promise<ModelResult>(() => {});
    const k1 = await boot({ model: fake(PROFILE, { dishes: never }).model, setupBudgetMs: 200 });
    const r1 = await k1.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r1.ok).toBe(true);
    expect(r1.noted.join()).toContain("dishes could not be read");
    const f = fake(PROFILE, { home: never });
    const k2 = await boot({ model: f.model, setupBudgetMs: 200 });
    const r2 = await k2.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("timeout");
    // No second try with no time left.
    expect(f.asked.filter((x) => partOf(x) === "home")).toHaveLength(1);
  });

  it("the model fails: nothing saved, a plain line to say", async () => {
    const k = await boot({ model: fake({ ok: false, code: "timeout", message: "late" }).model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(false);
    expect(r.say).toContain("nothing you told me is lost");
    expect(k.rows("people")).toHaveLength(0);
  });

  it("a wrong field and a missing transcript are refused before the model is asked", async () => {
    const f = fake(PROFILE);
    const k = await boot({ model: f.model });
    expect((await k.op("apply_setup", { facts: HOUSEHOLD, transcript: TRANSCRIPT })).code).toBe("APP_REFUSED");
    expect((await k.op("apply_setup", { household: HOUSEHOLD, transcript: [] })).status).toBe(400);
    expect(f.asked).toHaveLength(0);
  });
});

describe("apply_setup's readers", () => {
  it("the cook's visits made sensible: no dinner in the morning, a lost time from the facts, the time said last wins", () => {
    const facts = cookTimesOf({ "household.help": [{ role: "cook", name: "Rani", times: ["7am", "6pm"], meals: ["Breakfast", "Lunch", "Dinner"] }] }, "Rani");
    expect(facts).toEqual([{ at: "07:00", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }]);
    // The correction read as a second morning visit making dinner (sim run 051203): 7:30 makes breakfast and lunch, 6 pm dinner.
    expect(cookVisits([{ at: "07:00", meals: ["Breakfast", "Lunch"] }, { at: "07:30", meals: ["Dinner"] }], facts, ["A: yes, that's it", "A: actually Rani comes at 7:30"]))
      .toEqual([{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }]);
    // The bare "7:30" read as 19:30 for dinner (sim run 051203 again).
    expect(cookVisits([{ at: "07:00", meals: ["Breakfast", "Lunch"] }, { at: "19:30", meals: ["Dinner"] }], facts, ["A: actually Rani comes at 7:30"]))
      .toEqual([{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }]);
    // Every meal on both visits (sim run 084607).
    expect(cookVisits([{ at: "07:30", meals: ["Breakfast", "Lunch", "Dinner"] }, { at: "18:00", meals: ["Breakfast", "Lunch", "Dinner"] }], facts, []))
      .toEqual([{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }]);
  });

  it("days however written", () => {
    expect(daysOf(["Mon-Sat"])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(daysOf("every day")).toHaveLength(7);
    expect(daysOf(["Monday", "thursday", "Fri"])).toEqual(["Mon", "Thu", "Fri"]);
    expect(daysOf(["weekdays"])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
  it("times however written", () => {
    expect(clockOf("7am")).toBe("07:00");
    expect(clockOf("7:30")).toBe("07:30");
    expect(clockOf("6pm")).toBe("18:00");
    expect(clockOf("6.30 pm")).toBe("18:30");
    expect(clockOf("evening")).toBeNull();
  });
  it("a quote is the family's when it is in one of their replies, any capitals and punctuation; a question's words are not", () => {
    const lines = familyLines(TRANSCRIPT, HOUSEHOLD);
    expect(saidByFamily("Pure veg at home.", lines)).toBe(true);
    expect(saidByFamily("tiffin must be nut free", lines)).toBe(true);
    expect(saidByFamily("no onion garlic on Tuesdays", lines)).toBe(false);
    expect(saidByFamily("no", lines)).toBe(false);
    expect(plainWords("Nut-free!")).toBe("nut free");
  });
});

// Owner, 23 Nov: the family's frequency words are kept ("when he's tired", "twice", "weekend parathas", "X is good for him"),
// each only when a line the family said carries them; otherwise the default holds (a dish: two days a week; a rule: always).
describe("apply_setup: how often, in the family's words", () => {
  const LINES = [
    "Q: What does Ishaan eat for dinner?",
    "A: same as us, chapati with dal most nights. Khichdi when he's unwell.",
    "Q: And lunch?",
    "A: rice, sambar, a dry sabzi. Pulao twice last week, puri on Sunday. Weekend parathas for breakfast.",
    "Q: Any food rules?",
    "A: Padma is diabetic: no sugar, less rice, brown rice is good for her. Ishaan has fruit three times a week. Pure veg at home.",
  ];
  const READ = { people: [{ name: "Kiran", group: "adult" }, { name: "Nisha", group: "adult" }, { name: "Ishaan", group: "child", age: 7 }, { name: "Padma", group: "elder" }],
    rules: [
      { kind: "veg", quote: "Pure veg at home", often: "sometimes" },                                         // hard: no often
      { kind: "avoid", who: "Padma", items: ["@sweet"], quote: "no sugar", often: "usually" },                 // hard: no often
      { kind: "other", who: "Padma", note: "less rice", quote: "less rice" },
      { kind: "swap", who: "Padma", items: ["@white_rice"], to: "brown rice", often: "sometimes", quote: "brown rice is good for her" },
      { kind: "require", who: "Ishaan", items: ["fruit"], per_week: 3, quote: "Ishaan has fruit three times a week" },
    ],
    dishes: [["Chapati", "Dinner", "", "usually"], ["Dal", "Dinner", "", "usually"], ["Khichdi", "Dinner", "Ishaan", "sometimes"],
      ["Rice", "Lunch", "", ""], ["Sambar", "Lunch", "", "rarely"], ["Pulao", "Lunch", "", "2"], ["Puri", "Lunch", "", "Sun"],
      ["Paratha", "Breakfast", "", "Sat, Sun"], ["Dry sabzi", "Lunch", "", "3, Fri"]] };

  it("a dish keeps often, per_week and days only when its line says them; the rest is dropped and said", async () => {
    const k = await boot({ model: fake(READ).model });
    const r = await k.op("apply_setup", { household: {}, transcript: LINES });
    expect(r.ok).toBe(true);
    const book = Object.fromEntries(k.rows("dish_book").filter((d) => d.slots).map((d) => [d.name, [d.often, d.per_week, d.days ? JSON.parse(d.days) : null]]));
    expect(book["Chapati"]).toEqual(["usually", null, null]);                     // "most nights"
    expect(book["Khichdi"]).toEqual(["sometimes", null, null]);                   // "when he's unwell"
    expect(book["Pulao"]).toEqual([null, 2, null]);                               // "twice"
    expect(book["Puri"]).toEqual([null, null, ["Sun"]]);                          // "on Sunday"
    expect(book["Paratha"]).toEqual([null, null, ["Sat", "Sun"]]);                // "weekend parathas"
    expect(book["Rice"]).toEqual([null, null, null]);                             // nothing said
    // "rarely" is nowhere in the line that names sambar; "3" and "Fri" not in the dry sabzi's line: dropped, said.
    expect(book["Sambar"]).toEqual([null, null, null]);
    expect(book["Dry sabzi"]).toEqual([null, null, null]);
    expect(r.dropped.filter((d: string) => d.startsWith("how often")).sort()).toEqual(["how often for Dry sabzi (3; Fri): not in the family's words",
      "how often for Sambar (rarely): not in the family's words"]);
    // The week's context gives the menu how often.
    const ctx = (await k.op("plan_week", { week_start: "2026-11-30", mode: "draft" })).context;
    expect(ctx.family_dishes.Dinner.find((d: any) => d.dish === "Khichdi")).toEqual({ dish: "Khichdi", for: ["Ishaan"], often: "sometimes" });
  });

  it("a soft wish is kept some times a week (often, per_week); a hard rule never; 'less rice' is a note, not a swap", async () => {
    const k = await boot({ model: fake(READ).model });
    const r = await k.op("apply_setup", { household: {}, transcript: LINES });
    const rules = (await k.owner("GET", "/api/family")).body.house.rules;
    expect(rules.find((x: any) => x.kind === "veg").often).toBeUndefined();
    expect(rules.find((x: any) => x.kind === "avoid").often).toBeUndefined();
    expect(rules.find((x: any) => x.kind === "swap")).toMatchObject({ who: "Padma", items: ["@white_rice"], to: "brown rice", often: "sometimes" });
    expect(rules.find((x: any) => x.kind === "require")).toMatchObject({ who: "Ishaan", items: ["fruit"], per_week: 3 });
    expect(rules.find((x: any) => x.kind === "other")).toMatchObject({ who: "Padma", note: "less rice" });
    // The read-back says how often.
    expect(r.said).toContain("has brown rice in place of white rice 2–3 times a week");
    expect(r.said).toContain("has fruit 3 times a week");
  });

  it("a frequency the family's words do not carry is dropped: the rule holds every time", async () => {
    const read = { ...READ, rules: [{ kind: "swap", who: "Kiran", items: ["@white_rice"], to: "jowar roti", often: "sometimes", quote: "Kiran has jowar roti in place of rice" },
      { kind: "require", who: "Ishaan", items: ["fruit"], per_week: 5, quote: "Ishaan has fruit three times a week" }] };
    const k = await boot({ model: fake(read).model });
    const r = await k.op("apply_setup", { household: {}, transcript: [...LINES, "A: Kiran has jowar roti in place of rice."] });
    const rules = (await k.owner("GET", "/api/family")).body.house.rules;
    expect(rules.find((x: any) => x.kind === "swap").often).toBeUndefined();
    // A require with no count and no meals cannot be checked: kept as the family's words, a note.
    expect(rules.find((x: any) => x.kind === "require")).toBeUndefined();
    expect(rules.find((x: any) => x.kind === "other" && x.who === "Ishaan").note).toBe("Ishaan has fruit three times a week");
    expect(r.dropped.filter((d: string) => d.startsWith(`how often for "`))).toEqual([
      `how often for "Kiran has jowar roti in place of rice" (sometimes): not in the family's words, kept every time`,
      `how often for "Ishaan has fruit three times a week" (5 a week): not in the family's words, kept every time`]);
  });

  it("the readers are taught how often with the example family, never the test family", () => {
    const rules = SETUP_PARTS.find((p) => p.id === "rules")!, dishes = SETUP_PARTS.find((p) => p.id === "dishes")!;
    expect(rules.system).toContain("often");
    expect(rules.system).toContain(`"Less rice" is other`);
    expect((rules.schema as any).properties.rules.items.properties.often.enum).toEqual(["usually", "sometimes", "rarely", null]);
    expect(dishes.system).toContain("[name, meals, who, how_often]");
    expect(dishes.system).toContain(`["Khichdi", "Dinner", "Tara", "sometimes"]`);
  });

  it("frequency words read in code", () => {
    expect(dishOftenSaid("sometimes", ["curd rice when hes tired"])).toEqual({ often: "sometimes" });
    expect(dishOftenSaid("usually", ["chapati with a sabzi and dal most nights"])).toEqual({ often: "usually" });
    expect(dishOftenSaid("rarely", ["pasta once in a while"])).toEqual({ often: "rarely" });
    expect(dishOftenSaid("2", ["rajma twice last week"])).toEqual({ per_week: 2 });
    expect(dishOftenSaid("1", ["palak dal bhindi chole once"])).toEqual({ per_week: 1 });
    expect(dishOftenSaid("Fri", ["lemon rice on friday"])).toEqual({ days: ["Fri"] });
    expect(dishOftenSaid("Sat, Sun", ["weekend parathas"])).toEqual({ days: ["Sat", "Sun"] });
    expect(dishOftenSaid("usually", ["idli dosa poha"])).toEqual({ dropped: "usually" });
    expect(ruleOftenSaid({ often: "sometimes", quote: "millets are good for him" }, [])).toEqual({ often: "sometimes" });
    expect(ruleOftenSaid({ often: "sometimes", quote: "no sugar" }, ["father is diabetic no sugar"])).toEqual({ dropped: "sometimes" });
    // A wish read as "usually" is still a wish (eval 23 Nov).
    expect(ruleOftenSaid({ often: "usually", quote: "millets are good for him" }, [])).toEqual({ often: "sometimes" });
    expect(ruleOftenSaid({ per_week: 2, quote: "sweets twice a week" }, [])).toEqual({ per_week: 2 });
  });
});
