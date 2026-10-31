// Every 30 minutes: rings any advance-prep step (soak the batter, set it to ferment) whose moment has arrived, for
// any meal in the next 48 hours whose recipe has prep_steps. No model call: this never needs judgement, only the
// clock, so it rings through ctx.notify and dedupes itself in prep_reminders.
import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { meals, recipes, prep_reminders } from "../db/schema";
import { readSettings } from "../settings";
import { addDaysStr, addMinutes, dateTime, todayStr } from "../timeline";
import { recipeSets } from "../mealRecipes";

interface Ctx {
  notify(text: string): Promise<unknown>;
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database };
}

interface PrepStep { step: string; hours_before_cook: number }

const cookAt = (date: string, slot: string, s: Record<string, unknown>): string =>
  dateTime(date, slot === "Dinner" ? (s["cook.evening"] as string) : (s["cook.morning"] as string));

/** A reminder due inside [quiet.start, quiet.end) moves to quiet.start − 1h the evening before (quiet hours may
 *  cross midnight, as the defaults do: 22:30–06:30). */
function dodgeQuietHours(remindAt: string, s: Record<string, unknown>): string {
  const quietStart = s["quiet.start"] as string, quietEnd = s["quiet.end"] as string;
  const [date, time] = remindAt.split("T");
  const t = time.slice(0, 5);
  const inQuiet = quietStart < quietEnd ? (t >= quietStart && t < quietEnd) : (t >= quietStart || t < quietEnd);
  if (!inQuiet) return remindAt;
  return addMinutes(`${date}T${quietStart}`, -60);
}

export default async function prepReminders(ctx: Ctx): Promise<void> {
  const db = ctx.kit.db;
  const s = readSettings(ctx.kit.sqlite);
  const now = new Date();
  const today = todayStr(now);
  const end = addDaysStr(today, 2);
  const nowStamp = `${today}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const upcoming = db.select().from(meals).where(and(gte(meals.date, today), lte(meals.date, end))).all() as
    { id: string; date: string; slot: string }[];
  const sets = recipeSets(db, upcoming.map((m) => m.id));
  if (!sets.size) return;

  const recipeRows = db.select().from(recipes).all() as { id: string; prep_steps: string | null }[];
  const stepsById = new Map(recipeRows.map((r) => [r.id, r.prep_steps ? (JSON.parse(r.prep_steps) as PrepStep[]) : []]));

  for (const meal of upcoming) {
    const steps = (sets.get(meal.id) ?? []).flatMap((r) => stepsById.get(r.recipe_id) ?? []);
    if (!steps.length) continue;
    const cook = cookAt(meal.date, meal.slot, s);
    for (const step of steps) {
      const raw = addMinutes(cook, -(step.hours_before_cook * 60 + (s["reminder.buffer_min"] as number)));
      const remindAt = dodgeQuietHours(raw, s);
      if (remindAt > nowStamp) continue;   // not due yet
      const already = db.select({ id: prep_reminders.id }).from(prep_reminders)
        .where(and(eq(prep_reminders.meal_id, meal.id), eq(prep_reminders.step, step.step))).all();
      if (already.length) continue;
      await ctx.notify(`🍳 ${step.step} — for ${meal.slot.toLowerCase()} on ${meal.date}`);
      db.insert(prep_reminders).values({ meal_id: meal.id, step: step.step, remind_at: remindAt, sent_at: new Date().toISOString(), updated_by: "app" }).run();
    }
  }
}
