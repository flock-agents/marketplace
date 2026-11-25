// Eval 2's scorer on a hand-made week for the unit-test household: the good week passes every gating field, and each
// defect fails the field it is there to catch. Plus the expected slot-days (attendance) and the staples.
import { describe, expect, test } from "bun:test";
import { expectedSlotDays, scorePlan } from "./score-plan";
import { setupOfTruth, perturb } from "./truth-setup";
import { staplesOf } from "./history";
import { baselineWeek } from "./baseline";
import { PLAN_FIX as FIX } from "./test-fixture";
import { avoid, dateOf, type Weekday } from "./truth";
import type { PlanOut, SavedDish } from "./result";
import { BASE_TAGS } from "./vocab";

const MON = "2026-11-30";
const ALL3 = ["Asha", "Chotu", "Dadu Ram"];
const read = [...BASE_TAGS];
const newRow = (name: string, slot: string, contains: string[]): SavedDish => ({ slot, name, frequency: null, days: null, contains, contains_read: read, origin: "planner_suggested", suggested: true, untried: true });

/** The good week, by hand, held to the owner's rules (25 Nov kinds model): every slot-day filled for the right people, the
 *  food rules kept, a real dish named each time, the family's own items rotated within their kinds (no item back before the
 *  others of its kind are used, never the next day, never at lunch and dinner the same day), staples every day, new items
 *  only of the family's kinds. Breakfast rotates Poha, Upma, Idli and a new Rava idli; lunch's Toor dal and rice are staples,
 *  its sabzi (Bhindi, Aloo gobi) shares the Sabzi kind with dinner's Lauki; dinner's Toor dal and Rajma (2/week) rotate. */
