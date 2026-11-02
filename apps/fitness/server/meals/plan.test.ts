import { describe, it, expect } from "bun:test";
import { hasNumbers, mealPlanItems, parseItems, plannedTotals, shareText, slotOf, type MealPlanRow } from "./plan";
import { breakdown, noBreakdown } from "../nutrition/testing";

const row = (id: string, slot: string | null, name: string, position: number, extra: Partial<MealPlanRow> = {}): MealPlanRow =>
  ({ id, slot, name, position, kcal: null, protein_g: null, fiber_g: null, done: 0, ...extra });

describe("slotOf", () => {
  it("reads the slot a word or a title starts with", () => {
    expect(slotOf("lunch")).toBe("Lunch");
    expect(slotOf("Snacks: fruit")).toBe("Snack");
    expect(slotOf("Breakfast: besan chilla")).toBe("Breakfast");
    expect(slotOf("Besan chilla")).toBeNull();
    expect(slotOf(null)).toBeNull();
  });
});

describe("mealPlanItems", () => {
  const rows = [
    row("d", "Dinner", "Paneer bhurji + 2 roti", 3, { kcal: 520, protein_g: 32, fiber_g: 7 }),
    row("b", "Breakfast", "Besan chilla + curd", 0, { kcal: 330, protein_g: 18, fiber_g: 6 }),
    row("s1", "Snack", "Roasted chana", 1),
    row("s2", "Snack", "Apple", 2, { done: 1 }),
  ];
  it("keeps plan order and ticks each planned meal once a meal of its slot is logged", () => {
    const items = mealPlanItems(rows, [
      { title: "Breakfast: 2 besan chilla, curd", kind: "Meal" },
      { title: "Snack: chana", kind: "meal", kcal: 120, protein_g: 6, fiber_g: 5 },
      { title: "Dinner plan", kind: "Note" },   // not a logged meal
    ]);
    expect(items.map((i) => [i.id, i.done, i.loggedAs])).toEqual([
      ["b", true, "Breakfast: 2 besan chilla, curd"],
      ["s1", true, "Snack: chana"],
      ["s2", true, null],                       // ticked by hand
      ["d", false, null],
    ]);
    expect(items.find((i) => i.id === "s1")?.actual).toEqual({ kcal: 120, protein_g: 6, fiber_g: 5 });   // what was eaten, beside the plan
    expect(items.find((i) => i.id === "d")?.actual).toBeNull();
  });
  it("adds up what is planned and shares it as numbered lines", () => {
    const items = mealPlanItems(rows, []);
    expect(plannedTotals(items)).toEqual({ kcal: 850, protein_g: 50, fiber_g: 13 });
    expect(shareText("2026-10-22", items)).toBe([
      "Meal plan for 2026-10-22:",
      "1. Breakfast: Besan chilla + curd — 330 kcal · 18 g protein · 6 g fiber",
      "2. Snack: Roasted chana",
      "3. Snack: Apple ✓",
      "4. Dinner: Paneer bhurji + 2 roti — 520 kcal · 32 g protein · 7 g fiber",
      "Planned: 850 kcal · 50 g protein · 13 g fiber",
    ].join("\n"));
    expect(shareText("2026-10-22", [])).toBe("No meal plan set for 2026-10-22.");
  });
});

describe("parseItems", () => {
  it("takes the slot from the item or its name, and numbers only when they are numbers", () => {
    expect(parseItems({ items: [{ name: "Lunch: dal, rice", kcal: 450, protein_g: "lots" }, { slot: "dinner", name: "Khichdi", fiber_g: 5 }] })).toEqual([
      { slot: "Lunch", name: "dal, rice", kcal: 450, protein_g: null, fiber_g: null, ...noBreakdown() },
      { slot: "Dinner", name: "Khichdi", kcal: null, protein_g: null, fiber_g: 5, ...noBreakdown() },
    ]);
    expect(parseItems({ items: [{ name: "Snacks - roasted chana" }, { name: "Lunchbox salad" }] })?.map((i) => [i.slot, i.name])).toEqual([["Snack", "roasted chana"], [null, "Lunchbox salad"]]);
    expect(parseItems({ items: [{ slot: "Lunch" }] })).toBeNull();
    expect(parseItems({})).toBeNull();
  });
});

describe("hasNumbers", () => {
  it("is true only with the headline three and every nutrient of the full breakdown", () => {
    const headline = { kcal: 330, protein_g: 18, fiber_g: 6 };
    expect(hasNumbers({ ...headline, ...breakdown() })).toBe(true);
    expect(hasNumbers(headline)).toBe(false);
    expect(hasNumbers({ ...headline, ...breakdown(), calcium_mg: null })).toBe(false);
  });
  it("carries a planned meal's breakdown through parsing and onto its item", () => {
    const [parsed] = parseItems({ items: [{ slot: "Lunch", name: "Dal", kcal: 400, protein_g: 15, fiber_g: 8, ...breakdown(4) }] })!;
    expect(parsed.iron_mg).toBe(4);
    const [item] = mealPlanItems([row("l", "Lunch", "Dal", 0, { ...parsed })], []);
    expect(hasNumbers(item)).toBe(true);
  });
});
