import { describe, it, expect } from "bun:test";
import { computeMealNeeds, effectivePrefs, formatRange, mergeCartLines, packRange, reconcileMealRows, type DesiredRow, type ExistingMealRow, type IngredientInput, type MealInput } from "./quantity";
import { baseKindOf, convertTo, toBase } from "./units";

const DEFAULTS = { vegetables: { pack_min: 250, pack_unit: "g" }, dairy: { pack_min: 500, pack_unit: "ml" }, leafy_greens: { pack_min: 1, pack_unit: "pc" } };
const ing = (over: Partial<IngredientInput> & { id: string }): IngredientInput => ({ name: over.id, category: "vegetables", default_unit: "g", conversions: {}, prefs: {}, ...over });

describe("units", () => {
  it("converts kitchen measures and counts into the ingredient's base unit", () => {
    expect(toBase(2, "kg", {}, "g")).toEqual({ qty: 2000, unit: "g" });
    expect(toBase(1, "tbsp", {}, "ml")).toEqual({ qty: 15, unit: "ml" });
    expect(toBase(2, null, { pc: 150 }, "g")).toEqual({ qty: 300, unit: "g" });
    expect(toBase(1, "bunch", { bunch: 250 }, "g")).toEqual({ qty: 250, unit: "g" });
    expect(toBase(3, "", {}, "pc")).toEqual({ qty: 3, unit: "pc" });
    expect(toBase(100, "g", {}, "pc")).toEqual({ qty: 100, unit: "g" });
  });
  it("picks a base kind from default_unit, else grams when conversions exist", () => {
    expect(baseKindOf("ml", {})).toBe("ml");
    expect(baseKindOf(null, { pc: 100 })).toBe("g");
    expect(baseKindOf(null, {})).toBe("pc");
  });
  it("bridges pc ↔ g only with a per-piece weight", () => {
    expect(convertTo({ qty: 2, unit: "pc" }, "g", { pc: 150 })).toEqual({ qty: 300, unit: "g" });
    expect(convertTo({ qty: 2, unit: "pc" }, "g", {})).toBeNull();
    expect(convertTo({ qty: 100, unit: "g" }, "ml", {})).toEqual({ qty: 100, unit: "ml" });
  });
});

describe("packRange", () => {
  it("rounds the need up to whole smallest packs", () => {
    expect(packRange({ qty: 300, unit: "g" }, { pack_min: 250, pack_unit: "g" }, {})).toBe(500);
    expect(packRange({ qty: 100, unit: "g" }, { pack_min: 250, pack_unit: "g" }, {})).toBe(250);
    expect(packRange({ qty: 500, unit: "g" }, { pack_min: 250, pack_unit: "g" }, {})).toBe(500);
  });
  it("converts a pack in pieces/bunches to the need's unit, else returns the need", () => {
    expect(packRange({ qty: 300, unit: "g" }, { pack_min: 1, pack_unit: "pc" }, { pc: 250 })).toBe(500);
    expect(packRange({ qty: 300, unit: "g" }, { pack_min: 1, pack_unit: "pc" }, {})).toBe(300);
    expect(packRange({ qty: 300, unit: "g" }, {}, {})).toBe(300);
  });
  it("own prefs override category defaults", () => {
    expect(effectivePrefs({ pack_min: 1000 }, "vegetables", DEFAULTS).pack_min).toBe(1000);
    expect(effectivePrefs({}, "vegetables", DEFAULTS).pack_min).toBe(250);
  });
});

