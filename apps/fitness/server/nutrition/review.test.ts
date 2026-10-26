import { describe, it, expect } from "bun:test";
import { reviewNutrition } from "./review";
import { REVIEWED } from "./catalog";
import { breakdown } from "./testing";

const dayOf = (at: string) => at.slice(0, 10);

describe("reviewNutrition", () => {
  const meals = [
    { at: "2026-10-22T08:00", kcal: 300, protein_g: 10, fiber_g: 4, ...breakdown(2) },
    { at: "2026-10-22T13:00", kcal: 450, protein_g: 18, fiber_g: 8, ...breakdown(1.25) },
    { at: "2026-10-21T13:00", kcal: 500, protein_g: 20, fiber_g: 9 },   // logged before the full breakdown
  ];
  const review = reviewNutrition(["2026-10-22", "2026-10-21", "2026-10-20"], meals, dayOf);

  it("adds up every nutrient per day and counts the meals carrying the full breakdown", () => {
    expect(review.days[0]).toMatchObject({ date: "2026-10-22", meals: 2, fullBreakdown: 2 });
    expect(review.days[0].totals.kcal).toBe(750);
    expect(review.days[0].totals.iron_mg).toBe(3.3);   // 3.25, to one decimal
    expect(review.days[1]).toMatchObject({ meals: 1, fullBreakdown: 0 });
    expect(review.days[1].totals.iron_mg).toBeNull();
    expect(review.days[2]).toMatchObject({ meals: 0, totals: Object.fromEntries(REVIEWED.map((n) => [n.key, null])) });
    expect([review.meals, review.fullBreakdown]).toEqual([3, 2]);
  });
  it("averages each nutrient over the days that carry it", () => {
    expect(review.average.kcal).toBe(625);
    expect(review.average.iron_mg).toBe(3.3);
  });
});
