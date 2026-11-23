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
