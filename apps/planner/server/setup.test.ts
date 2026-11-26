// apply_setup v2 (setup.ts, docs/slot-model-spec.md §4) with a fake model: three balanced reads and a fast contains read; code
// checks structure only (quotes, hard rules, known names, slots, the day/count lint, contains_read), writes in a fixed order,
// reads back from the rows, and applies a correction as a diff.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { saysNoEggs, buildMeal, codePlace, nearestDish, cuisinesOf, regionalFor, kitchenLine, needsNamed, placeOf, wordOf, KINDS_SYSTEM, type MealDish, type Place } from "./setup";
import { keptOften, swapItems } from "./setup";
import { dishKey } from "./dishText";
import { checkRead, diffSetup, familyLines, familySentences, frequencyOf, householdOf, lunchLine, personOf, plainWords, quoteHasDayOrCount, readOf, resolveSlot,
  ruleSaid, saidByFamily, savedOf, homeViolations, swapOnly, uncited, kindsRead, kindsAsk, DISHES_ASK, SETUP_PARTS, SETUP_SYSTEM, CONTAINS_BATCH, daysOf, clockOf, itemWord, allergyAsk, answeredIn, mealOf, type Saved, type SetupRead } from "./setup";
import { isAllergyRule } from "./allergy";
import { houseCook, visitsOf } from "./makePlan";
import { listRules, listSlots } from "./slotStore";
import { HOUSEHOLDS } from "../evals/households";
import { mealKinds, regionalWordOf } from "./kinds";
import { resolveGives } from "./targets";
import type { ModelRequest, ModelResult } from "./model";

// A made-up test family (not an eval household).
const HOUSEHOLD = {
  "household.people": [{ name: "Kiran", relation: "self", group: "adult" }, { name: "Nisha", relation: "wife", group: "adult", nicknames: [{ name: "Nishu", by: "Kiran" }] },
    { name: "Ishaan", age: 7, group: "child" }, { name: "Padma", age: 68, group: "elder", relation: "mother", nicknames: [{ name: "Amma", by: "Kiran" }] }],
  "household.help": [{ role: "cook", name: "Rani", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], times: "8am" }],
  "household.weekly": [{ person: "Kiran", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
    { person: "Ishaan", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: "carries" }],
  "household.speaker": "Kiran",
};
const TRANSCRIPT = [
  "Q: Rani cooks Breakfast and Lunch at 8am. Is that right?",
  "A: yes, and dinner at 5pm",
  "A: actually Rani comes at 8:15",
  "Q: Any food rules? Some families say no onion garlic on Tuesdays.",
  "A: pure veg at home. Amma has no sugar, she fasts Mondays till evening. Ishaan's tiffin must be nut-free. Millets are good for Amma.",
  "Q: Does anyone eat differently?",
  "A: Amma has two phulkas at night, no rice",
  "Q: Weekends?",
  "A: Nishu cooks on Saturday, Sunday we eat out for lunch. We all have a snack at 5.",
  "Q: What did you have for lunch last week?",
  "A: rice, sambar, beans poriyal, curd. Rajma twice. Lemon rice on Fridays. Salad every day.",
  "Q: Which grocery app?",
  "A: blinkit mostly, bigbasket otherwise. Akshayakalpa milk every morning.",
];
const HOME = {
  slots: [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main", skip_days: [{ day: "Sun", skip: "eaten_out" }], quote: "Sunday we eat out for lunch" },
    { name: "Dinner", kind: "main" },
    { name: "Ishaan's tiffin", kind: "custom", after: "Breakfast", usual_people: ["Ishaan"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"], quote: "Ishaan's tiffin must be nut-free" },
    { name: "Evening snack", kind: "custom", after: "Lunch", quote: "We all have a snack at 5" },
    { name: "Padma's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Amma"], quote: "Amma has two phulkas at night" },
    // Never said: dropped.
    { name: "Midnight snack", kind: "custom", quote: "we eat at midnight" }],
  cook: { name: "Rani", days: ["Mon-Fri"], visits: [{ at: "8:15", meals: ["breakfast", "lunch"] }, { at: "5pm", meals: ["Dinner"] }], quote: "actually Rani comes at 8:15" },
  family_cooks: [{ person: "Nisha", days: ["Sat"], quote: "Nishu cooks on Saturday" }],
  apps: { main: "blinkit", fallback: "bigbasket" },
  subscriptions: [{ item: "milk", source: "Akshayakalpa", note: "every morning" }],
  lunch_unclear: ["Kiran"],
};
const RULES = {
  rules: [
    { hard: true, what: "veg", quote: "pure veg at home" },
    { hard: true, what: "avoid", who: "Padma", items: ["sugar"], quote: "Amma has no sugar", frequency: "usually" },        // hard: frequency dropped
    { hard: true, what: "fasting", who: "Padma", days: ["Mon"], slots: ["Breakfast", "Lunch"], quote: "she fasts Mondays till evening" },
    { hard: true, what: "avoid", items: ["@nuts"], slots: ["tiffin"], quote: "tiffin must be nut-free" },                     // "tiffin": the one tiffin slot
    { hard: false, what: "swap", who: "Padma", items: ["white_rice"], to: "millets", frequency: "sometimes", quote: "Millets are good for Amma" },
    { hard: true, what: "avoid", who: "Padma", items: ["white_rice"], slots: ["Dinner"], quote: "no rice" },
    { hard: true, what: "avoid", items: ["onion_garlic"], days: ["Tue"], quote: "no onion garlic on Tuesdays" },          // the question's example: dropped
    { hard: true, what: "no_eggs", who: "Ravi", quote: "pure veg at home" },                                                 // nobody at home: asked
  ],
  unplaced: [],
};
const DISHES = {
  library: [["Rice", "Lunch", "rice, sambar, beans poriyal, curd"], ["Sambar", "Lunch", "rice, sambar"], ["Beans poriyal", "Lunch", "beans poriyal"],
    ["Curd", "Lunch", "curd"], ["Rajma", "Lunch", "Rajma twice"], ["Lemon rice", "Lunch", "Lemon rice on Fridays"],
    ["Salad", "Lunch", "Salad every day"], ["Phulka", "Padma's dinner", "Amma has two phulkas at night"], ["Curd", "Breakfast", "curd"],
    ["Sambar", "Breakfast", "rice, sambar"], ["Poriyal", "Ishaan's tiffin", "beans poriyal"]],
  seed: [["Lunch", "Rice, Sambar, Beans poriyal, Curd", "rice, sambar, beans poriyal, curd"]],
};
const OFTEN = {
  often: [["Lemon rice", "Lunch", "Lemon rice on Fridays", "on Fridays", "", "Fri"], ["Salad", "Lunch", "Salad every day", "every day", "daily", ""],
    ["Curd", "Breakfast", "curd", "", "", "Wed"],                                                                               // days with no words saying them: dropped
    ["Sambar", "Breakfast", "rice, sambar", "every day", "daily", ""],                                                         // how-often words not said with it: dropped
    ["Poriyal", "Ishaan's tiffin", "beans poriyal", "", "", "Mon-Fri"]],                                                       // the tiffin's own days: dropped
};

type Part = "home" | "rules" | "dishes" | "often" | "contains" | "lint" | "kinds";
const partOf = (req: ModelRequest): Part => {
  const p = req.purpose ?? "";
  return /kinds/.test(p) ? "kinds" : /contains/.test(p) ? "contains" : /lint/.test(p) ? "lint" : /often/.test(p) ? "often" : /rules/.test(p) ? "rules" : /dishes/.test(p) ? "dishes" : "home";
};
const isResult = (v: unknown): v is ModelResult => !!v && typeof v === "object" && "ok" in (v as object);
/** Every dish's contains: true for the tags in `has`, false for the rest asked. */
const containsOf = (has: Record<string, string[]> = {}) => (req: ModelRequest) => {
  const { dishes, tags } = JSON.parse(req.user) as { dishes: string[]; tags: string[] };
  return Object.fromEntries(dishes.map((d) => [d, Object.fromEntries(tags.map((t) => [t, (has[d] ?? []).includes(t)]))]));
};
/** A kinds answer that places every dish asked as a kind of its own (for tests not about the kinds read). */
const ownKinds = (req: ModelRequest) => ({ dishes: (JSON.parse(req.user).dishes as { name: string; meal: string }[]).map((d) => ({ name: d.name, meal: d.meal, own: true, named: "dish" })) });
/** A model per part: a JSON answer, a result, or a function of (request, try number). */
function fake(over: Partial<Record<Part, unknown>> = {}) {
  const answers: Record<Part, unknown> = { home: HOME, rules: RULES, dishes: DISHES, often: OFTEN, contains: containsOf({ Rice: ["white_rice"], "Lemon rice": ["white_rice"], Curd: ["dairy"] }),
    lint: { dishes: [{ name: "Rajma", often: "twice", frequency: "2/week" }] }, kinds: { dishes: [] }, ...over };
  const asked: ModelRequest[] = [];
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    asked.push(req);
    const part = partOf(req);
    let a = answers[part];
    if (typeof a === "function") a = await a(req, asked.filter((x) => partOf(x) === part).length);
    if (isResult(a)) return a;
    return { ok: true, json: a, model: "fake" };
  };
  return { model, asked, of: (p: Part) => asked.filter((x) => partOf(x) === p) };
}
const lib = (k: Awaited<ReturnType<typeof boot>>) => Object.fromEntries(k.rows("library").map((d) => [`${d.name}@${d.slot}`,
  { frequency: d.frequency, days: d.days ? JSON.parse(d.days) : null, contains: JSON.parse(d.contains), read: JSON.parse(d.contains_read), origin: d.origin }]));

