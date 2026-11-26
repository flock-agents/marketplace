// Eval 2's scorer on a hand-made week for the unit-test household: the good week passes every gating field, and each
// defect fails the field it is there to catch. Plus the expected slot-days (attendance) and the staples.
import { describe, expect, test } from "bun:test";
import { expectedSlotDays, scorePlan } from "./score-plan";
import { setupOfTruth, perturb } from "./truth-setup";
import { staplesOf } from "./history";
import { baselineWeek } from "./baseline";
import { PLAN_FIX as FIX, BOX_FIX } from "./test-fixture";
import { avoid, dateOf, dish, items, kindPart, linked, tpl, type Household, type Weekday } from "./truth";
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
    // (Rice and dal break no rule of his: a dish kept from him for no reason is also silent filler.)
    expect(fails(r)).toEqual(["hard_rules", "no_silent_filler"]);
    const o = goodWeek();
    for (const d of at(o, "Wed", "Dinner").dishes) d.not_for = ["Dadu Ram"];
    expect(fails(o)).toEqual(["no_silent_filler"]);
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

  test("words said of a category hold for its items, named or not ('pasta on Sundays': a macaroni on Wednesday breaks it)", () => {
    const h = { ...FIX, truth: { ...FIX.truth, library: [...FIX.truth.library, { name: "Pasta", slot: "Dinner", days: ["Sun" as Weekday] }] } };
    const freq = (p: PlanOut) => scorePlan(h, p, loaded()).notes.filter((n) => n.startsWith("dish_frequency: Pasta"));
    const p = goodWeek();
    at(p, "Sun", "Dinner").dishes = [{ name: "Masala pasta" }];
    expect(freq(p)).toEqual([]);
    at(p, "Wed", "Dinner").dishes = [{ name: "Macaroni" }];
    expect(freq(p)).toHaveLength(1);
  });

  test("a how-often said of a dish holds across the day's meals, except at a meal where the family named that category themselves ('uthappam sometimes' at dinner; breakfast's own dosas are free)", () => {
    const h = { ...FIX, truth: { ...FIX.truth, library: [...FIX.truth.library, { name: "Uthappam", slot: "Dinner", frequency: "sometimes" as const }, { name: "Dosa", slot: "Breakfast" }] } };
    const freq = (p: PlanOut) => scorePlan(h, p, loaded()).notes.filter((n) => n.startsWith("dish_frequency: Uthappam"));
    const p = goodWeek();
    for (const d of ["Mon", "Tue", "Wed", "Thu"] as Weekday[]) at(p, d, "Breakfast").dishes = [{ name: "Plain dosa" }];
    for (const d of ["Mon", "Wed"] as Weekday[]) at(p, d, "Dinner").dishes = [{ name: "Rava uttapam" }];
    expect(freq(p)).toEqual([]);
    // A meal with no word of theirs for it counts: two at dinner and two at lunch are four.
    for (const d of ["Tue", "Fri"] as Weekday[]) at(p, d, "Lunch").dishes = [{ name: "Rice" }, { name: "Plain dosa" }];
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
    // Owner 26 Nov: no rice or bread demanded; a dal and a sabzi is as full as their two-dish lunch.
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Toor dal", "Bhindi"]))).not.toContain("whole_plate");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Dal rice", "Rice", "Lauki"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti with aloo gobi", "Roti", "Rajma"]))).toContain("no_doubled_staple");
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Khichdi"]))).not.toContain("whole_plate");
    // Decided 8: a flavoured rice, a biryani, a khichdi is a whole plate, whatever its name ("vangi bath").
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Vangi bath"]))).not.toContain("whole_plate");
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Puliyogare", "Curd"]))).not.toContain("whole_plate");
  });
  test("a main three days running at breakfast: the next day, not a cap (owner 25 Nov)", () => {
    const p = goodWeek();
    for (const d of ["Mon", "Tue", "Wed"] as Weekday[]) set(p, d, "Breakfast", ["Poha"]);
    expect(fails(p)).toEqual(["not_next_day"]);
    // The family's words as setup saved them ("poha most days": usually) let it come day after day.
    const l = loaded();
    l.library = l.library.map((d) => (d.name === "Poha" ? { ...d, frequency: "usually" } : d));
    expect(fails(p, l)).not.toContain("not_next_day");
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

describe("whole_plate and not_bare: the family's plates are the template (owner, 26 Nov)", () => {
  // "When the user speaks a new dish treat it as the template. No need to check for rice or chapati every time by default.
  // Different people might be on different diets."
  const h16 = async () => (await import("../households")).ALL_HOUSEHOLDS.find((h) => h.id === "h16-pillai")!;
  const failsIn = (h: Awaited<ReturnType<typeof h16>>, day: Weekday, slot: string, dishes: string[]) => {
    const p = baselineWeek(h, MON);
    const sd = p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;
    sd.dishes = dishes.map((name) => ({ name }));
    return Object.entries(scorePlan(h, p, setupOfTruth(h), { failClosed: false }).rates).filter(([, [a, n]]) => a < n).map(([k]) => k);
  };
  test("a plate with no rice or bread passes when it is as full as theirs, or one of their whole meals", async () => {
    const h = await h16();
    expect(failsIn(h, "Wed", "Dinner", ["Kanji", "Payar"])).not.toContain("whole_plate");   // their "Kanji and payar"
    expect(failsIn(h, "Wed", "Dinner", ["Kanji and payar"])).not.toContain("whole_plate");
    expect(failsIn(h, "Mon", "Dinner", ["Chapati", "Chicken curry"])).not.toContain("whole_plate");   // their template
    expect(failsIn(h, "Mon", "Dinner", ["Egg curry", "Veg kurma"])).not.toContain("whole_plate");    // no bread, still two dishes
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Rajma chawal"]))).not.toContain("whole_plate");
  });
  test("a plate clearly thinner than every plate they described still fails: a side or a staple alone, one curry alone", async () => {
    const h = await h16();
    expect(failsIn(h, "Mon", "Dinner", ["Chicken curry"])).toContain("whole_plate");
    expect(failsIn(h, "Mon", "Dinner", ["Chapati"])).toEqual(expect.arrayContaining(["not_bare", "whole_plate"]));
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Curd"]))).toEqual(expect.arrayContaining(["not_bare", "whole_plate"]));
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Rice", "Curd"]))).toContain("whole_plate");
    expect(fails(set(goodWeek(), "Mon", "Lunch", ["Bhindi"]))).toContain("whole_plate");
  });
  test("a staple alone the family eats as such is not bare (their own seed row)", () => {
    expect(fails(set(goodWeek(), "Mon", "Dinner", ["Roti"]))).not.toContain("not_bare");   // the fixture's seed has a "Roti" dinner
  });
});

describe("no_new_kind: a regional dish of another cuisine is fine when its kind is theirs (owner, 26 Nov)", () => {
  // "It's okay to suggest other dishes from similar cuisines that fits their preferences. This is anyway a draft."
  const run = async (slot: string, day: Weekday, dishes: string[], fresh: string) => {
    const h = (await import("../households")).ALL_HOUSEHOLDS.find((x) => x.id === "h16-pillai")!;
    const p = baselineWeek(h, MON);
    const sd = p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;
    sd.dishes = dishes.map((name) => ({ name, ...(name === fresh ? { new: true } : {}) }));
    p.library.push(newRow(fresh, slot, []));
    return scorePlan(h, p, setupOfTruth(h), { failClosed: false }).notes.filter((n) => n.startsWith("no_new_kind"));
  };
  test("Bisi bele bath in a Kerala lunch box of flavoured rice; Chettinad chicken where they have chicken curry", async () => {
    expect(await run("Advaith's lunch box", "Mon", ["Bisi bele bath"], "Bisi bele bath")).toEqual([]);
    expect(await run("Dinner", "Mon", ["Chapati", "Chettinad chicken"], "Chettinad chicken")).toEqual([]);
  });
  test("a new dish of a kind they never have at that meal still fails", async () => {
    expect((await run("Dinner", "Mon", ["Chapati", "Masala pasta"], "Masala pasta")).join(" ")).toMatch(/Masala pasta is a Pasta/);
  });
});

describe("attendance: a school child is away at the weekday lunch (owner, 26 Nov)", () => {
  // "Kids coming home for lunch is not a valid case for now." TRUTH may say the child comes home; the scorer does not expect it.
  test("a child TRUTH has home for lunch is still left out Mon-Fri; an adult at a school (a teacher) is not", async () => {
    const { ALL_HOUSEHOLDS } = await import("../households");
    const lunch = (id: string, d: Weekday) => expectedSlotDays(ALL_HOUSEHOLDS.find((h) => h.id === id)!, MON).find((e) => e.day === d && e.slot === "Lunch")?.people ?? [];
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]) {
      expect(lunch("h15-gupta", d)).toEqual(["Ankit", "Pooja"]);    // Myra: "home for lunch" in TRUTH
      expect(lunch("h2-iyer", d)).not.toContain("Ananya");
      expect(lunch("h6-kulkarni", d)).toContain("Snehal");          // a teacher, home for lunch
    }
    expect(lunch("h15-gupta", "Sat")).toContain("Myra");
    expect(lunch("h2-iyer", "Sun")).toContain("Ananya");
  });
  test("a school child whose weekday lunch is carries stays at the shared Lunch (OD2)", async () => {
    const { ALL_HOUSEHOLDS } = await import("../households");
    const g = ALL_HOUSEHOLDS.find((x) => x.id === "h15-gupta")!;
    const weekly = ((g.household["household.weekly"] ?? []) as { person: string }[]).map((w) => (w.person === "Myra" ? { ...w, lunch: "carries" } : w));
    const h = { ...g, household: { ...g.household, "household.weekly": weekly } };
    expect(weekly.some((w: any) => w.person === "Myra" && w.lunch === "carries")).toBe(true);
    for (const d of ["Mon", "Fri"] as Weekday[]) expect(expectedSlotDays(h, MON).find((e) => e.day === d && e.slot === "Lunch")!.people).toContain("Myra");
  });
  test("a week with the child at the weekday lunch fails attendance; without her it passes", async () => {
    const { ALL_HOUSEHOLDS } = await import("../households");
    const h = ALL_HOUSEHOLDS.find((x) => x.id === "h15-gupta")!, setup = setupOfTruth(h);
    const att = (p: PlanOut) => { const [a, n] = scorePlan(h, p, setup, { failClosed: false }).rates.attendance; return n - a; };
    const good = baselineWeek(h, MON);
    expect(good.slotDays.find((x) => x.date === MON && x.slot === "Lunch")!.people).not.toContain("Myra");
    expect(att(good)).toBe(0);
    const bad = baselineWeek(h, MON);
    bad.slotDays.find((x) => x.date === MON && x.slot === "Lunch")!.people.push("Myra");
    expect(att(bad)).toBe(1);
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

describe("scorePlan: made without a leave-out ingredient (decided 21)", () => {
  // A catalog dish is someone's when its MAIN ingredients keep their rule and the note says it is made without the rest for
  // them ("make without cashews for Asha"); a main ingredient that breaks the rule is a break whatever the note.
  const h = { ...FIX, truth: { ...FIX.truth, rules: [...FIX.truth.rules, avoid("no_nuts", "Asha: no nuts", ["nuts"], /nut/i, { who: "Asha" }),
    avoid("no_root", "Asha: no root vegetables", ["root_veg"], /root/i, { who: "Asha" })] } };
  // What the plan saved about each dish's contents (the app's library rows), as a run's setup carries them.
  const lib = () => { const l = loaded(); l.library = [...l.library, { name: "Rava upma", slot: "Breakfast", contains: ["wheat", "nuts", "peanut", "dairy", "onion_garlic"] } as any,
    { name: "Mooli thepla", slot: "Breakfast", contains: ["wheat", "root_veg"] } as any]; return l; };
  const breaks = (p: PlanOut, rule: RegExp) => scorePlan(h, p, lib(), { failClosed: false }).notes.filter((n) => n.startsWith("hard_rules") && rule.test(n));
  test("rava upma (cashews leave-out) with the note for her is kept; without the note, a break", () => {
    const p = goodWeek();
    at(p, "Mon", "Breakfast").dishes = [{ name: "Rava upma", note: "make without cashews and peanuts for Asha" }];
    expect(breaks(p, /no nuts/)).toEqual([]);
    at(p, "Mon", "Breakfast").dishes = [{ name: "Rava upma" }];
    expect(breaks(p, /no nuts/)).toHaveLength(1);
  });
  test("mooli thepla (radish is main) is a break for no root vegetables, note or not", () => {
    const p = goodWeek();
    at(p, "Mon", "Breakfast").dishes = [{ name: "Mooli thepla", note: "make without radish for Asha" }];
    expect(breaks(p, /no root/)).toHaveLength(1);
  });
});


// ── The one meaning model (spec §5.2–§5.4, §7, §9.1): boxes, linked parts, swaps, asked unknowns ──
describe("scorePlan: one meaning model", () => {
  const H = BOX_FIX, boxLoaded = () => setupOfTruth(H);
  const BOXDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu"], SCHOOLDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const sdOf = (p: PlanOut, day: Weekday, slot: string) => p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;
  /** goodWeek, with the box (the lunch sabzi rolled in a paratha, Mon–Thu), Asha's salad beside the home lunch, and Dadu Ram's
   *  plain parathas on Tuesday and Thursday dinner. Lunch has Chotu on Friday only (the box takes him off it Mon–Thu). */
  function boxWeek(): PlanOut {
    const p = goodWeek();
    for (const day of SCHOOLDAYS) {
      const lunch = sdOf(p, day, "Lunch");
      lunch.people = [...lunch.people.filter((x) => x !== "Chotu" || !BOXDAYS.includes(day)), ...(lunch.people.includes("Asha") ? [] : ["Asha"])];
      if (BOXDAYS.includes(day)) {
        const sabzi = lunch.dishes.filter((d) => ["Bhindi", "Aloo gobi"].includes(d.name)).map((d) => ({ name: d.name }));
        p.slotDays.push({ date: dateOf(MON, day), slot: "Chotu's lunch box", people: ["Chotu"], guests: [], skip: null, dishes: [{ name: "Paratha roll" }, ...sabzi] });
      }
      p.slotDays.push({ date: dateOf(MON, day), slot: "Asha's lunch extras", people: ["Asha"], guests: [], skip: null, dishes: [{ name: "Cucumber salad" }] });
    }
    for (const day of ["Tue", "Thu"] as Weekday[]) sdOf(p, day, "Dinner").dishes.push({ name: "Plain paratha", for_people: ["Dadu Ram"] } as any);
    // Wednesday's lunch carries a sabzi for the box to roll.
    return p;
  }
  const rate = (p: PlanOut, field: string, l = boxLoaded()) => scorePlan(H, p, l, { failClosed: false }).rates[field];
  const note = (p: PlanOut, field: string) => scorePlan(H, p, boxLoaded(), { failClosed: false }).notes.filter((n) => n.startsWith(`${field}:`));

  test("the good box week passes the new checks", () => {
    const p = boxWeek();
    for (const f of ["linked_parts", "box_attendance", "no_silent_filler"]) { const r = rate(p, f); expect(r).toBeDefined(); expect(r[0]).toBe(r[1]); }
    expect(scorePlan(H, p, boxLoaded(), { failClosed: false }).notes.filter((n) => /^(attendance|no_stray|filled)/.test(n))).toEqual([]);
  });

  describe("linked_parts", () => {
    test("fails when the box rolls a sabzi lunch did not have", () => {
      const p = boxWeek();
      sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }, { name: "Bhindi" }];   // Tuesday's lunch has Aloo gobi
      expect(rate(p, "linked_parts")[0]).toBeLessThan(rate(p, "linked_parts")[1]);
      expect(note(p, "linked_parts")[0]).toContain("Tue Chotu's lunch box");
    });
    test("fails when the box has no sabzi though lunch did", () => {
      const p = boxWeek();
      sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }];
      expect(rate(p, "linked_parts")[0]).toBeLessThan(rate(p, "linked_parts")[1]);
    });
    test("passes the whole plate of the source, and when the source is skipped that day", () => {
      const p = boxWeek();
      sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }, { name: "Rice" }, { name: "Toor dal" }, { name: "Bhindi" }];
      sdOf(p, "Tue", "Lunch").skip = "eaten_out"; sdOf(p, "Tue", "Lunch").dishes = [];
      sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }, { name: "Bhindi" }];
      const r = rate(p, "linked_parts");
      expect(r[0]).toBe(r[1]);
    });
  });

  describe("real_dish", () => {
    const HW = structuredClone(H);
    HW.truth.meals = [...(HW.truth.meals ?? []), { slot: "Lunch", templates: [{ parts: [{ kind: "Sabzi", sub: "Sabzi", words: "dry sabji" }] }, { parts: [{ items: ["Egg paratha roll"] }] }] }];
    const real = (p: PlanOut) => scorePlan(HW, p, setupOfTruth(HW), { failClosed: false });
    test("fails on 'Dry sabji', the family's word for a part, and on a bare kind word", () => {
      const p = boxWeek();
      sdOf(p, "Mon", "Lunch").dishes = [{ name: "Rice" }, { name: "Toor dal" }, { name: "Dry sabji" }];
      expect(real(p).notes.filter((n) => n.startsWith("real_dish"))[0]).toContain("Dry sabji");
    });
    test("passes a dish of a TRUTH items part, and a real dish", () => {
      const p = boxWeek();
      sdOf(p, "Mon", "Lunch").dishes = [{ name: "Rice" }, { name: "Toor dal" }, { name: "Bhindi" }];
      expect(real(p).notes.filter((n) => n.startsWith("real_dish"))).toEqual([]);
    });
  });

  describe("unknowns_asked", () => {
    const withKadhi = (asked?: string[]) => {
      const p = boxWeek();
      sdOf(p, "Wed", "Dinner").dishes.push({ name: "Methi kadhi", new: true });
      p.library.push({ ...newRow("Methi kadhi", "Dinner", ["dairy"]), contains_read: ["dairy", "sugar"] });   // read for sugar, never for egg
      if (asked) p.asked = asked;
      return p;
    };
    test("fails when an unread Kadhi for an egg-free elder is not in the question", () => {
      const p = withKadhi(["I know only a few dishes for dinner. What else do you make for dinner?"]);
      expect(rate(p, "unknowns_asked")).toEqual([0, 1]);
      expect(rate(withKadhi(), "unknowns_asked")).toEqual([0, 1]);
    });
    test("passes when the question names it, or counts it in its 'more to check'", () => {
      expect(rate(withKadhi(["Is the Methi kadhi OK for Dadu Ram, no egg?"]), "unknowns_asked")).toEqual([1, 1]);
      expect(rate(withKadhi(["is the Rajma OK for Asha, no egg, and 1 more to check on the week page?"]), "unknowns_asked")).toEqual([1, 1]);
    });
    test("is not scored when every dish was read", () => {
      expect(rate(boxWeek(), "unknowns_asked")).toBeUndefined();
    });
  });

  describe("no_silent_filler", () => {
    test("fails when Idli is added for the elder with no known break", () => {
      const p = boxWeek();
      sdOf(p, "Wed", "Dinner").dishes.push({ name: "Idli", for_people: ["Dadu Ram"] } as any);
      expect(rate(p, "no_silent_filler")[0]).toBeLessThan(rate(p, "no_silent_filler")[1]);
      expect(note(p, "no_silent_filler")[0]).toContain("Idli added for Dadu Ram");
    });
    test("passes a swap's item for its person, and a dish added where the plate has a known break for them", () => {
      const p = boxWeek();
      sdOf(p, "Wed", "Dinner").dishes = [{ name: "Roti" }, { name: "Egg curry", not_for: ["Dadu Ram"] }, { name: "Idli", for_people: ["Dadu Ram"] } as any];
      const r = rate(p, "no_silent_filler");
      expect(r[0]).toBe(r[1]);
    });
    test("fails a dish kept from someone who has no rule it breaks", () => {
      const p = boxWeek();
      sdOf(p, "Mon", "Dinner").dishes.find((d) => d.name === "Toor dal")!.not_for = ["Asha"];
      expect(note(p, "no_silent_filler")).toHaveLength(1);
    });
    test("a swap's item bound to a person who has no swap for it fails", () => {
      const p = boxWeek();
      sdOf(p, "Tue", "Dinner").dishes.find((d) => d.name === "Plain paratha")!.for_people = ["Asha"];
      expect(rate(p, "no_silent_filler")[0]).toBeLessThan(rate(p, "no_silent_filler")[1]);
    });
  });

  describe("box_attendance", () => {
    test("fails when the box leaves its child at Lunch on a box day", () => {
      const p = boxWeek();
      sdOf(p, "Tue", "Lunch").people.push("Chotu");
      expect(note(p, "box_attendance")[0]).toContain("Tue Lunch: Chotu has Chotu's lunch box");
    });
    test("fails when a box takes the child off Lunch on a day it is not on", () => {
      const p = boxWeek();
      sdOf(p, "Fri", "Lunch").people = sdOf(p, "Fri", "Lunch").people.filter((x) => x !== "Chotu");
      expect(note(p, "box_attendance")[0]).toContain("Fri Lunch: Chotu is off Lunch");
    });
    test("fails when an extras add-on takes its person off the main meal", () => {
      const p = boxWeek();
      sdOf(p, "Wed", "Lunch").people = sdOf(p, "Wed", "Lunch").people.filter((x) => x !== "Asha");
      expect(note(p, "box_attendance")[0]).toContain("Wed Lunch: Asha is off Lunch though Asha's lunch extras is an add-on");
    });
  });

  test("a kind target in a hard rule is kept by what the dish is, and a swap's item for one person is eaten by them alone", () => {
    const h = structuredClone(H);
    h.truth.rules.push(avoid("no_salad_dadu", "Dadu Ram: no salad", [], /salad/i, { who: "Dadu Ram", targets: [{ kind: "Salad" }] }));
    const p = boxWeek();
    sdOf(p, "Tue", "Lunch").dishes.push({ name: "Cucumber salad" });
    const bad = scorePlan(h, p, setupOfTruth(h), { failClosed: false }).notes.filter((n) => n.startsWith("hard_rules: Dadu Ram: no salad"));
    expect(bad).toHaveLength(1);
    sdOf(p, "Tue", "Lunch").dishes.find((d) => d.name === "Cucumber salad")!.not_for = ["Dadu Ram"];
    expect(scorePlan(h, p, setupOfTruth(h), { failClosed: false }).notes.filter((n) => n.startsWith("hard_rules: Dadu Ram: no salad"))).toEqual([]);
  });

  test("expectedSlotDays: only a box that replaces Lunch takes its person off it, on its days", () => {
    const exp = expectedSlotDays(H, MON), e = (d: Weekday, s: string) => exp.find((x) => x.day === d && x.slot === s);
    expect(e("Tue", "Lunch")!.people).not.toContain("Chotu");
    expect(e("Fri", "Lunch")!.people).toContain("Chotu");
    expect(e("Tue", "Lunch")!.people).toContain("Asha");
    expect(e("Fri", "Chotu's lunch box")).toBeUndefined();
  });
});


