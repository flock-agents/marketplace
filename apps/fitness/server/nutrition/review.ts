// Plain code: the logged meals of a run of days added up, every nutrient (the headline three and the full breakdown), for a review.
import { REVIEWED, missingNutrients } from "./catalog";

export type MealRow = Record<string, unknown> & { at: string };
type Totals = Record<string, number | null>;
/** One day: how many meals were logged, how many carry the full breakdown, and each nutrient added up (null when no meal had it). */
export interface NutritionDay { date: string; meals: number; fullBreakdown: number; totals: Totals }
export interface NutritionReview { days: NutritionDay[]; average: Totals; meals: number; fullBreakdown: number }

const round = (n: number) => Math.round(n * 10) / 10;

function addUp(meals: MealRow[]): Totals {
  return Object.fromEntries(REVIEWED.map(({ key }) => {
    const known = meals.map((m) => m[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return [key, known.length ? round(known.reduce((a, b) => a + b, 0)) : null];
  }));
}

/** `meals`: the logged meals in and around `days` (newest first); `dayOf` files a stored time under its local day.
 *  `average` is per day, over the days that carry that nutrient, so a day logged before the breakdown existed does not pull it down. */
export function reviewNutrition(days: string[], meals: MealRow[], dayOf: (at: string) => string): NutritionReview {
  const out = days.map((date) => {
    const mine = meals.filter((m) => dayOf(m.at) === date);
    return { date, meals: mine.length, fullBreakdown: mine.filter((m) => missingNutrients(m).length === 0).length, totals: addUp(mine) };
  });
  const average = Object.fromEntries(REVIEWED.map(({ key }) => {
    const known = out.map((d) => d.totals[key]).filter((v): v is number => v !== null);
    return [key, known.length ? round(known.reduce((a, b) => a + b, 0) / known.length) : null];
  }));
  const sum = (k: "meals" | "fullBreakdown") => out.reduce((a, d) => a + d[k], 0);
  return { days: out, average, meals: sum("meals"), fullBreakdown: sum("fullBreakdown") };
}