describe("apply_setup v2: the model reads, code checks and writes", () => {
  it("four reads at once (the dishes on fast, the rest balanced), then contains on the fast tier; everything written in order and read back", async () => {
    const f = fake();
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(f.of("home").length + f.of("rules").length + f.of("dishes").length + f.of("often").length).toBe(4);
    for (const p of ["home", "rules", "dishes", "often"] as Part[]) {
      const a = f.of(p)[0];
      expect(a.tier).toBe(p === "dishes" ? "fast" : "balanced");
      expect(JSON.parse(a.user).household).toEqual(HOUSEHOLD);
      expect(JSON.parse(a.user).transcript).toContain("A2: actually Rani comes at 8:15");
    }
    // Contains: fast, every rule's tag and the base tags.
    const c = f.of("contains");
    expect(c).toHaveLength(1);
    expect(c[0].tier).toBe("fast");
    expect(JSON.parse(c[0].user).tags).toEqual(expect.arrayContaining(["sugar", "nuts", "white_rice", "egg", "meat", "fish", "onion_garlic", "dairy"]));

    // People: names only, from the household.
    expect(k.rows("people").map((p) => [p.name, p.group])).toEqual([["Kiran", "adult"], ["Nisha", "adult"], ["Ishaan", "child"], ["Padma", "elder"]]);
    // Slots: the main three, the tiffin after breakfast, the snack after lunch, the add-on for the nickname's person.
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.map((s: any) => [s.name, s.kind, s.order])).toEqual([["Breakfast", "main", 10], ["Ishaan's tiffin", "custom", 20], ["Lunch", "main", 30],
      ["Evening snack", "custom", 40], ["Dinner", "main", 50], ["Padma's dinner", "addon", 60]]);
    expect(fam.slots.find((s: any) => s.name === "Padma's dinner")).toMatchObject({ addon_of: "Dinner", usual_people: ["Padma"] });
    expect(fam.slots.find((s: any) => s.name === "Lunch").skip_days).toEqual([{ day: "Sun", skip: "eaten_out" }]);
    expect(r.dropped.join("\n")).toContain("Midnight snack");
    // Rules: the question's example dropped, the hard rule's frequency dropped, the slot word resolved, the unknown name asked.
    expect(fam.rules.map((x: any) => `${x.hard ? "hard" : "soft"} ${x.what}${x.who ? ` ${x.who}` : ""}${x.slots ? ` @${x.slots.join(",")}` : ""}${x.frequency ? ` ${x.frequency}` : ""}`)).toEqual([
      "hard veg", "hard avoid Padma", "hard fasting Padma @Breakfast,Lunch", "hard avoid @Ishaan's tiffin", "soft swap Padma sometimes", "hard avoid Padma @Dinner"]);
    expect(fam.rules.find((x: any) => x.slots?.includes("Ishaan's tiffin")).items).toEqual(["nuts"]);
    expect(r.dropped.join("\n")).toContain("no onion garlic on Tuesdays");
    expect(r.dropped.join("\n")).toContain("a hard rule holds every time");
    expect(r.asks).toEqual(["Who is Ravi? I don't have them among the people at home.", "What does Padma eat on the Monday fast?"]);
    // Library: days backed by a day word kept, unbacked dropped; the lint re-read the count; daily kept; contains read.
    const book = lib(k);
    // Lemon rice is a catalog item: its contents are the catalog's (peanuts, so nuts too), not asked of the model.
    expect(book["Lemon rice@Lunch"]).toMatchObject({ days: ["Fri"], contains: ["white_rice", "peanut", "nuts"], origin: "setup_named" });
    expect(JSON.parse(f.of("contains")[0].user).dishes).not.toContain("Lemon rice");
    expect(book["Curd@Breakfast"].days).toBeNull();
    // A category word is no library row (§5.3): setup keeps it, with how often as checked, for a correction.
    const cats = JSON.parse(k.rows("house")[0].setup_state).categories;
    expect(book["Sambar@Breakfast"]).toBeUndefined();
    expect(cats.Breakfast.find((c: any) => c.name === "Sambar").frequency).toBeNull();
    expect(book["Poriyal@Ishaan's tiffin"]).toBeUndefined();
    expect(cats["Ishaan's tiffin"].find((c: any) => c.name === "Poriyal").days).toBeNull();
    expect(book["Rajma@Lunch"].frequency).toBe("2/week");
    expect(f.of("lint")).toHaveLength(1);
    expect(JSON.parse(f.of("lint")[0].user).dishes.map((d: any) => d.name)).toEqual(["Rajma", "Phulka"]);   // "two phulkas at night": re-read, nothing saved
    expect(book["Salad@Lunch"]).toBeUndefined();
    expect(cats.Lunch.find((c: any) => c.name === "Salad")).toEqual({ name: "Salad", frequency: "daily", days: null, said: "Salad every day" });
    // The family's words for how often are kept beside it, for the plan call; none where nothing stands.
    const saidOf = (name: string, slot: string) => k.rows("library").find((d) => d.name === name && d.slot === slot)?.said ?? null;
    expect([saidOf("Lemon rice", "Lunch"), saidOf("Rajma", "Lunch"), saidOf("Rice", "Lunch"), saidOf("Curd", "Breakfast")])
      .toEqual(["Lemon rice on Fridays", "Rajma twice", null, null]);
    expect(book["Phulka@Padma's dinner"]).toBeTruthy();
    expect(book["Rice@Lunch"].read).toEqual(expect.arrayContaining(["sugar", "nuts", "white_rice", "egg"]));
    expect(r.contains_missing).toBe(0);
    // The seed: an example slot-day, no date, confirmed.
    expect(k.rows("slot_days").filter((d) => d.date === null).map((d) => [d.slot, d.status])).toEqual([["Lunch", "confirmed"]]);
    expect(k.rows("slot_dishes").map((d) => d.dish)).toEqual(["Rice", "Sambar", "Beans poriyal", "Curd"]);
    // The cook; apps and subscriptions through their routes.
    expect([fam.house.cook_name, fam.house.cook_days, fam.house.cook_visits]).toEqual(["Rani", ["Mon", "Tue", "Wed", "Thu", "Fri"],
      [{ at: "08:15", meals: ["Breakfast", "Lunch"] }, { at: "17:00", meals: ["Dinner"] }]]);
    expect((await k.owner("GET", "/api/family")).body.shopping.main).toBe("zomato-blinkit");
    expect(k.rows("items").find((i) => i.subscription === "Akshayakalpa")).toBeTruthy();
    // The kinds model: each dish's place, Lunch as its plates (the example plate; rajma twice a week with the plate's rice; lemon
    // rice on Fridays, a whole plate; salad every day on each), the cuisines the dishes tell (sambar, beans poriyal: South Indian).
    // Sambar and salad are category words: on their parts, in the family's words, never library rows (§5.3).
    expect(k.rows("library").filter((d) => d.slot === "Lunch").map((d) => [d.name, d.kind, d.sub, d.catalog_item]).sort()).toEqual([
      ["Beans poriyal", "Sabzi", "Poriyal/Thoran", "Beans poriyal"], ["Curd", "Curd", "Curd", "Curd"], ["Lemon rice", "Flavoured rice", "Flavoured rice", "Lemon rice"],
      ["Rajma", "Dal", "Rajma/Chole", "Rajma"], ["Rice", "Rice", "Rice", null]]);
    const lunch = fam.slots.find((s: any) => s.name === "Lunch");
    const salad = { kind: "Salad", words: "salad" };
    expect(lunch.templates).toEqual([
      { parts: [{ kind: "Rice", words: "rice" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }, { kind: "Sabzi", dish: "Beans poriyal", words: "beans poriyal" },
        { kind: "Curd", words: "curd" }, salad], share: null, said: null },
      { parts: [{ kind: "Flavoured rice", dish: "Lemon rice", words: "lemon rice" }, salad], share: null, said: "Lemon rice on Fridays", days: ["Fri"] },
      { parts: [{ kind: "Rice", words: "rice" }, { kind: "Dal", dish: "Rajma", words: "rajma" }, salad], share: "2/week", said: "Rajma twice" }]);
    expect(mealKinds(lunch.templates)).toEqual([{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar"] }, { name: "Sabzi" },
      { name: "Curd", staple: true }, { name: "Salad" }, { name: "Flavoured rice" }, { name: "Dal" }]);   // derived from the parts: a sub-kind only where a part names one
    expect(lunch.kinds).toBeUndefined();
    expect(fam.slots.find((s: any) => s.name === "Padma's dinner").templates).toEqual([{ parts: [{ kind: "Roti", words: "phulka" }], share: null, said: null }]);
    expect(fam.house.cuisines).toEqual(["south"]);
    // The read-back.
    expect(r.said).toBe([
      "At home: Kiran, Nisha, Ishaan and Padma.",
      "Rani cooks Mon–Fri: breakfast and lunch at 8:15 am and dinner at 5 pm; Nisha cooks on Saturdays; the family cooks on Sunday.",
      "Each day: Breakfast, Lunch and Dinner, plus Ishaan's tiffin Mon–Fri for Ishaan, Evening snack and Padma's dinner for Padma at dinner.",
      "Weekday lunch is for Nisha and Padma; Kiran's at the office; Ishaan takes lunch to school.",
      "Sunday lunch is eaten out.",
      "Food rules:\n- Everyone: vegetarian; no nuts at Ishaan's tiffin\n- Padma: no sugar; fasts on Mondays at breakfast and lunch; millets in place of white rice, 2–3 times a week; no white rice at dinner",
      "Your usual meals:\n- Breakfast: curd and sambar\n- Ishaan's tiffin: poriyal"
        + "\n- Lunch: rice, sambar, beans poriyal, curd and salad; or lemon rice and salad (on Fridays); or rice, rajma and salad (twice a week)\n- Padma's dinner: phulka",
      "Your kitchen: South Indian. Tell me if that's not right.",
      "Every day: salad at lunch.",
      "Who is Ravi? I don't have them among the people at home.",
      "What does Padma eat on the Monday fast?",
      "Does Kiran take lunch from home to the office?",
    ].join("\n"));
  });

  it("a person's own meal in place of the family's (instead): their own slot, the family meal without them, said plainly (class 3)", async () => {
    const T = [...TRANSCRIPT, "Q: Does Amma eat with you at night?", "A: No, Amma eats before sunset, her own dinner of phulkas. She doesn't sit for our dinner."];
    const own = { name: "Padma's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Amma"], instead_of: "Dinner", quote: "Amma eats before sunset, her own dinner of phulkas" };
    const f = fake({ home: { ...HOME, slots: [...HOME.slots.filter((x) => x.name !== "Padma's dinner"), own] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: T });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    const mine = fam.slots.find((s: any) => s.name === "Padma's dinner");
    expect(mine).toMatchObject({ kind: "custom", usual_people: ["Padma"], order: 55 });
    expect(fam.slots.find((s: any) => s.name === "Dinner").usual_people).toEqual(["Kiran", "Nisha", "Ishaan"]);
    expect(r.said).toContain("Padma has a separate dinner (Padma's dinner), not the family's; Dinner is for Kiran, Nisha and Ishaan.");
    expect(r.said).not.toContain("Padma's dinner for Padma at dinner");
    // Its meal is dinner (new items are suggested as for dinner), and one in place of lunch is lunch.
    expect(mealOf(mine)).toBe("dinner");
    expect(mealOf({ name: "Ravi's lunch", kind: "custom", addon_of: null, order: 35 })).toBe("lunch");
  });

  it("a school tiffin read as in place of Lunch is saved at Lunch's box place, whatever meal it comes after (F1, D2)", async () => {
    const tiffin = { name: "Ishaan's tiffin", kind: "custom", usual_people: ["Ishaan"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"], instead_of: "Lunch", after: "Breakfast",
      quote: "Ishaan's tiffin must be nut-free" };
    const f = fake({ home: { ...HOME, slots: [...HOME.slots.filter((x) => x.name !== "Ishaan's tiffin"), tiffin] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.find((s: any) => s.name === "Ishaan's tiffin")).toMatchObject({ kind: "custom", usual_people: ["Ishaan"], order: 35 });
  });

  it("a correction re-reads and applies only what the new reply said; the rest is discarded; the read-back says only that", async () => {
    const NEW = "Kiran takes lunch from home. Drop the evening snack. Rajma only on Sundays.";
    const corrected = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const f = fake({
      home: (req: ModelRequest) => (corrected(req) ? { ...HOME, slots: HOME.slots.filter((s) => s.name !== "Evening snack"),
        weekday_lunch: [{ person: "Kiran", lunch: "carries", quote: "Kiran takes lunch from home" }], lunch_unclear: [],
        cook: { ...HOME.cook, days: ["Mon", "Tue", "Wed"] } } : HOME),                              // read differently, not said again: discarded
      rules: (req: ModelRequest) => (corrected(req) ? { ...RULES, rules: RULES.rules.filter((x) => x.what !== "swap") } : RULES),   // missed: not removed
      dishes: (req: ModelRequest) => (corrected(req) ? { ...DISHES, library: [...DISHES.library.filter((d) => d[0] !== "Rajma"), ["Rajma", "Lunch", "Rajma only on Sundays"]] } : DISHES),
      often: (req: ModelRequest) => (corrected(req) ? { often: [...OFTEN.often, ["Rajma", "Lunch", "Rajma only on Sundays", "only on Sundays", "", "Sun"]] } : OFTEN),
    });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...TRANSCRIPT, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    expect(r.correction).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.map((s: any) => s.name)).not.toContain("Evening snack");
    expect(lib(k)["Rajma@Lunch"]).toMatchObject({ days: ["Sun"] });
    expect(fam.house.cook_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);   // an unrelated difference: kept as saved
    expect(fam.rules.some((x: any) => x.what === "swap")).toBe(true);
    // Lunch's dishes changed: its plates are read again and said (rajma's plate is now Sunday's, no count).
    expect(fam.slots.find((s: any) => s.name === "Lunch").templates[2]).toEqual({ parts: [{ kind: "Rice", words: "rice" }, { kind: "Dal", dish: "Rajma", words: "rajma" }, { kind: "Salad", words: "salad" }],
      share: null, said: "Rajma only on Sundays", days: ["Sun"] });
    // The category words read in the first setup (sambar, salad) are on the plates again, from setup's memory, never the library.
    expect(fam.slots.find((s: any) => s.name === "Lunch").templates[0].parts).toContainEqual({ kind: "Rice curry", sub: "Sambar", words: "sambar" });
    expect(k.rows("library").some((d) => d.name === "Salad" || d.name === "Sambar")).toBe(false);
    expect(r.said).toBe(["Removed Evening snack.", "Changed: Rajma at lunch, on Sundays.",
      "Lunch: rice, sambar, beans poriyal, curd and salad; or lemon rice and salad (on Fridays); or rice, rajma and salad (on Sundays).", "Who is Ravi? I don't have them among the people at home.", "What does Padma eat on the Monday fast?", "Anything else to change?"].join("\n"));
    expect(JSON.parse(k.rows("house")[0].setup_state).weekday_lunch).toEqual([{ person: "Kiran", lunch: "carries", quote: "Kiran takes lunch from home" }]);
  });

  it("a fast with no food said is asked about in the read-back; the answer fills it and the question goes (onboarding run 28)", async () => {
    const NEW = "Sabudana khichdi and fruit";
    const answered = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const fasting = RULES.rules.find((x) => x.what === "fasting")!;
    const f = fake({ rules: (req: ModelRequest) => (answered(req)
      ? { ...RULES, rules: RULES.rules.map((x) => (x === fasting ? { ...x, fasting_food: ["sabudana khichdi", "fruit"] } : x)) } : RULES) });
    const k = await boot({ model: f.model });
    const first = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(first.said).toContain("What does Padma eat on the Monday fast?");
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...TRANSCRIPT, "Q: What does Padma eat on the Monday fast?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    const fasts = (await k.owner("GET", "/api/family")).body.rules.filter((x: any) => x.what === "fasting");
    expect(fasts).toHaveLength(1);
    expect(fasts[0].fasting_food).toEqual(["sabudana khichdi", "fruit"]);
    expect(r.said).not.toContain("What does Padma eat");
  });

  describe("an allergy on one person: the read-back asks whether the whole kitchen goes without it (owner, 25 Nov)", () => {
    const ALLERGY = "Ishaan is allergic to peanuts, so nothing with peanuts for him, not even groundnut oil.";
    const ASK = "Do you cook everything without peanuts, or only Ishaan's food?";
    const T0 = [...TRANSCRIPT, "Q: Any allergies?", `A: ${ALLERGY}`];
    const PERSON = { hard: true, what: "avoid", who: "Ishaan", items: ["peanut"], quote: "Ishaan is allergic to peanuts" };
    const HOUSE = (quote: string) => ({ hard: true, what: "avoid", items: ["peanut"], quote });
    /** The rules reader: the person's allergy always; a house rule when the reply says the whole kitchen. */
    const rulesFor = (houseWords?: string) => (req: ModelRequest) => {
      const t = JSON.parse(req.user).transcript as string;
      return { ...RULES, rules: [...RULES.rules, PERSON, ...(houseWords && t.includes(houseWords) ? [HOUSE(houseWords)] : [])] };
    };
    const peanutRules = async (k: Awaited<ReturnType<typeof boot>>) => (await k.owner("GET", "/api/family")).body.rules.filter((x: any) => x.items?.includes("peanut"));

    it("asks once per allergy, in the family's word for it", async () => {
      const k = await boot({ model: fake({ rules: rulesFor() }).model });
      const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: T0 });
      expect(r.asks).toContain(ASK);
      expect(r.said.split("\n").filter((l: string) => l === ASK)).toHaveLength(1);
    });

    it("\"everything\": the rule becomes the whole house's (no person, same items, hard, still an allergy); not asked again", async () => {
      const NEW = "Everything at home is without peanuts, we don't even use groundnut oil.";
      const k = await boot({ model: fake({ rules: rulesFor("Everything at home is without peanuts") }).model });
      await k.op("apply_setup", { household: HOUSEHOLD, transcript: T0 });
      const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...T0, `Q: ${ASK}`, `A: ${NEW}`] });
      expect(r.ok).toBe(true);
      const got = await peanutRules(k);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ who: null, hard: true, what: "avoid", items: ["peanut"] });
      expect(isAllergyRule(got[0])).toBe(true);
      expect(r.said).not.toContain(ASK);
      expect(r.said).toContain("Removed: Ishaan: no peanut (now for everyone).");
      // Once more with nothing new: still one house rule, still not asked.
      const again = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...T0, `Q: ${ASK}`, `A: ${NEW}`] });
      expect(await peanutRules(k)).toHaveLength(1);
      expect(again.said).not.toContain(ASK);
    });

    it("\"everything\" already in the first setup's chat: one house rule from the start, no question", async () => {
      const k = await boot({ model: fake({ rules: rulesFor("Everything at home is without peanuts") }).model });
      const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...T0, `Q: ${ASK}`, "A: Everything at home is without peanuts, we don't even use groundnut oil."] });
      const got = await peanutRules(k);
      expect(got.map((x: any) => [x.who, x.hard, x.quote])).toEqual([[null, true, "Ishaan is allergic to peanuts"]]);
      expect(r.asks).not.toContain(ASK);
    });

    for (const answer of ["Only his food, we keep his aside.", "He has his own food, a different dish."]) {
      it(`"${answer}": the rule stays on Ishaan, and the question is not asked again`, async () => {
        const k = await boot({ model: fake({ rules: rulesFor() }).model });
        await k.op("apply_setup", { household: HOUSEHOLD, transcript: T0 });
        const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...T0, `Q: ${ASK}`, `A: ${answer}`] });
        expect(r.ok).toBe(true);
        expect((await peanutRules(k)).map((x: any) => [x.who, x.hard])).toEqual([["Ishaan", true]]);
        expect(r.asks).not.toContain(ASK);
        expect(r.said).not.toContain(ASK);
        const later = await k.op("apply_setup", { household: HOUSEHOLD, transcript: [...T0, `Q: ${ASK}`, `A: ${answer}`, "Q: Anything else?", "A: Kiran takes lunch from home."] });
        expect(later.said).not.toContain(ASK);
      });
    }

    it("the family's word for the item, else the tag in words", () => {
      expect(itemWord("peanut", "nothing with peanuts for him")).toBe("peanuts");
      expect(itemWord("dairy", "she is allergic to milk")).toBe("dairy");
      expect(allergyAsk({ who: "Ishaan", items: ["peanut", "sesame"], quote: "allergic to peanuts and sesame" })).toBe("Do you cook everything without peanuts and sesame, or only Ishaan's food?");
      expect(answeredIn(ASK, [`Q: ${ASK}`])).toBe(false);
      expect(answeredIn(ASK, [`Q: ${ASK}`, "A: only his"])).toBe(true);
    });
  });

  it("the same call again with no new reply changes nothing", async () => {
    const f = fake();
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    const rules = k.rows("rules").length, library = k.rows("library").length;
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.correction).toBe(true);
    expect(r.changed).toEqual([]);
    expect(k.rows("rules")).toHaveLength(rules);
    expect(k.rows("library")).toHaveLength(library);
    expect(r.said.startsWith("I didn't change anything from that.")).toBe(true);
  });

  for (const part of ["home", "rules"] as Part[]) {
    it(`the ${part} reader fails twice: nothing saved, a plain line to say`, async () => {
      const f = fake({ [part]: { ok: false, code: "invalid_output", message: "bad" } });
      const k = await boot({ model: f.model });
      const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
      expect(r.ok).toBe(false);
      expect(r.say).toContain("save my setup");
      expect(f.of(part)).toHaveLength(2);
      expect(k.rows("people")).toHaveLength(0);
      expect(k.rows("slots")).toHaveLength(0);
    });
  }

  it("the dishes reader fails: the rest is saved and the family is asked for their dishes, a real question, not a note (#29)", async () => {
    const f = fake({ dishes: { ok: false, code: "unavailable", message: "down" } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(k.rows("rules").length).toBeGreaterThan(0);
    expect(k.rows("library")).toHaveLength(0);
    expect(r.asks).toContain(DISHES_ASK);
    expect(r.noted.join("\n")).not.toContain("dishes");
    expect(r.said).toContain(DISHES_ASK);
  });

  it("a transcript with none of the family's replies is refused, never saved empty (#29: the agent sent its own one line)", async () => {
    const f = fake();
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { transcript: "Ankita is the only person eating at home.", household: { people: [{ name: "Ankita", group: "adult", relationship: "self" }] } });
    expect(r.ok).not.toBe(true);
    expect(JSON.stringify(r)).toContain("no family replies");
    expect(f.asked).toHaveLength(0);
    expect(k.rows("library")).toHaveLength(0);
  });

  it("a reader that does not answer within the setup's time is a timeout, not a wait without end", async () => {
    const f = fake({ rules: () => new Promise(() => {}) });
    const k = await boot({ model: f.model, setupBudgetMs: 200 });
    const t0 = Date.now();
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("contains: at most 40 dishes a call; a dish the answer leaves out stays unread (unknown)", async () => {
    const many = Array.from({ length: 45 }, (_, i) => [`Dish ${i + 1}`, "Lunch", "rice, sambar"]);
    const f = fake({ dishes: { library: many }, kinds: ownKinds, contains: (req: ModelRequest) => {
      const all = containsOf()(req) as Record<string, unknown>;
      delete all["Dish 45"];
      return all;
    } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(f.of("contains").map((c) => JSON.parse(c.user).dishes.length).sort((a, b) => b - a)).toEqual([CONTAINS_BATCH, 5]);
    expect(r.contains_missing).toBe(1);
    expect(lib(k)["Dish 45@Lunch"].read).toEqual([]);
  });

  it("a wrong field and a missing transcript are refused before the model is asked", async () => {
    const f = fake();
    const k = await boot({ model: f.model });
    expect((await k.op("apply_setup", { facts: HOUSEHOLD, transcript: TRANSCRIPT })).code).toBe("APP_REFUSED");
    expect((await k.op("apply_setup", { household: HOUSEHOLD, transcript: [] })).status).toBe(400);
    expect(f.asked).toHaveLength(0);
  });
});

describe("apply_setup v2: the checks, pure", () => {
  const hh = householdOf(HOUSEHOLD);
  const said = familyLines(TRANSCRIPT, HOUSEHOLD);
  const base = (over: Partial<SetupRead>): SetupRead => ({ ...readOf({ slots: HOME.slots.slice(0, 4) }, {}, {}), ...over });

  it("a person's vegetarian rule with eggs in their no-list, in a reply that names someone else too: their no_eggs (eval h8)", () => {
    const reply = ["A: Padma is diabetic, no sweets at all. Ishaan is vegetarian, no fish, meat, eggs, onion or garlic."];
    const read = readOf({}, { rules: [{ hard: true, what: "veg", who: "Ishaan", quote: "Ishaan is vegetarian" }] }, {});
    const rules = checkRead(read, { household: hh, said: familyLines(reply, HOUSEHOLD), sentences: familySentences(reply, HOUSEHOLD) }).read.rules;
    expect(rules.some((r) => r.what === "no_eggs" && r.who === "Ishaan")).toBe(true);
  });
  it("a main meal's people never drop someone who is only away on weekdays: weekends they are at it (eval h6)", () => {
    const lunch = (usual: string[]) => checkRead(readOf({ slots: [{ name: "Lunch", kind: "main", usual_people: usual, quote: "" }] }, {}, {}), { household: hh, said }).read.slots
      .find((x) => x.name === "Lunch")!.usual_people;
    expect(lunch(["Nisha", "Padma"])).toEqual([]);                 // Kiran (office) and Ishaan (school) are away Mon–Fri only
    expect(lunch(["Kiran", "Nisha", "Ishaan"])).toEqual(["Kiran", "Nisha", "Ishaan"]);   // Padma is not away: kept as said
  });
  it("a dish's days that are just the days its meal is cooked (lunch out at weekends) say nothing of the dish (eval h7)", () => {
    const read = readOf({ slots: [{ name: "Lunch", kind: "main", skip_days: [{ day: "Sat", skip: "eaten_out" }, { day: "Sun", skip: "ordered_in" }], quote: "weekends we eat out" }] }, {},
      { library: [["Chicken curry", "Lunch", "Weekdays lunch is chicken curry, rice and a sabzi"]] },
      { often: [["Chicken curry", "Lunch", "Weekdays lunch is chicken curry, rice and a sabzi", "Weekdays", "", "Mon,Tue,Wed,Thu,Fri"]] });
    const lines = familyLines(["A: Weekdays lunch is chicken curry, rice and a sabzi. Weekends we eat out."], HOUSEHOLD);
    const c = checkRead(read, { household: hh, said: lines, sentences: lines });
    expect(c.read.library.find((d) => d.name === "Chicken curry")!.days).toBeNull();
    expect(c.dropped.some((x) => x.includes("the meal's own days"))).toBe(true);
  });
  it("a dish said of a person who has their own meal in place of the family's goes on their meal, never the family's (class 6)", () => {
    const reply = ["A: Amma eats at six on her own: khichdi or upma, every night. We have roti and sabzi."];
    const lines = familySentences(reply, HOUSEHOLD);
    const read = readOf({ slots: [...HOME.slots.slice(0, 3), { name: "Padma's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Amma"], instead_of: "Dinner", quote: "Amma eats at six on her own" }] }, {},
      { library: [["Khichdi", "Dinner", "khichdi or upma"], ["Upma", "Dinner", "khichdi or upma"], ["Roti", "Dinner", "roti and sabzi"], ["Sabzi", "Dinner", "roti and sabzi"]],
        seed: [["Dinner", "Khichdi", "khichdi or upma"], ["Dinner", "Roti, Sabzi", "roti and sabzi"]] });
    const c = checkRead(read, { household: hh, said: familyLines(reply, HOUSEHOLD), sentences: lines });
    expect(c.read.library.map((d) => `${d.name}@${d.slot}`).sort()).toEqual(["Khichdi@Padma's dinner", "Roti@Dinner", "Sabzi@Dinner", "Upma@Padma's dinner"]);
    expect(c.read.seed.map((x) => `${x.dishes.join("+")}@${x.slot}`)).toEqual(["Khichdi@Padma's dinner", "Roti+Sabzi@Dinner"]);
    expect(c.read.slots.find((x) => x.name === "Dinner")!.usual_people).toEqual(["Kiran", "Nisha", "Ishaan"]);
  });
  it("a dish read without its words is linted by the family's sentence that names it with a day", () => {
    const lines = familyLines(["A: Weeknights dal and rice. Sunday dinner we make something simple like pasta maybe."], HOUSEHOLD);
    const read = readOf({ slots: HOME.slots.slice(0, 4) }, {}, { library: [["Pasta", "Dinner", ""]] });
    const c = checkRead(read, { household: hh, said: lines });
    expect(c.lint.map((d) => d.name)).toEqual(["Pasta"]);
  });
  it("eggs for some people in a vegetarian house: everyone else gets no eggs, when the reader left it out (eval h13)", () => {
    const lines = familyLines(["A: pure veg at home. Eggs okay for Ishaan and Kiran."], HOUSEHOLD);
    const egg = (rules: unknown[]) => checkRead(readOf({}, { rules }, {}), { household: hh, said: lines }).read.rules
      .filter((r) => r.what === "egg" || r.what === "no_eggs").map((r) => `${r.what} ${r.who ?? "house"}`);
    const veg = { hard: true, what: "veg", quote: "pure veg at home" };
    const eggs = ["Ishaan", "Kiran"].map((who) => ({ hard: true, what: "egg", who, quote: "Eggs okay for Ishaan and Kiran" }));
    expect(egg([veg, ...eggs])).toEqual(["egg Ishaan", "egg Kiran", "no_eggs Nisha", "no_eggs Padma"]);
    // Read already: nothing added twice.
    expect(egg([veg, ...eggs, { hard: true, what: "no_eggs", who: "Nisha", quote: "Eggs okay for Ishaan and Kiran" }])).toEqual(["egg Ishaan", "egg Kiran", "no_eggs Nisha", "no_eggs Padma"]);
    // No vegetarian house, or a house egg rule: nothing added.
    expect(egg(eggs)).toEqual(["egg Ishaan", "egg Kiran"]);
    expect(egg([veg, { hard: true, what: "egg", quote: "Eggs okay for Ishaan and Kiran" }, ...eggs])).toEqual(["egg house", "egg Ishaan", "egg Kiran"]);
  });

  it("a person's vegetarian rule with their no-eggs words beside it gets its no_eggs rule, when the reader left it out (eval h8)", () => {
    const noEggs = (reply: string, rules: unknown[]) => checkRead(readOf({}, { rules }, {}), { household: hh, said: familyLines([`A: ${reply}`], HOUSEHOLD) }).read.rules
      .filter((r) => r.what === "no_eggs" || r.what === "egg").map((r) => `${r.what} ${r.who}`);
    const veg = (quote: string) => ({ hard: true, what: "veg", who: "Padma", quote });
    expect(noEggs("Amma is vegetarian and doesn't eat eggs.", [veg("Amma is vegetarian")])).toEqual(["no_eggs Padma"]);
    expect(noEggs("Amma is vegetarian. She won't touch anda either.", [veg("Amma is vegetarian")])).toEqual(["no_eggs Padma"]);
    expect(noEggs("Amma is pure veg.", [veg("Amma is pure veg")])).toEqual(["no_eggs Padma"]);
    // Read already, or eggs are fine for her, or the no-eggs words are someone else's: nothing added.
    expect(noEggs("Amma is vegetarian, no eggs.", [veg("Amma is vegetarian"), { hard: true, what: "no_eggs", who: "Padma", quote: "no eggs" }])).toEqual(["no_eggs Padma"]);
    expect(noEggs("Amma is vegetarian but eggs are fine.", [veg("Amma is vegetarian")])).toEqual([]);
    expect(noEggs("Amma is vegetarian, no meat but eggs okay.", [veg("Amma is vegetarian")])).toEqual([]);
    expect(noEggs("Amma is vegetarian; Kiran has no eggs.", [veg("Amma is vegetarian")])).toEqual([]);
    expect(saysNoEggs("eggless cake only")).toBe(true);
    expect(saysNoEggs("we eat eggs")).toBe(false);
    // A list of what someone never eats, eggs among it.
    expect(saysNoEggs("Nani is vegetarian, no fish, meat, eggs, onion or garlic")).toBe(true);
    expect(saysNoEggs("no fish or meat, eggs are fine")).toBe(false);
  });

  it("the same dish twice on one example plate is one dish", () => {
    const read = readOf({}, {}, { seed: [["Lunch", "Rice, Sambar, Beans poriyal, Sambar", "rice, sambar, beans poriyal, curd"]] });
    expect(checkRead(read, { household: hh, said }).read.seed[0].dishes).toEqual(["Rice", "Sambar", "Beans poriyal"]);
  });

  it("names: a name, a nickname, a unique first name; never a guess", () => {
    expect(personOf("Amma", hh.people)).toBe("Padma");
    expect(personOf("nishu", hh.people)).toBe("Nisha");
    expect(personOf("Ravi", hh.people)).toBeNull();
    expect(personOf("Gita", [{ name: "Gita Rao", group: "adult", nicknames: [] }, { name: "Gita Das", group: "adult", nicknames: [] }])).toBeNull();
  });
  it("slots: the same name, or the one slot a word names alone", () => {
    const slots = ["Breakfast", "Lunch", "Dinner", "Ishaan's tiffin", "Padma's dinner"];
    expect(resolveSlot("lunch", slots)).toBe("Lunch");
    expect(resolveSlot("tiffin", slots)).toBe("Ishaan's tiffin");
    expect(resolveSlot("Padma's dinner", slots)).toBe("Padma's dinner");
    expect(resolveSlot("Nisha's breakfast", slots)).toBe("Breakfast");
    expect(resolveSlot("Kiran's dinner", slots)).toBe("Dinner");                // no own dinner: the main meal, not Padma's
    expect(resolveSlot("Ishaan's breakfast", slots)).toBe("Breakfast");         // never his tiffin (eval h4)
    expect(resolveSlot("Ishaan's breakfast", [...slots, "Padma's breakfast"])).toBe("Breakfast");
    expect(resolveSlot("supper", slots)).toBeNull();
    // A packed meal by another name: the one packed-meal slot.
    expect(resolveSlot("School tiffin", ["Breakfast", "Lunch", "Dinner", "Snack box"])).toBe("Snack box");
    expect(resolveSlot("Nila's tiffin", ["Breakfast", "Lunch", "Dinner", "Nila's lunch box"])).toBe("Nila's lunch box");
    // A box word naming one meal never lands on a box named for another (F1, D3a): the row is asked about, not moved.
    const agastya = ["Breakfast", "Lunch", "Dinner", "Agastya's breakfast box", "Shiva's lunch"];
    expect(resolveSlot("Agastya's lunch box", agastya)).toBeNull();
    expect(resolveSlot("Lunch box", ["Breakfast", "Lunch", "Dinner", "Breakfast box"])).toBeNull();
    expect(resolveSlot("Agastya's lunch box", [...agastya, "Agastya's lunch box"])).toBe("Agastya's lunch box");
    expect(resolveSlot("Agastya's box", agastya)).toBe("Agastya's breakfast box");
    expect(resolveSlot("tiffin", ["Lunch", "Kabir's box", "Mira's box"])).toBeNull();
  });
  it("a rule's slot that is no meal is noted, not saved; an incomplete rule is kept as a note", () => {
    const c = checkRead(base({ rules: [{ hard: true, what: "avoid", items: ["nuts"], slots: ["Brunch"], quote: "tiffin must be nut-free" },
      { hard: true, what: "swap", who: "Padma", items: ["white_rice"], quote: "Millets are good for Amma" }] }), { household: hh, said });
    expect(c.noted).toEqual([`"tiffin must be nut-free": not saved, there is no meal called Brunch`]);
    expect(c.read.rules.map((r) => r.what)).toEqual(["note"]);
  });
  it("a note that is only the cook's limit again stays with the cook, not the family's notes (onboarding run 24)", () => {
    const cook = { name: "Lakshmi", days: [], visits: [], limits_words: "she has two hours, so 3 to 4 dishes in all", quote: "" } as any;
    const line = ["A: Yes, she has two hours, so 3 to 4 dishes in all"];
    const c = checkRead(base({ cook, rules: [{ hard: false, what: "note", quote: "Yes, she has two hours, so 3 to 4 dishes in all" }] }), { household: hh, said: familyLines(line, {}) });
    expect(c.read.rules).toEqual([]);
    expect(c.dropped.join("\n")).toContain("the cook's limit");
  });
  it("hard whats are always hard and never carry a frequency", () => {
    const c = checkRead(base({ rules: [{ hard: false, what: "avoid", items: ["sugar"], frequency: "sometimes", quote: "Amma has no sugar" }] }), { household: hh, said });
    expect(c.read.rules[0]).toMatchObject({ hard: true, frequency: null });
  });
  it("a note is never hard; how often stands only on words said with the dish, and not on a whole list's words", () => {
    const n = checkRead(base({ rules: [{ hard: true, what: "note", who: "Padma", quote: "Amma has no sugar" }] }), { household: hh, said });
    expect(n.read.rules[0]).toMatchObject({ what: "note", hard: false });
    const line = ["A: rice, sambar, beans poriyal, curd most days. Rajma twice."];
    const sentences = familySentences(line, {});
    const dish = (name: string, quote: string, often: string, frequency: string) => ({ name, slot: "Lunch", quote, often, frequency: frequency as any, days: null });
    const c = checkRead(base({ library: [dish("Rice", "rice", "most days", "usually"), dish("Sambar", "sambar", "most days", "usually"),
      dish("Curd", "curd", "most days", "usually"), dish("Rajma", "Rajma twice", "twice", "2/week"), dish("Beans poriyal", "beans poriyal", "", "usually")] }),
      { household: hh, said: familyLines(line, {}), sentences });
    expect(Object.fromEntries(c.read.library.map((d) => [d.name, d.frequency]))).toEqual({ Rice: null, Sambar: null, Curd: null, Rajma: "2/week", "Beans poriyal": null });
    expect(c.dropped.join("\n")).toContain("is said of the whole list");
  });
  it("how often said over two dishes is each one's; a dish read twice at a meal, or at several meals, keeps its days (eval h8, h13)", () => {
    const line = ["A: Ishaan has toast, or muri; luchi on Sunday.", "A: Breakfast: toast, muri, chire bhaja; luchi with alur dom on Sunday.",
      "A: Dinner: dal, rice, roti and a sabzi most nights, rajma or chole twice a week, khichdi once.", "A: Paratha on Sunday."];
    const sentences = familySentences(line, {});
    const read = readOf({}, {}, { library: [["Luchi", "Breakfast", "luchi on Sunday"], ["Luchi", "Breakfast", "luchi with alur dom on Sunday"],
      ["Alur dom", "Breakfast", "luchi with alur dom on Sunday"], ["Rajma", "Dinner", "rajma or chole twice a week"], ["Chole", "Dinner", "rajma or chole twice a week"],
      ["Dal", "Dinner", "dal, rice, roti and a sabzi most nights"], ["Rice", "Dinner", "dal, rice, roti and a sabzi most nights"],
      ["Roti", "Dinner", "dal, rice, roti and a sabzi most nights"], ["Paratha", "Breakfast", "Paratha on Sunday"], ["Paratha", "Lunch", "Paratha on Sunday"],
      ["Paratha", "Dinner", "Paratha on Sunday"]] },
      { often: [["Luchi", "Breakfast", "luchi with alur dom on Sunday", "on Sunday", "", "Sun"], ["Alur dom", "Breakfast", "luchi with alur dom on Sunday", "on Sunday", "", "Sun"],
        ["Rajma", "Dinner", "rajma or chole twice a week", "twice a week", "1/week", ""], ["Chole", "Dinner", "rajma or chole twice a week", "twice a week", "1/week", ""],
        ["Dal", "Dinner", "most nights", "most nights", "usually", ""], ["Rice", "Dinner", "most nights", "most nights", "usually", ""],
        ["Roti", "Dinner", "most nights", "most nights", "usually", ""],
        ["Paratha", "Breakfast", "Paratha on Sunday", "on Sunday", "", "Sun"], ["Paratha", "Lunch", "Paratha on Sunday", "on Sunday", "", "Sun"],
        ["Paratha", "Dinner", "Paratha on Sunday", "on Sunday", "", "Sun"]] });
    // Both Luchi rows at Breakfast take the read (before, two rows of one meal took neither).
    expect(read.library.filter((d) => d.name === "Luchi").map((d) => d.days)).toEqual([["Sun"], ["Sun"]]);
    const c = checkRead(base({ library: read.library }), { household: hh, said: familyLines(line, {}), sentences });
    const got = Object.fromEntries(c.read.library.map((d) => [`${d.name}@${d.slot}`, { frequency: d.frequency, days: d.days, said: d.said ?? null }]));
    expect(got["Luchi@Breakfast"]).toEqual({ frequency: null, days: ["Sun"], said: "luchi with alur dom on Sunday" });
    expect(got["Alur dom@Breakfast"]).toEqual({ frequency: null, days: ["Sun"], said: "luchi with alur dom on Sunday" });
    expect(got["Rajma@Dinner"]).toEqual({ frequency: "1/week", days: null, said: "rajma or chole twice a week" });
    expect(got["Chole@Dinner"]).toEqual({ frequency: "1/week", days: null, said: "rajma or chole twice a week" });
    // The whole plate's words stay no dish's; one dish at three meals is one dish, not a list.
    for (const d of ["Dal", "Rice", "Roti"]) expect(got[`${d}@Dinner`].frequency, d).toBeNull();
    for (const m of ["Breakfast", "Lunch", "Dinner"]) expect(got[`Paratha@${m}`].days, m).toEqual(["Sun"]);
  });
  it("the often and lint prompts share a count said over two dishes, by a worked example", () => {
    const often = SETUP_PARTS.find((p) => p.id === "often")!.system;
    expect(often).toContain(`["Chole", "Dinner", "chole or kadhi twice a week", "twice a week", "1/week", ""], ["Kadhi", "Dinner", "chole or kadhi twice a week", "twice a week", "1/week", ""]`);
    expect(often).toContain(`["Kadala curry", "Breakfast", "Puttu with kadala curry on Sunday mornings", "on Sunday mornings", "", "Sun"]`);
    expect(often).toContain("most days rice, dal and a sabzi");
    expect(SETUP_SYSTEM).toContain(`"chole or kadhi twice a week": "1/week"`);
    expect(often).toContain(`"chapati and a kurma twice a week": "2/week" each`);   // eaten together: not shared
  });
  it("the day/count lint: a quote with a day word or a number", () => {
    expect(quoteHasDayOrCount("Rajma twice")).toBe(true);
    expect(quoteHasDayOrCount("Lemon rice on Fridays")).toBe(true);
    expect(quoteHasDayOrCount("4 eggs every day")).toBe(true);
    expect(quoteHasDayOrCount("rice, sambar")).toBe(false);
  });
  it("the model's formats read leniently", () => {
    expect(daysOf(["Mon-Fri"])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(daysOf("Sat, Sun")).toEqual(["Sat", "Sun"]);
    expect(clockOf("6.30 pm")).toBe("18:30");
    expect(frequencyOf("2")).toBe("2/week");
    expect(frequencyOf("3/week")).toBe("3/week");
    expect(frequencyOf("daily")).toBe("daily");
    expect(frequencyOf("often")).toBeNull();
    expect(readOf({}, { rules: [{ what: "avoid", items: ["@Nuts"], quote: "x" }] }, {}).rules[0].items).toEqual(["nuts"]);
  });
  it("a quote is the family's when it is in one of their replies or facts; a question's words are not", () => {
    expect(saidByFamily("Pure veg at home.", said)).toBe(true);
    expect(saidByFamily("tiffin must be nut free", said)).toBe(true);
    expect(saidByFamily("no onion garlic on Tuesdays", said)).toBe(false);
    expect(plainWords("Nut-free!")).toBe("nut free");
  });
  it("the weekday lunch line: household.weekly, the replies winning; unknown weekly is no line", () => {
    expect(lunchLine(["Kiran", "Nisha", "Ishaan"], hh.weekly, [], [])).toBe("Weekday lunch is for Nisha; Kiran's at the office; Ishaan takes lunch to school.");
    expect(lunchLine(["Kiran", "Nisha"], hh.weekly, [{ person: "Kiran", lunch: "home", quote: "" }], [])).toBe("Weekday lunch is for Kiran and Nisha.");
    expect(householdOf({ "household.weekly": "Kiran works" }).weekly).toBeNull();
    expect(lunchLine(["Kiran"], null, [], [])).toBeNull();
  });
  it("rules in words", () => {
    const r = { items: null, to: null, slots: null, days: null, frequency: null, per_meal: null, fasting_food: null, quote: "less oil" };
    expect(ruleSaid({ ...r, what: "swap", items: ["white_rice"], to: "millets", frequency: "sometimes" })).toBe("millets in place of white rice, 2–3 times a week");
    expect(ruleSaid({ ...r, what: "fasting", days: ["Mon"], slots: ["Breakfast", "Lunch"], fasting_food: ["fruit"] })).toBe("fasts on Mondays at breakfast and lunch (fruit allowed)");
    expect(ruleSaid({ ...r, what: "cap", per_meal: 2 })).toBe("at most 2 dishes a meal");
    expect(ruleSaid({ ...r, what: "note" })).toBe("less oil");
  });
  it("the diff: an item is applied when its quote is in a new reply or a new reply names it; removals only by name", () => {
    const saved: Saved = { slots: [], cook: null, seed: [], state: null, rules: [],
      library: [{ key: "poha", slot: "Breakfast", name: "Poha" }, { key: "upma", slot: "Breakfast", name: "Upma" }] as any };
    const next = base({ library: [{ name: "Idli", slot: "Breakfast", frequency: null, days: null, quote: "we also have idli", often: "" },
      { name: "Dosa", slot: "Breakfast", frequency: null, days: null, quote: "dosa", often: "" }] });
    const ops = diffSetup(saved, next, [plainWords("we also have idli, no more poha")], false);
    expect(ops.library.map((d) => d.name)).toEqual(["Idli"]);
    expect(ops.removeLibrary).toEqual([{ name: "Poha", slot: "Breakfast" }]);
    expect(ops.discarded).toContain("dish Dosa at Breakfast");
  });
});

describe("the kinds model: each dish placed, each meal's templates, the cuisines (decided 16-19)", () => {
  // Expectations written from the owner's rules (docs/kinds-model-build.md, scripts/kinds/decided.md), not from the code.
  const dish = (name: string, o: Partial<MealDish> & { word?: string } = {}): MealDish =>
    ({ name, place: o.place !== undefined ? o.place : codePlace(name, o.word), frequency: o.frequency ?? null, days: o.days ?? null, said: o.said ?? null });

  it("the family's words: \"a poriyal\" as said, else the dish's name", () => {
    expect(wordOf("Poriyal", "rice, sambar, a poriyal and curd")).toBe("a poriyal");
    expect(wordOf("Dal", "some dal or other")).toBe("some dal");
    expect(wordOf("Beans poriyal", "beans poriyal")).toBe("beans poriyal");
    expect(wordOf("Sambar")).toBe("sambar");
  });

  it("code places what the catalog names: an item is a dish, a sub-kind or kind a category; rice with a curry or curd is two parts", () => {
    expect(codePlace("Beans poriyal")).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", item: "Beans poriyal", named: "dish" });
    expect(codePlace("Poriyal")).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", item: null, named: "category" });
    // A vegetable said on its own ("bhindi", "lauki") is its sabzi: a side of the plate, never a meal by itself.
    expect(codePlace("Bhindi")).toMatchObject({ kind: "Sabzi", sub: "Sabzi", item: "Bhindi sabzi", named: "dish" });
    expect(codePlace("Lauki")).toMatchObject({ kind: "Sabzi", item: "Lauki sabzi", named: "dish" });
    expect(codePlace("Muri")).toBeNull();
    // Decided 3: curd rice is plated as rice and curd; so are rice and a curry eaten mixed.
    expect(codePlace("Curd rice")!.parts).toEqual([{ kind: "Rice", sub: null }, { kind: "Curd", sub: "Curd" }]);
    expect(codePlace("Kadhi chawal")!.parts).toEqual([{ kind: "Rice", sub: null }, { kind: "Rice curry", sub: "Kadhi" }]);
    expect(codePlace("Rasam rice")!.parts).toEqual([{ kind: "Rice", sub: null }, { kind: "Rice curry", sub: "Rasam" }]);
    expect(codePlace("Rajma chawal")).toMatchObject({ kind: "Dal", sub: "Rajma/Chole", item: null, parts: [{ kind: "Rice", sub: null }, { kind: "Dal", sub: "Rajma/Chole" }] });
    // Owner, 26 Nov: a plain bread said with a dish is two parts, the bread and the dish, as rice with a curry is ("roti sabzi"
    // was saved as one dish, and lunch planned "Rice · Roti sabzi").
    expect(codePlace("Roti sabzi")).toMatchObject({ kind: "Sabzi", item: null, parts: [{ kind: "Roti", sub: null }, { kind: "Sabzi", sub: "Sabzi" }] });
    expect(codePlace("Chapati sabzi")!.parts).toEqual([{ kind: "Roti", sub: null }, { kind: "Sabzi", sub: "Sabzi" }]);
    expect(codePlace("Roti with aloo gobi")).toMatchObject({ kind: "Sabzi", item: "Aloo gobi", named: "dish", parts: [{ kind: "Roti", sub: null }, { kind: "Sabzi", sub: "Sabzi" }] });
    expect(codePlace("Phulka dal")!.parts).toEqual([{ kind: "Roti", sub: null }, { kind: "Dal", sub: "Dal" }]);
    // A paratha is not a plain bread; a roti of the catalog's own is one dish.
    expect(codePlace("Paratha with curd")?.parts).toBeUndefined();
    expect(codePlace("Missi roti")).toMatchObject({ kind: "Roti", item: "Missi roti" });
    expect(codePlace("Missi roti")!.parts).toBeUndefined();
    // A rice dish of the catalog's own is one dish.
    expect(codePlace("Lemon rice")).toMatchObject({ kind: "Flavoured rice", item: "Lemon rice" });
    expect(codePlace("Lemon rice")!.parts).toBeUndefined();
    // Not in the catalog: the kinds read places it.
    expect(codePlace("Kovakkai")).toBeNull();
    expect(codePlace("Boiled chicken")).toBeNull();
  });

  // Owner, 26 Nov (decided 20): "curry means dry sabji even in Tamil Nadu and generally South India: it's actually kari";
  // "pachadi" is a chutney in Andhra and Telangana, a curd dish in Kerala and Tamil Nadu.
  it("a regional word is settled by code only where the family's region is clear; the family's word is kept", () => {
    const AP = ["andhra", "south"], TN = ["tamil", "south"], PB = ["punjab", "north"];
    expect(codePlace("Curry", "a curry", AP)).toMatchObject({ kind: "Sabzi", sub: "Vepudu", item: null, named: "category", word: "a curry" });
    expect(codePlace("Curry", "curry", TN)).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", named: "category" });
    expect(codePlace("Curry", "curry", PB)).toMatchObject({ kind: "Gravy", sub: "Curry", named: "category" });
    expect(codePlace("Pachadi", "a pachadi", AP)).toMatchObject({ kind: "Chutney", named: "category", word: "a pachadi" });
    expect(codePlace("Pachadi", "pachadi", ["kerala"])).toMatchObject({ kind: "Raita", named: "category" });
    // A dish named with the word: its vegetable, the word's meaning, the family's name kept.
    expect(codePlace("Cabbage curry", "cabbage curry", AP)).toMatchObject({ kind: "Sabzi", sub: "Vepudu", named: "dish", word: "cabbage curry" });
    expect(codePlace("Avarakkai curry", "avarakkai curry", TN)).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", named: "dish" });
    expect(codePlace("Lauki curry", "lauki curry", PB)).toMatchObject({ kind: "Gravy", named: "dish" });
    expect(codePlace("Cucumber pachadi", "cucumber pachadi", AP)).toMatchObject({ kind: "Chutney", named: "dish" });
    // The region not clear: the kinds read decides. A dish of another kind is not moved by the word.
    expect(codePlace("Curry")).toBeNull();
    expect(codePlace("Pachadi", "pachadi", ["south"])).toBeNull();
    expect(codePlace("Cabbage curry")).toBeNull();
    expect(codePlace("Chicken curry", "chicken curry", TN)).toMatchObject({ kind: "Chicken", item: "Chicken curry" });
  });

  it("unsaid, the region is what most of the family's dishes point to alone; dishes eaten across regions point nowhere", () => {
    const curry = regionalWordOf("curry")!;
    // An Andhra home that names no region: pappu and pesarattu are Andhra; idli is all South India; jowar roti (a bhakri,
    // eaten in four states) and a chapati roll point elsewhere or nowhere.
    const ap = { said: [], dishes: [["andhra", "south"], ["andhra", "south"], ["south"], ["maharashtra", "gujarat", "rajasthan", "karnataka", "west"], ["bengal", "east"]] };
    expect(regionalFor(curry, ap)?.sub).toBe("Vepudu");
    expect(codePlace("Dondakaya curry", "dondakaya curry", ap)).toMatchObject({ kind: "Sabzi", sub: "Vepudu", item: "Dondakaya vepudu" });
    // What they say wins; a split the dishes do not settle is the kinds read's.
    expect(regionalFor(curry, { said: ["punjab", "north"], dishes: ap.dishes })?.kind).toBe("Gravy");
    expect(regionalFor(curry, { said: [], dishes: [["andhra"], ["tamil"]] })).toBeNull();
    expect(regionalFor(curry, { said: [], dishes: [["south"], ["north", "south", "west", "east"]] })).toBeNull();
  });

  it("a category word at a meal the catalog does not suggest it at is asked: a category or one dish (decided 19)", () => {
    expect(needsNamed(codePlace("Upma")!, "lunch")).toBe(true);
    expect(needsNamed(codePlace("Upma")!, "dinner")).toBe(false);
    expect(needsNamed(codePlace("Dosa", "any dosa")!, "lunch")).toBe(true);    // said as any of it: a category
    // A bare word with a decided dish names that dish (§5.1: khichdi is Moong dal khichdi, dosa Plain dosa): nothing to ask.
    expect(needsNamed(codePlace("Khichdi")!, "breakfast")).toBe(false);
    expect(needsNamed(codePlace("Dosa")!, "lunch")).toBe(false);
    expect(codePlace("Dosa")).toMatchObject({ kind: "Dosa", item: null, named: "dish" });
    expect(needsNamed(codePlace("Sambar")!, "breakfast")).toBe(false);   // sambar keeps breakfast (decided 18)
    expect(needsNamed(codePlace("Rice")!, "breakfast")).toBe(false);     // a staple is just their rice
    expect(needsNamed(codePlace("Idli")!, "lunch")).toBe(false);         // an item names one dish
  });

  it("the kinds read's answer is checked against the catalog: an unknown kind is the family's own, an unknown sub-kind none", () => {
    expect(placeOf({ name: "Bhindi", meal: "dinner", words: "bhindi" }, { kind: "Sabzi", sub: "Sabzi", named: "dish" }, "bhindi"))
      .toEqual({ kind: "Sabzi", sub: "Sabzi", item: null, own: false, named: "dish", word: "bhindi" });
    expect(placeOf({ name: "Boiled chicken", meal: "breakfast", words: "" }, { own: true }, "boiled chicken"))
      .toEqual({ kind: "Boiled chicken", sub: null, item: null, own: true, named: "dish", word: "boiled chicken" });
    expect(placeOf({ name: "Mystery bake", meal: "dinner", words: "" }, { kind: "Casserole" }, "mystery bake")).toMatchObject({ kind: "Mystery bake", own: true });
    expect(placeOf({ name: "Tondli", meal: "lunch", words: "" }, { kind: "Sabzi", sub: "Fritters" }, "tondli").sub).toBeNull();
    expect(placeOf({ name: "Mor sadam", meal: "lunch", words: "" }, { kind: "Curd", parts: [{ kind: "Rice" }, { kind: "Curd" }, { kind: "Nonsense" }] }, "mor sadam").parts)
      .toEqual([{ kind: "Rice", sub: "Rice" }, { kind: "Curd", sub: "Curd" }]);
    // Parts say how one dish is plated (curd rice is rice and curd); a dish of a kind that is a whole item (a roll) is not
    // split into a roti and a paneer gravy.
    expect(placeOf({ name: "Roti roll with paneer", meal: "tiffin", words: "" }, { kind: "Roll", parts: [{ kind: "Roti" }, { kind: "Gravy", sub: "Paneer" }] }, "roti roll with paneer").parts)
      .toBeUndefined();
    // Asked only whether it is a category: code's place is kept.
    const known = codePlace("Dosa")!;
    expect(placeOf({ name: "Dosa", meal: "lunch", words: "", known }, { kind: "Upma", named: "category" }, "a dosa")).toMatchObject({ kind: "Dosa", named: "category", word: "a dosa" });
  });

  it("a side or curry told as its own plate goes with the plates it is eaten with, never a meal alone", () => {
    // "Idli, dosa, upma, pongal. With coconut chutney and sambar." read as one-dish plates: chutney and sambar go on every
    // breakfast plate that has nothing beside it yet; never a morning of chutney alone.
    const b = buildMeal("breakfast", [dish("Idli"), dish("Dosa"), dish("Upma"), dish("Coconut chutney"), dish("Sambar")],
      [["Idli"], ["Dosa"], ["Upma"], ["Coconut chutney"], ["Sambar"]]);
    const kinds = (t: { parts: any[] }) => t.parts.map((p) => p.kind ?? `items:${p.items.join("|")}`);
    expect(b.templates.map(kinds)).toEqual([["Idli", "Chutney", "Rice curry"], ["Dosa", "Chutney", "Rice curry"], ["Upma", "Chutney", "Rice curry"]]);
    // "Dosa or chapati with kurma, or rasam rice": kurma goes with the dosa and the chapati, not on the rasam rice.
    const d = buildMeal("dinner", [dish("Dosa"), dish("Chapati"), dish("Kurma"), dish("Rasam rice")], [["Dosa"], ["Chapati"], ["Kurma"], ["Rasam rice"]]);
    expect(d.templates.map(kinds)).toEqual([["Dosa", "Gravy"], ["Roti", "Gravy"], ["Rice", "Rice curry"]]);
    // A curry with nothing to go with at lunch gets the meal's rice or bread.
    const l = buildMeal("lunch", [dish("Rice"), dish("Sambar"), dish("Curd"), dish("Chicken curry")], [["Rice", "Sambar", "Curd"], ["Chicken curry"]]);
    expect(l.templates.map(kinds)).toEqual([["Rice", "Rice curry", "Curd"], ["Rice", "Chicken"]]);
    // "Bhakri or poli with usal or pithla" told dish by dish: each bread with each curry, never all on one plate.
    const m = buildMeal("dinner", [dish("Bhakri"), dish("Poli", { place: codePlace("Chapati") }), dish("Usal"), dish("Pithla")], [["Bhakri"], ["Poli"], ["Usal"], ["Pithla"]]);
    expect(m.templates.map(kinds)).toEqual([["Bhakri", "Dal"], ["Bhakri", "Dal"], ["Roti", "Dal"], ["Roti", "Dal"]]);
    expect(m.templates.every((t) => t.parts.length === 2)).toBe(true);
    // "Dosa sometimes, chapati, chapati with kurma": the bare chapati plate goes; chapati comes with its kurma.
    const c = buildMeal("dinner", [dish("Dosa"), dish("Chapati"), dish("Kurma")], [["Dosa"], ["Chapati"], ["Chapati", "Kurma"]]);
    expect(c.templates.map(kinds)).toEqual([["Dosa"], ["Roti", "Gravy"]]);
    // "Shiva and I carry roti sabzi to office. Dad has dal, rice, sabzi and curd at home": the carried lunch is roti and a sabzi,
    // Dad's is dal, rice, sabzi and curd; never one "Rice, Roti sabzi" plate.
    const rs = buildMeal("lunch", [dish("Roti sabzi"), dish("Dal"), dish("Rice"), dish("Sabzi"), dish("Curd")], [["Roti sabzi"], ["Dal", "Rice", "Sabzi", "Curd"]]);
    expect(rs.templates.map(kinds)).toEqual([["Roti", "Sabzi"], ["Dal", "Rice", "Sabzi", "Curd"]]);
    expect(rs.templates.flatMap((t) => t.parts).some((p) => "items" in p)).toBe(false);
    // An egg breakfast is a whole breakfast.
    expect(buildMeal("breakfast", [dish("Idli"), dish("Bread omelette")], [["Idli"], ["Bread omelette"]]).templates.map(kinds)).toEqual([["Idli"], ["Egg"]]);
  });

  it("a curry told with its own how-often never joins a whole dish told apart with its own; it gets the meal's base (G7)", () => {
    const S = "rajma or chole on some nights", K = "khichdi on one night";
    const d = buildMeal("dinner", [dish("Dal"), dish("Rice"), dish("Roti"), dish("Sabzi"),
      dish("Rajma", { frequency: "1/week", said: S }), dish("Chole", { frequency: "1/week", said: S }), dish("Moong dal khichdi", { frequency: "1/week", said: K })],
      [["Dal", "Rice", "Roti", "Sabzi"], ["Rajma"], ["Chole"], ["Moong dal khichdi"]]);
    const parts = d.templates.map((t) => t.parts);
    const has = (ps: any[], dishName: string) => ps.some((p) => p.dish === dishName);
    for (const ps of parts) if (has(ps, "Moong dal khichdi")) expect(has(ps, "Rajma") || has(ps, "Chole")).toBe(false);
    const kh = d.templates.filter((t) => has(t.parts, "Moong dal khichdi"));
    expect(kh).toHaveLength(1);
    expect(kh[0]).toMatchObject({ share: "1/week", said: K });
    expect(kh[0].parts).toHaveLength(1);
    for (const n of ["Rajma", "Chole"]) {
      const t = d.templates.filter((x) => has(x.parts, n));
      expect(t, n).toHaveLength(1);
      expect(t[0], n).toMatchObject({ share: "1/week", said: S });
      expect(t[0].parts.some((p: any) => p.kind === "Rice" || p.kind === "Roti"), n).toBe(true);
    }
  });

  it("category words are their kind or sub-kind; a named dish is its kind with their dish (variety among it); staples are their kind; each part keeps their words", () => {
    const lunch = buildMeal("lunch", [dish("Rice"), dish("Sambar"), dish("Rasam"), dish("Poriyal", { word: "a poriyal" }), dish("Curd"), dish("Beans poriyal")],
      [["Rice", "Sambar", "Rasam", "Poriyal", "Curd"], ["Rice", "Sambar", "Beans poriyal", "Curd"]]);
    expect(lunch.templates).toEqual([
      { parts: [{ kind: "Rice", words: "rice" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }, { kind: "Rice curry", sub: "Rasam", dish: "Tomato rasam", words: "rasam" },
        { kind: "Sabzi", sub: "Poriyal/Thoran", words: "a poriyal" }, { kind: "Curd", words: "curd" }], share: null, said: null },
      { parts: [{ kind: "Rice", words: "rice" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }, { kind: "Sabzi", dish: "Beans poriyal", words: "beans poriyal" },
        { kind: "Curd", words: "curd" }], share: null, said: null }]);
    expect("kinds" in lunch).toBe(false);
    expect(mealKinds(lunch.templates)).toEqual([{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar", "Rasam"] }, { name: "Sabzi", subs: ["Poriyal/Thoran"] }, { name: "Curd", staple: true }]);
    expect(lunch.line).toBe("rice, sambar, rasam, a poriyal and curd; or rice, sambar, beans poriyal and curd");

    const dinner = buildMeal("dinner", [dish("Phulka"), dish("Dal tadka"), dish("Aloo gobi"), dish("Bhindi sabzi")], [["Phulka", "Dal tadka", "Aloo gobi"], ["Phulka", "Aloo gobi"]]);
    const aloo = { kind: "Sabzi", dish: "Aloo gobi", words: "aloo gobi or bhindi sabzi" };
    expect(dinner.templates.map((t) => t.parts)).toEqual([[{ kind: "Roti", words: "phulka" }, { kind: "Dal", dish: "Dal tadka", words: "dal tadka" }, aloo], [{ kind: "Roti", words: "phulka" }, aloo]]);
    // Bhindi sabzi is in no plate: one more sabzi of the family's, an option of the Sabzi part, no plate of its own.
    expect(dinner.line).toBe("phulka, dal tadka and aloo gobi or bhindi sabzi; or phulka and aloo gobi or bhindi sabzi");
  });

  it("a fixed part named by its kind word is the one clear catalog dish of it, their word kept; else their word (owner, 26 Nov)", () => {
    const asDish = (name: string) => dish(name, { place: { ...codePlace(name)!, named: "dish" } });
    expect(nearestDish(asDish("Stew"), "breakfast")).toEqual({ name: "Vegetable stew",
      place: { kind: "Gravy", sub: "Kerala curry", item: "Vegetable stew", own: false, named: "dish", word: "stew" } });
    expect(nearestDish(asDish("Kurma"), "breakfast")?.name).toBe("Vegetable kurma");
    expect(nearestDish(asDish("Korma"), "breakfast")?.name).toBe("Vegetable kurma");
    // Not fixed there (a gravy at lunch rotates), many dishes of the word (khichdi), a sub-kind with no one dish (sambar), a dish
    // the catalog does not hold, or a dish already named: their word stays.
    expect(nearestDish(asDish("Stew"), "lunch")).toBeNull();
    expect(nearestDish(asDish("Khichdi"), "breakfast")).toBeNull();
    expect(nearestDish(dish("Sambar", { place: { ...codePlace("Sambar")!, named: "dish" } }), "snack")).toBeNull();
    expect(nearestDish(dish("Ammachi's stew"), "breakfast")).toBeNull();
    expect(nearestDish(asDish("Ishtu"), "breakfast")).toBeNull();
  });

  it("a dish at a meal its kind is not suggested at is a fixed part; a category word there is its kind (decided 18, 19)", () => {
    const b = buildMeal("breakfast", [dish("Appam"), dish("Vegetable stew")], [["Appam", "Vegetable stew"]]);
    expect(b.templates).toEqual([{ parts: [{ kind: "Appam", dish: "Appam", words: "appam" }, { items: ["Vegetable stew"] }], share: null, said: null }]);
    expect(mealKinds(b.templates)).toEqual([{ name: "Appam" }]);
    // A bare "dosa" at lunch is their Plain dosa (§5.1), fixed there.
    const asDish = buildMeal("lunch", [dish("Dosa", { place: { ...codePlace("Dosa")!, named: "dish" } })], [["Dosa"]]);
    expect(asDish.templates[0].parts).toEqual([{ items: ["Plain dosa"] }]);
    const asCategory = buildMeal("lunch", [dish("Dosa", { place: { ...codePlace("Dosa")!, named: "category", word: "a different dosa" } })], [["Dosa"]]);
    expect(asCategory.templates[0].parts).toEqual([{ kind: "Dosa", words: "a different dosa" }]);
    expect(mealKinds(asCategory.templates)).toEqual([{ name: "Dosa" }]);
  });

  it("an own kind holds the family's dish and nothing else", () => {
    const own: Place = { kind: "Boiled chicken", sub: null, item: null, own: true, named: "dish", word: "boiled chicken" };
    const b = buildMeal("breakfast", [dish("Boiled chicken", { place: own }), dish("Idli")], [["Idli"]]);
    expect(b.templates).toEqual([{ parts: [{ kind: "Idli", dish: "Idli", words: "idli" }], share: null, said: null },
      { parts: [{ kind: "Boiled chicken", words: "boiled chicken" }], share: null, said: null }]);
    expect(mealKinds(b.templates)).toEqual([{ name: "Idli" }, { name: "Boiled chicken", own: true }]);
  });

  it("curd rice is rice and curd; with rice already on the plate, one rice", () => {
    const l = buildMeal("lunch", [dish("Curd rice"), dish("Rice"), dish("Rasam")], [["Curd rice"], ["Rice", "Rasam", "Curd rice"], ["Curd rice", "Rasam", "Rice"]]);
    expect(l.templates.map((t) => t.parts)).toEqual([[{ kind: "Rice" }, { kind: "Curd", words: "curd rice" }],
      [{ kind: "Rice", words: "rice" }, { kind: "Rice curry", sub: "Rasam", dish: "Tomato rasam", words: "rasam" }, { kind: "Curd", words: "curd rice" }]]);
    expect(l.line).toBe("curd rice; or rice, rasam and curd rice");
  });

  it("how often the family said they have a plate's own dish is the plate's share; a dish they have every day is on every plate", () => {
    const b = buildMeal("breakfast", [dish("Idli"), dish("Dosa"), dish("Upma", { frequency: "1/week", said: "upma once" }), dish("Poha", { frequency: "2/week", said: "poha twice a week" })],
      [["Idli"], ["Dosa"], ["Upma"], ["Poha"]]);
    expect(b.templates.map((t) => [t.parts, t.share, t.said])).toEqual([[[{ kind: "Idli", dish: "Idli", words: "idli" }], null, null],
      [[{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }], null, null], [[{ kind: "Upma", words: "upma" }], "1/week", "upma once"], [[{ kind: "Poha", words: "poha" }], "2/week", "poha twice a week"]]);
    expect(b.line).toBe("idli; or dosa; or upma (once a week); or poha (twice a week)");
    // Pulao twice, in no example plate: a whole plate of its own, twice a week. Salad every day: on each plate.
    const l = buildMeal("lunch", [dish("Rice"), dish("Dal"), dish("Pulao", { frequency: "2/week", said: "pulao twice" }), dish("Salad", { frequency: "daily", said: "salad every day" })],
      [["Rice", "Dal"]]);
    // Salad is a category word: every day it is its kind, on each plate; pulao said bare is their Vegetable pulao.
    expect(l.templates).toEqual([{ parts: [{ kind: "Rice", words: "rice" }, { kind: "Dal", sub: "Dal", words: "dal" }, { kind: "Salad", words: "salad" }], share: null, said: null },
      { parts: [{ kind: "Pulao", dish: "Vegetable pulao", words: "pulao" }, { kind: "Salad", words: "salad" }], share: "2/week", said: "pulao twice" }]);
    expect(l.line).toBe("rice, dal and salad; or pulao and salad (twice a week)");
  });

  it("a main dish in none of the plates comes with the plate's base (rajma twice a week is rice and rajma); the curd stays its own", () => {
    const l = buildMeal("lunch", [dish("Rice"), dish("Sambar"), dish("Curd"), dish("Rajma", { frequency: "2/week", said: "rajma twice" })], [["Rice", "Sambar", "Curd"]]);
    expect(l.templates[1]).toEqual({ parts: [{ kind: "Rice", words: "rice" }, { kind: "Dal", dish: "Rajma", words: "rajma" }], share: "2/week", said: "rajma twice" });
  });

  it("their own dish of a known kind is that kind with their dish, never fixed; a box's filling variant of it is fixed (review 1)", () => {
    const kov: Place = { kind: "Sabzi", sub: "Sabzi", item: null, own: false, named: "dish", word: "kovakkai" };
    const d = buildMeal("dinner", [dish("Phulka"), dish("Kovakkai", { place: kov })], [["Phulka", "Kovakkai"]]);
    expect(d.templates[0].parts).toEqual([{ kind: "Roti", words: "phulka" }, { kind: "Sabzi", sub: "Sabzi", dish: "Kovakkai", words: "kovakkai" }]);
    const roll = (n: string): MealDish => dish(n, { place: { kind: "Paratha", sub: null, item: null, own: false, named: "dish", word: n.toLowerCase() }, frequency: "sometimes" });
    const box = buildMeal("lunch", [dish("Paratha"), roll("Egg paratha roll")], [["Paratha"], ["Egg paratha roll"]], [], { box: true });
    expect(box.templates.map((t) => t.parts)).toEqual([[{ kind: "Paratha", dish: "Plain paratha", words: "paratha" }], [{ items: ["Egg paratha roll"] }]]);
    // Not a box: their own paratha dish stays a Paratha part.
    expect(buildMeal("lunch", [dish("Paratha"), roll("Egg paratha roll")], [["Paratha"], ["Egg paratha roll"]]).templates[1].parts)
      .toEqual([{ kind: "Paratha", dish: "Egg paratha roll", words: "egg paratha roll" }]);
  });

  it("a linked box's base plate is the one named with the link's words, in any order; the others are its filling variants (G3)", () => {
    const own = (n: string): MealDish => dish(n, { place: { kind: "Paratha", sub: null, item: null, own: false, named: "dish", word: n.toLowerCase() } });
    const names = ["Paratha wrapped with sabzi", "Paratha with paneer", "Paratha with egg"];
    const link = [{ kind: "Sabzi", sub: "Sabzi", from: "Lunch", words: "sabzi" }];
    const build = (ns: string[]) => buildMeal("lunch", ns.map(own), ns.map((n) => [n]), link, { box: true }).templates.map((t) => t.parts);
    const want = [[{ kind: "Paratha", dish: "Plain paratha", words: "paratha wrapped with sabzi" }, { from: "Lunch", kind: "Sabzi", sub: "Sabzi" }],
      [{ items: ["Paratha with paneer"] }], [{ items: ["Paratha with egg"] }]];
    expect(build(names)).toEqual(want);
    const back = build([...names].reverse());
    expect(back).toHaveLength(3);
    for (const t of want) expect(back).toContainEqual(t);
    // No plate named with the link's words: as before (the link joins the kind plate the variant pass leaves).
    const none = buildMeal("lunch", names.slice(1).map(own), names.slice(1).map((n) => [n]), link, { box: true }).templates.map((t) => t.parts);
    expect(none.flat().filter((p: any) => "from" in p)).toHaveLength(1);
  });

  it("a dish not placed is itself, never dropped", () => {
    const l = buildMeal("dinner", [dish("Grandma's bake", { place: null })], [["Grandma's bake"]]);
    expect(l.templates).toEqual([{ parts: [{ items: ["Grandma's bake"] }], share: null, said: null }]);
    expect(mealKinds(l.templates)).toEqual([]);
  });

  it("cuisines: what the family's dishes tell (an item's narrow cuisines with their region, a one-region sub-kind), and the regions they name", () => {
    const at = (n: string) => codePlace(n)!;
    expect(cuisinesOf([at("Macher jhol"), at("Dal tadka"), at("Rice"), at("Aloo gobi")], ["we are gujarati but love fish"])).toEqual(["gujarat", "bengal", "west", "east"]);
    expect(cuisinesOf([at("Sambar"), at("Beans poriyal")], [])).toEqual(["south"]);
    expect(cuisinesOf([at("Roti"), at("Dal"), at("Rajma")], [])).toEqual([]);                  // eaten everywhere: tells nothing
    expect(cuisinesOf([], ["we are south indian, my wife is tamil"])).toEqual(["tamil", "south"]);
    expect(kitchenLine(["tamil", "south"])).toBe("Your kitchen: Tamil, South Indian. Tell me if that's not right.");
    expect(kitchenLine([])).toBeNull();
  });

  it("the kinds prompt is in the prompts checked, and its example family is made up", () => {
    expect(SETUP_SYSTEM).toContain(KINDS_SYSTEM);
    for (const w of ["curd rice", "rasam rice", "kadhi chawal", "varan bhaat", "bhindi", "lauki", "boiled chicken", "vegetable stew"]) expect(KINDS_SYSTEM.toLowerCase(), w).not.toContain(w);
  });
});

describe("apply_setup: the kinds model, end to end with a fake model", () => {
  const FAMILY = { "household.people": [{ name: "Sameer", group: "adult" }, { name: "Tanvi", group: "adult" }], "household.speaker": "Sameer" };
  const T = [
    "Q: What did you have for breakfast last week?",
    "A: Khichdi most days, boiled chicken on gym days, appam with vegetable stew on Sundays.",
    "Q: And dinner?",
    "A: Phulka with kovakkai or chicken curry. We're Malayali, by the way.",
  ];
  const DISHES2 = {
    library: [["Khichdi", "Breakfast", "Khichdi most days"], ["Boiled chicken", "Breakfast", "boiled chicken on gym days"], ["Appam", "Breakfast", "appam with vegetable stew"],
      ["Vegetable stew", "Breakfast", "appam with vegetable stew"], ["Phulka", "Dinner", "Phulka with kovakkai"], ["Kovakkai", "Dinner", "Phulka with kovakkai"],
      ["Chicken curry", "Dinner", "chicken curry"]],
    seed: [["Breakfast", "Khichdi", "Khichdi most days"], ["Breakfast", "Boiled chicken", "boiled chicken on gym days"], ["Breakfast", "Appam, Vegetable stew", "appam with vegetable stew"],
      ["Dinner", "Phulka, Kovakkai", "Phulka with kovakkai or chicken curry"], ["Dinner", "Phulka, Chicken curry", "Phulka with kovakkai or chicken curry"]],
  };
  const OFTEN2 = { often: [["Khichdi", "Breakfast", "Khichdi most days", "most days", "usually", ""],
    ["Boiled chicken", "Breakfast", "boiled chicken on gym days", "on gym days", "sometimes", ""],
    ["Appam", "Breakfast", "appam with vegetable stew on Sundays", "on Sundays", "", "Sun"], ["Vegetable stew", "Breakfast", "appam with vegetable stew on Sundays", "on Sundays", "", "Sun"]] };
  const KINDS = { dishes: [{ name: "Khichdi", meal: "breakfast", named: "dish" }, { name: "Boiled chicken", meal: "breakfast", own: true, named: "dish" },
    { name: "Kovakkai", meal: "dinner", kind: "Sabzi", sub: "Sabzi", named: "dish" }] };
  const fake2 = (more: Partial<Record<Part, unknown>> = {}) => fake({ home: { slots: [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" }] },
    rules: { rules: [] }, dishes: DISHES2, often: OFTEN2, kinds: KINDS, contains: containsOf(), lint: { dishes: [] }, ...more });

  it("places every dish, writes each meal's kinds and templates and the cuisines, and reads them back in the family's words", async () => {
    const f = fake2();
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: T });
    expect(r.ok).toBe(true);
    // One kinds read, on fast, with the catalog, of only what code could not settle: two dishes the catalog does not hold. A bare
    // "khichdi" is the catalog's decided dish (§5.1, Moong dal khichdi): nothing to ask.
    const asked = f.of("kinds");
    expect(asked).toHaveLength(1);
    expect(asked[0].tier).toBe("fast");
    const user = JSON.parse(asked[0].user);
    expect(user.dishes.map((d: any) => d.name).sort()).toEqual(["Boiled chicken", "Kovakkai"]);
    expect(user.catalog.some((l: string) => l.startsWith("Sabzi [") && l.includes("Poriyal/Thoran"))).toBe(true);
    // The library: kind, sub-kind and catalog item; a catalog item's contents from the catalog, not asked of the model.
    const row = (n: string) => k.rows("library").find((d) => d.name === n)!;
    expect([row("Kovakkai").kind, row("Kovakkai").sub, row("Kovakkai").catalog_item]).toEqual(["Sabzi", "Sabzi", null]);
    expect([row("Boiled chicken").kind, row("Boiled chicken").catalog_item]).toEqual(["Boiled chicken", null]);
    expect([row("Moong dal khichdi").kind, row("Moong dal khichdi").catalog_item]).toEqual(["Khichdi", "Moong dal khichdi"]);
    expect(k.rows("library").some((d) => d.name === "Khichdi")).toBe(false);
    expect([row("Chicken curry").kind, row("Chicken curry").sub, row("Chicken curry").catalog_item]).toEqual(["Chicken", "Curry", "Chicken curry"]);
    expect(JSON.parse(row("Chicken curry").contains).sort()).toEqual(["chicken", "meat", "onion_garlic", "root_veg"]);
    expect(f.of("contains").flatMap((c) => JSON.parse(c.user).dishes)).not.toContain("Chicken curry");
    expect(f.of("contains").flatMap((c) => JSON.parse(c.user).dishes)).toContain("Kovakkai");
    // Breakfast: their khichdi (Moong dal khichdi) at breakfast, a meal khichdi is not suggested at, stays theirs, fixed; boiled
    // chicken a kind of their own; appam with the stew fixed, on Sundays.
    const fam = (await k.owner("GET", "/api/family")).body;
    const slot = (n: string) => fam.slots.find((s: any) => s.name === n);
    expect(slot("Breakfast").templates).toEqual([
      { parts: [{ items: ["Moong dal khichdi"] }], share: "usually", said: "Khichdi most days" },
      { parts: [{ kind: "Boiled chicken", words: "boiled chicken" }], share: "sometimes", said: "boiled chicken on gym days" },
      { parts: [{ kind: "Appam", dish: "Appam", words: "appam" }, { items: ["Vegetable stew"] }], share: null, said: "appam with vegetable stew on Sundays", days: ["Sun"] }]);
    expect(mealKinds(slot("Breakfast").templates)).toEqual([{ name: "Boiled chicken", own: true }, { name: "Appam" }]);
    // Kovakkai is a sabzi of theirs the catalog does not hold: their dish on a Sabzi part (others offered as new), a library row
    // with its kind; chicken curry their dish of its kind.
    expect(slot("Dinner").templates).toEqual([{ parts: [{ kind: "Roti", words: "phulka" }, { kind: "Sabzi", sub: "Sabzi", dish: "Kovakkai", words: "kovakkai" }], share: null, said: null },
      { parts: [{ kind: "Roti", words: "phulka" }, { kind: "Chicken", dish: "Chicken curry", words: "chicken curry" }], share: null, said: null }]);
    expect(mealKinds(slot("Dinner").templates)).toEqual([{ name: "Roti", staple: true }, { name: "Sabzi", subs: ["Sabzi"] }, { name: "Chicken" }]);
    expect(slot("Lunch").templates).toBeNull();      // no dish said for lunch: not read
    // Cuisines: appam and the stew are Kerala (appam Tamil too), and they said Malayali.
    expect(fam.house.cuisines).toEqual(["tamil", "kerala", "south"]);
    expect(r.said).toContain("Your usual meals:\n- Breakfast: khichdi (most days); or boiled chicken (2–3 times a week); or appam and vegetable stew (on Sundays)\n- Dinner: phulka and kovakkai; or phulka and chicken curry");
    expect(r.said).toContain("Your kitchen: Tamil, Kerala, South Indian. Tell me if that's not right.");
    expect(r.said).not.toContain("Your usual dishes");
  });

  it("idiyappam with stew at breakfast: the stew is kept fixed as Vegetable stew, read back in their words (owner, 26 Nov)", async () => {
    const tr = ["Q: What did you have for breakfast last week?", "A: Idiyappam with stew most days, sometimes idiyappam with ammachi's curry."];
    const line = "Idiyappam with stew most days";
    const f = fake({ home: { slots: [{ name: "Breakfast", kind: "main" }] }, rules: { rules: [] },
      dishes: { library: [["Idiyappam", "Breakfast", line], ["Stew", "Breakfast", line], ["Ammachi's curry", "Breakfast", "idiyappam with ammachi's curry"]],
        seed: [["Breakfast", "Idiyappam, Stew", line], ["Breakfast", "Idiyappam, Ammachi's curry", "idiyappam with ammachi's curry"]] },
      often: { often: [] }, kinds: { dishes: [{ name: "Stew", meal: "breakfast", named: "dish" }, { name: "Ammachi's curry", meal: "breakfast", own: true, named: "dish" }] },
      contains: containsOf(), lint: { dishes: [] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: tr });
    expect(r.ok).toBe(true);
    const names = k.rows("library").map((d) => d.name).sort();
    expect(names).toEqual(["Ammachi's curry", "Idiyappam", "Vegetable stew"]);
    const stew = k.rows("library").find((d) => d.name === "Vegetable stew")!;
    expect([stew.kind, stew.sub, stew.catalog_item]).toEqual(["Gravy", "Kerala curry", "Vegetable stew"]);
    const bf = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Breakfast");
    expect(bf.templates.map((t: any) => t.parts)).toEqual([[{ kind: "Idiyappam", dish: "Idiyappam", words: "idiyappam" }, { items: ["Vegetable stew"] }],
      [{ kind: "Idiyappam", dish: "Idiyappam", words: "idiyappam" }, { items: ["Ammachi's curry"] }]]);   // a word the catalog does not hold stays as said
    expect(mealKinds(bf.templates).map((x: any) => x.name)).not.toContain("Gravy");
    expect(r.said).toContain("Breakfast: idiyappam and stew; or idiyappam and ammachi's curry");
    // A correction that leaves breakfast alone keeps it so, still in their words.
    const NEW = "Also we are four at home.";
    const r2 = await k.op("apply_setup", { household: FAMILY, transcript: [...tr, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r2.ok).toBe(true);
    expect(k.rows("library").map((d) => d.name).sort()).toEqual(["Ammachi's curry", "Idiyappam", "Vegetable stew"]);
    expect((await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Breakfast").templates).toEqual(bf.templates);
  });

  // Decided 20, end to end: a made-up Telugu home ("tomato pappu" says Andhra) and one whose region nothing says.
  const regional = (lunch: string, library: string[][], seed: string[][]) => {
    const tr = ["Q: What did you have for lunch last week?", `A: ${lunch}`];
    const f = fake({ home: { slots: [{ name: "Lunch", kind: "main" }] }, rules: { rules: [] }, dishes: { library, seed }, often: { often: [] },
      kinds: (req: ModelRequest) => ({ dishes: JSON.parse(req.user).dishes.map((d: any) => ({ name: d.name, meal: d.meal, kind: "Sabzi", sub: "Sabzi", named: d.name === "Curry" ? "category" : "dish" })) }),
      contains: containsOf(), lint: { dishes: [] } });
    return { tr, f };
  };
  it("a regional word in a home whose region is clear is placed by code, never asked, and read back in the family's words", async () => {
    const line = "Rice, tomato pappu, a curry and a pachadi. Curry is usually cabbage curry.";
    const { tr, f } = regional(line, [["Rice", "Lunch", line], ["Tomato pappu", "Lunch", line], ["Curry", "Lunch", line], ["Pachadi", "Lunch", line], ["Cabbage curry", "Lunch", line]],
      [["Lunch", "Rice, Tomato pappu, Curry, Pachadi", line]]);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: tr });
    expect(r.ok).toBe(true);
    expect(f.of("kinds").flatMap((q) => JSON.parse(q.user).dishes.map((d: any) => d.name))).toEqual([]);
    const row = (n: string) => k.rows("library").find((d) => d.name === n)!;
    expect([row("Cabbage curry").kind, row("Cabbage curry").sub]).toEqual(["Sabzi", "Vepudu"]);
    // "a curry" and "a pachadi" are category words: placed on their parts, in their words, never library rows (§5.3).
    expect(row("Curry")).toBeUndefined();
    expect(row("Pachadi")).toBeUndefined();
    const lunch = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Lunch");
    expect(lunch.templates[0].parts).toEqual(expect.arrayContaining([{ kind: "Sabzi", sub: "Vepudu", words: "a curry or cabbage curry" }, { kind: "Chutney", words: "a pachadi" }]));
    expect(mealKinds(lunch.templates).map((x: any) => x.name)).not.toContain("Gravy");
    expect(mealKinds(lunch.templates).map((x: any) => x.name)).not.toContain("Raita");
    expect(r.said).toContain("a curry");
    expect(r.said).toContain("a pachadi");
  });
  it("a regional word in a home whose region nothing says is asked of the kinds read, with the word's meanings and the family's dishes", async () => {
    const line = "Rice, dal and a curry.";
    const { tr, f } = regional(line, [["Rice", "Lunch", line], ["Dal", "Lunch", line], ["Curry", "Lunch", line]], [["Lunch", "Rice, Dal, Curry", line]]);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: { ...FAMILY, "household.people": FAMILY["household.people"] }, transcript: tr });
    expect(r.ok).toBe(true);
    const user = JSON.parse(f.of("kinds")[0].user);
    expect(user.dishes.map((d: any) => d.name)).toEqual(["Curry"]);
    expect(user.regional.map((x: any) => x.word)).toEqual(["curry"]);
    expect(user.regional[0].meanings.join(" ")).toMatch(/Sabzi.*Gravy/);
    expect(user.family_dishes).toEqual(expect.arrayContaining(["Rice", "Dal", "Curry"]));
  });

  it("a correction reads again only the meal whose dishes changed, asks the kinds read nothing it read before, and says the new plates", async () => {
    const NEW = "Also poha on Saturdays.";
    const more = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const f = fake2({
      dishes: (req: ModelRequest) => (more(req) ? { library: [...DISHES2.library, ["Poha", "Breakfast", "poha on Saturdays"]], seed: [...DISHES2.seed, ["Breakfast", "Poha", "poha on Saturdays"]] } : DISHES2),
      often: (req: ModelRequest) => (more(req) ? { often: [...OFTEN2.often, ["Poha", "Breakfast", "poha on Saturdays", "on Saturdays", "", "Sat"]] } : OFTEN2),
    });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: FAMILY, transcript: T });
    const dinner = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Dinner");
    const r = await k.op("apply_setup", { household: FAMILY, transcript: [...T, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    expect(f.of("kinds")).toHaveLength(1);           // the first setup's only
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[3]).toEqual({ parts: [{ kind: "Poha", words: "poha" }], share: null, said: "poha on Saturdays", days: ["Sat"] });
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[0].parts).toEqual([{ items: ["Moong dal khichdi"] }]);   // still their dish
    expect(k.rows("library").some((d) => d.name === "Poha")).toBe(false);                                             // a category word
    expect(fam.slots.find((s: any) => s.name === "Dinner")).toEqual(dinner);
    expect(r.said).toContain("Breakfast: khichdi (most days); or boiled chicken (2–3 times a week); or appam and vegetable stew (on Sundays); or poha (on Saturdays).");
    expect(r.said).not.toContain("Dinner:");
    expect(r.said).not.toContain("Your kitchen");    // unchanged: not said again
  });

  it("a correction that names a dish reads its place again: kovakkai at dinner is any vegetable after all, and leaves the library", async () => {
    // (Khichdi, the old case here, is now a decided bare word: their Moong dal khichdi, never asked.)
    const NEW = "The kovakkai can be any vegetable, a different one each time.";
    const f = fake2({ kinds: (req: ModelRequest) => (JSON.parse(req.user).dishes.length === 1
      ? { dishes: [{ name: "Kovakkai", meal: "dinner", kind: "Sabzi", sub: "Sabzi", named: "category" }] } : KINDS) });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: FAMILY, transcript: T });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: [...T, "Q: Anything to change?", `A: ${NEW}`] });
    expect(f.of("kinds").map((q) => JSON.parse(q.user).dishes.map((d: any) => d.name))).toEqual([expect.arrayContaining(["Kovakkai"]), ["Kovakkai"]]);
    const fam = (await k.owner("GET", "/api/family")).body;
    // Decided 19: a category word is its kind at that meal, new sabzis suggested; its words on the part, no library row (§5.3).
    expect(fam.slots.find((s: any) => s.name === "Dinner").templates[0]).toEqual({ parts: [{ kind: "Roti", words: "phulka" }, { kind: "Sabzi", sub: "Sabzi", words: "kovakkai" }], share: null, said: null });
    expect(k.rows("library").some((d) => d.name === "Kovakkai")).toBe(false);
    expect(JSON.parse(k.rows("house")[0].setup_state).categories.Dinner.map((c: any) => c.name)).toEqual(["Kovakkai"]);
    expect(r.said).toContain("Dinner: phulka and kovakkai; or phulka and chicken curry");
  });

  // H4: no answer placed what code could not: the family is asked, never a bare word saved as their dish.
  it("the kinds read does not answer: it stops inside the setup's budget, the setup saves, what it would place is asked (H4)", async () => {
    const f = fake2({ kinds: () => new Promise(() => {}) });
    const k = await boot({ model: f.model, setupBudgetMs: 5000 });
    const t0 = Date.now();
    const r = await k.op("apply_setup", { household: FAMILY, transcript: T });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(JSON.stringify(fam.slots.find((s: any) => s.name === "Dinner").templates).toLowerCase()).not.toContain("kovakkai");
    expect(r.asks).toContain(kindsAsk("kovakkai", { name: "Dinner", kind: "main" }));
    expect(k.rows("library").some((d) => d.name === "Kovakkai")).toBe(false);
  });

  it("the kinds read fails: the setup still saves; what code could not place is asked, what it placed stays (H4)", async () => {
    const f = fake2({ kinds: { ok: false, code: "unavailable", message: "down" } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: T });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    const items = (n: string) => fam.slots.find((s: any) => s.name === n).templates.flatMap((t: any) => t.parts).filter((p: any) => "items" in p).flatMap((p: any) => p.items);
    expect(items("Dinner")).not.toContain("Kovakkai");
    expect(items("Breakfast")).not.toContain("Boiled chicken");
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[0].parts).toEqual([{ items: ["Moong dal khichdi"] }]);   // khichdi: placed by code, the decided bare dish
    expect(r.asks).toEqual(expect.arrayContaining([kindsAsk("kovakkai", { name: "Dinner", kind: "main" }), kindsAsk("boiled chicken", { name: "Breakfast", kind: "main" })]));
  });
});

// The one meaning model (docs/2026-11-26-one-meaning-model-design.md §5.1–§5.5, §6.4): the walk-through family, read through the
// approved question texts (Q lines are matched by content, never ids). Expectations from the spec and the owner's decisions.
describe("setup reads into the one meaning model (§5, §6.4)", () => {
  const W_HOUSEHOLD = {
    "household.people": [{ name: "Shiva", relation: "self", group: "adult" }, { name: "Ankita", relation: "wife", group: "adult" },
      { name: "Agastya", relation: "son", group: "child", age: 6 }, { name: "Gowri Shankar", relation: "father", group: "elder", nicknames: [{ name: "Dad", by: "Shiva" }] }],
    "household.help": [{ role: "cook", name: "Lakshmi", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], times: "twice a day" }],
    "household.weekly": [{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
      { person: "Ankita", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
      { person: "Agastya", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], to: "15:00" }],
    "household.speaker": "Shiva",
    // O4: who looks after what comes as lists, never text.
    "household.mealsBy": [{ person: "Ankita" }], "household.groceriesBy": [{ person: "Shiva", part: "weekly order" }],
  };
  const A = {
    lunchWhere: "I carry the home lunch, and I take 4 boiled eggs and some salad with it. Ankita eats at office.",
    cook: "Lakshmi comes at 7 for breakfast and lunch, and at 6 for dinner, Monday to Saturday.",
    cookTime: "Yes, she can do 3-4 dishes in the morning.",
    otherDays: "Ankita cooks on Sunday.",
    childSame: "Same as us mostly. He carries a breakfast box and a lunch box.",
    breakfast: "Idli, dosa, upma, poha.",
    lunch: "Rice, dry sabji, sambar/rasam/kootu.",
    dinner: "Roti, dal and a sabzi.",
    childMeals: "Breakfast box: he has what we make for the whole family. Lunch box: paratha rolled with the sabji that we make for lunch, sometimes with egg or cheese inside instead.",
    differently: "Dad doesn't eat egg or salad. Dad has 2 parathas at dinner, others rotis. Agastya doesn't like upma, so pancakes for him when we make upma.",
  };
  const W_TRANSCRIPT = [
    "Q: On weekdays you and Ankita are at the office and Agastya is at school till 3; Dad has lunch at home. Who carries lunch from home, and who eats out?", `A: ${A.lunchWhere}`,
    "Q: Which meals does Lakshmi make, and when does she come?", `A: ${A.cook}`,
    "Q: Is Lakshmi short of time, so only a few dishes?", `A: ${A.cookTime}`,
    "Q: On Sunday, when Lakshmi doesn't come, who cooks, and is any meal eaten out or ordered in?", `A: ${A.otherDays}`,
    "Q: For Agastya: the family's food, or something else at some meals? And a box for school?", `A: ${A.childSame}`,
    "Q: What did the family have for breakfast over the past week? Tell me the dishes.", `A: ${A.breakfast}`,
    "Q: What did the family have for lunch over the past week? Tell me the dishes.", `A: ${A.lunch}`,
    "Q: What did the family have for dinner over the past week? Tell me the dishes.", `A: ${A.dinner}`,
    "Q: What's on the plate for Agastya at those meals, and what goes in the box?", `A: ${A.childMeals}`,
    "Q: Does anyone eat differently: something they don't eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?", `A: ${A.differently}`,
  ];
  const MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"], MON_SAT = [...MON_FRI, "Sat"];
  const W_HOME = {
    slots: [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" },
      { name: "Agastya's breakfast box", kind: "custom", after: "Breakfast", usual_people: ["Agastya"], days: MON_FRI, instead_of: "Breakfast", quote: "He carries a breakfast box" },
      // after Breakfast as the model writes for a school box: the meal it replaces (instead_of) sets its place (F1).
      { name: "Agastya's lunch box", kind: "custom", after: "Breakfast", usual_people: ["Agastya"], days: MON_FRI, instead_of: "Lunch", quote: "a lunch box" },
      { name: "Shiva's lunch box", kind: "addon", addon_of: "Lunch", usual_people: ["Shiva"], days: MON_FRI, extras: true, quote: "I take 4 boiled eggs and some salad with it" }],
    cook: { name: "Lakshmi", days: MON_SAT, visits: [{ at: "7am", meals: ["Breakfast", "Lunch"] }, { at: "6pm", meals: ["Dinner"] }], limits_words: "3-4 dishes in the morning",
      quote: "Lakshmi comes at 7 for breakfast and lunch" },
    family_cooks: [{ person: "Ankita", days: ["Sun"], quote: "Ankita cooks on Sunday" }],
    weekday_lunch: [{ person: "Shiva", lunch: "carries", quote: "I carry the home lunch" }, { person: "Ankita", lunch: "away", quote: "Ankita eats at office" }],
  };
  const W_RULES = { rules: [
    { hard: true, what: "avoid", who: "Gowri Shankar", items: ["egg", "salad"], quote: "Dad doesn't eat egg or salad" },
    { hard: true, what: "swap", who: "Gowri Shankar", items: ["roti"], to: "paratha", slots: ["Dinner"], quote: "Dad has 2 parathas at dinner, others rotis" },
    { hard: true, what: "swap", who: "Agastya", items: ["upma"], to: "pancakes", slots: ["Breakfast", "Agastya's breakfast box"], quote: "pancakes for him when we make upma" },
    { hard: true, what: "cap", per_meal: 4, slots: ["Breakfast", "Lunch"], days: MON_SAT, quote: "she can do 3-4 dishes in the morning" }] };
  const bq = "Idli, dosa, upma, poha", lq = "Rice, dry sabji, sambar/rasam/kootu", dq = "Roti, dal and a sabzi";
  const roll = "paratha rolled with the sabji that we make for lunch", inside = "sometimes with egg or cheese inside", extra = "I take 4 boiled eggs and some salad";
  const W_DISHES = {
    library: [["Idli", "Breakfast", bq], ["Dosa", "Breakfast", bq], ["Upma", "Breakfast", bq], ["Poha", "Breakfast", bq],
      ["Rice", "Lunch", lq], ["Dry sabji", "Lunch", lq], ["Sambar", "Lunch", lq], ["Rasam", "Lunch", lq], ["Kootu", "Lunch", lq],
      ["Roti", "Dinner", dq], ["Dal", "Dinner", dq], ["Sabzi", "Dinner", dq],
      ["Paratha", "Agastya's lunch box", roll], ["Egg paratha roll", "Agastya's lunch box", inside], ["Cheese paratha roll", "Agastya's lunch box", inside],
      ["4 boiled eggs", "Shiva's lunch box", extra], ["Salad", "Shiva's lunch box", extra]],
    seed: [["Breakfast", "Idli", bq], ["Breakfast", "Dosa", bq], ["Breakfast", "Upma", bq], ["Breakfast", "Poha", bq],
      ["Lunch", "Rice, Dry sabji, Sambar", lq], ["Lunch", "Rice, Dry sabji, Rasam", lq], ["Lunch", "Rice, Dry sabji, Kootu", lq], ["Dinner", "Roti, Dal, Sabzi", dq],
      ["Agastya's lunch box", "Paratha", roll], ["Agastya's lunch box", "Egg paratha roll", inside], ["Agastya's lunch box", "Cheese paratha roll", inside],
      ["Shiva's lunch box", "4 boiled eggs, Salad", extra]],
    links: [["Agastya's lunch box", "Lunch", "sabji", roll], ["Agastya's breakfast box", "Breakfast", "", "he has what we make for the whole family"]],
  };
  const W_OFTEN = { often: [["Egg paratha roll", "Agastya's lunch box", inside, "sometimes", "sometimes", ""], ["Cheese paratha roll", "Agastya's lunch box", inside, "sometimes", "sometimes", ""]] };
  const W_KINDS = { dishes: [{ name: "Dry sabji", meal: "lunch", kind: "Sabzi", named: "category" },
    { name: "Egg paratha roll", meal: "lunch", kind: "Paratha", named: "dish" }, { name: "Cheese paratha roll", meal: "lunch", kind: "Paratha", named: "dish" },
    { name: "4 boiled eggs", meal: "lunch", kind: "Egg", sub: "Eggs", named: "dish" }] };
  const walk = async (over: Partial<Record<Part, unknown>> = {}) => {
    const f = fake({ home: W_HOME, rules: W_RULES, dishes: W_DISHES, often: W_OFTEN, kinds: W_KINDS, contains: containsOf(), lint: { dishes: [] }, ...over });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: W_TRANSCRIPT });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    const slot = (n: string) => fam.slots.find((s: any) => s.name === n);
    const names = (s: string) => k.rows("library").filter((d) => d.slot === s).map((d) => d.name).sort();
    return { f, k, r, fam, slot, names };
  };

  it("a category word lives on its template part, never in the library", async () => {
    const { k, slot, names } = await walk();
    const lunch = slot("Lunch");
    for (const t of lunch.templates) expect(t.parts).toContainEqual({ kind: "Sabzi", words: "dry sabji" });
    expect(lunch.templates[0].parts).toEqual([{ kind: "Rice", words: "rice" }, { kind: "Sabzi", words: "dry sabji" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }]);
    expect(names("Lunch")).not.toContain("Dry sabji");
    expect(names("Lunch")).not.toContain("Sambar");
    expect(k.rows("library").some((d) => d.name === "Dry sabji")).toBe(false);
    expect(slot("Lunch").kinds).toBeUndefined();
  });

  // F4 (D3e): a kinds answer that leaves a dish out is asked again, once, for only what it left out; a word still unplaced is
  // asked of the family in the read-back, never a dish on a plate (§5.1: no category word as a dish).
  const noDry = { dishes: W_KINDS.dishes.filter((d) => d.name !== "Dry sabji") };
  const dry = { name: "Dry sabji", meal: "lunch", kind: "Sabzi", sub: "Sabzi", named: "category" };
  const itemsOf = (s: any) => s.templates.flatMap((t: any) => t.parts).filter((p: any) => "items" in p).flatMap((p: any) => p.items);
  it("a kinds answer that leaves a dish out is asked again for it alone; placed then, it is its kind's part (F4)", async () => {
    const { f, slot, k, r } = await walk({ kinds: (_req: ModelRequest, n: number) => (n === 1 ? noDry : { dishes: [dry] }) });
    const asked = f.of("kinds").map((q) => JSON.parse(q.user).dishes.map((d: any) => d.name));
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual(["Dry sabji"]);
    for (const t of slot("Lunch").templates) expect(t.parts).toContainEqual(expect.objectContaining({ kind: "Sabzi", words: "dry sabji" }));
    expect(itemsOf(slot("Lunch"))).not.toContain("Dry sabji");
    expect(k.rows("library").some((d) => d.name === "Dry sabji")).toBe(false);
    expect(r.asks.join("\n")).not.toContain("dry sabji");
  });
  it("a dish both kinds answers leave out is asked of the family, never saved as a dish on a plate (F4)", async () => {
    const { f, slot, k, r } = await walk({ kinds: noDry });
    expect(f.of("kinds")).toHaveLength(2);
    expect(itemsOf(slot("Lunch"))).not.toContain("Dry sabji");
    for (const t of slot("Lunch").templates) expect(t.parts).not.toContainEqual(expect.objectContaining({ words: "dry sabji" }));
    expect(k.rows("library").some((d) => d.name === "Dry sabji")).toBe(false);
    const asks = r.asks.filter((a: string) => a.includes("dry sabji"));
    expect(asks).toHaveLength(1);
    expect(r.said).toContain(asks[0]);
    // The rest of the plate stands: rice and sambar.
    expect(slot("Lunch").templates[0].parts).toEqual([{ kind: "Rice", words: "rice" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }]);
  });

  it("a kinds answer that places none of the dishes asked is no answer, as a failed read is: every dish it was asked is asked (F4 review, H4)", async () => {
    const base = await walk({ kinds: { ok: false, code: "unavailable", message: "down" } });
    const { f, k, r, slot } = await walk({ kinds: { dishes: [] } });
    expect(f.of("kinds")).toHaveLength(1);
    expect(k.rows("library").map((d) => `${d.name}@${d.slot}`).sort()).toEqual(base.k.rows("library").map((d) => `${d.name}@${d.slot}`).sort());
    expect(r.asks).toEqual(base.r.asks);
    expect(itemsOf(slot("Lunch"))).not.toContain("Dry sabji");
    expect(r.asks.filter((a: string) => a.includes("dry sabji"))).toHaveLength(1);
  });
  it("a second kinds call that fails leaves what the first left out asked, never a fixed dish (H4)", async () => {
    const { f, r, slot } = await walk({ kinds: (_req: ModelRequest, n: number) => (n === 1 ? noDry : { ok: false, code: "unavailable", message: "down" }) });
    expect(f.of("kinds")).toHaveLength(3);   // the first, then the second and its one retry (askOnce)
    expect(r.asks.filter((a: string) => a.includes("dry sabji"))).toHaveLength(1);
    expect(itemsOf(slot("Lunch"))).not.toContain("Dry sabji");
  });

  it("a bare dosa is their Plain dosa; a bare upma stays a category", async () => {
    const { slot, names } = await walk();
    const parts = slot("Breakfast").templates.map((t: any) => t.parts);
    expect(parts).toContainEqual([{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }]);
    expect(parts).toContainEqual([{ kind: "Upma", words: "upma" }]);
    expect(parts).toContainEqual([{ kind: "Idli", dish: "Idli", words: "idli" }]);
    expect(names("Breakfast")).toContain("Plain dosa");
    expect(names("Breakfast")).not.toContain("Upma");
    expect(names("Breakfast")).not.toContain("Dosa");
    // The decided bare list at lunch: rasam is Tomato rasam, kootu Mixed vegetable kootu; both their dishes.
    const lunch = slot("Lunch").templates.flatMap((t: any) => t.parts);
    expect(lunch).toContainEqual({ kind: "Rice curry", sub: "Rasam", dish: "Tomato rasam", words: "rasam" });
    expect(lunch).toContainEqual({ kind: "Rice curry", sub: "Kootu", dish: "Mixed vegetable kootu", words: "kootu" });
    expect(names("Lunch")).toEqual(expect.arrayContaining(["Tomato rasam", "Mixed vegetable kootu", "Rice"]));
  });

  it("the lunch box links the lunch sabzi; the breakfast box is the family breakfast", async () => {
    const { slot, names } = await walk();
    const box = slot("Agastya's lunch box");
    expect(box).toMatchObject({ kind: "custom", order: 35, usual_people: ["Agastya"], days: MON_FRI });
    expect(box.templates).toEqual([
      { parts: [{ kind: "Paratha", dish: "Plain paratha", words: "paratha" }, { from: "Lunch", kind: "Sabzi" }], share: null, said: null },
      { parts: [{ items: ["Egg paratha roll"] }], share: "sometimes", said: inside },
      { parts: [{ items: ["Cheese paratha roll"] }], share: "sometimes", said: inside }]);
    expect(names("Agastya's lunch box")).toEqual(["Cheese paratha roll", "Egg paratha roll", "Plain paratha"]);
    const bbox = slot("Agastya's breakfast box");
    expect(bbox).toMatchObject({ kind: "custom", order: 15, usual_people: ["Agastya"], days: MON_FRI });
    expect(bbox.templates).toEqual([{ parts: [{ from: "Breakfast" }], share: null, said: null }]);
    // A weekday box takes its person off the meal only on its days (planDays): the main meals keep him for the weekend.
    expect(slot("Lunch").usual_people).toEqual([]);
    expect(slot("Breakfast").usual_people).toEqual([]);
  });

  it("extras beside the home lunch are an extras add-on; the carrier stays at Lunch", async () => {
    const { k, slot } = await walk();
    expect(slot("Shiva's lunch box")).toMatchObject({ kind: "addon", addon_of: "Lunch", extras: true, usual_people: ["Shiva"], days: MON_FRI });
    expect(slot("Shiva's lunch box").templates).toEqual([{ parts: [{ items: ["4 boiled eggs"] }, { kind: "Salad", words: "some salad" }], share: null, said: null }]);
    expect(slot("Agastya's lunch box").extras).toBe(false);
    expect(JSON.parse(k.rows("house")[0].setup_state).weekday_lunch).toContainEqual({ person: "Shiva", lunch: "carries", quote: "I carry the home lunch" });
  });

  it("an extras add-on read with no days runs on the days its person carries lunch, never every day (F6, D6)", async () => {
    const box = W_HOME.slots.find((s) => s.name === "Shiva's lunch box")!;
    const home = (days: string[], lunch = W_HOME.weekday_lunch) => ({ ...W_HOME, weekday_lunch: lunch, slots: W_HOME.slots.map((s) => (s === box ? { ...s, days } : s)) });
    // End to end: Shiva carries (his reply), at the office Mon–Fri (household.weekly).
    const { slot } = await walk({ home: home([]) });
    expect(slot("Shiva's lunch box")).toMatchObject({ kind: "addon", extras: true, days: MON_FRI });
    // Pure: the weekly entry's days; no weekly entry is Mon–Fri (as withLunchSaid reads it); days the read gave stay; a person
    // who does not carry lunch leaves it as read.
    const said = familyLines(W_TRANSCRIPT, W_HOUSEHOLD);
    const days = (h: ReturnType<typeof home>, household: unknown) =>
      checkRead(readOf(h, { rules: [] }, { library: [] }), { household: householdOf(household), said }).read.slots.find((s) => s.name === "Shiva's lunch box")?.days as string[] | undefined;
    const weekly = (w: unknown[]) => ({ ...W_HOUSEHOLD, "household.weekly": w });
    expect(days(home([]), weekly([{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed"] }]))).toEqual(["Mon", "Tue", "Wed"]);
    expect(days(home([]), weekly([]))).toEqual(MON_FRI);
    // Days at home are no carrying days (review): office Mon–Wed, home Thu–Fri.
    expect(days(home([]), weekly([{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed"] }, { person: "Shiva", where: "home", weekdays: ["Thu", "Fri"] }])))
      .toEqual(["Mon", "Tue", "Wed"]);
    // Each entry's own lunch, with no reply: only the entry that carries.
    expect(days(home([], []), weekly([{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue"], lunch: "carries" },
      { person: "Shiva", where: "site", weekdays: ["Wed", "Thu"], lunch: "away" }]))).toEqual(["Mon", "Tue"]);
    // household.weekly's own "carries", with nothing said in the replies.
    expect(days(home([], []), weekly([{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue"], lunch: "carries" }]))).toEqual(["Mon", "Tue"]);
    expect(days(home(["Mon", "Wed"]), W_HOUSEHOLD)).toEqual(["Mon", "Wed"]);
    expect(days(home([], [{ person: "Shiva", lunch: "home", quote: "I carry the home lunch" }]), W_HOUSEHOLD)).toEqual([]);
  });

  it("rules naming a kind or a dish get typed targets", async () => {
    const { k } = await walk();
    const rules = k.rows("rules").map((r) => ({ ...r, items: JSON.parse(r.items ?? "null"), targets: JSON.parse(r.targets ?? "null"), gives: JSON.parse(r.gives ?? "null") }));
    const avoid = rules.find((r) => r.what === "avoid" && r.who === "Gowri Shankar")!;
    expect(avoid.targets).toEqual([{ type: "ingredient", tag: "egg" }, { type: "kind", kind: "Salad" }]);
    expect(avoid.items).toEqual(["egg", "salad"]);
    const pancakes = rules.find((r) => r.what === "swap" && r.who === "Agastya")!;
    expect(pancakes.targets).toEqual([{ type: "kind", kind: "Upma" }]);
    expect(pancakes.gives).toEqual({ type: "item", item: "Pancakes", kind: null });
    expect(pancakes.to).toBe("pancakes");
    const paratha = rules.find((r) => r.what === "swap" && r.who === "Gowri Shankar")!;
    expect(paratha.targets).toEqual([{ type: "kind", kind: "Roti" }]);
    expect(paratha.gives).toEqual(resolveGives("paratha"));
    expect(paratha.gives).toEqual({ type: "item", item: "Plain paratha", kind: "Paratha" });
    expect(JSON.parse(paratha.slots)).toEqual(["Dinner"]);
  });

  it("\"no rice at night\" read as avoid [\"rice\"] keeps every rice off: the Rice kind (OD4, F7)", async () => {
    const rice = { hard: true, what: "avoid", who: "Gowri Shankar", items: ["rice"], slots: ["Dinner"], quote: "Dad doesn't eat egg or salad" };
    const { k } = await walk({ rules: { rules: [...W_RULES.rules, rice] } });
    const r = k.rows("rules").find((x) => x.what === "avoid" && JSON.parse(x.items ?? "[]").includes("rice"))!;
    expect(JSON.parse(r.targets)).toEqual([{ type: "kind", kind: "Rice" }, { type: "ingredient", tag: "rice" }]);
    expect(JSON.parse(r.slots)).toEqual(["Dinner"]);
  });

  it("a named dish said with a day and \"sometimes\" keeps both on its template (OD5, F7, D5)", async () => {
    const q = "on saturdays we make egg curry sometimes";
    const f = fake({ home: W_HOME, rules: W_RULES, kinds: W_KINDS, contains: containsOf(), lint: { dishes: [] },
      dishes: { ...W_DISHES, library: [...W_DISHES.library, ["Egg curry", "Dinner", q]], seed: [...W_DISHES.seed, ["Dinner", "Egg curry", q]] },
      often: { often: [...W_OFTEN.often, ["Egg curry", "Dinner", q, q, "sometimes", "Sat"]] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: [...W_TRANSCRIPT, "Q: Anything else?", "A: And on saturdays we make egg curry sometimes."] });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    const dinner = fam.slots.find((s: any) => s.name === "Dinner");
    const egg = dinner.templates.find((t: any) => t.parts.some((p: any) => p.kind === "Egg"));
    expect(egg.parts).toContainEqual(expect.objectContaining({ kind: "Egg", dish: "Egg curry" }));   // {kind, dish} (Task 12 ruling)
    expect(egg).toMatchObject({ share: "sometimes", days: ["Sat"] });
    // The lunch box's rolls keep their "sometimes" (D4).
    const box = fam.slots.find((s: any) => s.name === "Agastya's lunch box");
    expect(box.templates.filter((t: any) => t.share === "sometimes").map((t: any) => t.parts[0].items[0])).toEqual(["Egg paratha roll", "Cheese paratha roll"]);
    expect(r.said).toContain("egg curry (sometimes on Saturdays)");
    expect([keptOften("usually", ["Sat"]), keptOften("rarely", ["Sat"]), keptOften("2/week", ["Mon", "Thu"])])
      .toEqual(["most Saturdays", "now and then on Saturdays", "twice a week, Mon and Thu"]);
  });

  // G1 (N2, D3c): a hard swap's item is the person's rule, never a dish of the meal it is had at, nor of the box that replaces
  // that meal; the library keeps its row (its ingredients are read for the person's rules).
  describe("a hard swap's item is no dish of its meal or box (G1)", () => {
    const qOf = (who: string, to = "puri") => `${to} for ${who} when we make pongal, he won't eat it`;
    const run = async (who: string, said: string, dishes: { library: unknown[][]; seed: unknown[][]; links: unknown[][] }, more: string[] = [],
      over: { often?: unknown[][] } = {}, to = "puri") => {
      const swap = { hard: true, what: "swap", who, items: ["pongal"], to, slots: ["Breakfast"], quote: qOf(said, to) };
      const f = fake({ home: W_HOME, rules: { rules: [...W_RULES.rules, swap] }, contains: containsOf(), lint: { dishes: [] }, often: { often: over.often ?? W_OFTEN.often }, kinds: W_KINDS, dishes });
      const k = await boot({ model: f.model });
      const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: [...W_TRANSCRIPT, "Q: Anything else?", `A: Pongal some days too. And ${qOf(said, to)}.`, ...more] });
      expect(r.ok).toBe(true);
      const fam = (await k.owner("GET", "/api/family")).body;
      return { k, r, slot: (n: string) => fam.slots.find((s: any) => s.name === n) };
    };
    const names = (s: any) => JSON.stringify(s?.templates ?? []).toLowerCase();
    const pongal = ["Pongal", "Breakfast", "Pongal some days too"];
    it("at the meal it is had at: no template part, the library row kept", async () => {
      const { k, slot } = await run("Gowri Shankar", "Dad", { ...W_DISHES, library: [...W_DISHES.library, pongal, ["Puri", "Breakfast", qOf("Dad")]],
        seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]]] });
      expect(names(slot("Breakfast"))).not.toContain("puri");
      expect(names(slot("Breakfast"))).toContain("pongal");
      expect(k.rows("library").some((d) => d.name === "Puri" && d.slot === "Breakfast")).toBe(true);
    });
    it("a dish of the meal in its own right that is also one person's swap item keeps its template (review 1)", async () => {
      const own = "Puri for all of us on Sundays";
      const { k, slot } = await run("Gowri Shankar", "Dad", { ...W_DISHES, library: [...W_DISHES.library, pongal, ["Puri", "Breakfast", own]],
        seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]], ["Breakfast", "Puri", own]] }, [`A: ${own}.`]);
      expect(names(slot("Breakfast"))).toContain("puri");
      expect(k.rows("library").some((d) => d.name === "Puri" && d.slot === "Breakfast")).toBe(true);
      // Read only from the swap's words, but with a how-often of its own: a dish of the meal too.
      const some = "Puri sometimes for everyone too";
      const { slot: s2 } = await run("Gowri Shankar", "Dad", { ...W_DISHES, library: [...W_DISHES.library, pongal, ["Puri", "Breakfast", qOf("Dad")]],
        seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]]] }, [`A: ${some}.`], { often: [...W_OFTEN.often, ["Puri", "Breakfast", some, "sometimes", "sometimes", ""]] });
      expect(names(s2("Breakfast"))).toContain("puri");
    });
    it("a swap to a kind word drops nothing by that word: the meal's dish of that kind stays (review 1)", async () => {
      expect(swapItems([{ what: "swap", hard: true, slots: ["Breakfast"], to: "dosa", gives: resolveGives("dosa"), items: ["pongal"], quote: "q" }]).map((w) => w.keys))
        .toEqual([[dishKey("Plain dosa")]]);   // the item it gives, never the kind word
      expect(swapItems([{ what: "swap", hard: true, slots: ["Breakfast"], to: "upma", gives: { type: "kind", kind: "Upma" }, items: ["pongal"], quote: "q" }])).toEqual([]);
      const { slot } = await run("Gowri Shankar", "Dad", { ...W_DISHES, library: [...W_DISHES.library, pongal], seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]]] }, [], {}, "dosa");
      expect(slot("Breakfast").templates.map((t: any) => t.parts)).toContainEqual([{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }]);
    });
    it("at the box that replaces that meal, linked to it: the box is the meal's whole plate", async () => {
      const { slot } = await run("Agastya", "Agastya", { ...W_DISHES, library: [...W_DISHES.library, pongal, ["Puri", "Agastya's breakfast box", qOf("Agastya")]],
        seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]]] });
      expect(slot("Agastya's breakfast box").templates).toEqual([{ parts: [{ from: "Breakfast" }], share: null, said: null }]);
    });
    it("at that box with no link: no template of it; the box is left to ask, as an empty box is", async () => {
      const { k, slot } = await run("Agastya", "Agastya", { ...W_DISHES, library: [...W_DISHES.library, pongal, ["Puri", "Agastya's breakfast box", qOf("Agastya")]],
        seed: [...W_DISHES.seed, ["Breakfast", "Pongal", pongal[2]]], links: W_DISHES.links.filter((l) => l[0] !== "Agastya's breakfast box") });
      expect(names(slot("Agastya's breakfast box"))).not.toContain("puri");
      expect(slot("Agastya's breakfast box").templates ?? []).toEqual([]);
      expect(k.rows("library").some((d) => d.name === "Puri")).toBe(true);
    });
  });

  it("the cook's limit is a cap on her morning visit", async () => {
    const { k } = await walk();
    const cap = k.rows("rules").find((r) => r.what === "cap")!;
    expect([cap.per_meal, JSON.parse(cap.slots), JSON.parse(cap.days), cap.hard]).toEqual([4, ["Breakfast", "Lunch"], MON_SAT, 1]);
    expect(k.rows("house")[0].cook_wont_make).toBeNull();
    expect(SETUP_PARTS.find((p) => p.id === "rules")!.system).toContain("a cook short of time with a number of dishes is cap { per_meal: the larger number said, slots: that visit's meals }");
    expect(ruleSaid({ what: "cap", per_meal: 4, slots: ["Breakfast", "Lunch"], days: MON_SAT as any, items: null, to: null, frequency: null, fasting_food: null, quote: "" }))
      .toBe("at most 4 dishes in the morning visit");
  });

  it("a cook with no name and no clock time is kept: her days, her visits' meals, her cap; the read-back says \"your cook\" (F5, D10)", async () => {
    const home = { ...W_HOME, cook: { days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }], limits_words: "3-4 dishes in the morning",
      quote: "comes at 7 for breakfast and lunch" } };
    const { k, r, fam } = await walk({ home });
    expect(savedOf(k.kit.db).cook).toMatchObject({ name: null, days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }] });
    expect([fam.house.cook_name, fam.house.cook_days, fam.house.cook_visits]).toEqual([null, MON_SAT, []]);   // the page's visits are timed ones
    expect(r.said).toContain("Your cook cooks Mon–Sat: breakfast and lunch, and dinner");
    expect(r.said).not.toContain("the family cooks");
    expect(r.said).not.toContain(" at undefined");
    // The plan reads her: the morning visit keeps the cap (spec §9.3).
    const visits = visitsOf(listRules(k.kit.db), houseCook(k.kit.db), listSlots(k.kit.db));
    expect(visits.map((v): unknown[] => [v.cook, v.cap, v.days])).toEqual([[null, 4, MON_SAT]]);
    expect(visits[0].meals).toEqual(expect.arrayContaining(["Breakfast", "Lunch"]));
    // A visit with neither a time nor a meal is no visit; a name the model gives stays hers.
    const { k: k2 } = await walk({ home: { ...home, cook: { ...home.cook, name: "Lakshmi", visits: [{ at: "morning" }, { meals: ["Dinner"] }] } } });
    expect(savedOf(k2.kit.db).cook).toMatchObject({ name: "Lakshmi", visits: [{ meals: ["Dinner"] }] });
  });

  it("a correction that says the cook no longer comes removes a cook saved without a name (F5 review)", async () => {
    const NEW = "We don't have a cook any more.";
    const more = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const nameless = { ...W_HOME, cook: { days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }], quote: "comes at 7 for breakfast and lunch" } };
    const f = fake({ home: (req: ModelRequest) => (more(req) ? { ...nameless, cook: null } : nameless), rules: W_RULES, dishes: W_DISHES, often: W_OFTEN, kinds: W_KINDS,
      contains: containsOf(), lint: { dishes: [] } });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: W_TRANSCRIPT });
    expect(savedOf(k.kit.db).cook).not.toBeNull();
    const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: [...W_TRANSCRIPT, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    expect(savedOf(k.kit.db).cook).toBeNull();
    expect(r.said).toContain("No cook.");
  });

  it("the read-back says templates and rules in the family's words", async () => {
    const { r } = await walk();
    expect(r.said).toContain("Agastya: Pancakes when it's upma");
    expect(r.said).toContain("Gowri Shankar: no egg, no salad");
    expect(r.said).toContain("dry sabji");
    expect(r.said).not.toContain("Dry sabji");
    expect(r.said).not.toContain("Agastya: pancake");
  });

  it("a correction that drops a category word (\"no more salad\") removes it from the plates and the read-back (review 1)", async () => {
    const NEW = "No more salad in my lunch box.";
    const more = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const f = fake({ home: W_HOME, rules: W_RULES, often: W_OFTEN, kinds: W_KINDS, contains: containsOf(), lint: { dishes: [] },
      dishes: (req: ModelRequest) => (more(req) ? { ...W_DISHES, library: W_DISHES.library.filter((d) => d[0] !== "Salad"),
        seed: W_DISHES.seed.map((x) => (x[0] === "Shiva's lunch box" ? ["Shiva's lunch box", "4 boiled eggs", extra] : x)) } : W_DISHES) });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: W_TRANSCRIPT });
    const box = () => k.owner("GET", "/api/family").then((x) => x.body.slots.find((s: any) => s.name === "Shiva's lunch box"));
    expect((await box()).templates[0].parts).toContainEqual({ kind: "Salad", words: "some salad" });
    const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: [...W_TRANSCRIPT, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    expect((await box()).templates).toEqual([{ parts: [{ items: ["4 boiled eggs"] }], share: null, said: null }]);
    expect(JSON.parse(k.rows("house")[0].setup_state).categories["Shiva's lunch box"]).toBeUndefined();
    expect(r.said).toContain("Removed: salad at Shiva's lunch box.");
    expect(r.said).toContain("Shiva's lunch box: 4 boiled eggs.");
  });

  it("a correction that changes only a box's link builds the box again (review 1)", async () => {
    const NEW = "Actually his lunch box roll has the dal we make for dinner.";
    const more = (req: ModelRequest) => JSON.parse(req.user).transcript.includes(NEW);
    const f = fake({ home: W_HOME, rules: W_RULES, often: W_OFTEN, kinds: W_KINDS, contains: containsOf(), lint: { dishes: [] },
      dishes: (req: ModelRequest) => (more(req) ? { ...W_DISHES, links: [["Agastya's lunch box", "Dinner", "dal", "his lunch box roll has the dal we make for dinner"], W_DISHES.links[1]] } : W_DISHES) });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: W_TRANSCRIPT });
    const r = await k.op("apply_setup", { household: W_HOUSEHOLD, transcript: [...W_TRANSCRIPT, "Q: Anything to change?", `A: ${NEW}`] });
    expect(r.ok).toBe(true);
    const box = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Agastya's lunch box");
    expect(box.templates[0].parts).toEqual([{ kind: "Paratha", dish: "Plain paratha", words: "paratha" }, { from: "Dinner", kind: "Dal", sub: "Dal" }]);   // the dinner's own dal part
    expect(r.said).toContain("Agastya's lunch box: paratha and the dinner dal");
  });

  it("the speaker is the household's self person; the lists of who looks after what are never read as words", async () => {
    expect(householdOf({ "household.people": [{ name: "Shiva", relation: "self" }], "household.speaker": "" }).speaker).toBe("Shiva");
    const { f } = await walk();
    expect(JSON.parse(f.of("home")[0].user).household["household.mealsBy"]).toEqual([{ person: "Ankita" }]);
  });

  it("the prompts teach links, extras, a filling's item and the box that replaces a meal, with the made-up family", () => {
    const dishes = SETUP_PARTS.find((p) => p.id === "dishes")!, home = SETUP_PARTS.find((p) => p.id === "home")!;
    expect(dishes.system).toContain("A filling or stuffing said with a dish makes a dish of its own, named by the filling and the dish, one row for each filling");
    expect(dishes.system).toContain("A meal the person has beside the home meal is their add-on's");
    expect(dishes.system).toContain("A box with the home meal's dish names a link, not a dish");
    expect(dishes.system).toContain("is their rule's (a swap), never a dish of the meal");
    expect(dishes.system).toContain("links: ");
    expect(JSON.stringify(dishes.schema)).toContain('"links"');
    expect(JSON.stringify(home.schema)).toContain('"extras":{"type":"boolean"}');
    expect(home.system).toContain("extras: true");
  });
  it("teach a box that is the home meal as made (a whole link) and a box dish made with a home part (its own dish and a link) (G2)", () => {
    const dishes = SETUP_PARTS.find((p) => p.id === "dishes")!.system;
    expect(dishes).toContain(`A box that has a home meal as it is made is a link to that meal with kind_words "", never its dishes; a box dish named with a part of a home meal is the box's own dish and a link of that part: the part's words are never in its dish name.`);
    // One worked example, of the whole-meal shape, from Dinner in a made-up family's words: no library or seed row for the box.
    expect(dishes).toContain(`links [["Rahul's dinner box", "Dinner", "", "whatever is cooked that night, as it is"]] and no library or seed row for the box`);
    expect(dishes).not.toContain(`["Rahul's dinner box", "Dinner", "whatever`);   // never a seed row for it
    // Review round 1: no second box example, no flatbread around the day's dish (h18's two-box shape).
    for (const w of ["ira's", "akki roti", "has what we have", "for the whole family", "share of our morning plate"]) expect(dishes.toLowerCase(), w).not.toContain(w);
  });
});