describe("computeMealNeeds", () => {
  const meal = (id: string, slot: string, dish: string, recipes: { recipe_id: string; servings: number }[], adjustments?: MealInput["adjustments"]): MealInput =>
    ({ id, date: "2026-10-30", slot, dish, recipes, adjustments });
  const meals = [meal("m1", "Lunch", "Sambar", [{ recipe_id: "r1", servings: 1 }]), meal("m2", "Dinner", "Bhindi", [{ recipe_id: "r2", servings: 1 }])];
  const catalog = new Map([["onion", ing({ id: "onion", conversions: { pc: 150 } })], ["rice", ing({ id: "rice", category: "grains" })], ["milk", ing({ id: "milk", category: "dairy", default_unit: "ml" })]]);

  it("scales per-adult qty by the family, converts to base, and keys by (meal, ingredient)", () => {
    const lines = [
      { recipe_id: "r1", ingredient_id: "onion", item: "Onion", qty: 1, unit: "pc", category: "vegetables" },
      { recipe_id: "r1", ingredient_id: "onion", item: "Onion (garnish)", qty: 20, unit: "g", category: "vegetables" },
      { recipe_id: "r2", ingredient_id: "onion", item: "Onions", qty: 50, unit: "g", category: "vegetables" },
    ];
    const out = computeMealNeeds(meals, lines, catalog, () => 4, DEFAULTS);
    expect(out).toHaveLength(2);
    const m1 = out.find((r) => r.meal_id === "m1")!;
    expect(m1).toMatchObject({ ingredient_id: "onion", qty_min: 680, qty_max: 750, qty_unit: "g", needed_by: "2026-10-30", item: "onion" });
    expect(out.find((r) => r.meal_id === "m2")).toMatchObject({ qty_min: 200, qty_max: 250 });
  });

  it("never accumulates: the same inputs always give the same output", () => {
    const lines = [{ recipe_id: "r1", ingredient_id: "onion", item: "Onion", qty: 50, unit: "g", category: "vegetables" }];
    expect(computeMealNeeds(meals, lines, catalog, () => 2, DEFAULTS)).toEqual(computeMealNeeds(meals, lines, catalog, () => 2, DEFAULTS));
  });

  it("leaves out held-back categories, unlinked, optional, uncategorised and never_auto_add lines", () => {
    const lines = [
      { recipe_id: "r1", ingredient_id: "rice", item: "Rice", qty: 100, unit: "g", category: "grains" },
      { recipe_id: "r1", ingredient_id: null, item: "Mystery", qty: 1, unit: "pc", category: "vegetables" },
      { recipe_id: "r1", ingredient_id: "onion", item: "Onion", qty: 1, unit: "pc", category: "vegetables", optional: 1 },
      { recipe_id: "r2", ingredient_id: "x", item: "X", qty: 1, unit: "pc", category: null },
    ];
    expect(computeMealNeeds(meals, lines, catalog, () => 1, DEFAULTS)).toHaveLength(0);
    const meat = new Map([["chicken", ing({ id: "chicken", category: "meat", prefs: { never_auto_add: true } })]]);
    expect(computeMealNeeds(meals, [{ recipe_id: "r1", ingredient_id: "chicken", item: "Chicken", qty: 100, unit: "g", category: "meat" }], meat, () => 1, DEFAULTS)).toHaveLength(0);
  });

  it("prefers qty_per_adult over the legacy qty; null qty gives a row with no range", () => {
    const lines = [{ recipe_id: "r1", ingredient_id: "milk", item: "Milk", qty: 999, qty_per_adult: 100, unit: "ml", category: "dairy" },
      { recipe_id: "r2", ingredient_id: "onion", item: "Onion", qty: null, unit: null, category: "vegetables" }];
    const out = computeMealNeeds(meals, lines, catalog, () => 3, DEFAULTS);
    expect(out.find((r) => r.ingredient_id === "milk")).toMatchObject({ qty_min: 300, qty_max: 500, qty_unit: "ml" });
    expect(out.find((r) => r.ingredient_id === "onion")).toMatchObject({ qty_min: null, qty_max: null });
  });
});

