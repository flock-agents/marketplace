// apply_setup (setup.ts) with a fake model: the profile the model reads is checked and written by code, one thing at a time,
// in a fixed order; a rule the family never said is dropped; one the app cannot take is kept as a note; nothing sinks the rest.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { clockOf, cookVisits, cookTimesOf, daysOf, saidByFamily, familyLines, plainWords } from "./setup";
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