// ── F9 (Task 15 G5): the scorer reads links, newness, category words, fixed extras and staple parts as the spec means them.
// Each relaxed check has a really bad week beside it that still fails.
describe("scorePlan: F9 links, newness, categories, fixed extras, staples", () => {
  const sdOf = (p: PlanOut, day: Weekday, slot: string) => p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;
  const notesOf = (h: Household, p: PlanOut, l: ReturnType<typeof setupOfTruth>, field: string) => scorePlan(h, p, l, { failClosed: false }).notes.filter((n) => n.startsWith(`${field}:`));
  const BOXDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu"];

  // Chotu's breakfast box is the family's breakfast (a whole-plate link, spec §5.4), Mon–Thu. Breakfast's own parts are
  // categories (Poha, Upma, Idli); the planner fills Mon's poha with Matar poha (a category item: theirs, saved
  // suggested:false with origin planner_suggested, makePlan.ts), and the e2e eval loads plan.library (eval-e2e.ts).
  const BB: Household = (() => {
    const h = structuredClone(BOX_FIX);
    h.truth.slots.push({ name: "Chotu's breakfast box", kind: "custom", usual_people: ["Chotu"], days: BOXDAYS, replaces: "Breakfast", match: /breakfast box/i });
    h.truth.meals = [...(h.truth.meals ?? []), { slot: "Breakfast", templates: [tpl([kindPart("Poha")]), tpl([kindPart("Upma")]), tpl([kindPart("Idli")])] },
      { slot: "Chotu's breakfast box", templates: [tpl([linked("Breakfast")])] }];
    return h;
  })();
  const bbWeek = (boxMon = "Matar poha") => {
    const p = goodWeek();
    sdOf(p, "Mon", "Breakfast").dishes = [{ name: "Matar poha" }];
    for (const day of BOXDAYS) {
      const b = sdOf(p, day, "Breakfast");
      b.people = b.people.filter((x) => x !== "Chotu");
      p.slotDays.push({ date: dateOf(MON, day), slot: "Chotu's breakfast box", people: ["Chotu"], guests: [], skip: null, dishes: day === "Mon" ? [{ name: boxMon }] : b.dishes.map((d) => ({ ...d })) });
    }
    p.library.push({ ...newRow("Matar poha", "Breakfast", ["peas"]), suggested: false, untried: false });
    return p;
  };
  const e2eLoaded = (h: Household, p: PlanOut) => ({ ...setupOfTruth(h), library: p.library });

  test("(1) a box dish equal to its linked meal's dish that day passes from_library and is neither new nor a new kind", () => {
    const p = bbWeek();
    const l = e2eLoaded(BB, p);
    expect(notesOf(BB, p, l, "from_library").filter((n) => /breakfast box/.test(n))).toEqual([]);
    expect(notesOf(BB, p, l, "no_new_kind").filter((n) => /breakfast box/.test(n))).toEqual([]);
    expect(scorePlan(BB, p, l, { failClosed: false }).notes.filter((n) => n.startsWith("new_budget") && /matar poha/i.test(n))).toEqual([]);
  });
  test("(1) bad: a box dish the linked meal did not have that day is still not from the box's library and a new kind", () => {
    const p = bbWeek("Macaroni");
    const l = e2eLoaded(BB, p);
    expect(notesOf(BB, p, l, "from_library").some((n) => /Mon Chotu's breakfast box: Macaroni/.test(n))).toBe(true);
    expect(notesOf(BB, p, l, "no_new_kind").some((n) => /Macaroni/.test(n))).toBe(true);
    expect(notesOf(BB, p, l, "linked_parts").length).toBeGreaterThan(0);
  });

  test("(2) newness is the dish's own flag or a suggested library row: 3 new dishes count 3 even when the loaded library holds them", () => {
    const p = goodWeek();
    for (const [day, name] of [["Mon", "Rava upma"], ["Tue", "Semiya upma"], ["Thu", "Kanda poha"]] as [Weekday, string][]) {
      sdOf(p, day, "Breakfast").dishes = [{ name, new: true }];
      p.library.push(newRow(name, "Breakfast", []));
    }
    const s = scorePlan(FIX, p, { ...loaded(), library: p.library }, { failClosed: false });
    // Rava idli, Bajra roti (goodWeek's own two) and these three.
    expect(s.facts.new_dishes).toBe(5);
    expect(s.rates.new_budget).toEqual([0, 1]);
  });
  test("(2) a category item saved suggested:false (origin planner_suggested) is not new", () => {
    const p = bbWeek();
    expect(scorePlan(BB, p, e2eLoaded(BB, p), { failClosed: false }).facts.new_dishes).toBe(2);
  });

  test("(3) a named dish is no category: Methi paratha at dinner is not counted as 'Egg paratha roll sometimes'", () => {
    const h = structuredClone(BOX_FIX);
    h.truth.library.push(...dish("Egg paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }));
    const p = boxWeek4();
    for (const day of ["Mon", "Wed", "Fri"] as Weekday[]) sdOf(p, day, "Dinner").dishes.push({ name: "Methi paratha", new: true });
    expect(notesOf(h, p, setupOfTruth(h), "dish_frequency").filter((n) => /Egg paratha roll/.test(n))).toEqual([]);
    // Bad: the roll itself on all four box days is past "sometimes".
    for (const day of BOXDAYS) sdOf(p, day, "Chotu's lunch box").dishes = [{ name: "Egg paratha roll" }];
    expect(notesOf(h, p, setupOfTruth(h), "dish_frequency").filter((n) => /Egg paratha roll/.test(n))).toHaveLength(1);
  });

  test("(4) linked_parts skips a box day whose plate is an items template's (Egg paratha roll), not one with a wrong sabzi", () => {
    const h = structuredClone(BOX_FIX);
    h.truth.meals![0].templates.push(tpl([items("Egg paratha roll")], "sometimes"));
    h.truth.library.push(...dish("Egg paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }));
    const p = boxWeek4();
    // Tuesday's lunch sabzi is Aloo gobi; the roll day has none of it.
    sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Egg paratha roll" }];
    const r = scorePlan(h, p, setupOfTruth(h), { failClosed: false }).rates.linked_parts;
    expect(r[0]).toBe(r[1]);
    // Bad: the roll beside a sabzi lunch did not have, and the paratha with the wrong sabzi (Monday's lunch has Bhindi).
    sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Egg paratha roll" }, { name: "Bhindi" }];
    sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }, { name: "Aloo gobi" }];
    expect(notesOf(h, p, setupOfTruth(h), "linked_parts").map((n) => n.slice(14, 35))).toEqual(["Mon Chotu's lunch box", "Tue Chotu's lunch box"]);
  });

  test("(4a) G5: 'Paratha with egg' and 'Cheese paratha' are the egg and cheese rolls (same words); a bare 'Paratha roll' is no egg roll", () => {
    const h = structuredClone(BOX_FIX);
    h.truth.meals![0].templates.push(tpl([items("Egg paratha roll")], "sometimes"), tpl([items("Cheese paratha roll")], "sometimes"));
    h.truth.library.push(...dish("Egg paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }), ...dish("Cheese paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }));
    const linked = (q: PlanOut) => notesOf(h, q, setupOfTruth(h), "linked_parts");
    const p = boxWeek4();
    sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Paratha with egg" }];
    sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Cheese paratha" }];
    expect(linked(p)).toEqual([]);
    // Bad: a bare "Paratha roll" is neither roll; it is the linked plate and holds no sabzi here.
    sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }];
    expect(linked(p).map((n) => n.slice(14, 35))).toEqual(["Mon Chotu's lunch box"]);
  });

  test("(4b) review: the link-free 'sometimes' rolls together stay within 'sometimes' and under the usual linked plate", () => {
    const h = structuredClone(BOX_FIX);
    h.truth.meals![0].templates.push(tpl([items("Egg paratha roll")], "sometimes"), tpl([items("Cheese paratha roll")], "sometimes"));
    h.truth.library.push(...dish("Egg paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }), ...dish("Cheese paratha roll", ["Chotu's lunch box"], { frequency: "sometimes" }));
    const rolls = (q: PlanOut) => notesOf(h, q, setupOfTruth(h), "dish_frequency").filter((n) => /Chotu's lunch box: its/.test(n));
    const p = boxWeek4();
    sdOf(p, "Tue", "Chotu's lunch box").dishes = [{ name: "Egg paratha roll" }];
    sdOf(p, "Thu", "Chotu's lunch box").dishes = [{ name: "Cheese paratha roll" }];
    expect(rolls(p)).toEqual([]);
    // Bad: a roll on every box day (each roll only 2 days, so the per-dish count alone passes it).
    sdOf(p, "Mon", "Chotu's lunch box").dishes = [{ name: "Egg paratha roll" }];
    sdOf(p, "Wed", "Chotu's lunch box").dishes = [{ name: "Cheese paratha roll" }];
    expect(notesOf(h, p, setupOfTruth(h), "dish_frequency").filter((n) => /paratha roll \(/.test(n))).toEqual([]);
    expect(rolls(p)).toHaveLength(1);
    // Bad: three roll days of four (within "sometimes", but more than the usual linked plate).
    sdOf(p, "Wed", "Chotu's lunch box").dishes = [{ name: "Paratha roll" }];
    expect(rolls(p)).toHaveLength(1);
  });

  test("(5) a fixed dish of a slot's only template ('4 eggs' every school day) is exempt from not_next_day and no_early_repeat", () => {
    const h = structuredClone(BOX_FIX);
    h.truth.library = h.truth.library.map((d) => (d.name === "Cucumber salad" ? { name: d.name, slot: d.slot } : d));
    h.truth.library.push(...dish("4 eggs", ["Asha's lunch extras"]));
    h.truth.meals!.push({ slot: "Asha's lunch extras", templates: [tpl([items("4 eggs"), kindPart("Salad", { words: "salad" })])] });
    const p = boxWeek4();
    const salads = ["Cucumber salad", "Kachumber salad", "Cucumber salad", "Kachumber salad", "Cucumber salad"];
    (["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]).forEach((day, i) => { sdOf(p, day, "Asha's lunch extras").dishes = [{ name: "4 eggs" }, { name: salads[i] }]; });
    const rot = (q: PlanOut) => scorePlan(h, q, setupOfTruth(h), { failClosed: false }).notes.filter((n) => /^(not_next_day|no_early_repeat):/.test(n) && /lunch extras/i.test(n));
    expect(rot(p)).toEqual([]);
    // Bad: the salad (a kind part, it rotates) the same two days running still fails.
    sdOf(p, "Tue", "Asha's lunch extras").dishes = [{ name: "4 eggs" }, { name: "Cucumber salad" }];
    expect(rot(p).some((n) => /Cucumber salad/.test(n))).toBe(true);
    expect(rot(p).some((n) => /4 eggs/.test(n))).toBe(false);
  });

  test("(6) an item filling a template's staple-kind part (Rice of [Rice, Rasam]) passes from_library; at a meal with no such part it fails", () => {
    const h = structuredClone(FIX);
    h.truth.meals = [{ slot: "Dinner", staples: ["Rice"], templates: [tpl(["Rice", "Dal"])] }];
    const p = goodWeek();
    sdOf(p, "Mon", "Dinner").dishes = [{ name: "Rice" }, { name: "Toor dal" }];
    const lib = (q: PlanOut) => notesOf(h, q, setupOfTruth(h), "from_library");
    expect(lib(p)).toEqual([]);
    // Bad: rice at breakfast, where no template has a Rice part.
    sdOf(p, "Wed", "Breakfast").dishes = [{ name: "Rice" }];
    expect(lib(p).some((n) => /Wed Breakfast: Rice/.test(n))).toBe(true);
  });

  test("(7) no_new_kind reads a family dish's saved kind before the catalog name ('Bread omlette', their spelling, an Egg)", () => {
    const h = structuredClone(FIX);
    h.truth.library.push(...dish("Bread omelette", ["Breakfast"], { days: ["Sun"] }));
    const p = goodWeek();
    sdOf(p, "Sun", "Breakfast").dishes = [{ name: "Bread omlette" }];
    const l = setupOfTruth(h);
    l.library.push({ slot: "Breakfast", name: "Bread omlette", frequency: null, days: ["Sun"], contains: ["egg", "wheat"], contains_read: read, origin: "setup_named", kind: "Egg", sub: "Eggs" });
    expect(scorePlan(h, p, l, { failClosed: false }).notes.filter((n) => n.startsWith("no_new_kind") && /omlette/.test(n))).toEqual([]);
    // Bad: the planner's own row filing a foreign dish (Butter chicken is a Chicken) under a family kind does not grade it.
    sdOf(p, "Fri", "Breakfast").dishes = [{ name: "Butter chicken", new: true }];
    l.library.push({ ...newRow("Butter chicken", "Breakfast", ["chicken"]), kind: "Poha", sub: "Poha" });
    expect(scorePlan(h, p, l, { failClosed: false }).notes.filter((n) => n.startsWith("no_new_kind") && /Butter chicken/.test(n))).toHaveLength(1);
    // Bad: a dish nobody saved and the catalog cannot place still fails.
    sdOf(p, "Sat", "Breakfast").dishes = [{ name: "Zorba special", new: true }];
    expect(scorePlan(h, p, l, { failClosed: false }).notes.filter((n) => n.startsWith("no_new_kind") && /Zorba/.test(n))).toHaveLength(1);
  });
});

/** BOX_FIX's good box week for another household of the same shape (the box rolls the lunch sabzi Mon–Thu). */
function boxWeek4(): PlanOut {
  const p = goodWeek(), BOXD: Weekday[] = ["Mon", "Tue", "Wed", "Thu"];
  const sdOf = (day: Weekday, slot: string) => p.slotDays.find((x) => x.date === dateOf(MON, day) && x.slot === slot)!;
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]) {
    const lunch = sdOf(day, "Lunch");
    lunch.people = [...lunch.people.filter((x) => x !== "Chotu" || !BOXD.includes(day)), ...(lunch.people.includes("Asha") ? [] : ["Asha"])];
    if (BOXD.includes(day)) p.slotDays.push({ date: dateOf(MON, day), slot: "Chotu's lunch box", people: ["Chotu"], guests: [], skip: null,
      dishes: [{ name: "Paratha roll" }, ...lunch.dishes.filter((d) => ["Bhindi", "Aloo gobi"].includes(d.name)).map((d) => ({ name: d.name }))] });
    p.slotDays.push({ date: dateOf(MON, day), slot: "Asha's lunch extras", people: ["Asha"], guests: [], skip: null, dishes: [{ name: "Cucumber salad" }] });
  }
  for (const day of ["Tue", "Thu"] as Weekday[]) sdOf(day, "Dinner").dishes.push({ name: "Plain paratha", for_people: ["Dadu Ram"] } as any);
  return p;
}

describe("h18 Pancakes: G6", () => {
  // Pancakes is made with egg (lead ruling, 26 Nov), so a family Breakfast Pancakes kept from the no-egg father with Idli
  // for him is a known break, not silent filler.
  test("Pancakes (not for Gowri Shankar) with Idli at Breakfast passes no_silent_filler; Idli with no break for him still fails", async () => {
    const h = (await import("../households")).ALL_HOUSEHOLDS.find((x) => x.id === "h18-shiva-walkthrough")!;
    const p = baselineWeek(h, MON);
    const tue = p.slotDays.find((x) => x.date === dateOf(MON, "Tue") && x.slot === "Breakfast")!;
    tue.dishes = [{ name: "Pancakes", not_for: ["Gowri Shankar"] }, { name: "Idli", for_people: ["Gowri Shankar"] } as any];
    const nsf = (q: PlanOut) => scorePlan(h, q, setupOfTruth(h), { failClosed: false }).notes.filter((n) => n.startsWith("no_silent_filler:"));
    expect(nsf(p)).toEqual([]);
    // Bad: the same Pancakes kept from him where nothing in it breaks (a dish with no egg) is silent.
    tue.dishes = [{ name: "Plain dosa", not_for: ["Gowri Shankar"] }, { name: "Idli", for_people: ["Gowri Shankar"] } as any];
    expect(nsf(p).length).toBeGreaterThan(0);
  });
});
