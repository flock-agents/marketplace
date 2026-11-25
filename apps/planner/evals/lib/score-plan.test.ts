// Eval 2's scorer on a hand-made week for the unit-test household: the good week passes every gating field, and each
// defect fails the field it is there to catch. Plus the expected slot-days (attendance) and the staples.
import { describe, expect, test } from "bun:test";
import { expectedSlotDays, scorePlan } from "./score-plan";
import { setupOfTruth, perturb } from "./truth-setup";
import { staplesOf } from "./history";
import { baselineWeek } from "./baseline";
import { FIX } from "./test-fixture";
import { dateOf, type Weekday } from "./truth";
import type { PlanOut, SavedDish } from "./result";
import { BASE_TAGS } from "./vocab";

const MON = "2026-11-30";
const ALL3 = ["Asha", "Chotu", "Dadu Ram"];
const read = [...BASE_TAGS];
const newRow = (name: string, slot: string, contains: string[]): SavedDish => ({ slot, name, frequency: null, days: null, contains, contains_read: read, origin: "planner_suggested", suggested: true, untried: true });

/** The good week, by hand (see the plan notes in the test file's history: every count and window kept). */
function goodWeek(): PlanOut {
  const sd = (day: Weekday, slot: string, people: string[], dishes: string[], o: { skip?: string; guests?: number; isNew?: string[] } = {}) =>
    ({ date: dateOf(MON, day), slot, people, guests: o.guests ? [{ count: o.guests }] : [], skip: o.skip ?? null, dishes: dishes.map((name) => ({ name, ...(o.isNew?.includes(name) ? { new: true } : {}) })) });
  const withNani = (d: Weekday, ps: string[]) => (["Fri", "Sat", "Sun"].includes(d) ? [...ps, "Nani"] : ps);
  const B: Record<Weekday, string> = { Mon: "Poha", Tue: "Upma", Wed: "Idli", Thu: "Poha", Fri: "Upma", Sat: "Idli", Sun: "Dosa" };
  const L: Record<Weekday, string[]> = { Mon: ["Rice", "Dal", "Bhindi"], Tue: ["Rice", "Dal", "Aloo gobi"], Wed: ["Rice", "Dal"], Thu: ["Rice", "Dal", "Bhindi"], Fri: ["Rice", "Dal", "Aloo gobi"], Sat: ["Rice", "Dal"], Sun: ["Rice", "Dal"] };
  const D: Record<Weekday, string[]> = { Mon: ["Roti", "Dal"], Tue: ["Roti", "Lauki"], Wed: ["Roti", "Rajma"], Thu: ["Roti", "Dal"], Fri: ["Roti", "Lauki"], Sat: [], Sun: ["Roti", "Rajma"] };
  const days: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const slotDays = days.flatMap((d) => {
    const weekday = !["Sat", "Sun"].includes(d);
    const out = [
      sd(d, "Breakfast", withNani(d, d === "Mon" ? ["Asha", "Chotu"] : ALL3), [B[d]], { isNew: ["Dosa"] }),
      sd(d, "Lunch", withNani(d, d === "Mon" ? ["Chotu"] : weekday ? ["Chotu", "Dadu Ram"] : ALL3), L[d], { guests: d === "Sun" ? 2 : 0 }),
      d === "Sat" ? sd(d, "Dinner", withNani(d, ALL3), [], { skip: "ordered_in" }) : sd(d, "Dinner", withNani(d, ALL3), D[d]),
      d === "Sat" ? sd(d, "Dadu's dinner", ["Dadu Ram"], [], { skip: "ordered_in" }) : sd(d, "Dadu's dinner", ["Dadu Ram"], ["Phulka", ...(d === "Tue" || d === "Fri" ? ["Ragi roti"] : [])], { isNew: ["Ragi roti"] }),
    ];
    if (weekday) out.push(sd(d, "Chotu's tiffin", ["Chotu"], ["Sandwich"]));
    return out;
  });
  return { ok: true, week_start: MON, slotDays, library: [newRow("Dosa", "Breakfast", ["white_rice"]), newRow("Ragi roti", "Dadu's dinner", ["millet"])], unmet: [] };
}
const loaded = () => setupOfTruth(FIX);
const fails = (p: PlanOut, l = loaded()) => Object.entries(scorePlan(FIX, p, l).rates).filter(([, [a, n]]) => a < n).map(([k]) => k).sort();
const at = (p: PlanOut, day: Weekday, slot: string) => p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;