function goodWeek(): PlanOut {
  const sd = (day: Weekday, slot: string, people: string[], dishes: string[], o: { skip?: string; guests?: number; isNew?: string[] } = {}) =>
    ({ date: dateOf(MON, day), slot, people, guests: o.guests ? [{ count: o.guests }] : [], skip: o.skip ?? null, dishes: dishes.map((name) => ({ name, ...(o.isNew?.includes(name) ? { new: true } : {}) })) });
  const withNani = (d: Weekday, ps: string[]) => (["Fri", "Sat", "Sun"].includes(d) ? [...ps, "Nani"] : ps);
  const B: Record<Weekday, string> = { Mon: "Poha", Tue: "Upma", Wed: "Idli", Thu: "Poha", Fri: "Upma", Sat: "Idli", Sun: "Rava idli" };
  const L: Record<Weekday, string[]> = { Mon: ["Rice", "Toor dal", "Bhindi"], Tue: ["Rice", "Toor dal", "Aloo gobi"], Wed: ["Rice", "Toor dal"], Thu: ["Rice", "Toor dal", "Bhindi"], Fri: ["Rice", "Toor dal", "Aloo gobi"], Sat: ["Rice", "Toor dal"], Sun: ["Rice", "Toor dal"] };
  const D: Record<Weekday, string[]> = { Mon: ["Roti", "Toor dal"], Tue: ["Roti", "Lauki"], Wed: ["Roti", "Rajma"], Thu: ["Roti", "Toor dal"], Fri: ["Roti", "Lauki"], Sat: [], Sun: ["Roti", "Rajma"] };
  const days: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const slotDays = days.flatMap((d) => {
    const weekday = !["Sat", "Sun"].includes(d);
    const out = [
      sd(d, "Breakfast", withNani(d, d === "Mon" ? ["Asha", "Chotu"] : ALL3), [B[d]], { isNew: ["Rava idli"] }),
      sd(d, "Lunch", withNani(d, d === "Mon" ? ["Chotu"] : weekday ? ["Chotu", "Dadu Ram"] : ALL3), L[d], { guests: d === "Sun" ? 2 : 0 }),
      d === "Sat" ? sd(d, "Dinner", withNani(d, ALL3), [], { skip: "ordered_in" }) : sd(d, "Dinner", withNani(d, ALL3), D[d]),
      d === "Sat" ? sd(d, "Dadu's dinner", ["Dadu Ram"], [], { skip: "ordered_in" }) : sd(d, "Dadu's dinner", ["Dadu Ram"], ["Phulka", ...(d === "Tue" || d === "Fri" ? ["Bajra roti"] : [])], { isNew: ["Bajra roti"] }),
    ];
    if (weekday) out.push(sd(d, "Chotu's tiffin", ["Chotu"], ["Sandwich"]));
    return out;
  });
  return { ok: true, week_start: MON, slotDays, library: [newRow("Rava idli", "Breakfast", ["wheat"]), newRow("Bajra roti", "Dadu's dinner", ["millet"])], unmet: [] };
}
const loaded = () => setupOfTruth(FIX);
const set = (p: PlanOut, day: Weekday, slot: string, dishes: string[]) => { at(p, day, slot).dishes = dishes.map((name) => ({ name })); return p; };
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
    // Kheer is no kind of the family's dinner (Roti, Dal, Sabzi, Khichdi): a new kind too.
    expect(fails(q)).toEqual(["new_budget", "no_new_kind"]);
    at(q, "Wed", "Dinner").dishes.find((d) => d.name === "Kheer")!.not_for = [];
    expect(fails(q)).toEqual(["hard_rules", "new_budget", "no_new_kind"]);
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
    p.library.find((d) => d.name === "Rava idli")!.contains_read = [];
    expect(fails(p)).toEqual(["hard_rules"]);
    const q = goodWeek();
    at(q, "Sun", "Breakfast").dishes = [{ name: "Masala omelette", new: true }];
    q.library = [newRow("Masala omelette", "Breakfast", []), q.library[1]];
    // An omelette is an Egg: no kind of their breakfast (Poha, Upma, Idli) either.
    expect(fails(q)).toEqual(["hard_rules", "no_new_kind"]);
  });

  test("library: a dish from another slot's library, and too many new dishes", () => {
    const p = goodWeek();
    at(p, "Wed", "Lunch").dishes = [{ name: "Rice" }, { name: "Toor dal" }, { name: "Lauki" }];
    // Lauki is dinner's; and Tuesday dinner's Lauki is back at Wednesday lunch, the next day.
    expect(fails(p)).toEqual(["from_library", "not_next_day"]);
    const q = goodWeek();
    at(q, "Wed", "Lunch").dishes.push({ name: "Cabbage poriyal", new: true });
    q.library.push(newRow("Cabbage poriyal", "Lunch", []));
    expect(fails(q)).toEqual(["new_budget"]);
  });

  test("a short slot the planner asks about has its own new dishes for its shortfall beside the setting (owner 24 Nov)", () => {
    // Breakfast: 7 days of one dish, Poha, Upma and Idli 2 days each: short by 1, so 1 new dish of its own.
    const p = goodWeek();
    at(p, "Wed", "Breakfast").dishes = [{ name: "Semiya upma", new: true }];
    p.library.push(newRow("Semiya upma", "Breakfast", []));
    expect(fails(p)).toEqual(["new_budget"]);   // 3 new dishes, setting 2, and no slot said to be short
    p.asked = ["I only know 3 dishes for breakfast, so I've added a new one, Semiya upma. What else do you have for breakfast?"];
    expect(fails(p)).toEqual([]);
    // Its allowance is the shortfall, no more: a second new breakfast dish is past it.
    at(p, "Thu", "Breakfast").dishes = [{ name: "Kanda poha", new: true }];
    p.library.push(newRow("Kanda poha", "Breakfast", []));
    expect(fails(p)).toEqual(["new_budget"]);
  });

  test("frequency and days per dish, counted in days across slots; no default cap any more (owner 25 Nov); staples exempt", () => {
    const p = goodWeek();
    at(p, "Mon", "Dinner").dishes = [{ name: "Roti" }, { name: "Rajma" }];
    expect(fails(p)).toContain("dish_frequency");
    const q = goodWeek();
    at(q, "Sun", "Dinner").dishes = [{ name: "Roti" }, { name: "Khichdi" }];
    expect(fails(q)).toEqual(["dish_frequency"]);
    // Bhindi a third day (Mon, Thu, Sun), every other sabzi of theirs used, never the next day: fine now.
    const r = goodWeek();
    at(r, "Sun", "Lunch").dishes.push({ name: "Bhindi" });
    expect(fails(r)).toEqual([]);
    expect(scorePlan(FIX, r, loaded()).rates.default_cap).toBeUndefined();
  });
  test("a frequency said of a dish at one meal holds at that meal only ('dal sometimes' at dinner; dal every lunch is fine)", () => {
    const h = { ...FIX, truth: { ...FIX.truth, library: FIX.truth.library.map((d) => (d.name === "Toor dal" && d.slot === "Dinner" ? { ...d, frequency: "sometimes" as const } : d)) } };
    const freq = (p: PlanOut) => scorePlan(h, p, loaded()).notes.filter((n) => n.startsWith("dish_frequency: Toor dal"));
    expect(freq(goodWeek())).toEqual([]);
    const p = goodWeek();
    for (const d of ["Tue", "Wed", "Fri", "Sun"] as Weekday[]) at(p, d, "Dinner").dishes = [{ name: "Roti" }, { name: "Toor dal" }];
    expect(freq(p)).toHaveLength(1);
  });

  // ── Rotation, owner 25 Nov (kinds model rule 3). Expectations written from the rules before the scorer. ──
  test("not_next_day: the same item on consecutive days in its slot fails", () => {
    const p = goodWeek();
    at(p, "Tue", "Breakfast").dishes = [{ name: "Poha" }];   // Poha Mon and Tue
    at(p, "Thu", "Breakfast").dishes = [{ name: "Upma" }];   // Upma Thu and Fri
    expect(fails(p)).toEqual(["not_next_day"]);
  });
  test("not_next_day: the same item at lunch and at dinner the same day, or dinner then the next lunch (a kind both use)", () => {
    const p = goodWeek();
    at(p, "Tue", "Dinner").dishes = [{ name: "Roti" }, { name: "Aloo gobi" }];   // Aloo gobi Tue lunch and Tue dinner
    at(p, "Fri", "Dinner").dishes = [{ name: "Roti" }, { name: "Lauki" }];
    expect(fails(p)).toContain("not_next_day");
    const q = goodWeek();
    at(q, "Wed", "Dinner").dishes = [{ name: "Roti" }, { name: "Bhindi" }];      // Bhindi Wed dinner, Thu lunch
    expect(fails(q)).toContain("not_next_day");
    // A staple is exempt: Toor dal at every lunch, rice every day, Phulka every night.
    expect(fails(goodWeek())).not.toContain("not_next_day");
    // Still a staple when the loaded seed (what setup saved, end to end) misses it: TRUTH's seed makes the family's staples too.
    const l = loaded();
    l.seed = l.seed.filter((r) => r.slot !== "Lunch");
    expect(fails(goodWeek(), l)).not.toContain("not_next_day");
  });
  test("no_early_repeat: an item back while another of the family's items of its kind went unused this week", () => {
    // Lunch's sabzi: Bhindi Mon and Thu, Aloo gobi never (dinner's Lauki is made Tue and Fri).
    const p = goodWeek();
    for (const d of ["Tue", "Fri"] as Weekday[]) set(p, d, "Lunch", ["Rice", "Toor dal"]);
    expect(fails(p)).toEqual(["no_early_repeat"]);
    expect(scorePlan(FIX, p, loaded()).notes.find((n) => n.startsWith("no_early_repeat"))).toContain("Aloo gobi");
    // Counted across lunch and dinner for a kind both use: Bhindi and Aloo gobi back at lunch while dinner's Lauki is never made.
    const q = goodWeek();
    const D: Record<string, string> = { Mon: "Toor dal", Tue: "Rajma", Wed: "Toor dal", Thu: "Rajma", Fri: "Toor dal", Sun: "Toor dal" };
    for (const [d, x] of Object.entries(D)) set(q, d as Weekday, "Dinner", ["Roti", x]);
    expect(fails(q)).toEqual(["no_early_repeat"]);
    expect(scorePlan(FIX, q, loaded()).notes.filter((n) => n.startsWith("no_early_repeat")).join(" ")).toContain("Lauki");
    // Breakfast's kinds are dish families (Poha, Upma, Idli): Poha back while Idli waits is no early repeat of a kind.
    const r = goodWeek();
    for (const d of ["Wed", "Sat"] as Weekday[]) set(r, d, "Breakfast", ["Upma"]);
    set(r, "Fri", "Breakfast", ["Poha"]);
    expect(fails(r)).not.toContain("no_early_repeat");
  });
  test("no_early_repeat: the family's own words allow a repeat (a frequency or days on the dish)", () => {
    const h = structuredClone(FIX);
    h.truth.library = h.truth.library.map((d) => (d.name === "Bhindi" ? { ...d, frequency: "sometimes" as const } : d));
    const p = goodWeek();
    const D: Record<string, string> = { Mon: "Toor dal", Tue: "Rajma", Wed: "Toor dal", Thu: "Rajma", Fri: "Toor dal", Sun: "Toor dal" };
    for (const [d, x] of Object.entries(D)) set(p, d as Weekday, "Dinner", ["Roti", x]);
    const s = scorePlan(h, p, setupOfTruth(h));
    // Bhindi twice is within "sometimes" (2–3) and their words let it come back; Aloo gobi (no words) back while Lauki waits fails.
    expect(Object.entries(s.rates).filter(([, [a, n]]) => a < n).map(([k]) => k)).toEqual(["no_early_repeat"]);
    expect(s.notes.filter((n) => n.startsWith("no_early_repeat")).join(" ")).toContain("Aloo gobi");
    expect(s.notes.filter((n) => n.startsWith("no_early_repeat")).join(" ")).not.toContain("Bhindi back");
  });

  test("a daily dish on every slot-day of its slot (hard), exempt from the rotation checks", () => {
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

describe("scorePlan: a slot with only two dishes", () => {
  // Chotu's tiffin with one seed row of each of its two dishes: no staple. Owner 25 Nov: no cap and no window any more, so
  // alternating them all week is right; the same box two days running is not.
  const thinFix = structuredClone(FIX);
  thinFix.truth.library = thinFix.truth.library.filter((d) => d.slot !== "Chotu's tiffin" || d.name === "Sandwich");
  thinFix.truth.library.push({ name: "Paratha roll", slot: "Chotu's tiffin", kind: "Roll" });
  thinFix.truth.seed = [...thinFix.truth.seed.filter((r) => r.slot !== "Chotu's tiffin"), { slot: "Chotu's tiffin", dishes: ["Sandwich"] }, { slot: "Chotu's tiffin", dishes: ["Paratha roll"] }];
  const week = () => {
    const p = goodWeek();
    const tiffin: Record<string, string> = { Mon: "Sandwich", Tue: "Paratha roll", Wed: "Sandwich", Thu: "Paratha roll", Fri: "Sandwich" };
    for (const [d, dish] of Object.entries(tiffin)) at(p, d as Weekday, "Chotu's tiffin").dishes = [{ name: dish }];
    return p;
  };
  const failing = (p: PlanOut) => Object.entries(scorePlan(thinFix, p, setupOfTruth(thinFix)).rates).filter(([, [a, n]]) => a < n).map(([k]) => k).sort();

  test("alternating passes, said in unmet or not; back the next day fails", () => {
    expect(failing(week())).toEqual([]);
    const next = week();
    at(next, "Thu", "Chotu's tiffin").dishes = [{ name: "Sandwich" }];
    expect(failing(next)).toEqual(["not_next_day"]);
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
  test("a bare staple, a lunch with no bread or rice, a staple twice", () => {
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Rice"]))).toEqual(expect.arrayContaining(["not_bare", "whole_plate"]));
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Dal", "Bhindi"]))).toContain("whole_plate");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Dal rice", "Rice", "Lauki"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti with aloo gobi", "Roti", "Rajma"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Khichdi"]))).not.toContain("whole_plate");
  });
  test("a main three days running at breakfast: the next day, not a cap (owner 25 Nov)", () => {
    const p = goodWeek();
    for (const d of ["Mon", "Tue", "Wed"] as Weekday[]) set(p, d, "Breakfast", ["Poha"]);
    expect(fails(p)).toEqual(["not_next_day"]);
  });
  test("real_dish: a bare kind or sub-kind word is not a dish; a staple's, an item's or a breakfast family's word is", () => {
    for (const bare of ["Sabzi", "Dal", "Curry", "Poriyal"]) expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti", bare]))).toContain("real_dish");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti", "Toor dal"]))).not.toContain("real_dish");
    expect(fails(goodWeek())).not.toContain("real_dish");   // Rice, Roti, Idli, Poha
    // The family's own bare word for a dish they fixed to a day is theirs to keep ("kadhi on Sundays").
    const h = structuredClone(FIX);
    h.truth.library.push({ name: "Kadhi", slot: "Dinner", days: ["Sun"] });
    const p = set(goodWeek(), "Sun", "Dinner", ["Roti", "Kadhi"]);
    expect(Object.entries(scorePlan(h, p, setupOfTruth(h)).rates).filter(([, [a, n]]) => a < n).map(([k]) => k)).not.toContain("real_dish");
  });
  test("no_new_kind: a new dish is of a kind the family's own dishes at that meal are; unplaceable fails", () => {
    const withNew = (name: string) => { const p = set(goodWeek(), "Mon", "Dinner", ["Roti", name]); at(p, "Mon", "Dinner").dishes[1].new = true; p.library.push(newRow(name, "Dinner", [])); return p; };
    expect(fails(withNew("Jeera aloo"))).not.toContain("no_new_kind");   // a Sabzi, like their Lauki
    expect(fails(withNew("Moong dal"))).not.toContain("no_new_kind");    // a Dal
    expect(fails(withNew("Pasta"))).toContain("no_new_kind");
    expect(fails(withNew("Mix veg curry"))).toContain("no_new_kind");    // Gravy: they make no gravy at dinner
    expect(fails(withNew("Zorba special"))).toContain("no_new_kind");    // the catalog cannot place it
  });
  test("own_share: at least 30% of the week's non-staple items are the family's own; staples do not count", () => {
    const p = goodWeek();
    const news = ["Masala dosa", "Rava dosa", "Set dosa", "Neer dosa", "Onion uttapam", "Pesarattu", "Ghee roast dosa"];
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as Weekday[]).forEach((d, i) => set(p, d, "Breakfast", [news[i]]));
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]) set(p, d, "Lunch", ["Rice", "Toor dal", ["Jeera aloo", "Gajar matar", "Cabbage sabzi", "Aloo methi", "Beans sabzi"][["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(d)]]);
    for (const d of ["Tue", "Fri"] as Weekday[]) set(p, d, "Dinner", ["Roti", d === "Tue" ? "Tinda sabzi" : "Turai sabzi"]);
    // Their own non-staples: Toor dal and Rajma at dinner, 4 of 18 (22%); rice, roti and lunch's toor dal are staples.
    expect(fails(p)).toContain("own_share");
    expect(scorePlan(FIX, p, loaded()).notes.find((n) => n.startsWith("own_share"))).toContain("22%");
  });
  test("a part named as a category (\"sambar\", \"sabzi\") makes the catalog's items of it theirs; the bare word stays no dish", () => {
    // Lead's rule (25 Nov): their dinner has "Sambar" (a sub-kind) and "Sabzi" (the kind's own sub-kind) as categories.
    const h = structuredClone(FIX);
    h.truth.library.push({ name: "Sambar", slot: "Dinner" }, { name: "Sabzi", slot: "Dinner" });
    const p = goodWeek();
    const news = ["Masala dosa", "Rava dosa", "Set dosa", "Neer dosa", "Onion uttapam", "Pesarattu", "Ghee roast dosa"];
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as Weekday[]).forEach((d, i) => set(p, d, "Breakfast", [news[i]]));
    const sab = ["Jeera aloo", "Gajar matar", "Aloo shimla mirch", "Methi bhaji", "Baingan aloo", "Arbi fry", "Karela fry"];
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as Weekday[]).forEach((d, i) => set(p, d, "Lunch", ["Rice", "Toor dal", sab[i]]));
    for (const [d, x] of [["Tue", "Dum aloo"], ["Fri", "Aloo matar"]] as const) set(p, d, "Dinner", ["Roti", x]);
    // Under 30% their own, so the scorer lists what is not theirs.
    set(p, "Mon", "Dinner", ["Roti", "Drumstick sambar", "Pepper rasam", "Aloo methi", "Beans poriyal"]);
    for (const d of at(p, "Mon", "Dinner").dishes.slice(1)) d.new = true;
    const sc = scorePlan(h, p, setupOfTruth(h));
    const notTheirs = sc.notes.find((n) => n.startsWith("own_share"))!.split("not theirs ")[1].split(", ");
    // Any Sambar is theirs, a Rasam is not (they named no rasam); a sabzi of their Sabzi sub-kind is, a poriyal is not.
    expect(notTheirs).toContain("Pepper rasam");
    expect(notTheirs).toContain("Beans poriyal");
    expect(notTheirs).not.toContain("Drumstick sambar");
    expect(notTheirs).not.toContain("Aloo methi");
    // Theirs is never new: no_new_kind does not look at them (Pepper rasam is a Rice curry, a kind their Sambar is: passes too).
    expect(sc.notes.filter((n) => n.startsWith("no_new_kind")).join(" ")).not.toMatch(/Drumstick sambar|Aloo methi/);
    // The bare word itself is still no dish.
    const q = set(goodWeek(), "Mon", "Dinner", ["Roti", "Sambar"]);
    expect(Object.entries(scorePlan(h, q, setupOfTruth(h)).rates).filter(([, [a, n]]) => a < n).map(([k]) => k)).toContain("real_dish");
  });
  test("a category makes a week their own: without it the same week is under 30%", () => {
    const h = structuredClone(FIX);
    h.truth.library.push({ name: "Sabzi", slot: "Lunch" });
    const p = goodWeek();
    const news = ["Masala dosa", "Rava dosa", "Set dosa", "Neer dosa", "Onion uttapam", "Pesarattu", "Ghee roast dosa"];
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as Weekday[]).forEach((d, i) => set(p, d, "Breakfast", [news[i]]));
    const sab = ["Jeera aloo", "Gajar matar", "Cabbage sabzi", "Aloo methi", "Beans sabzi", "Tinda sabzi", "Turai sabzi"];
    (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as Weekday[]).forEach((d, i) => set(p, d, "Lunch", ["Rice", "Toor dal", sab[i]]));
    for (const [d, x] of [["Tue", "Kaddu sabzi"], ["Fri", "Parwal sabzi"]] as const) set(p, d, "Dinner", ["Roti", x]);
    const share = (hh: typeof h) => scorePlan(hh, p, setupOfTruth(hh)).rates.own_share;
    // Theirs without the category: dinner's toor dal and rajma, 4 of 20 non-staples (20%); with lunch's "Sabzi", 11 of 20.
    expect(share(FIX)).toEqual([0, 1]);
    expect(share(h)).toEqual([1, 1]);
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

// Attendance gates tiers A and B (eval-e2e BASE, owner 25 Nov). A child with a school box of their own is not at the home
// weekday lunch: TRUTH's `away` says so, and the scorer holds the planner to it (h13: Lunch is for Anjali, Varun, Raghavan
// on weekdays; Vivaan joins at the weekend).
describe("attendance: a child with their own box", () => {
  test("is left out of the weekday home lunch, in at the weekend, for every household that has one", async () => {
    const { HOUSEHOLDS } = await import("../households");
    const h13 = HOUSEHOLDS.find((h) => h.id === "h13-familyb")!;
    const lunch = (h: typeof h13, d: Weekday) => expectedSlotDays(h, MON).find((e) => e.day === d && e.slot === "Lunch")!.people;
    expect(lunch(h13, "Mon")).toEqual(["Anjali", "Varun", "Raghavan"]);
    expect(lunch(h13, "Sat")).toEqual(["Anjali", "Varun", "Vivaan", "Raghavan"]);
    for (const [id, child] of [["h1-sharma", "Vihaan"], ["h13-familyb", "Vivaan"], ["h14-familyb2", "Nila"], ["h4-reddy", "Karan"]]) {
      const h = HOUSEHOLDS.find((x) => x.id === id)!;
      for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]) expect(lunch(h, d)).not.toContain(child);
      expect(lunch(h, "Sun")).toContain(child);
    }
    // The truth's own week passes attendance; the child put back at Monday's lunch fails it.
    const good = baselineWeek(h13, MON), setup = setupOfTruth(h13);
    const att = (p: PlanOut) => scorePlan(h13, p, setup, { failClosed: false }).rates.attendance;
    expect(att(good)[0]).toBe(att(good)[1]);
    const bad = baselineWeek(h13, MON);
    bad.slotDays.find((x) => x.date === MON && x.slot === "Lunch")!.people.push("Vivaan");
    expect(att(bad)[1] - att(bad)[0]).toBe(1);
  });
});