// Round 3 (task 15, §2): what the reads leave out is found by code over the saved shape and re-read once, then asked; never
// guessed. A made-up family (F7): Rahul at the office, Divya, and Ira at school.
describe("setup checks what a read left out (H1-H3)", () => {
  const MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const I_HOUSEHOLD = {
    "household.people": [{ name: "Rahul", relation: "self", group: "adult" }, { name: "Divya", relation: "wife", group: "adult" },
      { name: "Ira", relation: "daughter", group: "child", age: 8 }],
    "household.weekly": [{ person: "Rahul", where: "office", weekdays: MON_FRI }, { person: "Ira", where: "school", weekdays: MON_FRI }],
    "household.speaker": "Rahul",
  };
  const I_TRANSCRIPT = [
    "Q: Rahul is at the office on weekdays. Does he carry lunch?", "A: I carry the home lunch, and a bowl of sprouts beside it.",
    "Q: And Ira on school days?", "A: Ira carries a breakfast box for school. She carries a lunch box.",
    "Q: What did the family have for breakfast last week?", "A: Idli, poha, dosa.",
    "Q: And lunch?", "A: Rice, dal and a sabzi.",
    "Q: And dinner?", "A: Roti, dal and a sabzi.",
    "Q: What goes in Ira's boxes?", "A: The breakfast box is our breakfast. The lunch box has two rotis with the lunch sabzi.",
  ];
  const mains = [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" }];
  const sprouts = { name: "Rahul's lunch", kind: "addon", addon_of: "Lunch", usual_people: ["Rahul"], extras: true, quote: "a bowl of sprouts beside it" };
  const bbox = { name: "Ira's breakfast box", kind: "custom", usual_people: ["Ira"], days: MON_FRI, instead_of: "Breakfast", home_meal: "as_made",
    quote: "Ira carries a breakfast box for school" };
  const lbox = { name: "Ira's lunch box", kind: "custom", usual_people: ["Ira"], days: MON_FRI, instead_of: "Lunch", home_meal: "a_part", home_part: "sabzi",
    quote: "She carries a lunch box" };
  const I_LUNCH = [{ person: "Rahul", lunch: "carries", quote: "I carry the home lunch" }];
  const noBoxes = { slots: [...mains, sprouts], weekday_lunch: I_LUNCH };
  const withBoxes = { slots: [...mains, sprouts, bbox, lbox], weekday_lunch: I_LUNCH };
  const lq = "Rice, dal and a sabzi", dq = "Roti, dal and a sabzi", bq = "Idli, poha, dosa";
  const I_DISHES = {
    library: [["Idli", "Breakfast", bq], ["Poha", "Breakfast", bq], ["Dosa", "Breakfast", bq], ["Rice", "Lunch", lq], ["Dal", "Lunch", lq], ["Sabzi", "Lunch", lq],
      ["Roti", "Dinner", dq], ["Dal", "Dinner", dq], ["Sabzi", "Dinner", dq], ["Roti", "Ira's lunch box", "two rotis with the lunch sabzi"],
      ["Sprouts", "Rahul's lunch", "a bowl of sprouts"]],
    seed: [["Breakfast", "Idli", bq], ["Breakfast", "Poha", bq], ["Breakfast", "Dosa", bq], ["Lunch", "Rice, Dal, Sabzi", lq], ["Dinner", "Roti, Dal, Sabzi", dq]],
    links: [["Ira's breakfast box", "Breakfast", "", "The breakfast box is our breakfast"], ["Ira's lunch box", "Lunch", "sabzi", "with the lunch sabzi"]],
  };
  const iFake = (over: Partial<Record<Part, unknown>> = {}) =>
    fake({ home: withBoxes, rules: { rules: [] }, dishes: I_DISHES, often: { often: [] }, contains: containsOf(), lint: { dishes: [] }, kinds: { dishes: [] }, ...over });
  const run = async (over: Partial<Record<Part, unknown>> = {}, transcript = I_TRANSCRIPT) => {
    const f = iFake(over);
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: I_HOUSEHOLD, transcript });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    return { f, k, r, fam, slot: (n: string) => fam.slots.find((s: any) => s.name === n) };
  };
  /** The checked read of a home answer, against these sentences. */
  const checkedHome = (home: unknown, sentences: string[], household: unknown = I_HOUSEHOLD) =>
    checkRead(readOf(home, { rules: [] }, { library: [] }), { household: householdOf(household), said: sentences, sentences }).read;

  // H1: the home read is checked and re-read once (A1, A7).
  const boxSentences = ["ira carries a breakfast box for school", "she carries a lunch box", "a bowl of sprouts beside it"];
  it("homeViolations finds a named box with no slot", () => {
    const read = checkedHome(noBoxes, boxSentences);
    expect(homeViolations(read, { household: householdOf(I_HOUSEHOLD), sentences: boxSentences }).map((v) => v.missing))
      .toEqual(["breakfast box (Ira)", "lunch box (Ira)"]);
    // Each box with its slot: nothing missing.
    expect(homeViolations(checkedHome(withBoxes, boxSentences), { household: householdOf(I_HOUSEHOLD), sentences: boxSentences })
      .filter((v) => /box/.test(v.missing))).toEqual([]);
  });
  it("homeViolations finds an extras add-on with no carrying days", () => {
    const household = { ...I_HOUSEHOLD, "household.weekly": [{ person: "Ira", where: "school", weekdays: MON_FRI }] };
    const read = checkedHome({ slots: [...mains, sprouts] }, ["a bowl of sprouts beside it"], household);
    expect(read.slots.find((s) => s.name === "Rahul's lunch")!.days).toEqual([]);
    const v = homeViolations(read, { household: householdOf(household), sentences: ["a bowl of sprouts beside it"] });
    expect(v).toHaveLength(1);
    expect(v[0].missing).toContain("Rahul");
    expect(v[0].ask).toContain("Rahul");
  });
  it("homeViolations: a box said in the first person is the speaker's, never pinned on the only child (fix 1)", () => {
    const ctx = (sentences: string[]) => ({ household: householdOf(I_HOUSEHOLD), sentences });
    const read = checkedHome(noBoxes, ["i carry my lunch box with two eggs", "a bowl of sprouts beside it"]);
    // Rahul (the speaker, a grown-up) carries his box: no box slot of Ira's is asked for.
    expect(homeViolations(read, ctx(["i carry my lunch box with two eggs"]))).toEqual([]);
    expect(homeViolations(read, ctx(["my lunch box has sprouts"]))).toEqual([]);
    // A third person with no name is still the only child.
    expect(homeViolations(read, ctx(["she carries a lunch box"])).map((v) => v.missing)).toEqual(["lunch box (Ira)"]);
  });
  it("homeViolations: a first-person sentence about a child's box is the child's (fix round 2)", () => {
    const ctx = (sentences: string[], household: unknown = I_HOUSEHOLD) => ({ household: householdOf(household), sentences });
    const read = checkedHome(noBoxes, ["a bowl of sprouts beside it"]);
    expect(homeViolations(read, ctx(["i pack a lunch box for the kid"])).map((v) => v.missing)).toEqual(["lunch box (Ira)"]);
    expect(homeViolations(read, ctx(["my son carries a breakfast box"])).map((v) => v.missing)).toEqual(["breakfast box (Ira)"]);
    expect(homeViolations(read, ctx(["i give her a tiffin"])).map((v) => v.missing)).toEqual(["tiffin (Ira)"]);
    expect(homeViolations(read, ctx(["i carry my lunch box"]))).toEqual([]);
    // Two children and no name: the box with no person, and the question asks whose it is.
    const two = { ...I_HOUSEHOLD, "household.people": [...I_HOUSEHOLD["household.people"], { name: "Arjun", relation: "son", group: "child", age: 5 }] };
    const v = homeViolations(checkedHome(noBoxes, ["a bowl of sprouts beside it"], two), ctx(["i pack a lunch box for the kids"], two));
    expect(v.map((x) => x.missing)).toEqual(["lunch box"]);
    expect(v[0].ask).toBe("Who carries the lunch box, and what goes in it?");
  });
  it("homeViolations: a bare box word is any box of that person's (fix 5)", () => {
    const ctx = (sentences: string[]) => ({ household: householdOf(I_HOUSEHOLD), sentences });
    const read = checkedHome(withBoxes, boxSentences);
    for (const s of ["her box has a sandwich", "ira takes a tiffin", "the dabba comes back empty"]) expect(homeViolations(read, ctx([s])), s).toEqual([]);
    // With no box of hers, a bare box word is still missing.
    expect(homeViolations(checkedHome(noBoxes, boxSentences), ctx(["her box has a sandwich"])).map((v) => v.missing)).toEqual(["box (Ira)"]);
  });
  it("applySetup re-reads the home part once", async () => {
    const { f, slot } = await run({ home: (_req: ModelRequest, n: number) => (n === 1 ? noBoxes : withBoxes) });
    expect(f.of("home")).toHaveLength(2);
    expect(JSON.parse(f.of("home")[1].user).missing).toEqual(["breakfast box (Ira)", "lunch box (Ira)"]);
    expect(f.of("home")[1].system).toContain("A list `missing` names what your last answer left out: write it.");
    expect(slot("Ira's breakfast box")).toMatchObject({ kind: "custom", usual_people: ["Ira"], days: MON_FRI });
    expect(slot("Ira's lunch box")).toMatchObject({ kind: "custom", usual_people: ["Ira"], days: MON_FRI });
  });
  it("applySetup asks when the re-read still misses the box", async () => {
    const { f, r, fam } = await run({ home: noBoxes });
    expect(f.of("home")).toHaveLength(2);
    expect(r.said).toContain("Does Ira carry a breakfast box to school, and what goes in it?");
    expect(r.said).toContain("Does Ira carry a lunch box to school, and what goes in it?");
    expect(fam.slots.filter((s: any) => /box/i.test(s.name))).toEqual([]);
  });
  it("applySetup asks for the carrying days an extras add-on lacks, and saves no add-on for every day", async () => {
    const household = { ...I_HOUSEHOLD, "household.weekly": [{ person: "Ira", where: "school", weekdays: MON_FRI }] };
    const f = iFake({ home: { slots: [...mains, sprouts, bbox, lbox] } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household, transcript: I_TRANSCRIPT });
    expect(f.of("home")).toHaveLength(2);
    expect(r.said).toContain("Which days does Rahul take");
    expect((await k.owner("GET", "/api/family")).body.slots.some((s: any) => s.name === "Rahul's lunch")).toBe(false);
  });
  it("an extras add-on's carrying days have one home, its own days, in the prompt and the check: a re-read that gives them clears it (fix 4)", async () => {
    const home = SETUP_PARTS.find((p) => p.id === "home")!.system;
    expect(home).toContain("An extras add-on's carrying days are its own days, never weekday_lunch");
    const household = { ...I_HOUSEHOLD, "household.weekly": [{ person: "Ira", where: "school", weekdays: MON_FRI }] };
    const read = checkedHome({ slots: [...mains, sprouts] }, ["a bowl of sprouts beside it"], household);
    expect(homeViolations(read, { household: householdOf(household), sentences: [] })[0].missing).toBe("the days of Rahul's lunch: the days Rahul carries it (its days)");
    const f = iFake({ home: (_req: ModelRequest, n: number) => ({ slots: [...mains, n === 1 ? sprouts : { ...sprouts, days: ["Mon", "Wed"] }, bbox, lbox] }) });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household, transcript: I_TRANSCRIPT });
    expect(f.of("home")).toHaveLength(2);
    expect(r.said).not.toContain("Which days does Rahul take");
    expect((await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Rahul's lunch")).toMatchObject({ extras: true, days: ["Mon", "Wed"] });
  });
  it("the home re-read is merged: what the first read had and the re-read leaves out is kept (fix 2)", async () => {
    const dinner = { name: "Dinner", kind: "main", skip_days: [{ day: "Sun", skip: "ordered_in" }], quote: "Sunday dinner we order in" };
    const snack = { name: "Evening snack", kind: "custom", after: "Lunch", quote: "we all have a snack at 5" };
    const cook = { name: "Sunita", days: MON_FRI, visits: [{ at: "08:00", meals: ["Breakfast", "Lunch"] }], quote: "Sunita comes at 8" };
    const first = { slots: [mains[0], mains[1], dinner, sprouts, snack], cook, weekday_lunch: I_LUNCH };
    // The re-read gives the boxes and Dinner again, but no skip day, no snack, no cook and no weekday lunch.
    const second = { slots: [...mains, sprouts, bbox, lbox] };
    const { f, k, fam, slot } = await run({ home: (_req: ModelRequest, n: number) => (n === 1 ? first : second) },
      [...I_TRANSCRIPT, "Q: Anything else?", "A: Sunday dinner we order in. Sunita comes at 8, and we all have a snack at 5."]);
    expect(f.of("home")).toHaveLength(2);
    expect(slot("Ira's breakfast box")).toBeTruthy();
    expect(slot("Ira's lunch box")).toBeTruthy();
    expect(slot("Dinner").skip_days).toEqual([{ day: "Sun", skip: "ordered_in" }]);
    expect(slot("Evening snack")).toBeTruthy();
    expect(slot("Rahul's lunch")).toMatchObject({ kind: "addon", extras: true, days: MON_FRI });
    expect([fam.house.cook_name, fam.house.cook_days]).toEqual(["Sunita", MON_FRI]);
    expect(JSON.parse(k.rows("house")[0].setup_state).weekday_lunch).toEqual(I_LUNCH);
  });
  // The first dishes read had no box to put the roll in, so it put it on Lunch.
  const rollSaid = "Her lunch box has a paratha roll";
  const rollTranscript = [...I_TRANSCRIPT, "Q: Anything else?", `A: ${rollSaid}.`];
  const noBoxDishes = { ...I_DISHES, library: [...I_DISHES.library.filter((d) => !/box/.test(d[1])), ["Paratha roll", "Lunch", rollSaid]], links: [] };
  const boxDishes = { ...I_DISHES, library: [...I_DISHES.library, ["Paratha roll", "Ira's lunch box", rollSaid]] };
  it("a box the home re-read adds has the dishes read again once, so its dish moves to the box (fix 3)", async () => {
    const { f, slot } = await run({ home: (_req: ModelRequest, n: number) => (n === 1 ? noBoxes : withBoxes),
      dishes: (_req: ModelRequest, n: number) => (n === 1 ? noBoxDishes : boxDishes), kinds: ownKinds }, rollTranscript);
    expect(f.of("dishes")).toHaveLength(2);
    const again = JSON.parse(f.of("dishes")[1].user);
    expect(again.meals).toEqual(expect.arrayContaining(["Ira's breakfast box", "Ira's lunch box", "Lunch"]));
    // The sentences no first-read quote cites join this same re-read (H15).
    expect(again.missing).toEqual(["what goes in Ira's breakfast box", "what goes in Ira's lunch box", "the breakfast box is our breakfast",
      "the lunch box has two rotis with the lunch sabzi"]);
    expect(f.of("dishes")[1].system).toContain("A list `meals`, when given, is the family's meals as read");
    expect(JSON.stringify(slot("Ira's lunch box").templates).toLowerCase()).toContain("paratha roll");
    expect(JSON.stringify(slot("Lunch").templates).toLowerCase()).not.toContain("paratha roll");
  });
  it("with no time to read the dishes again, a box the home re-read adds is asked about (fix 3, OD7)", async () => {
    // The home re-read takes the time: the dishes are not read again.
    const slow = async (_req: ModelRequest, n: number) => { if (n === 1) return noBoxes; await Bun.sleep(150); return withBoxes; };
    const f = iFake({ home: slow, dishes: noBoxDishes });
    const k = await boot({ model: f.model, setupBudgetMs: 32_100 });
    const r = await k.op("apply_setup", { household: I_HOUSEHOLD, transcript: rollTranscript });
    expect(f.of("home")).toHaveLength(2);
    expect(f.of("dishes")).toHaveLength(1);
    expect(r.asks).toEqual(expect.arrayContaining(["What goes in Ira's breakfast box: the family's breakfast as made, or something of its own?",
      "What goes in Ira's lunch box: the family's lunch as made, or something of its own?"]));
  });

  // H3: a box says whether it carries the home meal, as a field (A8, A9; also the A5 base).
  const boxOnly = (over: Record<string, unknown>) => checkedHome({ slots: [...mains, { ...bbox, ...over }] }, boxSentences);
  it("checkRead: home_meal as_made makes a whole link", () => {
    expect(boxOnly({ home_meal: "as_made" }).links).toEqual([{ slot: "Ira's breakfast box", from: "Breakfast", words: "", quote: bbox.quote }]);
    // A link the dishes read gave for the box stands; none is added beside it.
    const read = checkRead(readOf({ slots: [...mains, bbox] }, { rules: [] }, { library: [], links: [["Ira's breakfast box", "Breakfast", "", "ira carries a breakfast box"]] }),
      { household: householdOf(I_HOUSEHOLD), said: boxSentences, sentences: boxSentences }).read;
    expect(read.links).toEqual([{ slot: "Ira's breakfast box", from: "Breakfast", words: "", quote: "ira carries a breakfast box" }]);
  });
  it("checkRead: home_meal a_part makes a kind link", () => {
    expect(boxOnly({ home_meal: "a_part", home_part: "sabzi" }).links).toEqual([{ slot: "Ira's breakfast box", from: "Breakfast", words: "sabzi", quote: bbox.quote }]);
    expect(boxOnly({ home_meal: "none" }).links).toEqual([]);
  });
  it("homeViolations: a box in place of a meal with no home_meal is left out (re-read, never asked by itself)", () => {
    const v = homeViolations(boxOnly({ home_meal: undefined }), { household: householdOf(I_HOUSEHOLD), sentences: ["ira carries a breakfast box for school"] });
    expect(v).toEqual([{ missing: "home_meal of Ira's breakfast box: the family's breakfast as made, a part of it (home_part), or none" }]);
    expect(homeViolations(boxOnly({ home_meal: "a_part" }), { household: householdOf(I_HOUSEHOLD), sentences: [] })).toHaveLength(1);
    expect(homeViolations(boxOnly({ home_meal: "none" }), { household: householdOf(I_HOUSEHOLD), sentences: [] })).toEqual([]);
  });
  it("the home re-read is taken when it clears a box, though it leaves home_meal out", async () => {
    const { f, slot } = await run({ home: (_req: ModelRequest, n: number) => (n === 1 ? noBoxes : { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: undefined }, lbox] }) });
    expect(f.of("home")).toHaveLength(2);
    expect(slot("Ira's breakfast box")).toBeTruthy();
  });

  // The swap: Ira has cheese toast in place of pongal, at breakfast and so in her breakfast box. Named apart as well.
  const swapQ = "Ira won't eat pongal, so cheese toast for her when there is pongal";
  const swap = { hard: true, what: "swap", who: "Ira", items: ["pongal"], to: "cheese toast", slots: ["Breakfast", "Ira's breakfast box"], quote: swapQ };
  const toastDishes = (box: unknown[][] = [["Cheese toast", "Ira's breakfast box", "cheese toast for her"]]) =>
    ({ ...I_DISHES, library: [...I_DISHES.library, ["Pongal", "Breakfast", "Pongal some days"], ...box], links: I_DISHES.links.filter((l) => l[0] !== "Ira's breakfast box") });
  const toastTranscript = [...I_TRANSCRIPT, "Q: Anything else?", `A: Pongal some days. ${swapQ}. Cheese toast is quick on busy days too.`];
  const boxAsk = "What goes in Ira's breakfast box: the family's breakfast as made, or something of its own?";
  it("writeKinds: a box whose only dish is a swap's item is asked about", async () => {
    const { r, k, slot } = await run({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [swap] }, dishes: toastDishes() },
      toastTranscript);
    expect(r.asks).toContain(boxAsk);
    expect(r.said).toContain(boxAsk);
    expect(slot("Ira's breakfast box").templates ?? []).toEqual([]);
    expect(k.rows("library").some((d) => d.name === "Cheese toast")).toBe(true);
    // Kept on the box as a dish in its own right (its own how often), it is still only the swap's item for Ira: asked all the same.
    const busy = "Cheese toast is quick on busy days too";
    const kept = await run({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [swap] },
      dishes: toastDishes([["Cheese toast", "Ira's breakfast box", busy]]), often: { often: [["Cheese toast", "Ira's breakfast box", busy, "on busy days", "sometimes", ""]] } }, toastTranscript);
    expect(kept.r.asks).toContain(boxAsk);
    expect(kept.slot("Ira's breakfast box").templates ?? []).toEqual([]);
  });
  it("an empty box is asked about once, by setup: the plan made after it asks nothing more of it (fix 6)", async () => {
    const f = iFake({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [swap] }, dishes: toastDishes() });
    const k = await boot({ model: f.model, now: () => new Date(2026, 10, 29, 11, 0) });
    const r = await k.op("apply_setup", { household: I_HOUSEHOLD, transcript: toastTranscript });
    expect(r.asks.filter((a: string) => a.includes("Ira's breakfast box"))).toEqual([boxAsk]);
    const plan = await k.op("make_plan", { week_start: "2026-11-30" });
    expect(plan.ok).toBe(true);
    // No question of the plan's names the box: it is only listed, with nothing in it (no filler).
    expect(JSON.stringify(plan.asked ?? [])).not.toContain("breakfast box");
    const lines = String(plan.message).split("\n").filter((l) => l.includes("breakfast box"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toBe("Ira's breakfast box: nothing planned");
    expect(k.rows("slot_days").filter((d) => d.slot === "Ira's breakfast box" && d.date).flatMap((d) => k.rows("slot_dishes").filter((x) => x.slot_day_id === d.id))).toEqual([]);
  });
  it("a box with no link and only a swap's item is re-read once from the dishes, naming the box", async () => {
    const box = (n: number) => toastDishes(n === 1 ? undefined : [["Cheese toast", "Ira's breakfast box", "cheese toast for her"], ["Sandwich", "Ira's breakfast box", "a sandwich"]]);
    const { f, r, slot } = await run({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [swap] },
      dishes: (_req: ModelRequest, n: number) => box(n) }, [...toastTranscript, "A: Or a sandwich."]);
    expect(f.of("dishes")).toHaveLength(2);
    // The sentences no quote cites join this same re-read (H15).
    expect(JSON.parse(f.of("dishes")[1].user).missing).toEqual(["what goes in Ira's breakfast box", "ira carries a breakfast box for school", "she carries a lunch box",
      "the breakfast box is our breakfast", "cheese toast is quick on busy days too", "or a sandwich"]);
    expect(f.of("dishes")[1].system).toContain("A list `missing` names what your last answer left out: write it.");
    expect(JSON.stringify(slot("Ira's breakfast box").templates).toLowerCase()).toContain("sandwich");
    expect(r.asks).not.toContain(boxAsk);
    // A box with its link needs no re-read.
    const { f: f2 } = await run();
    expect(f2.of("dishes").slice(1).flatMap((x) => JSON.parse(x.user).missing as string[]).filter((m) => m.startsWith("what goes in"))).toEqual([]);
  });

  // H15: each meal sentence that names food is written down (A10).
  const puriSaid = "Her lunch box is usually puri rolled around the sabzi", variantSaid = "Or sometimes with paneer or egg inside it";
  const puriTranscript = [...I_TRANSCRIPT, "Q: Anything else?", `A: ${puriSaid}. ${variantSaid}.`];
  const puriRow = ["Puri", "Ira's lunch box", puriSaid];
  const variantRows = [["Paneer puri", "Ira's lunch box", "sometimes with paneer or egg inside it"], ["Egg puri", "Ira's lunch box", "sometimes with paneer or egg inside it"]];
  const puriDishes = (variants: boolean) => ({ ...I_DISHES, library: [...I_DISHES.library, puriRow, ...(variants ? variantRows : [])] });
  const puriOften = { often: variantRows.map((r) => [...r, "sometimes", "sometimes"]) };
  const variant = plainWords(variantSaid);
  it("uncited finds the variant sentence", () => {
    const sentences = ["his box is usually puri rolled around the sabzi", "or sometimes with paneer or egg inside it"];
    const read = readOf(null, { rules: [] }, { library: [["Puri", "Lunch", "his box is usually puri rolled around the sabzi"]] });
    expect(uncited(read, sentences)).toEqual(["or sometimes with paneer or egg inside it"]);
    // A quote that holds the sentence cites it too; a sentence naming no food is never asked about.
    const both = readOf(null, { rules: [] }, { library: [["Puri", "Lunch", "His box is usually puri rolled around the sabzi. Or sometimes with paneer or egg inside it"]] });
    expect(uncited(both, sentences)).toEqual([]);
    expect(uncited(read, [sentences[0], "we are four at home"])).toEqual([]);
  });
  it("applySetup re-reads the dishes once for an uncited sentence", async () => {
    const { f, k } = await run({ dishes: (_req: ModelRequest, n: number) => puriDishes(n > 1), often: puriOften, kinds: ownKinds }, puriTranscript);
    expect(f.of("dishes")).toHaveLength(2);
    expect(JSON.parse(f.of("dishes")[1].user).missing).toContain(variant);
    const saved = lib(k);
    expect(saved["Paneer puri@Ira's lunch box"]).toMatchObject({ frequency: "sometimes" });
    expect(saved["Egg puri@Ira's lunch box"]).toMatchObject({ frequency: "sometimes" });
    expect(Object.keys(saved).filter((x) => x.startsWith("Puri@"))).toEqual(["Puri@Ira's lunch box"]);
  });
  it("an uncited sentence still unwritten after its re-read is logged, never guessed", async () => {
    const lines: string[] = [], was = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    let out: Awaited<ReturnType<typeof run>>;
    try { out = await run({ dishes: puriDishes(false), often: puriOften, kinds: ownKinds }, puriTranscript); } finally { console.log = was; }
    expect(out.f.of("dishes")).toHaveLength(2);
    expect(lines.some((l) => l.includes("still not written down") && l.includes(variant))).toBe(true);
    expect(Object.keys(lib(out.k)).filter((x) => /paneer|egg/i.test(x))).toEqual([]);
  });
  it("one dishes re-read only: an uncited sentence joins the re-read for a box the home re-read adds (fix 3)", async () => {
    const first = { ...noBoxDishes, library: [...noBoxDishes.library, ["Puri", "Lunch", puriSaid]] };
    const { f, k } = await run({ home: (_req: ModelRequest, n: number) => (n === 1 ? noBoxes : withBoxes),
      dishes: (_req: ModelRequest, n: number) => (n === 1 ? first : puriDishes(true)), often: puriOften, kinds: ownKinds }, puriTranscript);
    expect(f.of("dishes")).toHaveLength(2);
    expect(JSON.parse(f.of("dishes")[1].user).missing).toEqual(expect.arrayContaining(["what goes in Ira's lunch box", variant]));
    expect(lib(k)["Paneer puri@Ira's lunch box"]).toBeTruthy();
  });
  it("one dishes re-read only: an uncited sentence joins the re-read for an empty box (H3)", async () => {
    const boxRows = [["Cheese toast", "Ira's breakfast box", "cheese toast for her"], ["Sandwich", "Ira's breakfast box", "a sandwich"]];
    const box = (n: number) => { const d = toastDishes(n === 1 ? undefined : boxRows); return { ...d, library: [...d.library, puriRow, ...(n === 1 ? [] : variantRows)] }; };
    const { f, k, slot } = await run({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [swap] },
      dishes: (_req: ModelRequest, n: number) => box(n), often: puriOften, kinds: ownKinds }, [...toastTranscript, "A: Or a sandwich.", `A: ${puriSaid}. ${variantSaid}.`]);
    expect(f.of("dishes")).toHaveLength(2);
    expect(JSON.parse(f.of("dishes")[1].user).missing).toEqual(expect.arrayContaining(["what goes in Ira's breakfast box", variant]));
    expect(JSON.stringify(slot("Ira's breakfast box").templates).toLowerCase()).toContain("sandwich");
    expect(lib(k)["Egg puri@Ira's lunch box"]).toBeTruthy();
  });

  // H2: a swap item is off a meal's templates by the family's sentences, not by the reader's fields (A8, A9).
  const packQ = "bread toast for her breakfast in case we make pongal";
  const packSwap = { quote: packQ, items: ["pongal"] };
  const packSentences = ["sometimes we pack ira bread toast for her breakfast in case we make pongal since she doesnt like it", "ira carries a breakfast box"];
  it("swapOnly: how-often from the swap's own sentence does not keep the dish", () => {
    // The dish's "sometimes" sits in the swap's own sentence: no sentence names it apart.
    expect(swapOnly("Bread toast", packSentences, packSwap)).toBe(true);
  });
  it("swapOnly: a dish named in another sentence stays", () => {
    expect(swapOnly("Bread toast", [...packSentences, "bread toast on busy days"], packSwap)).toBe(false);
    expect(swapOnly("Bread toast", ["ira carries a breakfast box"], packSwap)).toBe(false);   // named nowhere: no sign it is the swap's alone
  });
  it("writeKinds: a box's library dish with how-often from the swap's own sentence is on no box template; its library row stays", async () => {
    // An item the swap gives (a kind word like "bread toast" gives no item: the meal's dish of that kind stays, review 1).
    const said = "Sometimes we pack Ira cheese toast for her breakfast in case we make pongal since she doesnt like it";
    const q = "cheese toast for her breakfast in case we make pongal";
    const sw = { hard: true, what: "swap", who: "Ira", items: ["pongal"], to: "cheese toast", slots: ["Breakfast", "Ira's breakfast box"], quote: q };
    const { k, slot } = await run({ home: { ...withBoxes, slots: [...mains, sprouts, { ...bbox, home_meal: "none" }, lbox] }, rules: { rules: [sw] },
      dishes: { ...I_DISHES, library: [...I_DISHES.library, ["Pongal", "Breakfast", "Pongal some days"], ["Cheese toast", "Ira's breakfast box", q], ["Sandwich", "Ira's breakfast box", "a sandwich"]],
        links: I_DISHES.links.filter((l) => l[0] !== "Ira's breakfast box") },
      often: { often: [["Cheese toast", "Ira's breakfast box", q, "Sometimes", "sometimes", ""]] } },
    [...I_TRANSCRIPT, "Q: Anything else?", `A: Pongal some days. ${said}. Or a sandwich.`]);
    const box = JSON.stringify(slot("Ira's breakfast box").templates).toLowerCase();
    expect(box).toContain("sandwich");
    expect(box).not.toContain("cheese toast");
    expect(k.rows("library").some((d) => d.name === "Cheese toast" && d.slot === "Ira's breakfast box")).toBe(true);
  });
});