describe("expectedSlotDays", () => {
  const exp = expectedSlotDays(FIX, MON);
  const e = (day: Weekday, slot: string) => exp.find((x) => x.day === day && x.slot === slot);
  test("office lunch, a fast without food, a stay, guests, skip days (an add-on follows its main slot), slot days", () => {
    expect(e("Tue", "Lunch")!.people).toEqual(["Chotu", "Dadu Ram"]);
    expect(e("Mon", "Lunch")!.people).toEqual(["Chotu"]);
    expect(e("Mon", "Breakfast")!.people).toEqual(["Asha", "Chotu"]);
    expect(e("Fri", "Breakfast")!.people).toContain("Nani");
    expect(e("Fri", "Chotu's tiffin")!.people).toEqual(["Chotu"]);
    expect(e("Fri", "Dadu's dinner")!.people).toEqual(["Dadu Ram"]);
    expect(e("Sun", "Lunch")!.guests).toBe(2);
    expect(e("Sat", "Dinner")!.skip).toBe("ordered_in");
    expect(e("Sat", "Dadu's dinner")!.skip).toBe("ordered_in");
    expect(e("Sat", "Chotu's tiffin")).toBeUndefined();
  });
});

describe("staplesOf", () => {
  test("a dish in ≥ 60% of the slot's last 14 rows; newest dated rows first, then the seed", () => {
    const rows = [{ slot: "Lunch", dishes: ["Rice", "Dal"] }, { slot: "Lunch", dishes: ["Rice", "Rajma"] }, { slot: "Lunch", dishes: ["Rice", "Dal"] }, { slot: "Lunch", dishes: ["Roti"] }, { slot: "Dinner", dishes: ["Rice"] }];
    expect([...staplesOf(rows, "Lunch")].sort()).toEqual(["rice"]);
    const old = Array.from({ length: 14 }, (_, i) => ({ slot: "Lunch", dishes: ["Roti", "Dal"], date: `2026-10-${String(10 + i).padStart(2, "0")}` }));
    expect([...staplesOf([...rows, ...old], "Lunch")].sort()).toEqual(["dal", "roti"]);
  });
  test("fewer than 3 rows with dishes: only the daily dishes", () => {
    const two = [{ slot: "Dinner", dishes: ["Jowar roti"] }, { slot: "Dinner", dishes: ["Jowar roti"] }];
    expect([...staplesOf(two, "Dinner")]).toEqual([]);
    expect([...staplesOf(two, "Dinner", ["Phulka"])]).toEqual(["phulka"]);
    expect([...staplesOf([...two, { slot: "Dinner", dishes: ["Jowar roti", "Dal"] }], "Dinner")]).toEqual(["jowar roti"]);
  });
});

