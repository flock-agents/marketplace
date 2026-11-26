// Eval 1's scorer on hand-made setups: each field passes on TRUTH and fails on the defect it is there to catch.
import { describe, expect, test } from "bun:test";
import { effective, familyWords, scoreSetup, slotMap } from "./score-setup";
import { setupOfTruth } from "./truth-setup";
import { FIX } from "./test-fixture";
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
    // [Rice, Sambar, Rasam, Poriyal, Curd] saved as kinds without sub-kinds: the same plate (template_subs notes it).
    lunch.templates![0].parts = [{ kind: "Rice" }, { kind: "Rice curry" }, { kind: "Rice curry" }, { kind: "Sabzi" }, { kind: "Curd" }];
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
