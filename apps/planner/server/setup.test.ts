// apply_setup v2 (setup.ts, docs/slot-model-spec.md §4) with a fake model: three balanced reads and a fast contains read; code
// checks structure only (quotes, hard rules, known names, slots, the day/count lint, contains_read), writes in a fixed order,
// reads back from the rows, and applies a correction as a diff.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { saysNoEggs, buildMeal, codePlace, cuisinesOf, regionalFor, kitchenLine, needsNamed, placeOf, wordOf, KINDS_SYSTEM, type MealDish, type Place } from "./setup";
import { checkRead, diffSetup, familyLines, familySentences, frequencyOf, householdOf, lunchLine, personOf, plainWords, quoteHasDayOrCount, readOf, resolveSlot,
  ruleSaid, saidByFamily, DISHES_ASK, SETUP_PARTS, SETUP_SYSTEM, CONTAINS_BATCH, daysOf, clockOf, itemWord, allergyAsk, answeredIn, type Saved, type SetupRead } from "./setup";
import { isAllergyRule } from "./allergy";
import { HOUSEHOLDS } from "../evals/households";
import { regionalWordOf } from "./kinds";
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
    expect(book["Sambar@Breakfast"].frequency).toBeNull();
    expect(book["Poriyal@Ishaan's tiffin"].days).toBeNull();
    expect(book["Rajma@Lunch"].frequency).toBe("2/week");
    expect(f.of("lint")).toHaveLength(1);
    expect(JSON.parse(f.of("lint")[0].user).dishes.map((d: any) => d.name)).toEqual(["Rajma", "Phulka"]);   // "two phulkas at night": re-read, nothing saved
    expect(book["Salad@Lunch"].frequency).toBe("daily");
    // The family's words for how often are kept beside it, for the plan call; none where nothing stands.
    const saidOf = (name: string, slot: string) => k.rows("library").find((d) => d.name === name && d.slot === slot)?.said ?? null;
    expect([saidOf("Lemon rice", "Lunch"), saidOf("Rajma", "Lunch"), saidOf("Salad", "Lunch"), saidOf("Rice", "Lunch"), saidOf("Curd", "Breakfast")])
      .toEqual(["Lemon rice on Fridays", "Rajma twice", "Salad every day", null, null]);
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
    expect(k.rows("library").filter((d) => d.slot === "Lunch").map((d) => [d.name, d.kind, d.sub, d.catalog_item]).sort()).toEqual([
      ["Beans poriyal", "Sabzi", "Poriyal/Thoran", "Beans poriyal"], ["Curd", "Curd", "Curd", "Curd"], ["Lemon rice", "Flavoured rice", "Flavoured rice", "Lemon rice"],
      ["Rajma", "Dal", "Rajma/Chole", "Rajma"], ["Rice", "Rice", "Rice", null], ["Salad", "Salad", "Salad", null], ["Sambar", "Rice curry", "Sambar", null]]);
    const lunch = fam.slots.find((s: any) => s.name === "Lunch");
    expect(lunch.templates).toEqual([
      { parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Sabzi" }, { kind: "Curd" }, { items: ["Salad"] }], share: null, said: null },
      { parts: [{ kind: "Flavoured rice" }, { items: ["Salad"] }], share: null, said: "Lemon rice on Fridays" },
      { parts: [{ kind: "Rice" }, { kind: "Dal" }, { items: ["Salad"] }], share: "2/week", said: "Rajma twice" }]);
    expect(lunch.kinds).toEqual([{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar"] }, { name: "Sabzi", subs: ["Poriyal/Thoran"] },
      { name: "Curd", staple: true }, { name: "Flavoured rice" }, { name: "Dal", subs: ["Rajma/Chole"] }]);
    expect(fam.slots.find((s: any) => s.name === "Padma's dinner").templates).toEqual([{ parts: [{ kind: "Roti" }], share: null, said: null }]);
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
    expect(fam.slots.find((s: any) => s.name === "Lunch").templates[2]).toEqual({ parts: [{ kind: "Rice" }, { kind: "Dal" }, { items: ["Salad"] }], share: null, said: "Rajma only on Sundays" });
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
    const f = fake({ dishes: { library: many }, contains: (req: ModelRequest) => {
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
    expect(needsNamed(codePlace("Khichdi")!, "breakfast")).toBe(true);
    expect(needsNamed(codePlace("Khichdi")!, "dinner")).toBe(false);
    expect(needsNamed(codePlace("Dosa")!, "lunch")).toBe(true);
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
    // An egg breakfast is a whole breakfast.
    expect(buildMeal("breakfast", [dish("Idli"), dish("Bread omelette")], [["Idli"], ["Bread omelette"]]).templates.map(kinds)).toEqual([["Idli"], ["Egg"]]);
  });

  it("category words are their kind or sub-kind; a named dish is its kind (variety among it); staples are their kind", () => {
    const lunch = buildMeal("lunch", [dish("Rice"), dish("Sambar"), dish("Rasam"), dish("Poriyal", { word: "a poriyal" }), dish("Curd"), dish("Beans poriyal")],
      [["Rice", "Sambar", "Rasam", "Poriyal", "Curd"], ["Rice", "Sambar", "Beans poriyal", "Curd"]]);
    expect(lunch.templates).toEqual([
      { parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "Sabzi", sub: "Poriyal/Thoran" }, { kind: "Curd" }], share: null, said: null },
      { parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Sabzi" }, { kind: "Curd" }], share: null, said: null }]);
    expect(lunch.kinds).toEqual([{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar", "Rasam"] }, { name: "Sabzi", subs: ["Poriyal/Thoran"] }, { name: "Curd", staple: true }]);
    expect(lunch.line).toBe("rice, sambar, rasam, a poriyal and curd; or rice, sambar, beans poriyal and curd");

    const dinner = buildMeal("dinner", [dish("Phulka"), dish("Dal tadka"), dish("Aloo gobi"), dish("Bhindi sabzi")], [["Phulka", "Dal tadka", "Aloo gobi"], ["Phulka", "Aloo gobi"]]);
    expect(dinner.templates.map((t) => t.parts)).toEqual([[{ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" }], [{ kind: "Roti" }, { kind: "Sabzi" }]]);
    expect(dinner.kinds).toEqual([{ name: "Roti", staple: true }, { name: "Dal", subs: ["Dal"] }, { name: "Sabzi", subs: ["Sabzi"] }]);
    // Bhindi sabzi is in no plate: one more sabzi of the family's, an option of the Sabzi part, no plate of its own.
    expect(dinner.line).toBe("phulka, dal tadka and aloo gobi or bhindi sabzi; or phulka and aloo gobi or bhindi sabzi");
  });

  it("a dish at a meal its kind is not suggested at is a fixed part; a category word there is its kind (decided 18, 19)", () => {
    const b = buildMeal("breakfast", [dish("Appam"), dish("Vegetable stew")], [["Appam", "Vegetable stew"]]);
    expect(b.templates).toEqual([{ parts: [{ kind: "Appam" }, { items: ["Vegetable stew"] }], share: null, said: null }]);
    expect(b.kinds).toEqual([{ name: "Appam" }]);
    const asDish = buildMeal("lunch", [dish("Dosa", { place: { ...codePlace("Dosa")!, named: "dish" } })], [["Dosa"]]);
    expect(asDish.templates[0].parts).toEqual([{ items: ["Dosa"] }]);
    const asCategory = buildMeal("lunch", [dish("Dosa", { place: { ...codePlace("Dosa")!, named: "category", word: "a different dosa" } })], [["Dosa"]]);
    expect(asCategory.templates[0].parts).toEqual([{ kind: "Dosa" }]);
    expect(asCategory.kinds).toEqual([{ name: "Dosa" }]);
  });

  it("an own kind holds the family's dish and nothing else", () => {
    const own: Place = { kind: "Boiled chicken", sub: null, item: null, own: true, named: "dish", word: "boiled chicken" };
    const b = buildMeal("breakfast", [dish("Boiled chicken", { place: own }), dish("Idli")], [["Idli"]]);
    expect(b.templates).toEqual([{ parts: [{ kind: "Idli" }], share: null, said: null }, { parts: [{ kind: "Boiled chicken" }], share: null, said: null }]);
    expect(b.kinds).toEqual([{ name: "Idli" }, { name: "Boiled chicken", own: true }]);
  });

  it("curd rice is rice and curd; with rice already on the plate, one rice", () => {
    const l = buildMeal("lunch", [dish("Curd rice"), dish("Rice"), dish("Rasam")], [["Curd rice"], ["Rice", "Rasam", "Curd rice"], ["Curd rice", "Rasam", "Rice"]]);
    expect(l.templates.map((t) => t.parts)).toEqual([[{ kind: "Rice" }, { kind: "Curd" }], [{ kind: "Rice" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "Curd" }]]);
    expect(l.line).toBe("curd rice; or rice, rasam and curd rice");
  });

  it("how often the family said they have a plate's own dish is the plate's share; a dish they have every day is on every plate", () => {
    const b = buildMeal("breakfast", [dish("Idli"), dish("Dosa"), dish("Upma", { frequency: "1/week", said: "upma once" }), dish("Poha", { frequency: "2/week", said: "poha twice a week" })],
      [["Idli"], ["Dosa"], ["Upma"], ["Poha"]]);
    expect(b.templates.map((t) => [t.parts, t.share, t.said])).toEqual([[[{ kind: "Idli" }], null, null], [[{ kind: "Dosa" }], null, null],
      [[{ kind: "Upma" }], "1/week", "upma once"], [[{ kind: "Poha" }], "2/week", "poha twice a week"]]);
    expect(b.line).toBe("idli; or dosa; or upma (once a week); or poha (twice a week)");
    // Pulao twice, in no example plate: a whole plate of its own, twice a week. Salad every day: on each plate.
    const l = buildMeal("lunch", [dish("Rice"), dish("Dal"), dish("Pulao", { frequency: "2/week", said: "pulao twice" }), dish("Salad", { frequency: "daily", said: "salad every day" })],
      [["Rice", "Dal"]]);
    expect(l.templates).toEqual([{ parts: [{ kind: "Rice" }, { kind: "Dal", sub: "Dal" }, { items: ["Salad"] }], share: null, said: null },
      { parts: [{ kind: "Pulao" }, { items: ["Salad"] }], share: "2/week", said: "pulao twice" }]);
    expect(l.line).toBe("rice, dal and salad; or pulao and salad (twice a week)");
  });

  it("a main dish in none of the plates comes with the plate's base (rajma twice a week is rice and rajma); the curd stays its own", () => {
    const l = buildMeal("lunch", [dish("Rice"), dish("Sambar"), dish("Curd"), dish("Rajma", { frequency: "2/week", said: "rajma twice" })], [["Rice", "Sambar", "Curd"]]);
    expect(l.templates[1]).toEqual({ parts: [{ kind: "Rice" }, { kind: "Dal" }], share: "2/week", said: "rajma twice" });
  });

  it("a dish not placed is itself, never dropped", () => {
    const l = buildMeal("dinner", [dish("Grandma's bake", { place: null })], [["Grandma's bake"]]);
    expect(l.templates).toEqual([{ parts: [{ items: ["Grandma's bake"] }], share: null, said: null }]);
    expect(l.kinds).toEqual([]);
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
    // One kinds read, on fast, with the catalog, of only what code could not settle: two dishes the catalog does not hold, and
    // khichdi, a category word at a meal the catalog does not suggest it at.
    const asked = f.of("kinds");
    expect(asked).toHaveLength(1);
    expect(asked[0].tier).toBe("fast");
    const user = JSON.parse(asked[0].user);
    expect(user.dishes.map((d: any) => d.name).sort()).toEqual(["Boiled chicken", "Khichdi", "Kovakkai"]);
    expect(user.dishes.find((d: any) => d.name === "Khichdi").known).toBe("Khichdi / Khichdi");
    expect(user.catalog.some((l: string) => l.startsWith("Sabzi [") && l.includes("Poriyal/Thoran"))).toBe(true);
    // The library: kind, sub-kind and catalog item; a catalog item's contents from the catalog, not asked of the model.
    const row = (n: string) => k.rows("library").find((d) => d.name === n)!;
    expect([row("Kovakkai").kind, row("Kovakkai").sub, row("Kovakkai").catalog_item]).toEqual(["Sabzi", "Sabzi", null]);
    expect([row("Boiled chicken").kind, row("Boiled chicken").catalog_item]).toEqual(["Boiled chicken", null]);
    expect([row("Chicken curry").kind, row("Chicken curry").sub, row("Chicken curry").catalog_item]).toEqual(["Chicken", "Curry", "Chicken curry"]);
    expect(JSON.parse(row("Chicken curry").contains).sort()).toEqual(["chicken", "meat", "onion_garlic", "root_veg"]);
    expect(f.of("contains").flatMap((c) => JSON.parse(c.user).dishes)).not.toContain("Chicken curry");
    expect(f.of("contains").flatMap((c) => JSON.parse(c.user).dishes)).toContain("Kovakkai");
    // Breakfast: khichdi named as a dish at breakfast stays theirs; boiled chicken a kind of their own; appam with the stew fixed.
    const fam = (await k.owner("GET", "/api/family")).body;
    const slot = (n: string) => fam.slots.find((s: any) => s.name === n);
    expect(slot("Breakfast").templates).toEqual([
      { parts: [{ items: ["Khichdi"] }], share: "usually", said: "Khichdi most days" },
      { parts: [{ kind: "Boiled chicken" }], share: "sometimes", said: "boiled chicken on gym days" },
      { parts: [{ kind: "Appam" }, { items: ["Vegetable stew"] }], share: null, said: "appam with vegetable stew on Sundays" }]);
    expect(slot("Breakfast").kinds).toEqual([{ name: "Boiled chicken", own: true }, { name: "Appam" }]);
    expect(slot("Dinner").templates).toEqual([{ parts: [{ kind: "Roti" }, { kind: "Sabzi" }], share: null, said: null },
      { parts: [{ kind: "Roti" }, { kind: "Chicken" }], share: null, said: null }]);
    expect(slot("Dinner").kinds).toEqual([{ name: "Roti", staple: true }, { name: "Sabzi", subs: ["Sabzi"] }, { name: "Chicken", subs: ["Curry"] }]);
    expect(slot("Lunch").templates).toBeNull();      // no dish said for lunch: not read
    // Cuisines: appam and the stew are Kerala (appam Tamil too), and they said Malayali.
    expect(fam.house.cuisines).toEqual(["tamil", "kerala", "south"]);
    expect(r.said).toContain("Your usual meals:\n- Breakfast: khichdi (most days); or boiled chicken (2–3 times a week); or appam and vegetable stew (on Sundays)\n- Dinner: phulka and kovakkai; or phulka and chicken curry");
    expect(r.said).toContain("Your kitchen: Tamil, Kerala, South Indian. Tell me if that's not right.");
    expect(r.said).not.toContain("Your usual dishes");
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
    expect([row("Curry").kind, row("Curry").sub]).toEqual(["Sabzi", "Vepudu"]);
    expect([row("Cabbage curry").kind, row("Cabbage curry").sub]).toEqual(["Sabzi", "Vepudu"]);
    expect(row("Pachadi").kind).toBe("Chutney");
    const lunch = (await k.owner("GET", "/api/family")).body.slots.find((s: any) => s.name === "Lunch");
    expect(lunch.kinds.map((x: any) => x.name)).not.toContain("Gravy");
    expect(lunch.kinds.map((x: any) => x.name)).not.toContain("Raita");
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
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[3]).toEqual({ parts: [{ kind: "Poha" }], share: null, said: "poha on Saturdays" });
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[0].parts).toEqual([{ items: ["Khichdi"] }]);   // still read as a dish
    expect(fam.slots.find((s: any) => s.name === "Dinner")).toEqual(dinner);
    expect(r.said).toContain("Breakfast: khichdi (most days); or boiled chicken (2–3 times a week); or appam and vegetable stew (on Sundays); or poha (on Saturdays).");
    expect(r.said).not.toContain("Dinner:");
    expect(r.said).not.toContain("Your kitchen");    // unchanged: not said again
  });

  it("a correction that names a dish reads its place again: khichdi at breakfast is any khichdi after all", async () => {
    const NEW = "The khichdi can be any khichdi, a different one each time.";
    const f = fake2({ kinds: (req: ModelRequest) => (JSON.parse(req.user).dishes.length === 1
      ? { dishes: [{ name: "Khichdi", meal: "breakfast", named: "category" }] } : KINDS) });
    const k = await boot({ model: f.model });
    await k.op("apply_setup", { household: FAMILY, transcript: T });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: [...T, "Q: Anything to change?", `A: ${NEW}`] });
    expect(f.of("kinds").map((q) => JSON.parse(q.user).dishes.map((d: any) => d.name))).toEqual([expect.arrayContaining(["Khichdi"]), ["Khichdi"]]);
    const fam = (await k.owner("GET", "/api/family")).body;
    // Decided 19: a category word is its kind at that meal, new khichdis suggested at breakfast too.
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates[0]).toEqual({ parts: [{ kind: "Khichdi", sub: "Khichdi" }], share: "usually", said: "Khichdi most days" });
    expect(r.said).toContain("Breakfast: khichdi (most days); or boiled chicken");
  });

  it("the kinds read does not answer: it stops inside the setup's budget, the setup saves, its dishes are fixed parts", async () => {
    const f = fake2({ kinds: () => new Promise(() => {}) });
    const k = await boot({ model: f.model, setupBudgetMs: 5000 });
    const t0 = Date.now();
    const r = await k.op("apply_setup", { household: FAMILY, transcript: T });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.find((s: any) => s.name === "Dinner").templates[0].parts).toEqual([{ kind: "Roti" }, { items: ["Kovakkai"] }]);
  });

  it("the kinds read fails: the setup still saves; what code could not place is the family's fixed dish", async () => {
    const f = fake2({ kinds: { ok: false, code: "unavailable", message: "down" } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: FAMILY, transcript: T });
    expect(r.ok).toBe(true);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.find((s: any) => s.name === "Dinner").templates[0].parts).toEqual([{ kind: "Roti" }, { items: ["Kovakkai"] }]);
    expect(fam.slots.find((s: any) => s.name === "Breakfast").templates.slice(0, 2).map((t: any) => t.parts)).toEqual([[{ items: ["Khichdi"] }], [{ items: ["Boiled chicken"] }]]);
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
  it("never name an eval household's people, cook or surname", () => {
    for (const h of HOUSEHOLDS) for (const name of [...h.truth.people.map((p) => p.name), ...(h.truth.cook ? [h.truth.cook.name] : [])])
      expect(SETUP_SYSTEM, `${h.id} ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
    for (const name of ["Sharma", "Iyer", "Shiva", "Reddy", "Agarwal", "Kulkarni", "Menon", "Banerjee", "Ankita", "Agastya", "Gowri"])
      expect(SETUP_SYSTEM, name).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  });
});
