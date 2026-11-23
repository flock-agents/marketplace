// apply_setup v2 (setup.ts, docs/slot-model-spec.md §4) with a fake model: three balanced reads and a fast contains read; code
// checks structure only (quotes, hard rules, known names, slots, the day/count lint, contains_read), writes in a fixed order,
// reads back from the rows, and applies a correction as a diff.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { checkRead, diffSetup, familyLines, frequencyOf, householdOf, lunchLine, personOf, plainWords, quoteHasDayOrCount, readOf, resolveSlot,
  ruleSaid, saidByFamily, SETUP_PARTS, SETUP_SYSTEM, CONTAINS_BATCH, daysOf, clockOf, type Saved, type SetupRead } from "./setup";
import { HOUSEHOLDS } from "../evals/households";
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
  library: [["Rice", "Lunch", "", "", "rice, sambar, beans poriyal, curd"], ["Sambar", "Lunch", "", "", "rice, sambar"], ["Beans poriyal", "Lunch", "", "", "beans poriyal"],
    ["Curd", "Lunch", "", "", "curd"], ["Rajma", "Lunch", "", "", "Rajma twice"], ["Lemon rice", "Lunch", "", "Fri", "Lemon rice on Fridays"],
    ["Salad", "Lunch", "daily", "", "Salad every day"], ["Phulka", "Padma's dinner", "", "", "Amma has two phulkas at night"],
    ["Curd", "Breakfast", "", "Wed", "curd"]],                                                                                 // days with no day word: dropped
  seed: [["Lunch", "Rice, Sambar, Beans poriyal, Curd", "rice, sambar, beans poriyal, curd"]],
};