describe("scorePlan", () => {
  test("the good week passes every gating field; shape is tracked, not gating", () => {
    const s = scorePlan(FIX, goodWeek(), loaded());
    expect(fails(goodWeek())).toEqual([]);
    expect(s.rates.shape).toBeUndefined();
    expect(s.tracked.shape![1]).toBeGreaterThan(0);
    expect(s.facts.new_dishes).toBe(2);
  });

  test("filled, skips kept, nothing stray", () => {
    const p = goodWeek();
    at(p, "Wed", "Lunch").dishes = [];
    at(p, "Sat", "Dinner").dishes = [{ name: "Roti" }];
    p.slotDays.push({ date: dateOf(MON, "Sat"), slot: "Chotu's tiffin", people: ["Chotu"], guests: [], skip: null, dishes: [{ name: "Sandwich" }] });
    expect(fails(p)).toEqual(["filled", "no_stray", "skips_kept"]);
  });

  test("attendance: the office lunch, the fast, the stay; guests", () => {
    const p = goodWeek();
    at(p, "Tue", "Lunch").people = ALL3;
    at(p, "Mon", "Breakfast").people = ALL3;
    at(p, "Sun", "Dinner").people = ALL3;
    at(p, "Sun", "Lunch").guests = [];
    expect(fails(p)).toEqual(["attendance", "guests", "hard_rules"]);
  });

  test("hard rules per person: an egg dish breaks no-eggs; a dish not for the elder spares his rule", () => {
    const p = goodWeek();
    at(p, "Wed", "Breakfast").dishes = [{ name: "Egg bhurji", new: true }];
    p.library.push(newRow("Egg bhurji", "Breakfast", ["egg"]));
    expect(fails(p)).toContain("hard_rules");
    const q = goodWeek();
    at(q, "Wed", "Dinner").dishes.push({ name: "Kheer", new: true, not_for: ["Dadu Ram"] });
    q.library.push(newRow("Kheer", "Dinner", ["sugar", "dairy"]));
    expect(fails(q)).toEqual(["new_budget"]);
    at(q, "Wed", "Dinner").dishes.find((d) => d.name === "Kheer")!.not_for = [];
    expect(fails(q)).toEqual(["hard_rules", "new_budget"]);
    // not_for spares a rule only while the person keeps a dish of their own there (or at their own add-on that day).
    const r = goodWeek();
    for (const d of at(r, "Wed", "Lunch").dishes) d.not_for = ["Dadu Ram"];
    expect(fails(r)).toEqual(["hard_rules"]);
    const o = goodWeek();
    for (const d of at(o, "Wed", "Dinner").dishes) d.not_for = ["Dadu Ram"];
    expect(fails(o)).toEqual([]);
  });

  test("hard rules fail closed: a tag nobody read blocks the dish; the eval's own vocabulary overrides a wrong read", () => {
    const l = loaded();
    l.library.find((d) => d.name === "Upma")!.contains_read = ["sugar"];
    expect(fails(goodWeek(), l)).toEqual(["hard_rules"]);
    const p = goodWeek();
    p.library.find((d) => d.name === "Dosa")!.contains_read = [];
    expect(fails(p)).toEqual(["hard_rules"]);
    const q = goodWeek();
    at(q, "Sun", "Breakfast").dishes = [{ name: "Masala omelette", new: true }];
    q.library = [newRow("Masala omelette", "Breakfast", []), q.library[1]];
    expect(fails(q)).toEqual(["hard_rules"]);
  });

  test("library: a dish from another slot's library, and too many new dishes", () => {
    const p = goodWeek();
    at(p, "Wed", "Lunch").dishes = [{ name: "Rice" }, { name: "Dal" }, { name: "Lauki" }];
    expect(fails(p)).toEqual(["default_cap", "from_library"]);
    const q = goodWeek();
    at(q, "Wed", "Lunch").dishes.push({ name: "Cabbage poriyal", new: true });
    q.library.push(newRow("Cabbage poriyal", "Lunch", []));
    expect(fails(q)).toEqual(["new_budget"]);
  });

  test("a short slot the planner asks about has its own new dishes for its shortfall beside the setting (owner 24 Nov)", () => {
    // Breakfast: 7 days of one dish, Poha, Upma and Idli 2 days each: short by 1, so 1 new dish of its own.
    const p = goodWeek();
    at(p, "Wed", "Breakfast").dishes = [{ name: "Pesarattu", new: true }];
    p.library.push(newRow("Pesarattu", "Breakfast", []));
    expect(fails(p)).toEqual(["new_budget"]);   // 3 new dishes, setting 2, and no slot said to be short
    p.asked = ["I only know 3 dishes for breakfast, so I've added a new one, Pesarattu. What else do you have for breakfast?"];
    expect(fails(p)).toEqual([]);
    // Its allowance is the shortfall, no more: a second new breakfast dish is past it.
    at(p, "Thu", "Breakfast").dishes = [{ name: "Rava dosa", new: true }];
    p.library.push(newRow("Rava dosa", "Breakfast", []));
    expect(fails(p)).toEqual(["new_budget"]);
  });

  test("frequency and days per dish, counted in days across slots; the default cap; staples exempt", () => {
    const p = goodWeek();
    at(p, "Mon", "Dinner").dishes = [{ name: "Roti" }, { name: "Rajma" }];
    expect(fails(p)).toContain("dish_frequency");
    const q = goodWeek();
    at(q, "Sun", "Dinner").dishes = [{ name: "Roti" }, { name: "Khichdi" }];
    expect(fails(q)).toEqual(["dish_frequency"]);
    const r = goodWeek();
    at(r, "Sun", "Lunch").dishes.push({ name: "Bhindi" });
    expect(fails(r)).toEqual(["default_cap"]);
    // Rice at lunch every day is a staple: no cap, no window.
    expect(fails(goodWeek())).not.toContain("default_cap");
  });

  test("repeat window (3 days in a slot) and the same main twice a day across main slots", () => {
    const p = goodWeek();
    at(p, "Tue", "Breakfast").dishes = [{ name: "Poha" }];
    at(p, "Thu", "Breakfast").dishes = [{ name: "Idli" }];
    at(p, "Sat", "Breakfast").dishes = [{ name: "Upma" }];
    at(p, "Fri", "Breakfast").dishes = [{ name: "Idli" }];
    expect(fails(p)).toContain("repeat_window");
    const q = goodWeek();
    at(q, "Wed", "Lunch").dishes.push({ name: "Bhindi" });
    at(q, "Thu", "Lunch").dishes = [{ name: "Rice" }, { name: "Dal" }];
    at(q, "Wed", "Dinner").dishes = [{ name: "Roti" }, { name: "Rajma" }, { name: "Bhindi" }];
    expect(fails(q)).toContain("same_day_repeat");
  });

  test("a daily dish on every slot-day of its slot (hard), exempt from the repeat window and the cap", () => {
    const p = goodWeek();
    expect(scorePlan(FIX, p, loaded()).rates.daily_dishes).toEqual([6, 6]);
    at(p, "Wed", "Dadu's dinner").dishes = [{ name: "Lauki" }];
    expect(fails(p)).toContain("daily_dishes");
    expect(staplesOf([], "Dadu's dinner", ["Phulka"]).has("phulka")).toBe(true);
  });

  test("soft rule counts across slots (millets 2–3 times a week for him)", () => {
    const p = goodWeek();
    at(p, "Fri", "Dadu's dinner").dishes = [{ name: "Phulka" }];
    expect(fails(p)).toEqual(["soft_frequency"]);
  });

  test("perturbations change the loaded setup, never TRUTH", () => {
    const before = JSON.stringify(FIX.truth.library);
    for (const k of ["thin_library", "no_seed", "misfiled", "person_wrong_slot", "missing_contains"] as const) {
      const { setup, moved } = perturb(FIX, setupOfTruth(FIX), k);
      expect(moved.length).toBeGreaterThan(0);
      expect(JSON.stringify(setup)).not.toEqual(JSON.stringify(setupOfTruth(FIX)));
    }
    expect(JSON.stringify(FIX.truth.library)).toBe(before);
    expect(perturb(FIX, setupOfTruth(FIX), "person_wrong_slot").setup.library.find((d) => d.name === "Phulka")!.slot).toBe("Dinner");
  });

  test("the code-only baseline week fills every slot-day and keeps the hard rules", () => {
    const s = scorePlan(FIX, baselineWeek(FIX, MON), loaded());
    expect(s.rates.filled[0]).toBe(s.rates.filled[1]);
    expect(s.rates.hard_rules[0]).toBe(s.rates.hard_rules[1]);
  });
});