describe("computeMealNeeds: recipe sets and the agent's review", () => {
  const catalog = new Map([["onion", ing({ id: "onion" })], ["pumpkin", ing({ id: "pumpkin" })], ["curd", ing({ id: "curd", category: "dairy", default_unit: "ml" })]]);
  const lines = [
    { recipe_id: "dal", ingredient_id: "onion", item: "Onion", qty: 50, unit: "g", category: "vegetables" },
    { recipe_id: "sabzi", ingredient_id: "onion", item: "Onion", qty: 20, unit: "g", category: "vegetables" },
    { recipe_id: "sabzi", ingredient_id: "pumpkin", item: "Pumpkin", qty: 150, unit: "g", category: "vegetables" },
  ];
  const m = (recipes: { recipe_id: string; servings: number }[], adjustments?: MealInput["adjustments"]): MealInput[] =>
    [{ id: "m1", date: "2026-10-30", slot: "Lunch", dish: "Dal + sabzi", recipes, adjustments }];

  it("sums every recipe of the meal, scaled by its servings", () => {
    const out = computeMealNeeds(m([{ recipe_id: "dal", servings: 1 }, { recipe_id: "sabzi", servings: 0.5 }]), lines, catalog, () => 2, DEFAULTS);
    expect(out.find((r) => r.ingredient_id === "onion")!.qty_min).toBe(120);   // 50×2 + 20×2×0.5
    expect(out.find((r) => r.ingredient_id === "pumpkin")!.qty_min).toBe(150);
  });
  it("applies the review: drop, scale, add", () => {
    const out = computeMealNeeds(m([{ recipe_id: "dal", servings: 1 }, { recipe_id: "sabzi", servings: 1 }], [
      { ingredient_id: "pumpkin", action: "drop", reason: "leftover sabzi from tonight" },
      { ingredient_id: "onion", action: "scale", factor: 0.5, reason: "kids only" },
      { ingredient_id: "curd", action: "add", qty: 200, unit: "ml", reason: "raita, per the note" },
    ]), lines, catalog, () => 2, DEFAULTS);
    expect(out.map((r) => r.ingredient_id).sort()).toEqual(["curd", "onion"]);
    expect(out.find((r) => r.ingredient_id === "onion")!.qty_min).toBe(70);
    expect(out.find((r) => r.ingredient_id === "curd")).toMatchObject({ qty_min: 200, qty_unit: "ml" });
  });
});

