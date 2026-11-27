// Eval 1's scorer on hand-made setups: each field passes on TRUTH and fails on the defect it is there to catch.
import { describe, expect, test } from "bun:test";
import { effective, familyWords, sameParts, scoreSetup, slotMap } from "./score-setup";
import { cookOf } from "./adapter";
import { setupOfTruth } from "./truth-setup";
import { FIX, BOX_FIX } from "./test-fixture";
import { linked, kindPart } from "./truth";
import type { SavedRule, SetupOut } from "./result";

const base = () => setupOfTruth(FIX);
const fails = (s: SetupOut, o: { transcript?: string[] } = {}) =>
  Object.entries(scoreSetup(FIX, s, o).rates).filter(([, [p, n]]) => p < n).map(([k]) => k).sort();
const rule = (r: Partial<SavedRule>): SavedRule => ({ hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "", ...r });

describe("scoreSetup", () => {
  test("TRUTH passes every field", () => expect(fails(base())).toEqual([]));

  test("slots: a custom slot under another name is found by its pattern; a missing add-on, a wrong kind and an extra slot fail", () => {
    const s = base();
    s.slots.find((x) => x.name === "Chotu's tiffin")!.name = "Tiffin";
    s.library.filter((d) => d.slot === "Chotu's tiffin").forEach((d) => (d.slot = "Tiffin"));
    s.seed.filter((d) => d.slot === "Chotu's tiffin").forEach((d) => (d.slot = "Tiffin"));
    expect(fails(s)).toEqual([]);
    expect(slotMap(FIX.truth.slots, s.slots).get("Chotu's tiffin")).toBe("Tiffin");

    const noAddon = base();
    noAddon.slots = noAddon.slots.filter((x) => x.kind !== "addon");
    expect(fails(noAddon)).toContain("slots_present");

    const wrongKind = base();
    wrongKind.slots.find((x) => x.kind === "addon")!.kind = "custom";
    expect(fails(wrongKind)).toEqual(["slot_kind"]);

    const extra = base();
    extra.slots.push({ name: "Evening snack", kind: "custom", addon_of: null, usual_people: [], days: [], skip_days: [] });
    expect(fails(extra)).toEqual(["no_extra_slots"]);
  });

  test("slots: usual people (everyone listed by name = everyone), days and skip days", () => {
    const all = base();
    all.slots.find((x) => x.name === "Lunch")!.usual_people = ["Asha", "Chotu", "Dadu Ram"];
    expect(fails(all)).toEqual([]);
    const s = base();
    s.slots.find((x) => x.name === "Chotu's tiffin")!.usual_people = ["Chotu", "Asha"];
    s.slots.find((x) => x.name === "Chotu's tiffin")!.days = [];
    s.slots.find((x) => x.name === "Dinner")!.skip_days = [{ day: "Sat", skip: "eaten_out" }];
    expect(fails(s)).toEqual(["skip_days", "slot_days", "slot_people"]);
  });

  test("weekday attendance (when read) and lunch_unclear", () => {
    const s = base();
    s.attendance!.Lunch!.Mon = ["Asha", "Chotu", "Dadu Ram"];
    expect(fails(s)).toEqual(["attendance"]);
    const u = base();
    u.lunch_unclear = ["Asha"];
    expect(fails(u)).toEqual(["lunch_unclear"]);
    const none = base();
    delete none.attendance;
    expect(Object.keys(scoreSetup(FIX, none).rates)).not.toContain("attendance");
  });

  test("library: a misfiled dish, a person's dish on the shared slot, a lost or invented frequency", () => {
    const mis = base();
    mis.library.find((d) => d.name === "Bhindi")!.slot = "Breakfast";
    expect(fails(mis)).toEqual(["placement", "rows_on_right_slot"]);

    const personal = base();
    personal.library.find((d) => d.name === "Phulka")!.slot = "Dinner";
    expect(fails(personal)).toEqual(["personal_placement", "placement", "rows_on_right_slot"].sort());

    const shared = base();
    shared.library.push({ ...shared.library.find((d) => d.name === "Roti")!, slot: "Dadu's dinner" });
    expect(fails(shared)).toEqual(["no_wrong_personal", "rows_on_right_slot"]);

    const lost = base();
    lost.library.find((d) => d.name === "Rajma")!.frequency = null;
    lost.library.find((d) => d.name === "Khichdi")!.days = null;
    expect(fails(lost)).toEqual(["dish_frequency"]);

    const invented = base();
    invented.library.find((d) => d.name === "Lauki")!.frequency = "sometimes";
    expect(fails(invented)).toEqual(["no_unsaid_frequency"]);
  });

  test("rules: equivalent forms pass (veg kinds, `only` on days, split items)", () => {
    expect(effective({ what: "only", items: ["meat"], days: ["Sat", "Sun"] })).toEqual({ what: "avoid", items: ["meat"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
    expect(effective({ what: "veg" }).items).toEqual(["meat", "fish"]);
    const s = base();
    s.rules = s.rules.map((r) => (r.what === "no_eggs" ? { ...r, what: "avoid", items: ["@eggs"] } : r));
    expect(fails(s)).toEqual([]);
  });

  test("dish_frequency: a count or day the family's words never say with the dish is not required (h15 curd daily, h17 curd)", () => {
    const lost = base();
    lost.library.find((d) => d.name === "Rajma")!.frequency = null;
    lost.library.find((d) => d.name === "Khichdi")!.days = null;
    const dishes = (rajma: string, khichdi: string) => [`A: Dinner is roti, lauki, ${rajma}, ${khichdi}.`];
    // Said with the dish: still lost. Never said (the dish named bare): not scored.
    expect(fails(lost, { transcript: dishes("rajma twice a week", "khichdi on Saturday") })).toContain("dish_frequency");
    expect(fails(lost, { transcript: dishes("rajma", "khichdi") })).not.toContain("dish_frequency");
    expect(Object.keys(scoreSetup(FIX, lost, { transcript: dishes("rajma twice a week", "khichdi") }).rates).includes("dish_frequency")).toBe(true);
  });

  test("rules: a hard or soft rule the family's words never say is not required of the setup (h15 vegetarian, h16 beef and pork)", () => {
    const missing = base();
    missing.rules = missing.rules.filter((r) => r.what !== "fasting");
    // Said ("fasts"): still missing. Never said: nothing to read, not scored.
    expect(fails(missing, { transcript: ["A: Dadu Ram fasts on Mondays"] })).toContain("hard_rules");
    expect(fails(missing, { transcript: ["A: we eat roti and dal"] })).not.toContain("hard_rules");
  });

  test("rules: missing, hard saved soft, soft saved hard, lost frequency, unsaid, quote not said, frequency on a hard rule", () => {
    const missing = base();
    missing.rules = missing.rules.filter((r) => r.what !== "fasting");
    expect(fails(missing)).toEqual(["hard_rules"]);

    const soft = base();
    soft.rules.find((r) => r.items?.includes("sugar"))!.hard = false;
    expect(fails(soft)).toEqual(["hard_soft"]);

    const hard = base();
    hard.rules.find((r) => r.what === "require")!.hard = true;
    expect(fails(hard)).toEqual(["hard_no_frequency", "hard_soft"]);

    const freq = base();
    freq.rules.find((r) => r.what === "require")!.frequency = "usually";
    expect(fails(freq)).toEqual(["rule_frequency"]);

    const unsaid = base();
    unsaid.rules.push(rule({ items: ["onion_garlic"], quote: "no onion" }));
    expect(fails(unsaid)).toEqual(["no_unsaid_rules"]);

    const hardFreq = base();
    hardFreq.rules.find((r) => r.items?.includes("sugar"))!.frequency = "sometimes";
    expect(fails(hardFreq)).toEqual(["hard_no_frequency"]);

    const quoted = base();
    const transcript = ["Q: rules?", "A: No eggs at home, and Dadu Ram fasts on Monday till evening. Dadu Ram: no sugar.", "A: Millets are good for Dadu Ram, a few times a week. Less salt for him."];
    expect(familyWords(FIX, transcript)).toContain(" no eggs at home ");
    quoted.rules.find((r) => r.what === "require")!.quote = "millets daily for Dadu";
    expect(fails(quoted, { transcript })).toContain("rule_quotes");
  });

  test("noted: kept as noted passes; saved as a weekday fast fails", () => {
    const s = base();
    s.unplaced = [];
    expect(fails(s)).toEqual(["noted"]);
    s.rules.push(rule({ what: "fasting", who: "Dadu Ram", days: ["Thu"], quote: "On Ekadashi he eats only fruit" }));
    expect(scoreSetup(FIX, s).notes.join()).toContain("weekday fast");
  });

  test("seed: a slot without seed, and a seed row of another slot's dishes", () => {
    const s = base();
    s.seed = s.seed.filter((r) => r.slot !== "Lunch");
    expect(fails(s)).toEqual(["seed_present"]);
    const w = base();
    w.seed.push({ slot: "Breakfast", dishes: ["Rajma", "Roti"] });
    expect(fails(w)).toEqual(["seed_on_slot"]);
  });

  test("cook: days, the corrected visit time, family cooks", () => {
    const s = base();
    s.cook!.visits[0].at = "07:30";
    s.family_cooks = [];
    expect(fails(s)).toEqual(["cook_times", "family_cooks"]);
  });
});

// Kinds model (owner, 25 Nov): the cuisine profile and each meal's templates, read through the adapter. Expectations from the
// contract: a template is the same plate when its kinds match part for part; a family's fixed dish stays a fixed-dishes part.
describe("scoreSetup: cuisines and templates", () => {
  const h2 = async () => (await import("../households")).HOUSEHOLDS.find((h) => h.id === "h2-iyer")!;
  const h1 = async () => (await import("../households")).HOUSEHOLDS.find((h) => h.id === "h1-sharma")!;
  const failing = (h: Parameters<typeof scoreSetup>[0], s: SetupOut) => Object.entries(scoreSetup(h, s).rates).filter(([, [p, n]]) => p < n).map(([k]) => k).sort();

  test("TRUTH passes; nothing read yet fails each; an adapter that cannot read them scores nothing", async () => {
    const h = await h2();
    expect(failing(h, setupOfTruth(h))).toEqual([]);
    const r = scoreSetup(h, setupOfTruth(h)).rates;
    expect(r.cuisines).toEqual([2, 2]);
    expect(r.templates![1]).toBe(8);
    const none = setupOfTruth(h);
    none.cuisines = null;
    for (const sl of none.slots) { sl.kinds = null; sl.templates = null; }
    expect(failing(h, none)).toEqual(["cuisines", "template_staples", "templates"]);
    const unread = setupOfTruth(h);
    delete unread.cuisines;
    for (const sl of unread.slots) { delete sl.kinds; delete sl.templates; }
    const u = scoreSetup(h, unread).rates;
    expect(u.cuisines).toBeUndefined();
    expect(u.templates).toBeUndefined();
  });

  test("cuisines: a neighbouring region of theirs may be read; one they have nothing of may not", async () => {
    const h = await h2();
    const s = setupOfTruth(h);
    s.cuisines = ["south", "tamil", "kerala"];
    expect(failing(h, s)).toEqual([]);
    s.cuisines = ["south", "tamil", "punjab"];
    expect(failing(h, s)).toEqual(["cuisines"]);
    s.cuisines = ["south"];
    expect(failing(h, s)).toEqual(["cuisines"]);
  });

  test("templates: the same kinds part for part; a part missing or a kind changed fails; sub-kinds are reported only", async () => {
    const h = await h2();
    const s = setupOfTruth(h);
    const lunch = s.slots.find((x) => x.name === "Lunch")!;
    // [Rice, Sambar, Rasam, Poriyal, Curd] saved as kinds without sub-kinds: the same plate (template_subs notes it). Their bare
    // "rasam" keeps its one dish and words (Tomato rasam): those are compared, sub-kinds are not.
    lunch.templates![0].parts = [{ kind: "Rice" }, { kind: "Rice curry" }, { kind: "Rice curry", dish: "Tomato rasam", words: "rasam" }, { kind: "Sabzi" }, { kind: "Curd" }];
    expect(failing(h, s)).toEqual([]);
    expect(scoreSetup(h, s).info.template_subs).toEqual([6, 7]);   // of the 7 templates that name sub-kinds, this one no longer does
    // One rice curry only: not the plate.
    lunch.templates![0].parts = [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Sabzi" }, { kind: "Curd" }];
    expect(failing(h, s)).toEqual(["templates"]);
    // Rice no longer a staple.
    const t = setupOfTruth(h);
    t.slots.find((x) => x.name === "Lunch")!.kinds!.find((k) => k.name === "Rice")!.staple = false;
    expect(failing(h, t)).toEqual(["template_staples"]);
  });

  test("templates: their fixed dish (rajma chawal twice a week) is a fixed-dishes part, not the kind Dal", async () => {
    const h = await h1();
    const s = setupOfTruth(h);
    expect(failing(h, s)).toEqual([]);
    const lunch = s.slots.find((x) => x.name === "Lunch")!;
    lunch.templates![1].parts = [{ kind: "Dal", sub: "Rajma/Chole" }, { kind: "Raita" }];
    expect(failing(h, s)).toEqual(["templates"]);
    lunch.templates![1].parts = [{ items: ["Rajma chawal"] }, { kind: "Raita" }];
    expect(failing(h, s)).toEqual([]);
  });
});


describe("scoreSetup: the one meaning model", () => {
  // BOX_FIX with the meals the household's own words give: the lunch sabzi named "dry sabji", an egg paratha roll as fixed dishes.
  const HW = (() => {
    const h = structuredClone(BOX_FIX);
    h.truth.meals = [
      { slot: "Lunch", templates: [{ parts: [kindPart("Rice"), kindPart("Sabzi", { sub: "Sabzi", words: "dry sabji" })] }] },
      { slot: "Chotu's lunch box", templates: [{ parts: [kindPart("Paratha", { words: "paratha", dish: "Plain paratha" }), linked("Lunch", "Sabzi")] }, { parts: [{ items: ["Egg paratha roll"] }] }] },
    ];
    return h;
  })();
  const good = () => setupOfTruth(HW);
  const failing = (s: SetupOut, h = HW) => Object.entries(scoreSetup(h, s).rates).filter(([, [p, n]]) => p < n).map(([k]) => k).sort();
  const boxOf = (s: SetupOut) => s.slots.find((x) => x.name === "Chotu's lunch box")!;

  test("TRUTH passes every field, with the box's typed rules, extras and linked part", () => {
    expect(failing(good())).toEqual([]);
    expect(boxOf(good()).order).toBe(35);
    expect(good().slots.find((x) => x.name === "Asha's lunch extras")!.extras).toBe(true);
    expect(good().rules.find((r) => r.who === "Dadu Ram" && r.what === "swap")).toMatchObject({ targets: [{ type: "kind", kind: "Roti" }], gives: { type: "item", item: "Plain paratha", kind: "Paratha" } });
  });

  test("templates: a linked part, its words and its dish are compared", () => {
    const wrongLink = good();
    boxOf(wrongLink).templates![0].parts = [{ kind: "Paratha", words: "paratha", dish: "Plain paratha" }, { kind: "Sabzi" }];
    expect(failing(wrongLink)).toEqual(["templates"]);
    const wrongFrom = good();
    boxOf(wrongFrom).templates![0].parts = [{ kind: "Paratha", words: "paratha", dish: "Plain paratha" }, { from: "Dinner", kind: "Sabzi" }];
    expect(failing(wrongFrom)).toEqual(["templates"]);
    const noWords = good();
    noWords.slots.find((x) => x.name === "Lunch")!.templates![0].parts = [{ kind: "Rice" }, { kind: "Sabzi", sub: "Sabzi" }];
    expect(failing(noWords)).toEqual(["templates"]);
    const noDish = good();
    boxOf(noDish).templates![0].parts[0] = { kind: "Paratha", words: "paratha" };
    expect(failing(noDish)).toEqual(["templates"]);
  });

  test("hard_rules: the saved rule's typed targets and a swap's gives are compared when TRUTH states them", () => {
    const untyped = good();
    for (const r of untyped.rules) { delete r.targets; delete r.gives; }
    expect(failing(untyped)).toEqual(["hard_rules"]);
    expect(scoreSetup(HW, untyped).notes.filter((n) => n.startsWith("hard_rules: Dadu Ram: parathas")).length).toBe(1);
    const noGives = good();
    noGives.rules.find((r) => r.what === "swap")!.gives = null;
    expect(failing(noGives)).toEqual(["hard_rules"]);
    const wrongItem = good();
    wrongItem.rules.find((r) => r.what === "swap")!.gives = { type: "item", item: "Pancakes", kind: null };
    expect(failing(wrongItem)).toEqual(["hard_rules"]);
    const wrongTag = good();
    wrongTag.rules.find((r) => r.who === "Dadu Ram" && r.what === "avoid" && r.items?.includes("egg"))!.targets = [{ type: "ingredient", tag: "dairy" }];
    expect(failing(wrongTag)).toEqual(["hard_rules"]);
  });

  test("real_dish: a saved library row named their word for a part fails, a dish of an items part does not", () => {
    const s = good();
    s.library.push({ slot: "Lunch", name: "Dry sabji", frequency: null, days: null, contains: [], contains_read: [], origin: "setup_named" });
    expect(failing(s)).toContain("real_dish");
    const ok = good();
    ok.library.push({ slot: "Chotu's lunch box", name: "Egg paratha roll", frequency: null, days: null, contains: [], contains_read: [], origin: "setup_named" });
    expect(failing(ok)).not.toContain("real_dish");
  });

  test("no_filling_kind: a saved own kind named after a filling of a TRUTH item fails", () => {
    const s = good();
    boxOf(s).kinds = [{ name: "Paratha" }, { name: "Egg", own: true }];
    boxOf(s).templates![1].parts = [{ items: ["Egg paratha roll"] }, { kind: "Egg" }];
    expect(failing(s)).toContain("no_filling_kind");
    expect(scoreSetup(HW, good()).rates.no_filling_kind).toEqual([1, 1]);
  });

  test("cook_times: a visit TRUTH gives no time for is not compared", () => {
    const h = structuredClone(FIX);
    h.truth.cook!.visits = [{ meals: ["Breakfast", "Lunch", "Dinner"] }];
    const s = setupOfTruth(h);
    s.cook!.visits = [{ at: "07:30", meals: ["Breakfast", "Lunch", "Dinner"] }];
    expect(Object.entries(scoreSetup(h, s).rates).filter(([, [p, n]]) => p < n).map(([k]) => k)).toEqual([]);
    const timed = structuredClone(FIX);
    expect(Object.entries(scoreSetup(timed, { ...setupOfTruth(timed), cook: { ...setupOfTruth(timed).cook!, visits: [{ at: "09:00", meals: ["Breakfast", "Lunch", "Dinner"] }] } }).rates).filter(([, [p, n]]) => p < n).map(([k]) => k)).toEqual(["cook_times"]);
  });
});

// History keeps the family's words (spec §5.3): a seed plate of their part words ("Rice, Sambar") is that slot's plate, though no
// category word is a library row; a plate of dishes of no part or row of theirs is not.
describe("scoreSetup: seed plates in their words", () => {
  test("a seed row of their part words is on its slot; one of foreign dishes is not", async () => {
    const h = (await import("../households")).HOUSEHOLDS.find((x) => x.id === "h14-familyb2")!;
    const s = setupOfTruth(h);
    expect(h.truth.library.some((d) => d.name === "Sambar" || d.name === "Rice")).toBe(false);
    s.seed = [{ slot: "Lunch", dishes: ["Rice", "Sambar", "Poriyal", "Curd"] }];
    expect(scoreSetup(h, s).rates.seed_on_slot).toEqual([1, 1]);
    s.seed = [{ slot: "Lunch", dishes: ["Pizza", "Burger", "Curd"] }];
    expect(scoreSetup(h, s).rates.seed_on_slot).toEqual([0, 1]);
  });
});

// A kind part's one dish is theirs even when their word for the part is the dish's name ("usal or pithla": Pithla).
describe("scoreSetup: real_dish and a part's one dish", () => {
  test("a library row that is a part's dish passes; their bare word for another part fails", async () => {
    const h = (await import("../households")).HOUSEHOLDS.find((x) => x.id === "h6-kulkarni")!;
    const s = setupOfTruth(h);
    expect(s.library.some((d) => d.name === "Pithla" && d.slot === "Dinner")).toBe(true);
    expect(scoreSetup(h, s).rates.real_dish).toEqual([s.library.length, s.library.length]);
    s.library.push({ ...s.library[0], name: "Usal", slot: "Dinner" });
    expect(scoreSetup(h, s).notes).toContain("real_dish: Usal saved as a dish at Dinner: it is their word for a part");
  });
});

// ── F9 (Task 15 G5, lead's OD5 ruling, F5 follow-on) ──
describe("scoreSetup: F9 a named dish said alone as {kind, dish}, and a nameless cook", () => {
  test("OD5: a saved {kind, dish: X} part matches TRUTH's items(X); a kind part without that dish, or of another dish, does not", () => {
    const want = [{ kind: "Roti" }, { items: ["Egg curry"] }];
    expect(sameParts(want, [{ kind: "Roti" }, { kind: "Egg", dish: "Egg curry", words: "egg curry" }])).toBe(true);
    expect(sameParts(want, [{ kind: "Roti" }, { items: ["Egg curry"] }])).toBe(true);
    // Bad: the kind with no dish (any egg dish), another egg dish, or the dish under a kind it is not.
    expect(sameParts(want, [{ kind: "Roti" }, { kind: "Egg" }])).toBe(false);
    expect(sameParts(want, [{ kind: "Roti" }, { kind: "Egg", dish: "Egg roast" }])).toBe(false);
    expect(sameParts(want, [{ kind: "Roti" }, { kind: "Paneer", dish: "Egg curry" }])).toBe(false);
  });

  const nameless = (): { h: typeof FIX; s: SetupOut } => {
    const h = structuredClone(FIX);
    h.truth.cook = { ...h.truth.cook!, name: "Cook" };   // h18's TRUTH: the role word, no name said
    const s = setupOfTruth(h);
    s.cook = { ...s.cook!, name: null };
    return { h, s };
  };
  const failing = (h: typeof FIX, s: SetupOut) => Object.entries(scoreSetup(h, s).rates).filter(([, [p, n]]) => p < n).map(([k]) => k).sort();
  test("a nameless cook (no cook_name, her days set) loads from the house row and scores as the cook", () => {
    expect(cookOf({ cook_name: null, cook_days: '["Mon","Tue"]', cook_arrival: '[{"meals":["Dinner"]}]' })).toEqual({ name: null, days: ["Mon", "Tue"], visits: [{ meals: ["Dinner"] }] });
    expect(cookOf({ cook_name: "Lakshmi", cook_days: '["Mon"]', cook_arrival: "08:00" })).toEqual({ name: "Lakshmi", days: ["Mon"], visits: [{ at: "08:00" }] });
    expect(cookOf({ cook_name: null, cook_days: null, cook_arrival: null })).toBeNull();
    expect(cookOf({ cook_name: null, cook_days: "[]", cook_arrival: null })).toBeNull();
    const { h, s } = nameless();
    expect(failing(h, s)).toEqual([]);
  });
  test("bad: a nameless TRUTH cook saved under the role word, with the wrong days, or not at all; a named one saved nameless", () => {
    const { h, s } = nameless();
    expect(failing(h, { ...s, cook: { ...s.cook!, name: "cook" } })).toEqual(["cook_days"]);
    expect(failing(h, { ...s, cook: { ...s.cook!, days: ["Mon"] } })).toEqual(["cook_days"]);
    expect(failing(h, { ...s, cook: null })).toEqual(["cook_days", "cook_times"]);
    const named = setupOfTruth(FIX);
    expect(fails({ ...named, cook: { ...named.cook!, name: null } })).toEqual(["cook_days"]);
    // A house with no paid cook: a nameless cook saved is a paid cook nobody said.
    const none = structuredClone(FIX);
    none.truth.cook = null;
    expect(failing(none, { ...setupOfTruth(none), cook: { name: null, days: ["Mon"], visits: [] } })).toEqual(["cook_days"]);
  });
});
