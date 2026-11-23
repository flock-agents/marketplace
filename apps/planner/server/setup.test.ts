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
  cookingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
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

function fake(answer: unknown) {
  const asked: ModelRequest[] = [];
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    asked.push(req);
    return answer && typeof answer === "object" && "ok" in (answer as object) ? answer as ModelResult : { ok: true, json: answer, model: "fake" };
  };
  return { model, asked };
}

describe("apply_setup: the model reads, code writes", () => {
  it("one balanced call with the household and the transcript; everything saved in order, the late correction kept", async () => {
    const f = fake(PROFILE);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(f.asked).toHaveLength(1);
    expect(f.asked[0].tier).toBe("balanced");
    expect(JSON.parse(f.asked[0].user).transcript).toContain("actually Rani comes at 8:15");
    const fam = (await k.owner("GET", "/api/family")).body;
    // Padma was left out by the model: the household facts bring her, an elder.
    expect(fam.people.map((p: any) => [p.name, p.group])).toEqual([["Kiran", "adult"], ["Nisha", "adult"], ["Ishaan", "child"], ["Padma", "elder"]]);
    const h = fam.house;
    expect(h.cook_name).toBe("Rani");
    expect(h.cook_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(h.cook_visits).toEqual([{ at: "08:15", meals: ["Breakfast", "Lunch"] }, { at: "17:00", meals: ["Dinner"] }]);
    // Saturday is a cooking day because Nisha cooks it.
    expect(h.cooking_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
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
    expect(r.said).toContain("Nisha cooks at Breakfast, Lunch, Dinner on Sat");
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