describe("reconcileMealRows", () => {
  const want = (over: Partial<DesiredRow> = {}): DesiredRow => ({ meal_id: "m1", ingredient_id: "onion", item: "Onion", category: "vegetables", needed_by: "2026-10-30", slot: "Lunch", dish: "Sambar", qty_min: 200, qty_max: 250, qty_unit: "g", ...over });
  const row = (over: Partial<ExistingMealRow> = {}): ExistingMealRow => ({ id: "g1", meal_id: "m1", ingredient_id: "onion", status: "pending", cart_id: null, needed_by: "2026-10-30", qty_min: 200, qty_max: 250, qty_unit: "g", item: "Onion", category: "vegetables", for_dish: "Sambar", ...over });
  const none = new Map<string, string>();

  it("inserts a missing row and leaves an identical one alone", () => {
    expect(reconcileMealRows([want()], [], none).inserts).toHaveLength(1);
    expect(reconcileMealRows([want()], [row()], none)).toEqual({ inserts: [], updates: [], deletes: [] });
  });
  it("overwrites a changed amount instead of adding to it", () => {
    const r = reconcileMealRows([want({ qty_min: 300, qty_max: 500 })], [row()], none);
    expect(r.updates).toEqual([{ id: "g1", set: { qty_min: 300, qty_max: 500, suggested_qty: "300–500 g" } }]);
  });
  it("moves a row with its meal and frees it from its cart", () => {
    const r = reconcileMealRows([want({ needed_by: "2026-11-01" })], [row({ cart_id: "c1" })], new Map([["c1", "draft"]]));
    expect(r.updates[0].set).toMatchObject({ needed_by: "2026-11-01", cart_id: null, buy_at: null });
  });
  it("deletes open rows for deleted meals, duplicates and legacy rows without meal_id", () => {
    const r = reconcileMealRows([want()], [row(), row({ id: "dup" }), row({ id: "gone", meal_id: "m9" }), row({ id: "legacy", meal_id: null })], none);
    expect(r.deletes.sort()).toEqual(["dup", "gone", "legacy"]);
  });
  it("drops a legacy row in a held cart once a v2 row for the same ingredient is in that cart, never in an ordered cart", () => {
    const v2 = row({ id: "v2", cart_id: "c1" });
    const legacy = row({ id: "legacy", meal_id: null, cart_id: "c1" });
    expect(reconcileMealRows([want()], [v2, legacy], new Map([["c1", "draft"]])).deletes).toEqual(["legacy"]);
    expect(reconcileMealRows([want()], [v2, legacy], new Map([["c1", "ordered"]])).deletes).toEqual([]);
    const otherIng = row({ id: "legacy2", meal_id: null, cart_id: "c1", ingredient_id: "tomato" });
    expect(reconcileMealRows([want()], [v2, otherIng], new Map([["c1", "draft"]])).deletes).toEqual(["legacy2"]);  // nothing needs tomato any more
  });
  it("drops a held legacy row on the very first run, before any v2 row for it exists yet", () => {
    const legacy = row({ id: "legacy", meal_id: null, cart_id: "c1" });
    const r = reconcileMealRows([want()], [legacy], new Map([["c1", "draft"]]));
    expect(r.deletes).toEqual(["legacy"]);
    expect(r.inserts).toHaveLength(1);
  });
  it("keeps bought rows and doesn't re-add their need; a draft's rows stay live (amounts follow the meal)", () => {
    const r = reconcileMealRows([want()], [row({ status: "ordered", qty_min: 1 })], none);
    expect(r).toEqual({ inserts: [], updates: [], deletes: [] });
    expect(reconcileMealRows([want()], [row({ cart_id: "c1", qty_min: 1 })], new Map([["c1", "draft"]])).updates[0].set).toMatchObject({ qty_min: 200 });
    expect(reconcileMealRows([], [row({ cart_id: "c1" })], new Map([["c1", "ordered"]])).deletes).toHaveLength(0);
    expect(reconcileMealRows([want()], [row({ status: "have_stock" })], none).inserts).toHaveLength(0);
  });
  it("drops a row its meal no longer needs from a draft (the dish changed)", () => {
    expect(reconcileMealRows([], [row({ cart_id: "c1" })], new Map([["c1", "draft"]])).deletes).toEqual(["g1"]);
  });
  it("a skipped row stays skipped while the meal is unchanged, re-opens when it changed", () => {
    expect(reconcileMealRows([want()], [row({ status: "skipped" })], none)).toEqual({ inserts: [], updates: [], deletes: [] });
    const r = reconcileMealRows([want({ needed_by: "2026-11-02" })], [row({ status: "skipped" })], none);
    expect(r.updates[0].set).toMatchObject({ status: "pending", needed_by: "2026-11-02" });
  });
});

describe("mergeCartLines", () => {
  const resolve = { prefsFor: () => ({ pack_min: 250, pack_unit: "g" }), conversionsFor: (): Record<string, number> => ({ pc: 150 }) };
  it("one line per ingredient: summed min, pack-rounded max on the sum, all covered meals listed", () => {
    const rows = [
      { id: "a", ingredient_id: "onion", item: "Onion", meal_id: "m1", for_dish: "Sambar", needed_by: "2026-10-30", qty_min: 100, qty_max: 250, qty_unit: "g", qty: null, category: "vegetables" },
      { id: "b", ingredient_id: "onion", item: "Onion", meal_id: "m2", for_dish: "Bhindi", needed_by: "2026-10-30", qty_min: 1, qty_max: 1, qty_unit: "pc", qty: null, category: "vegetables" },
      { id: "c", ingredient_id: null, item: "Bread", meal_id: null, for_dish: null, needed_by: null, qty_min: null, qty_max: null, qty_unit: null, qty: "1 loaf", category: "bakery" },
    ];
    const lines = mergeCartLines(rows, resolve);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ ingredient_id: "onion", qty_min: 250, qty_max: 250, qty_unit: "g", row_ids: ["a", "b"] });
    expect(lines[0].meals.map((m) => m.meal_id)).toEqual(["m1", "m2"]);
    expect(lines[1]).toMatchObject({ item: "Bread", qty: "1 loaf", qty_min: null });
  });
  it("formats a range", () => {
    expect(formatRange(200, 250, "g")).toBe("200–250 g");
    expect(formatRange(250, 250, "g")).toBe("250 g");
    expect(formatRange(null, null, null)).toBeNull();
  });
});
