// The day's planned meals in the kit's table: read them, replace them in one go (the coach sets the whole day at once), and log a
// planned meal as eaten.
import type { Kit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import { events, meal_plan_items } from "../db/schema";
import { dayOf, shiftDays } from "../today/routes";
import { MEAL_PLAN_AUTHOR } from "./config";
import type { Nutrients } from "../nutrition/catalog";
import type { LoggedMeal, MealPlanInput, MealPlanRow } from "./plan";

export interface EatenMeal extends Nutrients { title: string; at: string; kcal: number; protein_g: number; fiber_g: number }

export interface MealPlanStore {
  rows(day: string): MealPlanRow[];
  logged(day: string): LoggedMeal[];
  replace(day: string, items: MealPlanInput[]): Promise<void>;
  logMeal(meal: EatenMeal): Promise<string>;
}

export function kitMealPlanStore(kit: Kit): MealPlanStore {
  // Prepared on first use: a new build is first tried against the previous database, before this table exists.
  const dayQuery = () => kit.sqlite.query(`SELECT * FROM meal_plan_items WHERE day = ?1`);
  const eventsQuery = () => kit.sqlite.query(`SELECT title, kind, at, kcal, protein_g, fiber_g FROM events WHERE at >= ?1 AND at < ?2 ORDER BY at`);
  return {
    rows: (day) => dayQuery().all(day) as MealPlanRow[],
    // Stored times are UTC or local: a day either side, then keep the local day.
    logged: (day) => (eventsQuery().all(shiftDays(day, -1), shiftDays(day, 2)) as (LoggedMeal & { at: string })[]).filter((e) => dayOf(e.at) === day),
    async replace(day, items) {
      const old = dayQuery().all(day) as MealPlanRow[];
      await kit.db.delete(meal_plan_items).where(eq(meal_plan_items.day, day));
      for (const r of old) kit.emitChange("meal_plan_items", r.id, "delete", MEAL_PLAN_AUTHOR);
      for (const [position, it] of items.entries()) {
        const [row] = await kit.db.insert(meal_plan_items).values({ day, ...it, position, done: false, updated_by: MEAL_PLAN_AUTHOR }).returning({ id: meal_plan_items.id });
        kit.emitChange("meal_plan_items", row.id, "insert", MEAL_PLAN_AUTHOR);
      }
    },
    async logMeal(meal) {
      const [row] = await kit.db.insert(events).values({ ...meal, kind: "Meal", updated_by: MEAL_PLAN_AUTHOR }).returning({ id: events.id });
      kit.emitChange("events", row.id, "insert", MEAL_PLAN_AUTHOR);
      return row.id;
    },
  };
}
