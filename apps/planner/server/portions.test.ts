import { describe, it, expect } from "bun:test";
import { buildGroceryChanges, familyMultiplier, historicalQty, portionMultiplier, scaledQty, structuredGroceryChanges } from "../src/pages/portions";

describe("portionMultiplier", () => {
  it("defaults to 1 (one regular adult portion) when nothing's recorded", () => {
    expect(portionMultiplier([], "d1", "Dinner")).toBe(1);
  });
  it("reads a diner's own recorded multiplier for that slot", () => {
    const portions = [{ diner_id: "d1", slot: "Dinner", multiplier: 0.5 }, { diner_id: "d1", slot: "Lunch", multiplier: 1.2 }];
    expect(portionMultiplier(portions, "d1", "Dinner")).toBe(0.5);
    expect(portionMultiplier(portions, "d1", "Lunch")).toBe(1.2);
  });
});

describe("familyMultiplier", () => {
  it("sums every diner's own multiplier for the slot, defaulting missing ones to 1", () => {
    const portions = [{ diner_id: "d1", slot: "Dinner", multiplier: 0.5 }];
    expect(familyMultiplier(["d1", "d2", "d3"], "Dinner", portions)).toBe(2.5);   // 0.5 + 1 + 1
  });
  it("is 0 for no diners", () => { expect(familyMultiplier([], "Dinner", [])).toBe(0); });
});

describe("scaledQty", () => {
  it("scales a per-adult quantity by the family's total multiplier", () => {
    expect(scaledQty({ qty: 0.5, unit: "cup" }, 4)).toBe("2 cup");
  });
  it("rounds to one decimal place and drops a trailing zero", () => {
    expect(scaledQty({ qty: 1, unit: "cup" }, 3.33)).toBe("3.3 cup");
    expect(scaledQty({ qty: 1, unit: "cup" }, 2)).toBe("2 cup");
  });
  it("has no unit when the recipe recorded none", () => {
    expect(scaledQty({ qty: 2, unit: null }, 3)).toBe("6");
  });
  it("is null when the recipe never recorded a quantity, or nobody is eating", () => {
    expect(scaledQty({ qty: null, unit: "cup" }, 4)).toBeNull();
    expect(scaledQty({ qty: 1, unit: "cup" }, 0)).toBeNull();
  });
});

describe("historicalQty", () => {
  const orders = [
    { item: "Rajma", for_dish: "Rajma chawal", qty: "1 kg", status: "ordered", created_at: "2026-09-01" },
    { item: "Rajma", for_dish: "Rajma chawal", qty: "1.2 kg", status: "ordered", created_at: "2026-10-01" },
    { item: "Rajma", for_dish: "Rajma chawal", qty: "huge", status: "pending", created_at: "2026-10-15" },   // not yet ordered: ignored
    { item: "Rajma", for_dish: "Something else", qty: "5 kg", status: "ordered", created_at: "2026-10-20" },  // different dish: ignored
  ];
  it("is the most recent ordered quantity for the same item and dish", () => {
    expect(historicalQty("Rajma", "Rajma chawal", orders)).toBe("1.2 kg");
  });
  it("matches case-insensitively", () => {
    expect(historicalQty("RAJMA", "rajma CHAWAL", orders)).toBe("1.2 kg");
  });
  it("is null with no matching order history", () => {
    expect(historicalQty("Chickpeas", "Chole", orders)).toBeNull();
  });
});

describe("structuredGroceryChanges", () => {
  const list = [{ id: "g1", item: "Rajma, 1 kg", status: "pending" }, { id: "g2", item: "Onion", status: "ordered" }];
  const lines = [
    { item: "Rajma", qty: 0.25, unit: "cup", category: "pantry" },
    { item: "Onion", qty: 0.5, unit: null, category: "vegetables" },
    { item: "Ginger", qty: null, unit: null, category: "vegetables" },
  ];
  it("skips an item already on the list and not bought, reopens one that was bought, adds the rest with a scaled quantity", () => {
    const c = structuredGroceryChanges(lines, 4, "Rajma chawal", list);
    expect(c.skipped).toEqual(["Rajma"]);
    expect(c.reopen).toEqual([{ id: "g2", for_dish: "Rajma chawal" }]);
    expect(c.add).toEqual([{ item: "Ginger", qty: null, category: "vegetables", for_dish: "Rajma chawal" }]);
  });
  it("falls back to historyQty for an ingredient with no recorded quantity", () => {
    const c = structuredGroceryChanges(lines, 4, "Rajma chawal", [], (item) => (item === "Ginger" ? "2 inch" : null));
    const ginger = c.add.find((a) => a.item === "Ginger");
    expect(ginger?.qty).toBe("2 inch");
  });
  it("adds a line once even when it's listed twice", () => {
    expect(structuredGroceryChanges([{ item: "Salt", qty: null, unit: null, category: "pantry" }, { item: "salt", qty: null, unit: null, category: "pantry" }], 4, "X", []).add).toHaveLength(1);
  });
});

const row = (over: Partial<{ id: string; item: string; for_dish: string | null; qty: string | null; status: string | null }>) =>
  ({ id: "g", item: "x", for_dish: null, qty: null, status: null, ...over });

describe("buildGroceryChanges: add all for this meal", () => {
  const rice = { id: "r1", name: "Rice", ingredients: "Sona masoori, 1 cup" };
  const sambar = { id: "r2", name: "Sambar", ingredients: "Toor dal, 1/2 cup\nDrumsticks, 2\nTamarind" };
  const bhindi = { id: "r3", name: "Bhindi fry", ingredients: "Bhindi, 250 g\nTamarind" };
  it("adds each dish's missing items once, under the first dish that needs them (freeform recipes, no structured data)", () => {
    const list = [row({ id: "g1", item: "Toor dal, 1 kg" }), row({ id: "g2", item: "Bhindi", status: "ordered" })];
    const c = buildGroceryChanges([rice, sambar, bhindi], new Map(), 4, list);
    expect(c.add).toEqual([
      { item: "Sona masoori, 1 cup", qty: null, category: null, for_dish: "Rice" },
      { item: "Drumsticks, 2", qty: null, category: null, for_dish: "Sambar" },
      { item: "Tamarind", qty: null, category: null, for_dish: "Sambar" },
    ]);
    expect(c.reopen).toEqual([{ id: "g2", for_dish: "Bhindi fry" }]);
    expect(c.skipped).toBe(2);   // toor dal on the list; tamarind already added for the sambar
    expect(c.bare).toEqual([]);
  });
  it("names the recipes with no ingredients yet (freeform or structured)", () => {
    expect(buildGroceryChanges([{ id: "r4", name: "Salad", ingredients: null }, rice], new Map(), 4, []).bare).toEqual(["Salad"]);
  });
  it("uses a recipe's structured ingredients, scaled, alongside another recipe's freeform text in the same pass", () => {
    const structured = new Map([["r1", [{ item: "Sona masoori", qty: 0.5, unit: "cup", category: "pantry" }]]]);
    const c = buildGroceryChanges([rice, sambar], structured, 4, []);
    expect(c.add.find((a) => a.item === "Sona masoori")).toEqual({ item: "Sona masoori", qty: "2 cup", category: "pantry", for_dish: "Rice" });
    expect(c.add.some((a) => a.item === "Drumsticks, 2")).toBe(true);   // sambar still freeform, unaffected
  });
});
