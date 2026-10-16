import { describe, it, expect } from "bun:test";
import { mondayOf, sampleGroceries, sampleMeals, sampleRecipes, staggered } from "./seed";
import { AISLES, SLOTS } from "./schema";
import { ingredientLines } from "../../src/pages/recipes";

describe("planner sample rows", () => {
  const from = new Date(2026, 9, 8);   // a Thursday
  const meals = sampleMeals(from);
  it("finds the Monday of the current week, across month ends too", () => {
    expect(mondayOf(from)).toBe("2026-10-05");
    expect(mondayOf(new Date(2026, 9, 11))).toBe("2026-10-05");   // Sunday
    expect(mondayOf(new Date(2026, 10, 1))).toBe("2026-10-26");   // Sunday 1 November
  });
  it("fills two weeks, Monday to the Sunday after, with real dishes in Breakfast, Lunch and Dinner", () => {
    expect([...SLOTS]).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(new Set(meals.map((m) => m.date)).size).toBe(14);
    expect(meals.map((m) => m.date).sort()[0]).toBe("2026-10-05");
    expect(meals.map((m) => m.date).sort().at(-1)).toBe("2026-10-18");
    for (const m of meals) {
      expect(SLOTS as readonly string[]).toContain(m.slot);
      expect(m.dish.toLowerCase()).not.toContain("lorem");
    }
  });
  it("a meal is often several dishes, each its own row (never \"Dal, rice, bhindi\" in one dish)", () => {
    const per = new Map<string, number>();
    for (const m of meals) per.set(`${m.date}|${m.slot}`, (per.get(`${m.date}|${m.slot}`) ?? 0) + 1);
    expect([...per.values()].filter((n) => n >= 2).length).toBeGreaterThanOrEqual(10);
    expect([...per.values()].some((n) => n >= 3)).toBe(true);
    for (const m of meals) expect(m.dish, m.dish).not.toContain(",");
  });
  it("a dish row is a date, a slot, the dish and its recipe", () => {
    for (const m of meals) expect(Object.keys(m).sort()).toEqual(["date", "dish", "recipe", "slot"]);
  });
  it("always has today and tomorrow planned, whatever day it is made on", () => {
    for (let d = 0; d < 14; d++) {
      const day = new Date(2026, 9, 5 + d);
      const dates = new Set(sampleMeals(day).map((m) => m.date));
      const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      expect(dates.has(iso(day)), `today ${iso(day)}`).toBe(true);
      expect(dates.has(iso(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))), `tomorrow of ${iso(day)}`).toBe(true);
    }
  });
  it("has four or five family recipes with real ingredients and how the family makes them", () => {
    const r = sampleRecipes();
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r.length).toBeLessThanOrEqual(5);
    for (const x of r) {
      expect(ingredientLines(x.ingredients).length, x.name).toBeGreaterThanOrEqual(4);
      expect(x.method.length, x.name).toBeGreaterThan(40);
    }
  });
  it("links every recipe to some planned meals, by its exact name", () => {
    const names = sampleRecipes().map((r) => r.name);
    for (const n of names) expect(meals.some((m) => m.recipe === n), n).toBe(true);
    for (const m of meals) if (m.recipe) expect(m.dish).toBe(m.recipe);
  });
  it("has twelve grocery rows across the four aisles", () => {
    const g = sampleGroceries();
    expect(g.length).toBe(12);
    for (const r of g) expect(AISLES as readonly string[]).toContain(r.aisle);
    for (const a of ["Vegetables", "Dairy", "Staples", "Spices"]) expect(g.some((r) => r.aisle === a)).toBe(true);
  });
  it("have distinct created_at stamps, in order and in the past", () => {
    const now = new Date();
    const at = staggered(sampleGroceries(), now).map((r) => r.created_at);
    expect(new Set(at).size).toBe(at.length);
    expect([...at].sort()).toEqual(at);
    expect(at.every((t) => t <= now.toISOString())).toBe(true);
  });
});