describe("scorePlan: a dish named made without an item", () => {
  test("\"Dal without onion and garlic\" breaks no onion-garlic rule by its name", () => {
    const p = goodWeek();
    at(p, "Mon", "Lunch").dishes = [{ name: "Rice" }, { name: "Dal without onion and garlic" }];
    at(p, "Tue", "Lunch").dishes = [{ name: "Rice" }, { name: "Moong dal (no onion garlic)" }];
    const s = scorePlan(FIX, p, loaded(), { failClosed: false });
    expect(s.notes.filter((n) => /without onion|no onion/i.test(n) && n.startsWith("hard_rules"))).toEqual([]);
  });
});

describe("scorePlan: onion and garlic (owner rule 7, decided 5)", () => {
  // Onion and garlic never block a dish: it is planned with "make without onion and garlic, or keep <person>'s portion
  // aside"; only a dish that is mostly onion is a break.
  const h = { ...FIX, truth: { ...FIX.truth, library: FIX.truth.library.map((d) => (d.name === "Lauki" ? { ...d, contains: ["onion_garlic"] } : d)),
    rules: [...FIX.truth.rules, avoid("no_og", "Dadu Ram: no onion or garlic", ["onion_garlic"], /onion/i, { who: "Dadu Ram" })] } };
  const withOnion = () => { const l = loaded(); l.library = l.library.map((d) => (d.name === "Lauki" ? { ...d, contains: ["onion_garlic"] } : d)); return l; };
  const og = (p: PlanOut) => scorePlan(h, p, withOnion(), { failClosed: false }).notes.filter((n) => n.startsWith("hard_rules: Dadu Ram: no onion"));
  const noted = (p: PlanOut, name: string, note: string) => { for (const sd of p.slotDays) for (const d of sd.dishes) if (d.name === name) d.note = note; return p; };
  test("a dish with onion and no note for him is a break", () => {
    expect(og(goodWeek())).toHaveLength(1);
  });
  test("the same dish with the note naming him is kept", () => {
    expect(og(noted(goodWeek(), "Lauki", "make without onion and garlic, or keep Dadu Ram's portion aside"))).toEqual([]);
    expect(og(noted(goodWeek(), "Lauki", "make without onion and garlic, or keep Asha and Dadu Ram's portion aside"))).toEqual([]);
  });
  test("a note for someone else, or a dish that is mostly onion, is still a break", () => {
    expect(og(noted(goodWeek(), "Lauki", "make without onion and garlic, or keep Asha's portion aside"))).toHaveLength(1);
    const p = goodWeek();
    at(p, "Wed", "Dinner").dishes = [{ name: "Roti" }, { name: "Pyaaz ki sabzi", note: "make without onion and garlic, or keep Dadu Ram's portion aside" }];
    expect(og(p)).toHaveLength(1);
  });
});