describe("scorePlan: a slot too thin for the default rules", () => {
  // Chotu's tiffin with one seed row of each of its two dishes: no staple, 2 dishes × 2 days < 5 school days.
  const thinFix = structuredClone(FIX);
  thinFix.truth.library = thinFix.truth.library.filter((d) => d.slot !== "Chotu's tiffin" || d.name === "Sandwich");
  thinFix.truth.library.push({ name: "Paratha roll", slot: "Chotu's tiffin" } as any);
  thinFix.truth.seed = [...thinFix.truth.seed.filter((r) => r.slot !== "Chotu's tiffin"), { slot: "Chotu's tiffin", dishes: ["Sandwich"] }, { slot: "Chotu's tiffin", dishes: ["Paratha roll"] }];
  const week = () => {
    const p = goodWeek();
    const tiffin: Record<string, string> = { Mon: "Sandwich", Tue: "Paratha roll", Wed: "Sandwich", Thu: "Paratha roll", Fri: "Sandwich" };
    for (const [d, dish] of Object.entries(tiffin)) at(p, d as Weekday, "Chotu's tiffin").dishes = [{ name: dish }];
    return p;
  };
  const failing = (p: PlanOut) => Object.entries(scorePlan(thinFix, p, setupOfTruth(thinFix)).rates).filter(([, [a, n]]) => a < n).map(([k]) => k).sort();

  test("said in unmet: a dish may come back on an even share of the days, every other day; not said: the default rules hold", () => {
    expect(failing(week())).toEqual(["default_cap", "repeat_window"]);
    const said = week();
    said.unmet = ["only 2 Chotu's tiffin dishes known, so some come back more often than usual"];
    expect(failing(said)).toEqual([]);
    // Back the next day is still sooner than the thin slot needs.
    at(said, "Thu", "Chotu's tiffin").dishes = [{ name: "Sandwich" }];
    expect(failing(said)).toContain("repeat_window");
  });
});

