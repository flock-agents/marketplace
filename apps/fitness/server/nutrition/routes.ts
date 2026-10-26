// GET /api/nutrients: every nutrient a meal carries (key, label, unit, group), the headline three first.
// GET /api/nutrition?until=YYYY-MM-DD&days=7: the logged meals of each day up to `until` (default today) added up, every nutrient,
// with the per-day average: for reviewing the whole diet, not only the numbers on the Today page.
import { Hono } from "hono";
import type { Kit } from "@flock/app-kit";
import { localDate } from "../time/dates";
import { dayOf, daysUntil, shiftDays } from "../today/routes";
import { REVIEWED } from "./catalog";
import { reviewNutrition, type MealRow } from "./review";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

export function nutritionRoutes(kit: Kit) {
  // Prepared on first use: a new build is first tried against the previous database, before its new columns exist.
  const mealsQuery = () => kit.sqlite.query(`SELECT * FROM events WHERE lower(kind) = 'meal' AND at >= ?1 AND at < ?2 ORDER BY at DESC`);
  const routes = new Hono();
  routes.get("/nutrients", (c) => c.json({ nutrients: REVIEWED }));
  routes.get("/nutrition", (c) => {
    const until = c.req.query("until") ?? localDate(new Date());
    const count = Number(c.req.query("days") ?? 7);
    if (!DATE.test(until) || Number.isNaN(Date.parse(until)) || !Number.isInteger(count) || count < 1 || count > MAX_DAYS) {
      return c.json({ error: `until must be YYYY-MM-DD and days 1 to ${MAX_DAYS}` }, 400);
    }
    const days = daysUntil(until, count);
    // Stored times are UTC or local: a day either side, then each meal is filed under its local day.
    const meals = mealsQuery().all(shiftDays(days[days.length - 1], -1), shiftDays(until, 2)) as MealRow[];
    return c.json({ until, nutrients: REVIEWED, ...reviewNutrition(days, meals, dayOf) });
  });
  return routes;
}
