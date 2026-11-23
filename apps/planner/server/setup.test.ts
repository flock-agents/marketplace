// apply_setup (setup.ts) with a fake model: the profile the model reads is checked and written by code, one thing at a time,
// in a fixed order; a rule the family never said is dropped; one the app cannot take is kept as a note; nothing sinks the rest.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { clockOf, cookVisits, cookTimesOf, daysNextTo, daysOf, dishOftenSaid, mergeDishes, oftenNextTo, rangesSpelled, ruleOftenSaid, rulesFixed, saidByFamily, familyLines, plainWords, SETUP_PARTS, SETUP_SYSTEM } from "./setup";
import { HOUSEHOLDS } from "../evals/households";
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
    // Padma's "no sugar", which this reader left out, is added from the family's words.
    expect(rules.map((x: any) => x.kind)).toEqual(["other", "veg", "avoid", "other"]);
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
    expect(rules.filter((x: any) => x.kind !== "other").map((x: any) => [x.kind, x.who ?? null])).toEqual([["no_eggs", null], ["avoid", "Kiran"], ["avoid", "Nisha"], ["avoid", "Padma"]]);
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
    const f = fake(PROFILE, { dishes: { dishes: [["Pulao", "Lunch", "Kiran, Nisha"], ["Pulao", "Lunch", "Ishaan"], ["Chapati", "Dinner", "Ishaan"], ["chapati", "Dinner", ""],
      ["Dal", "Lunch", "Kiran"], ["Dal", "Dinner", "Padma"], ["Curd", "Lunch", "Kiran, Nisha, Ishaan, Padma"], ["Sandwich", "Tiffin", "Ishaan"]] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const book = k.rows("dish_book").filter((d) => d.slots).map((d) => [d.name, JSON.parse(d.slots), d.eaten_by ? JSON.parse(d.eaten_by) : null]);
    expect(book).toContainEqual(["Pulao", ["Lunch"], ["Kiran", "Nisha", "Ishaan"]]);
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
    // Tried once more on its own, by halves of the meals; the other readers were asked once.
    expect(f.asked.map(partOf).sort()).toEqual(["dishes", "dishes", "dishes", "home", "rules"]);
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
  it("the cook's visits made sensible: a corrected time keeps its visit's meals, a lost time from the facts, the time said last wins", () => {
    // Several times with one list of meals: which visit makes which is not said (times never decide it).
    expect(cookTimesOf({ "household.help": [{ role: "cook", name: "Rani", times: ["7am", "6pm"], meals: ["Breakfast", "Lunch", "Dinner"] }] }, "Rani"))
      .toEqual([{ at: "07:00" }, { at: "18:00" }]);
    const facts = cookTimesOf({ "household.help": [{ role: "cook", name: "Rani", times: "7am", meals: ["Breakfast", "Lunch"] }, { role: "cook", name: "Rani", times: "6pm", meals: ["Dinner"] }] }, "Rani");
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
    // One late-morning visit that makes lunch and dinner keeps both (eval 23 Nov: "no dinner before noon" lost dinner).
    const once = cookTimesOf({ "household.help": [{ role: "cook", name: "Rekha", times: "10am", meals: ["Lunch", "Dinner"] }] }, "Rekha");
    expect(cookVisits([{ at: "11:00", meals: ["Lunch", "Dinner"] }], once, ["A: she comes at 11 now not 10"])).toEqual([{ at: "11:00", meals: ["Lunch", "Dinner"] }]);
    expect(cookVisits([{ at: "11:00", meals: ["Lunch"] }], once, ["A: she comes at 11 now not 10"])).toEqual([{ at: "11:00", meals: ["Lunch", "Dinner"] }]);
    // A dinner visit at 5 am is saved as said: the time is for reminders, not for which meals.
    expect(cookVisits([{ at: "05:00", meals: ["Breakfast", "Lunch", "Dinner"] }], [], [])).toEqual([{ at: "05:00", meals: ["Breakfast", "Lunch", "Dinner"] }]);
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

// Eval 1 (23 Nov, results/cf9a391-setup): what the readers got wrong, put right in code and in their prompts.
describe("apply_setup: eval 1's weak fields", () => {
  const FAM = {
    "household.people": [{ name: "Vivek", relation: "self", age: 44, group: "adult" }, { name: "Meera", relation: "wife", age: 41, group: "adult" },
      { name: "Kabir", relation: "son", age: 9, group: "child" }, { name: "Savitri", relation: "mother", age: 71, group: "elder" },
      { name: "Mohan", relation: "father", age: 75, group: "elder" }],
    "household.speaker": "Vivek",
  };
  const PEOPLE = [{ name: "Vivek", group: "adult" }, { name: "Meera", group: "adult", relationship: "wife" }, { name: "Kabir", group: "child", age: 9 },
    { name: "Savitri", group: "elder", relationship: "mother" }, { name: "Mohan", group: "elder", relationship: "father" }];
  const read = (over: Record<string, unknown>) => ({ people: PEOPLE, rules: [], dishes: [], ...over });
  const run = async (answer: unknown, transcript: string[], over: Record<string, unknown> = {}) => {
    const f = fake(answer, over as any);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAM, transcript });
    const book = Object.fromEntries(k.rows("dish_book").filter((d) => d.slots).map((d) => [d.name, { for: d.eaten_by ? JSON.parse(d.eaten_by) : null,
      often: d.often ?? null, per_week: d.per_week ?? null, days: d.days ? JSON.parse(d.days) : null }]));
    const rules = (await k.owner("GET", "/api/family")).body.house.rules as any[];
    return { r, book, rules, f };
  };

  it("a family word is the person of that relationship: one person's dish stays theirs (Amma, Papa, Nani)", async () => {
    const lines = [
      "Q: What did the adults have for breakfast over the past week?",
      "A: Amma had ragi dosa twice, ragi java thrice, and idli on the other days. I had idli or poha.",
      "A: dalia for Papa, he can't chew much",
      "Q: The adults' dinner over the past week?",
      "A: chapati with a sabzi, and one night bajra roti for Amma.",
      "Q: What did the children have for breakfast?",
      "A: Kabir had poha and cornflakes.",
    ];
    // The reader gave who as the family word, or no one at all: both are the person by relationship.
    const { book } = await run(read({ dishes: [["Ragi dosa", "Breakfast", "Amma", "2"], ["Ragi java", "Breakfast", "", "3"], ["Idli", "Breakfast", "", ""],
      ["Dalia", "Breakfast", "", ""], ["Bajra roti", "Dinner", "", ""], ["Chapati", "Dinner", "", ""], ["Poha", "Breakfast", "", ""], ["Cornflakes", "Breakfast", "", ""]] }), lines);
    expect(book["Ragi dosa"].for).toEqual(["Savitri"]);
    expect(book["Ragi java"].for).toEqual(["Savitri"]);       // "Amma had ..., ragi java thrice": the same sentence
    expect(book["Dalia"].for).toEqual(["Mohan"]);             // "dalia for Papa"
    expect(book["Bajra roti"].for).toEqual(["Savitri"]);      // "bajra roti for Amma"
    expect(book["Idli"].for).toBeNull();                      // also "I had idli": not one person's
    expect(book["Chapati"].for).toBeNull();
    expect(book["Cornflakes"].for).toBeNull();                // the answer about the children names the child: the question's group only
  });

  it("personByKin: by relationship, nearest first; a grandparent word is the one elder; never a guess between two", async () => {
    const { personByKin } = await import("./setup");
    const fam = [{ name: "Savitri", group: "elder", relationship: "mother" }, { name: "Usha", group: "elder", relationship: "mother-in-law" }, { name: "Vivek", group: "adult", relationship: "self" }];
    expect(personByKin("Amma", fam)).toBe("Savitri");
    expect(personByKin("my mother", fam)).toBe("Savitri");
    expect(personByKin("Mummy's", fam)).toBe("Savitri");
    expect(personByKin("Nani", fam)).toBe("Savitri");
    expect(personByKin("Papa", fam)).toBeNull();
    expect(personByKin("Thatha", [{ name: "Mohan", group: "elder" }, { name: "Kabir", group: "child" }])).toBe("Mohan");
    expect(personByKin("Nani", [{ name: "Mohan", group: "elder" }, { name: "Savitri", group: "elder" }])).toBeNull();
    expect(personByKin("lunch", fam)).toBeNull();
  });

  it("a he or she is the person named last before it, the question included", async () => {
    const lines = [
      "Q: What did Kabir have for dinner?",
      "A: same as us, chapati and dal. Curd rice when he's tired.",
      "Q: The adults' lunch?",
      "A: rice, sambar, a poriyal. Upma when he's late, says Vivek.",
    ];
    const { book } = await run(read({ dishes: [["Curd rice", "Dinner", "Kabir", "sometimes"], ["Upma", "Lunch", "Mohan", ""]] }), lines);
    expect(book["Curd rice"].for).toEqual(["Kabir"]);
    expect(book["Upma"].for).toBeNull();                      // nobody named before that "he" is Mohan
  });

  it("a dish's days: weekends are Saturday and Sunday, 'on Fridays', ranges, the head word, two answers joined; a diary is no rule", () => {
    expect(rangesSpelled("tiffin Mon-Fri, dosa Sat–Sun")).toBe("tiffin Mon to Fri, dosa Sat to Sun");
    expect(daysNextTo("lemon rice", null, ["veg sandwich lemon rice on friday"])).toEqual(["Fri"]);
    expect(daysNextTo("aloo paratha", "paratha", ["weekend parathas"])).toEqual(["Sat", "Sun"]);
    expect(daysNextTo("thalipeeth", null, ["thalipeeth on weekends"])).toEqual(["Sat", "Sun"]);
    expect(daysNextTo("maggi", null, ["maggi on fridays as a treat"])).toEqual(["Fri"]);
    expect(daysNextTo("chicken curry", null, ["paneer sometimes chicken curry on saturday and sunday"])).toEqual(["Sat", "Sun"]);
    expect(daysNextTo("khichdi", null, ["khichdi on saturday night"])).toEqual(["Sat"]);
    expect(daysNextTo("idli", null, ["idli monday to wednesday"])).toEqual(["Mon", "Tue", "Wed"]);
    expect(daysNextTo("fish fry", null, ["weekend fish fry saturday and chicken rassa sunday"])).toEqual(["Sat"]);
    // Last week, day by day: not the dish's days.
    expect(daysNextTo("poha", null, ["poha on monday upma tuesday sheera wednesday poha friday"])).toEqual([]);
    expect(daysNextTo("poha", null, ["poha upma and dosa"])).toEqual([]);
  });

  it("how often from the words next to a dish", () => {
    const A = (s: string) => [`A: ${s}`];
    expect(oftenNextTo("uthappam", A("dosa or chapati with kurma, sometimes uthappam, or rasam rice if it's late"))).toBe("sometimes");
    expect(oftenNextTo("rasam rice", A("dosa or chapati with kurma, sometimes uthappam, or rasam rice if it's late"))).toBe("sometimes");
    expect(oftenNextTo("dosa", A("dosa or chapati with kurma, sometimes uthappam"))).toBeUndefined();
    expect(oftenNextTo("cornflakes", A("poha, and cornflakes on busy days last week"))).toBe("sometimes");
    expect(oftenNextTo("chapati", A("Chapati most nights. Dal sometimes."))).toBe("usually");
    expect(oftenNextTo("biryani", A("biryani once in a while"))).toBe("rarely");
    expect(oftenNextTo("dal", A("Lunch is usually dal, chawal, roti"))).toBeUndefined();   // "usually" is the meal's, not the dal's
    expect(oftenNextTo("idli", ["Q: idli sometimes?", "A: no"])).toBeUndefined();          // the app's words are not the family's
  });

  it("a dish's days and how often, saved: what the reader left out read from the words next to it, two answers' days joined", async () => {
    const lines = [
      "Q: What did the children have for breakfast?",
      "A: Kabir had poha, aloo paratha on Saturday, and cornflakes on busy days.",
      "Q: The adults' breakfast?",
      "A: poha, besan chilla. Weekend parathas.",
      "Q: The children's dinner?",
      "A: dal, roti, sabzi, and chicken curry on Saturday.",
      "Q: The adults' dinner?",
      "A: roti, dal and a sabzi. Paneer sometimes, chicken curry on Saturday and Sunday.",
      "Q: Kabir's tiffin?",
      "A: Mon-Fri: sandwich, poha, lemon rice on Friday.",
    ];
    const { book } = await run(read({ dishes: [["Aloo paratha", "Breakfast", "", "Sat"], ["Cornflakes", "Breakfast", "", ""], ["Chicken curry", "Dinner", "", "Sat"],
      ["Chicken curry", "Dinner", "", "Sat, Sun"], ["Lemon rice", "Kabir's tiffin", "", ""], ["Paneer", "Dinner", "", ""], ["Poha", "Breakfast", "", ""]] }), lines);
    expect(book["Aloo paratha"].days).toEqual(["Sat", "Sun"]);
    expect(book["Cornflakes"].often).toBe("sometimes");
    expect(book["Chicken curry"].days).toEqual(["Sat", "Sun"]);
    expect(book["Lemon rice"].days).toEqual(["Fri"]);
    expect(book["Paneer"].often).toBe("sometimes");
    expect(book["Poha"]).toMatchObject({ often: null, days: null });
  });

  it("rulesFixed: 'less X' is a note, never 'never X'; 'no sugar' is always an avoid; eggs fine is no no-eggs rule; red meat is not chicken; a loose wish is sometimes", () => {
    const { rules, fixed } = rulesFixed([
      { kind: "avoid", who: "Mohan", items: ["oil"], quote: "less oil" },
      { kind: "avoid", who: "Kabir", items: ["@chilli"], quote: "Kabir eats the same, less spicy" },
      { kind: "avoid", who: "Mohan", items: ["@white_rice"], slots: ["Dinner"], quote: "less rice, no rice at night" },
      { kind: "other", who: "Savitri", note: "diabetic", quote: "Amma is diabetic, no sugar at all" },
      { kind: "require", who: "Savitri", items: ["ragi"], quote: "no sugar, ragi is good for her" },
      { kind: "no_eggs", quote: "Eggs are fine any day." },
      { kind: "veg", quote: "vegetarian, but eggs are ok" },
      { kind: "avoid", who: "Meera", items: ["@meat"], quote: "Meera doesn't eat red meat" },
      { kind: "other", who: "Mohan", note: "millets", quote: "millets are good for father" },
    ]);
    const r = (i: number) => rules[i];
    expect(r(0)).toEqual({ kind: "other", who: "Mohan", note: "less oil", quote: "less oil" });
    expect(r(1)).toMatchObject({ kind: "other", who: "Kabir", note: "less spicy" });
    expect(r(2)).toMatchObject({ kind: "avoid", items: ["@white_rice"] });                       // "no rice at night" is hard
    expect(r(3)).toMatchObject({ kind: "avoid", who: "Savitri", items: ["@sweet"] });
    expect(rules.filter((x) => x.who === "Savitri" && x.kind === "require")).toHaveLength(1);    // the ragi wish kept,
    expect(rules.filter((x) => x.who === "Savitri" && x.kind === "avoid")).toHaveLength(2);      // and its "no sugar" an avoid too
    expect(rules.find((x) => x.kind === "require")!.often).toBe("sometimes");
    expect(rules.some((x) => x.kind === "no_eggs")).toBe(false);
    expect(rules.find((x) => x.quote.startsWith("vegetarian"))!.kind).toBe("egg");
    expect(rules.find((x) => x.who === "Meera")!.items).toEqual(["mutton", "lamb", "goat", "beef", "pork"]);
    expect(rules.find((x) => x.quote.startsWith("millets"))!.often).toBe("sometimes");
    expect(fixed.length).toBeGreaterThan(5);
  });

  it("non-veg only on some days is no non-veg on the other days, never vegetarian every day; the day's other meals too", () => {
    expect(rulesFixed([{ kind: "veg", quote: "Chicken only on weekends, Saturday and Sunday." }]).rules)
      .toEqual([{ kind: "avoid", items: ["@meat", "@fish"], quote: "Chicken only on weekends, Saturday and Sunday.", days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }]);
    expect(rulesFixed([{ kind: "only", who: "Meera", items: ["chicken"], days: ["Sun"], slots: ["Lunch"], quote: "we eat chicken only at Sunday lunch" }]).rules).toEqual([
      { kind: "avoid", who: "Meera", items: ["@meat", "@fish"], quote: "we eat chicken only at Sunday lunch", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
      { kind: "avoid", who: "Meera", items: ["@meat", "@fish"], quote: "we eat chicken only at Sunday lunch", days: ["Sun"], slots: ["Breakfast", "Dinner"] }]);
    // "Veg only on Tuesdays" is the reader's own: no meat that day, not the other days.
    expect(rulesFixed([{ kind: "veg", days: ["Tue"], quote: "veg only on Tuesdays" }]).rules).toEqual([{ kind: "veg", days: ["Tue"], quote: "veg only on Tuesdays" }]);
    // A fast with "only fruits" is not about meat.
    expect(rulesFixed([{ kind: "fasting", who: "Savitri", days: ["Ekadashi"], quote: "fasts on Ekadashi, only fruits" }]).rules[0].kind).toBe("fasting");
  });

  it("saved: the three who eat chicken only at Sunday lunch, the elders vegetarian, is one rule for the house; a vegetarian elder eats no eggs", async () => {
    const lines = ["Q: Any food rules?", "A: My parents are pure vegetarian. The three of us eat chicken only on Sunday lunch."];
    const q = "The three of us eat chicken only on Sunday lunch.";
    const { rules } = await run(read({ rules: [{ kind: "veg", who: "Savitri", quote: "My parents are pure vegetarian" }, { kind: "veg", who: "Mohan", quote: "My parents are pure vegetarian" },
      ...["Vivek", "Meera", "Kabir"].map((who) => ({ kind: "only", who, items: ["chicken"], days: ["Sun"], slots: ["Lunch"], quote: q }))] }), lines);
    const avoid = rules.filter((x) => x.kind === "avoid");
    expect(avoid.map((x) => [x.who ?? null, x.days, x.slots ?? null])).toEqual([[null, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], null], [null, ["Sun"], ["Breakfast", "Dinner"]]]);
    expect(rules.filter((x) => x.kind === "veg").map((x) => x.who)).toEqual(["Savitri", "Mohan"]);
  });

  it("what the family said and no reader wrote down is added for its person: a diet, 'less spicy', 'no sugar'", async () => {
    const lines = [
      "Q: Is anyone on a diet?",
      "A: Yeah, I'm on high protein for the gym. Meera's not on anything.",
      "A: Father is diabetic — less oil, no sweets at all.",
      "Q: The children's dinner?",
      "A: Kabir's dinner is same as ours, just less spicy.",
      "Q: Any food rules?",
      "A: We eat less salt at home.",
    ];
    const { rules } = await run(read({ rules: [] }), lines);
    const said = rules.map((x) => [x.kind, x.who ?? null, x.kind === "avoid" ? x.items.join() : x.note]);
    expect(said).toContainEqual(["other", "Vivek", "high protein"]);
    expect(said).toContainEqual(["other", "Mohan", "less oil"]);
    expect(said).toContainEqual(["avoid", "Mohan", "@sweet"]);
    expect(said).toContainEqual(["other", "Kabir", "less spicy"]);
    expect(said).toContainEqual(["other", null, "less salt"]);
    // Said once only: a reader's own rule is not doubled.
    const again = await run(read({ rules: [{ kind: "other", who: "Mohan", note: "less oil", quote: "less oil" }] }), lines);
    expect(again.rules.filter((x) => x.who === "Mohan" && /oil/.test(x.note ?? ""))).toHaveLength(1);
  });

  it("a wish the rules reader left unplaced is a soft rule for its person", async () => {
    const lines = ["Q: Is anyone on a diet?", "A: Father is diabetic, millets are good for him."];
    const { rules } = await run(read({ rules: [], unplaced: [{ text: "millets are good for him", quote: "millets are good for him" }] }), lines);
    expect(rules.find((x) => x.kind === "require")).toMatchObject({ who: "Mohan", items: ["millets"], often: "sometimes" });
  });

  it("the dishes read by halves when the whole read fails; a half that fails is said; no dishes at all is never silent", async () => {
    const lines = ["Q: What did the adults have for breakfast?", "A: idli and dosa", "Q: The adults' lunch?", "A: rice and sambar"];
    const halves = async (n: number) => (n === 1 ? { ok: false, code: "timeout", message: "late" } : n === 2 ? { dishes: [["Idli", "Breakfast", "", ""]] } : { dishes: [["Sambar", "Lunch", "", ""]] });
    const k = await boot({ model: fake(read({}), { dishes: halves }).model });
    const r = await k.op("apply_setup", { household: FAM, transcript: lines });
    expect(r.ok).toBe(true);
    expect(k.rows("dish_book").filter((d) => d.slots).map((d) => d.name).sort()).toEqual(["Idli", "Sambar"]);
    expect(r.noted.join()).not.toContain("dishes");
    const half = await run(read({}), lines, { dishes: async (n: number) => (n === 2 ? { dishes: [["Idli", "Breakfast", "", ""]] } : { ok: false, code: "timeout", message: "late" }) });
    expect(half.f.asked.filter((x) => partOf(x) === "dishes").map((x) => x.purpose)).toEqual(["setup: the dishes",
      "setup: the dishes (Breakfast, a child's school tiffin and an evening snack)", "setup: the dishes (Lunch and Dinner)"]);
    expect(half.r.noted.join()).toContain("your dishes of Lunch and Dinner could not be read");
    // An answer with no rows is read again by halves; still none: said.
    const none = await run(read({ dishes: [] }), lines);
    expect(none.f.asked.filter((x) => partOf(x) === "dishes")).toHaveLength(3);
    expect(none.r.noted.join()).toContain("your dishes could not be read");
    // Rows that are no dishes (a drink): said too, never a silent empty dish book.
    const drinks = await run(read({ dishes: [["Milk", "Breakfast", "", ""]] }), lines);
    expect(drinks.r.noted.join()).toContain("no dishes could be read");
    // Rows under another name are still the dishes.
    const renamed = await run(read({}), lines, { dishes: { rows: [["Idli", "Breakfast", "", ""]] } });
    expect(renamed.book["Idli"]).toBeDefined();
  });

  it("a whole dishes read that is slow is not waited for alone: the halves start beside it and their answer is used", async () => {
    const lines = ["Q: What did the adults have for breakfast?", "A: idli and dosa", "Q: The adults' lunch?", "A: rice and sambar"];
    const never = () => new Promise<ModelResult>(() => {});
    const dishes = (n: number) => (n === 1 ? never() : n === 2 ? { dishes: [["Idli", "Breakfast", "", ""]] } : { dishes: [["Sambar", "Lunch", "", ""]] });
    // 31 s of budget: the halves start once only the retry's floor (30 s) is left.
    const k = await boot({ model: fake(read({}), { dishes }).model, setupBudgetMs: 31_000 });
    const t0 = Date.now();
    const r = await k.op("apply_setup", { household: FAM, transcript: lines });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.ok).toBe(true);
    expect(k.rows("dish_book").filter((d) => d.slots).map((d) => d.name).sort()).toEqual(["Idli", "Sambar"]);
  });

  it("a rule that names a food is no word on who eats a dish; a staple is never one person's", async () => {
    const lines = [
      "Q: What did the adults have for breakfast over the past week?",
      "A: I make eggs every morning for myself. Meera has oats.",
      "Q: The adults' dinner?",
      "A: roti and dal. Father has two phulkas, no rice at night.",
      "Q: Any food rules for the house?",
      "A: Chicken, fish, eggs are fine for all of us. Meera doesn't eat red meat.",
    ];
    const { book, rules } = await run(read({ dishes: [["Eggs", "Breakfast", "", ""], ["Phulka", "Dinner", "Mohan", ""], ["Roti", "Dinner", "", ""]],
      rules: [{ kind: "avoid", who: "Meera", items: ["red meat"], quote: "Meera doesn't eat red meat" }] }), lines);
    expect(book["Eggs"]).toMatchObject({ for: ["Vivek"], often: "usually" });
    expect(book["Phulka"].for).toBeNull();
    // The answer about the children, its subject the child: not the child's own dishes; a "for" or "when he's" still is.
    const kids = await run(read({ dishes: [["Pesarattu", "Breakfast", "Kabir", "2"], ["Bread toast", "Breakfast", "Kabir", ""], ["Rice", "Lunch", "Vivek, Meera", ""]] }),
      ["Q: What did the children have for breakfast?", "A: Only one child, Kabir. He had idli most days, pesarattu twice. Bread toast when he was late.", "Q: The adults' lunch?", "A: rice, dal."]);
    expect(kids.book["Pesarattu"].for).toBeNull();
    expect(kids.book["Bread toast"].for).toEqual(["Kabir"]);
    expect(kids.book["Rice"].for).toBeNull();
    expect(rules.find((x) => x.who === "Meera").items).toEqual(["mutton", "lamb", "goat", "beef", "pork"]);
  });

  it("no model-facing text names an eval household's people", () => {
    for (const h of HOUSEHOLDS) for (const name of [...h.truth.people.map((p) => p.name), ...(h.truth.cook ? [h.truth.cook.name] : [])])
      expect(SETUP_SYSTEM, `${h.id} ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  });
});