describe("add-on days may be empty (owner 23 Nov)", () => {
  test("an add-on day with no slot-day, or one with no dishes, is not counted unfilled; a main slot's still is", () => {
    const p = goodWeek();
    p.slotDays = p.slotDays.filter((x) => !(x.slot === "Dadu's dinner" && x.date === dateOf(MON, "Mon")));
    at(p, "Wed", "Dadu's dinner").dishes = [];
    expect(fails(p)).not.toContain("filled");
    at(p, "Wed", "Lunch").dishes = [];
    expect(fails(p)).toContain("filled");
  });
});

// The owner's base minimum (25 Nov), with onboarding run 31's own failures as the bad cases.
describe("scorePlan: the base minimum", () => {
  const set = (p: PlanOut, day: Weekday, slot: string, dishes: string[]) => { at(p, day, slot).dishes = dishes.map((name) => ({ name })); return p; };
  test("a bare staple, a lunch with no bread or rice, a staple twice", () => {
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Rice"]))).toEqual(expect.arrayContaining(["not_bare", "whole_plate"]));
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Dal", "Bhindi"]))).toContain("whole_plate");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Dal rice", "Rice", "Lauki"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti with aloo gobi", "Roti", "Rajma"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Khichdi"]))).not.toContain("whole_plate");
  });
  test("a main three times at breakfast", () => {
    const p = goodWeek();
    for (const d of ["Mon", "Tue", "Wed"] as Weekday[]) set(p, d, "Breakfast", ["Poha"]);
    expect(fails(p)).toContain("main_twice");
  });
  test("nobody without food; a clean message with one question at most", () => {
    const p = goodWeek();
    p.unmet = ["Tue Lunch: Dadu Ram has nothing to eat on 2026-12-01 Lunch but staples"];
    p.message = ["Your week is planned.", "Dinner: Chole, Rice, Roti. Chole is not for Dadu Ram; he has palak paneer with roti.",
      "New this week: Palak paneer (A vegetarian, high-protein dish that can be made without onion or garlic, and suits all family members.)",
      '"Office" (Asha), Mon: does it change who eats at home?', '"School" (Chotu), Mon: does it change who eats at home?'].join("\n");
    expect(fails(p)).toEqual(expect.arrayContaining(["nobody_without_food", "message_clean", "short_new_reasons", "one_question"]));
  });
});