type Part = "home" | "rules" | "dishes" | "contains" | "lint";
const partOf = (req: ModelRequest): Part => {
  const p = req.purpose ?? "";
  return /contains/.test(p) ? "contains" : /lint/.test(p) ? "lint" : /rules/.test(p) ? "rules" : /dishes/.test(p) ? "dishes" : "home";
};
const isResult = (v: unknown): v is ModelResult => !!v && typeof v === "object" && "ok" in (v as object);
/** Every dish's contains: true for the tags in `has`, false for the rest asked. */
const containsOf = (has: Record<string, string[]> = {}) => (req: ModelRequest) => {
  const { dishes, tags } = JSON.parse(req.user) as { dishes: string[]; tags: string[] };
  return Object.fromEntries(dishes.map((d) => [d, Object.fromEntries(tags.map((t) => [t, (has[d] ?? []).includes(t)]))]));
};
/** A model per part: a JSON answer, a result, or a function of (request, try number). */
function fake(over: Partial<Record<Part, unknown>> = {}) {
  const answers: Record<Part, unknown> = { home: HOME, rules: RULES, dishes: DISHES, contains: containsOf({ Rice: ["white_rice"], "Lemon rice": ["white_rice"], Curd: ["dairy"] }),
    lint: { dishes: [{ name: "Rajma", frequency: "2/week" }] }, ...over };
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
  it("three balanced reads at once, then contains on the fast tier; everything written in order and read back", async () => {
    const f = fake();
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(f.of("home").length + f.of("rules").length + f.of("dishes").length).toBe(3);
    for (const p of ["home", "rules", "dishes"] as Part[]) {
      const a = f.of(p)[0];
      expect(a.tier).toBe("balanced");
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
    expect(r.asks).toEqual(["Who is Ravi? I don't have them among the people at home."]);
    // Library: days backed by a day word kept, unbacked dropped; the lint re-read the count; daily kept; contains read.
    const book = lib(k);
    expect(book["Lemon rice@Lunch"]).toMatchObject({ days: ["Fri"], contains: ["white_rice"], origin: "setup_named" });
    expect(book["Curd@Breakfast"].days).toBeNull();
    expect(book["Rajma@Lunch"].frequency).toBe("2/week");
    expect(f.of("lint")).toHaveLength(1);
    expect(JSON.parse(f.of("lint")[0].user).dishes.map((d: any) => d.name)).toEqual(["Rajma", "Phulka"]);   // "two phulkas at night": re-read, nothing saved
    expect(book["Salad@Lunch"].frequency).toBe("daily");
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
    // The read-back.
    expect(r.said).toBe([
      "At home: Kiran, Nisha, Ishaan and Padma.",
      "Rani cooks Mon–Fri: breakfast and lunch at 8:15 am and dinner at 5 pm; Nisha cooks on Saturdays; the family cooks on Sunday.",
      "Each day: Breakfast, Lunch and Dinner, plus Ishaan's tiffin Mon–Fri for Ishaan, Evening snack and Padma's dinner for Padma at dinner.",
      "Weekday lunch is for Nisha and Padma; Kiran's at the office; Ishaan takes lunch to school.",
      "Sunday lunch is eaten out.",
      "Food rules:\n- Everyone: vegetarian; no nuts at Ishaan's tiffin\n- Padma: no sugar; fasts on Mondays at breakfast and lunch; millets in place of white rice, 2–3 times a week; no white rice at dinner",
      "Every day: salad at lunch.",
      "Who is Ravi? I don't have them among the people at home.",
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
      dishes: (req: ModelRequest) => (corrected(req) ? { ...DISHES, library: [...DISHES.library.filter((d) => d[0] !== "Rajma"), ["Rajma", "Lunch", "", "Sun", "Rajma only on Sundays"]] } : DISHES),
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
    expect(r.said).toBe(["Removed Evening snack.", "Changed: Rajma at lunch, on Sundays.", "Who is Ravi? I don't have them among the people at home.", "Anything else to change?"].join("\n"));
    expect(JSON.parse(k.rows("house")[0].setup_state).weekday_lunch).toEqual([{ person: "Kiran", lunch: "carries", quote: "Kiran takes lunch from home" }]);
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

  it("the dishes reader fails: the rest is saved and the missing dishes are said", async () => {
    const f = fake({ dishes: { ok: false, code: "unavailable", message: "down" } });
    const k = await boot({ model: f.model });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    expect(k.rows("rules").length).toBeGreaterThan(0);
    expect(k.rows("library")).toHaveLength(0);
    expect(r.said).toContain("Noted, not checked:\n- your dishes could not be read just now");
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
    const many = Array.from({ length: 45 }, (_, i) => [`Dish ${i + 1}`, "Lunch", "", "", "rice, sambar"]);
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
    expect(resolveSlot("Kiran's dinner", slots)).toBeNull();
    expect(resolveSlot("supper", slots)).toBeNull();
  });
  it("a rule's slot that is no meal is noted, not saved; an incomplete rule is kept as a note", () => {
    const c = checkRead(base({ rules: [{ hard: true, what: "avoid", items: ["nuts"], slots: ["Brunch"], quote: "tiffin must be nut-free" },
      { hard: true, what: "swap", who: "Padma", items: ["white_rice"], quote: "Millets are good for Amma" }] }), { household: hh, said });
    expect(c.noted).toEqual([`"tiffin must be nut-free": not saved, there is no meal called Brunch`]);
    expect(c.read.rules.map((r) => r.what)).toEqual(["note"]);
  });
  it("hard whats are always hard and never carry a frequency", () => {
    const c = checkRead(base({ rules: [{ hard: false, what: "avoid", items: ["sugar"], frequency: "sometimes", quote: "Amma has no sugar" }] }), { household: hh, said });
    expect(c.read.rules[0]).toMatchObject({ hard: true, frequency: null });
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
    const next = base({ library: [{ name: "Idli", slot: "Breakfast", frequency: null, days: null, quote: "we also have idli" },
      { name: "Dosa", slot: "Breakfast", frequency: null, days: null, quote: "dosa" }] });
    const ops = diffSetup(saved, next, [plainWords("we also have idli, no more poha")], false);
    expect(ops.library.map((d) => d.name)).toEqual(["Idli"]);
    expect(ops.removeLibrary).toEqual([{ name: "Poha", slot: "Breakfast" }]);
    expect(ops.discarded).toContain("dish Dosa at Breakfast");
  });
});

describe("apply_setup v2: the prompts", () => {
  it("teach every rule shape and frequency, with the example family", () => {
    for (const shape of ["avoid {", "only {", "swap {", "require {", "cap {", "fasting {", "note {"]) expect(SETUP_SYSTEM, shape).toContain(shape);
    expect(SETUP_PARTS.find((p) => p.id === "dishes")!.system).toContain("[name, slot, frequency, days, quote]");
    expect(SETUP_PARTS.find((p) => p.id === "dishes")!.system).toContain("daily");
    expect(SETUP_SYSTEM).toContain("never a nickname");
  });
  it("never name an eval household's people, cook or surname", () => {
    for (const h of HOUSEHOLDS) for (const name of [...h.truth.people.map((p) => p.name), ...(h.truth.cook ? [h.truth.cook.name] : [])])
      expect(SETUP_SYSTEM, `${h.id} ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
    for (const name of ["Sharma", "Iyer", "Shiva", "Reddy", "Agarwal", "Kulkarni", "Menon", "Banerjee", "Ankita", "Agastya", "Gowri"])
      expect(SETUP_SYSTEM, name).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  });
});
