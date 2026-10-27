// The day's plan rows in the kit's table: read them, and replace them in one go (the coach sets the whole day at once).
import type { Kit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import { plan_items } from "../db/schema";
import { PLAN_AUTHOR } from "./config";
import type { PlanInput, PlanRow } from "./plan";

export interface PlanStore {
  rows(day: string): PlanRow[];
  replace(day: string, items: PlanInput[]): Promise<void>;
}

export function kitPlanStore(kit: Kit): PlanStore {
  // Prepared on first use: a new build is first tried against the previous database, before this table exists.
  const dayQuery = () => kit.sqlite.query(`SELECT id, name, dose, done, position, exercise FROM plan_items WHERE day = ?1`);
  return {
    rows: (day) => dayQuery().all(day) as PlanRow[],
    async replace(day, items) {
      const old = dayQuery().all(day) as PlanRow[];
      await kit.db.delete(plan_items).where(eq(plan_items.day, day));
      for (const r of old) kit.emitChange("plan_items", r.id, "delete", PLAN_AUTHOR);
      for (const [position, it] of items.entries()) {
        const [row] = await kit.db.insert(plan_items).values({ day, name: it.name, dose: it.dose ?? null, exercise: it.exercise ?? null, position, done: false, updated_by: PLAN_AUTHOR }).returning({ id: plan_items.id });
        kit.emitChange("plan_items", row.id, "insert", PLAN_AUTHOR);
      }
    },
  };
}