describe("apply_setup v2: the prompts", () => {
  it("teach every rule shape and frequency, with the example family", () => {
    for (const shape of ["avoid {", "only {", "swap {", "require {", "cap {", "fasting {", "note {"]) expect(SETUP_SYSTEM, shape).toContain(shape);
    expect(SETUP_PARTS.find((p) => p.id === "dishes")!.system).toContain("[name, slot, quote]");
    expect(SETUP_PARTS.find((p) => p.id === "often")!.system).toContain("[name, slot, quote, often, frequency, days]");
    expect(SETUP_PARTS.find((p) => p.id === "often")!.system).toContain("daily");
    expect(SETUP_SYSTEM).toContain("never a nickname");
  });
  it("read a person's own meal in place of the family's as instead, and a meal ordered in for some as its skip when the others have their own (classes 3, 4)", () => {
    const home = SETUP_PARTS.find((p) => p.id === "home")!;
    expect(JSON.stringify(home.schema)).toContain('"instead_of":{"type":"string","enum":["Breakfast","Lunch","Dinner"]}');
    expect(JSON.stringify(home.schema)).not.toContain('"instead":');
    expect(home.system).toContain("instead_of: the main meal such a meal is eaten in place of, when the person does not eat that meal at all");
    expect(home.system).toContain("it is that meal's skip all the same when the others at home have their own meal in its place that day");
  });
  it("read a school box as in place of Lunch unless it is a breakfast box, and each box the family names as its own slot (F1, D2, D3a)", () => {
    const home = SETUP_PARTS.find((p) => p.id === "home")!;
    expect(home.system).not.toContain("(a tiffin: Breakfast");
    expect(home.system).toContain("a school tiffin or lunch box is instead_of Lunch, unless the family calls it a breakfast box");
    expect(home.system).toContain("Each box the family names is its own slot: a breakfast box and a lunch box are two slots, also for one child.");
  });
  it("read a dish joined to a list with its own words as that dish's, at any meal (class 5: every day at someone's own dinner)", () => {
    expect(SETUP_PARTS.find((p) => p.id === "often")!.system).toContain("A dish joined to a list with its own words, at any meal and for anyone");
  });
  it("read who a pronoun is, a person's own staple, a swap tied to a dish being made, no rice as the kind, a variant's and a day's frequency (F7, G2)", () => {
    const rules = SETUP_PARTS.find((p) => p.id === "rules")!.system, often = SETUP_PARTS.find((p) => p.id === "often")!.system;
    const dishes = SETUP_PARTS.find((p) => p.id === "dishes")!.system;
    // D1: a pronoun is the person the replies name for that same food.
    expect(rules).toContain(`A "he" or "she" is the person the replies name for that same food.`);
    expect(rules).toContain("Words saying the others eat it give nobody else the rule, and there is never a rule against a food the replies say that person eats.");
    // D3b: one person's staple differing from the others' is a hard swap at that meal.
    expect(rules).toContain("A staple named for one person at a meal that differs from the others' (their bread or rice where the rest have another) is a hard swap for that person at that meal");
    // D3c: a swap tied to another dish being made is hard; a frequency word there is how often that dish comes.
    expect(rules).toContain("A swap tied to another dish being made (the person has their own dish on the days that dish is made) is hard");
    expect(rules).toContain("A frequency word said with it tells how often that dish comes, never a soft swap.");
    // D9 / OD4: "no rice" names the Rice kind.
    expect(rules).toContain(`"No rice at night" is avoid ["rice"]`);
    expect(rules).not.toContain(`"No rice at night" is avoid ["white_rice"]`);
    // D4: a variant said with a frequency word is its own dish with it; D5: weekdays and a frequency word both kept, from any reply.
    expect(often).toContain("A variant said with a frequency word (a filling, topping or side the dish has only \"sometimes\") is its own dish with those words");
    expect(often).toContain("A dish said with weekdays and a frequency word keeps both: its frequency and its days");
    expect(often).toContain("A dish told in any reply has its row");
    // Review: no trigger phrase or sentence shape lifted from an eval household.
    for (const w of ["in case we make", "when we make", "who eats differently", "egg inside", "pancakes", "rest of us rotis", "rolled with", "cheese inside", "paneer inside", "what we make for", "has what we have", "for the whole family", "puri wrapped", "puri sabzi", "sabji that we make", "folded over", "morning box", "wrapped around", "breakfast box", "the day's sabzi"]) {
      expect(rules.toLowerCase(), w).not.toContain(w);
      expect(often.toLowerCase(), w).not.toContain(w);
      expect(dishes.toLowerCase(), w).not.toContain(w);
    }
  });
  it("read whether a box in place of a meal carries the home meal, as a field (H3)", () => {
    const home = SETUP_PARTS.find((p) => p.id === "home")!;
    expect(JSON.stringify(home.schema)).toContain('"home_meal":{"type":"string","enum":["as_made","a_part","none"]}');
    expect(JSON.stringify(home.schema)).toContain('"home_part":{"type":"string"}');
    expect(home.system).toContain("home_meal: on a custom meal with instead_of, always:");
    expect(SETUP_PARTS.find((p) => p.id === "dishes")!.system).toContain("A list `missing` names what your last answer left out: write it.");
  });
  it("never name an eval household's people, cook or surname", () => {
    // A cook the family gives no name is written by the role word ("Cook", h18): that word is no name to keep out.
    for (const h of HOUSEHOLDS) for (const name of [...h.truth.people.map((p) => p.name), ...(h.truth.cook && !/^cook$/i.test(h.truth.cook.name) ? [h.truth.cook.name] : [])])
      expect(SETUP_SYSTEM, `${h.id} ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
    for (const name of ["Sharma", "Iyer", "Shiva", "Reddy", "Agarwal", "Kulkarni", "Menon", "Banerjee", "Ankita", "Agastya", "Gowri"])
      expect(SETUP_SYSTEM, name).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  });
});

describe("the often read's own deadline, and its fallback (H5)", () => {
  const FAM = { "household.people": [{ name: "Omkar", group: "adult" }, { name: "Devika", group: "adult" }], "household.speaker": "Omkar" };
  const T = [
    "Q: What do you have for dinner?",
    "A: Dinner is rice and dal. On Saturdays we make egg curry sometimes. If we make egg curry, we skip the dal.",
  ];
  const SLOTS = [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" }];
  const DISHES = { library: [["Rice", "Dinner", "Dinner is rice and dal"], ["Dal", "Dinner", "Dinner is rice and dal"], ["Egg curry", "Dinner", "If we make egg curry"]],
    seed: [["Dinner", "Rice, Dal", "Dinner is rice and dal"]] };

  it("checkRead: with the often read failed, a dish named in a day sentence is linted", () => {
    const sentences = familySentences(T, FAM), said = familyLines(T, FAM), household = householdOf(FAM);
    const read = readOf({ slots: SLOTS }, {}, DISHES);
    // The often read answered: only a dish whose own quote has a day or a count is linted (Egg curry's has neither).
    expect(checkRead(read, { household, said, sentences }).lint.map((d) => d.name)).toEqual([]);
    // It failed: every dish named in a family sentence with a day or count word is.
    expect(checkRead(read, { household, said, sentences, oftenFailed: true }).lint.map((d) => d.name)).toEqual(["Egg curry"]);
  });

  it("applySetup: an often read past its own deadline fails and the lint re-reads", async () => {
    const f = fake({ home: { slots: SLOTS }, rules: { rules: [] }, dishes: DISHES, often: () => new Promise(() => {}), kinds: { dishes: [] }, contains: containsOf(),
      lint: { dishes: [{ name: "Egg curry", often: "On Saturdays we make egg curry sometimes", frequency: "sometimes", days: ["Sat"] }] } });
    const k = await boot({ model: f.model, setupBudgetMs: 5000, setupOftenMs: 300 });
    const t0 = Date.now();
    const r = await k.op("apply_setup", { household: FAM, transcript: T });
    // The often read's runaway eats its own time only, never the setup's budget.
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(r.ok).toBe(true);
    expect(f.of("lint")).toHaveLength(1);
    expect(JSON.parse(f.of("lint")[0].user).dishes.map((d: any) => d.name)).toEqual(["Egg curry"]);
    expect(lib(k)["Egg curry@Dinner"]).toMatchObject({ frequency: "sometimes", days: ["Sat"] });
  });
  it("a linted dish the lint gives nothing for, or a failed lint, is a dropped line, never a quiet miss", async () => {
    for (const lint of [{ dishes: [] }, { dishes: [{ name: "Egg curry", often: "" }] }, { ok: false, code: "unavailable", message: "down" }]) {
      const f = fake({ home: { slots: SLOTS }, rules: { rules: [] }, dishes: DISHES, often: { ok: false, code: "unavailable", message: "down" }, kinds: { dishes: [] }, contains: containsOf(), lint });
      const k = await boot({ model: f.model });
      const r = await k.op("apply_setup", { household: FAM, transcript: T });
      expect(r.ok).toBe(true);
      expect(f.of("lint")).toHaveLength(1);
      expect(lib(k)["Egg curry@Dinner"]).toMatchObject({ frequency: null, days: null });
      expect(r.dropped.filter((d: string) => d.startsWith("how often for Egg curry"))).toHaveLength(1);
    }
  });
});

describe("a word no read placed is never a fixed dish (H4)", () => {
  const ASKS = [{ name: "Dry veg", meal: "lunch", words: "dry veg" }, { name: "Kovakkai", meal: "dinner", words: "kovakkai" }];
  const KOV = { name: "Kovakkai", meal: "dinner", kind: "Sabzi", sub: "Sabzi", named: "dish" }, DRY = { name: "Dry veg", meal: "lunch", kind: "Sabzi", named: "category" };
  const answers = (...a: unknown[]) => { const asked: ModelRequest[] = [];
    return { asked, model: async (req: ModelRequest): Promise<ModelResult> => { asked.push(req); return { ok: true, json: a[Math.min(asked.length, a.length) - 1], model: "fake" }; } }; };

  it("kindsRead: no time for a second ask leaves the unanswered dishes left", async () => {
    const f = answers({ dishes: [KOV] });
    const r = await kindsRead(f.model, ASKS, Date.now() + 5_000, () => {});
    expect(f.asked).toHaveLength(1);
    expect(r.left.map((a) => a.name)).toEqual(["Dry veg"]);
    expect([...r.placed.keys()]).toEqual(["dinner|kovakkai"]);
  });
  it("kindsRead: a second ask runs with KINDS_RETRY_MS left", async () => {
    const f = answers({ dishes: [KOV] }, { dishes: [DRY] });
    const r = await kindsRead(f.model, ASKS, Date.now() + 10_000, () => {});
    expect(f.asked).toHaveLength(2);
    expect(JSON.parse(f.asked[1].user).dishes.map((d: any) => d.name)).toEqual(["Dry veg"]);
    expect(r.left).toEqual([]);
    expect(r.placed.size).toBe(2);
  });

  it("kindsRead: a failed first call leaves every dish it was asked", async () => {
    const f = { model: async (): Promise<ModelResult> => ({ ok: false, code: "unavailable", message: "down" }) };
    const r = await kindsRead(f.model, [...ASKS, { name: "Puttu", meal: "breakfast", words: "puttu", known: { kind: "Puttu", sub: null, item: null, own: false, named: "dish", word: "puttu" } as Place }], Date.now() + 5_000, () => {});
    expect(r.left.map((a) => a.name)).toEqual(["Dry veg", "Kovakkai"]);   // one asked only for named keeps code's place
    expect(r.placed.size).toBe(0);
  });
  it("kindsRead: a failed second ask leaves what the first answer left out", async () => {
    const asked: ModelRequest[] = [];
    const model = async (req: ModelRequest): Promise<ModelResult> => { asked.push(req); return asked.length === 1 ? { ok: true, json: { dishes: [KOV] }, model: "fake" } : { ok: false, code: "unavailable", message: "down" }; };
    const r = await kindsRead(model, ASKS, Date.now() + 10_000, () => {});
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(r.left.map((a) => a.name)).toEqual(["Dry veg"]);
    expect([...r.placed.keys()]).toEqual(["dinner|kovakkai"]);
  });

  it("writeKinds: a left dish is no fixed part", async () => {
    const FAM = { "household.people": [{ name: "Omkar", group: "adult" }, { name: "Devika", group: "adult" }], "household.speaker": "Omkar" };
    const T = ["Q: What do you have for lunch?", "A: Lunch is rice, dry veg and sambar. Or rice with kovakkai."];
    const q = "Lunch is rice, dry veg and sambar", q2 = "Or rice with kovakkai";
    // The kinds answer places Kovakkai and leaves Dry veg out.
    const f = fake({ home: { slots: [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" }] }, rules: { rules: [] },
      dishes: { library: [["Rice", "Lunch", q], ["Dry veg", "Lunch", q], ["Sambar", "Lunch", q], ["Kovakkai", "Lunch", q2]],
        seed: [["Lunch", "Rice, Dry veg, Sambar", q], ["Lunch", "Rice, Kovakkai", q2]] },
      often: { often: [] }, kinds: { dishes: [{ ...KOV, meal: "lunch" }] }, contains: containsOf(), lint: { dishes: [] } });
    // A setup near its budget's end: no time for the kinds read's second ask.
    const k = await boot({ model: f.model, setupBudgetMs: 8_000 });
    const r = await k.op("apply_setup", { household: FAM, transcript: T });
    expect(r.ok).toBe(true);
    expect(f.of("kinds")).toHaveLength(1);
    const lunch = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Lunch");
    for (const t of lunch.templates) expect(t.parts).not.toContainEqual({ items: ["Dry veg"] });
    expect(k.rows("library").some((d) => d.name === "Dry veg")).toBe(false);
    expect(r.asks).toContain(kindsAsk("dry veg", { name: "Lunch", kind: "main" }));
  });
});

// Round 3 (task 15, §2): H6 (an incomplete rule is re-read; notes never collapse), H12a (a require that restates an add-on dish
// is not saved), H16 (a cook in household.help is a saved cook). A made-up family (F7): Rahul at the office, Kavya, Lalitha.
describe("a rule read whole, a require that is an add-on dish, a cook from help (H6, H12, H16)", () => {
  const MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const R_HOUSEHOLD = {
    "household.people": [{ name: "Rahul", relation: "self", group: "adult" }, { name: "Kavya", relation: "wife", group: "adult" },
      { name: "Lalitha", relation: "mother", group: "elder", age: 72 }],
    "household.weekly": [{ person: "Rahul", where: "office", weekdays: MON_FRI, lunch: "carries" }],
    "household.speaker": "Rahul",
  };
  const R_TRANSCRIPT = [
    "Q: Any food rules?", "A: Lalitha has hers with less salt, and less oil. Millets are good for Lalitha.",
    "Q: What did the family have for breakfast last week?", "A: Idli and upma.",
    "Q: And lunch?", "A: Rice, dal and a sabzi. I take 4 boiled eggs with my lunch.",
    "Q: And dinner?", "A: Roti, dal and a sabzi.",
  ];
  const hh = householdOf(R_HOUSEHOLD);
  const said = familyLines(R_TRANSCRIPT, R_HOUSEHOLD), sentences = familySentences(R_TRANSCRIPT, R_HOUSEHOLD);
  const mains = [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" }, { name: "Dinner", kind: "main" }];
  const millet = { hard: false, what: "swap", who: "Lalitha", items: ["millet"], quote: "Millets are good for Lalitha" };
  const R_DISHES = {
    library: [["Idli", "Breakfast", "Idli and upma"], ["Upma", "Breakfast", "Idli and upma"], ["Rice", "Lunch", "Rice, dal and a sabzi"],
      ["Dal", "Lunch", "Rice, dal and a sabzi"], ["Roti", "Dinner", "Roti, dal and a sabzi"], ["Dal", "Dinner", "Roti, dal and a sabzi"]],
    seed: [["Breakfast", "Idli", "Idli and upma"], ["Lunch", "Rice, Dal", "Rice, dal and a sabzi"], ["Dinner", "Roti, Dal", "Roti, dal and a sabzi"]],
  };
  const rFake = (over: Partial<Record<Part, unknown>> = {}) =>
    fake({ home: { slots: mains }, rules: { rules: [] }, dishes: R_DISHES, often: { often: [] }, contains: containsOf(), lint: { dishes: [] }, kinds: ownKinds, ...over });
  const rulesOf = (k: Awaited<ReturnType<typeof boot>>) => k.rows("rules").map((r) => ({ what: r.what, who: r.who, items: JSON.parse(r.items ?? "null"), frequency: r.frequency, quote: r.quote }));

  // H6
  it("checkRead keeps two notes for one person", () => {
    const read = readOf({ slots: mains }, { rules: [{ hard: false, what: "note", who: "Lalitha", quote: "with less salt" }, { hard: false, what: "note", who: "Lalitha", quote: "less oil" }] }, {});
    const c = checkRead(read, { household: hh, said, sentences });
    expect(c.read.rules.filter((r) => r.what === "note" && r.who === "Lalitha").map((r) => r.quote)).toEqual(["with less salt", "less oil"]);
    // The same note read twice is still one.
    const twice = readOf({ slots: mains }, { rules: [{ hard: false, what: "note", who: "Lalitha", quote: "less oil" }, { hard: false, what: "note", who: "Lalitha", quote: "Less oil" }] }, {});
    expect(checkRead(twice, { household: hh, said, sentences }).read.rules).toHaveLength(1);
  });
  it("checkRead reports an incomplete swap", () => {
    const c = checkRead(readOf({ slots: mains }, { rules: [millet] }, {}), { household: hh, said, sentences });
    expect(c.incomplete).toEqual([{ quote: "Millets are good for Lalitha", what: "swap", missing: ["to"] }]);
    // Kept as a note meanwhile.
    expect(c.read.rules).toMatchObject([{ what: "note", who: "Lalitha", quote: "Millets are good for Lalitha" }]);
    // A complete rule is not reported.
    expect(checkRead(readOf({ slots: mains }, { rules: [{ ...millet, to: "ragi roti" }] }, {}), { household: hh, said, sentences }).incomplete).toEqual([]);
  });
  it("applySetup re-reads an incomplete soft rule once", async () => {
    const whole = { hard: false, what: "require", who: "Lalitha", items: ["millet"], frequency: "sometimes", quote: "Millets are good for Lalitha" };
    const salt = { hard: false, what: "note", who: "Lalitha", quote: "with less salt" };
    const f = rFake({ rules: (_req: ModelRequest, n: number) => ({ rules: n === 1 ? [salt, millet] : [salt, whole] }) });
    const k = await boot({ model: f.model });
    expect((await k.op("apply_setup", { household: R_HOUSEHOLD, transcript: R_TRANSCRIPT })).ok).toBe(true);
    expect(f.of("rules")).toHaveLength(2);
    expect(JSON.parse(f.of("rules")[1].user).missing).toEqual(["the swap 'Millets are good for Lalitha' has no 'to' (what they have instead)"]);
    expect(f.of("rules")[1].system).toContain("A list `missing` names what your last answer left out: write it.");
    const rules = rulesOf(k);
    expect(rules).toContainEqual({ what: "require", who: "Lalitha", items: ["millet"], frequency: "sometimes", quote: "Millets are good for Lalitha" });
    expect(rules.filter((r) => r.quote === "Millets are good for Lalitha")).toHaveLength(1);
    expect(rules.some((r) => r.what === "note" && r.quote === "with less salt")).toBe(true);
  });
  it("applySetup keeps a rule still incomplete after its re-read as a note, and logs it", async () => {
    const f = rFake({ rules: { rules: [millet] } });
    const lines: string[] = [], was = console.log;
    const k = await boot({ model: f.model });
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { expect((await k.op("apply_setup", { household: R_HOUSEHOLD, transcript: R_TRANSCRIPT })).ok).toBe(true); } finally { console.log = was; }
    expect(f.of("rules")).toHaveLength(2);
    expect(lines.some((l) => l.includes("rules re-read: still incomplete") && l.includes("Millets are good for Lalitha"))).toBe(true);
    expect(rulesOf(k)).toMatchObject([{ what: "note", who: "Lalitha", quote: "Millets are good for Lalitha" }]);
  });

  // H12a
  it("checkRead drops a require that restates an add-on dish", () => {
    const box = { name: "Rahul's lunch box", kind: "addon", addon_of: "Lunch", usual_people: ["Rahul"], extras: true, quote: "I take 4 boiled eggs with my lunch" };
    const eggs = { hard: true, what: "require", who: "Rahul", items: ["egg"], slots: ["Lunch"], quote: "I take 4 boiled eggs" };
    const read = readOf({ slots: [...mains, box] }, { rules: [eggs] }, { library: [["4 boiled eggs", "Rahul's lunch box", "I take 4 boiled eggs with my lunch"]] });
    const c = checkRead(read, { household: hh, said, sentences });
    expect(c.read.rules).toEqual([]);
    expect(c.dropped.some((d) => d.includes("I take 4 boiled eggs") && d.includes("Rahul's lunch box"))).toBe(true);
    // The same require for someone else, or with no add-on dish in its sentence, stands.
    expect(checkRead(readOf({ slots: [...mains, box] }, { rules: [{ ...eggs, who: "Kavya" }] }, { library: [["4 boiled eggs", "Rahul's lunch box", "I take 4 boiled eggs with my lunch"]] }),
      { household: hh, said, sentences }).read.rules).toHaveLength(1);
    expect(checkRead(readOf({ slots: [...mains, box] }, { rules: [eggs] }, { library: [] }), { household: hh, said, sentences }).read.rules).toHaveLength(1);
  });

  // H16
  const help = [{ role: "cook", days: "Mon-Sat", times: "morning", meals: ["Breakfast", "Lunch"] }, { role: "cook", days: "Mon-Sat", times: "afternoon", meals: ["Dinner"] }];
  const MON_SAT = [...MON_FRI, "Sat"];
  it("checkRead: a cook in household.help is the cook when the read has none", () => {
    const c = checkRead(readOf({ slots: mains, cook: null }, { rules: [] }, {}), { household: householdOf({ ...R_HOUSEHOLD, "household.help": help }), said, sentences });
    expect(c.read.cook).toMatchObject({ name: null, days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }] });
    // Her clock time and name from help when given; the read's limits laid on.
    const timed = [{ role: "cook", name: "Savita", days: ["Mon", "Tue"], times: "8am", meals: ["Breakfast"] }, { role: "maid", days: "daily" }];
    const c2 = checkRead(readOf({ slots: mains, cook: { limits_words: "two hours in the morning" } }, { rules: [] }, {}),
      { household: householdOf({ ...R_HOUSEHOLD, "household.help": timed }), said, sentences });
    expect(c2.read.cook).toMatchObject({ name: "Savita", days: ["Mon", "Tue"], visits: [{ at: "08:00", meals: ["Breakfast"] }], limits_words: "two hours in the morning" });
    // No cook in help, none read: no cook.
    expect(checkRead(readOf({ slots: mains, cook: null }, { rules: [] }, {}), { household: hh, said, sentences }).read.cook).toBeNull();
  });
  it("applySetup saves the cook household.help lists when the home read has none", async () => {
    const f = rFake({ home: { slots: mains, cook: null } });
    const k = await boot({ model: f.model });
    expect((await k.op("apply_setup", { household: { ...R_HOUSEHOLD, "household.help": help }, transcript: R_TRANSCRIPT })).ok).toBe(true);
    expect(savedOf(k.kit.db).cook).toMatchObject({ name: null, days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }] });
  });
});
