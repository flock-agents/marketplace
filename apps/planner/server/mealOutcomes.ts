// What became of a meal (docs/V3-FLOW-SPEC.md "When a meal's needs leave the draft" and "Inferring instead of
// asking"): once a meal's latest possible time has passed with nobody saying otherwise, it was cooked as planned.
// An owner/agent outcome (PATCH meals.outcome) is never overwritten; a meal with any outcome needs nothing more.
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { meals } from "./db/schema";
import { SETTINGS } from "./db/constants";
import { logChoice } from "./choices";
import { addDaysStr, cookTimeFor, timelineSettingsFrom, todayStr, type SettingsReader } from "./timeline";

type Db = BunSQLiteDatabase<any>;
type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;

/** Older open meals are history from before outcomes existed: left alone rather than flooding the choice log. */
export const INFER_LOOKBACK_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");
export const localStamp = (d: Date): string => `${todayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localDate = (date: string, time: string): Date => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const declaredDefault = (key: string): string => String(SETTINGS.find((s) => s.key === key)?.default ?? "23:00");

/** The slot's latest possible cooking time (settings meal.latest.*). An unknown slot gets dinner's, the latest. */
export function latestTimeFor(slot: string, settings: SettingsReader): string {
  const known = ["breakfast", "lunch", "dinner"].includes(slot.toLowerCase()) ? slot.toLowerCase() : "dinner";
  const key = `meal.latest.${known}`;
  return settings.get<string>(key) ?? declaredDefault(key);
}

/** Whether a meal on `date` in `slot` is surely over by `now` (its latest time has passed). */
export function isPastLatest(date: string, slot: string, settings: SettingsReader, now: Date): boolean {
  return `${date}T${latestTimeFor(slot, settings)}` <= localStamp(now);
}

/** Every recent meal with no outcome whose latest time has passed → cooked, inferred, at its planned cook time;
 *  each logged as an inferred meal_cooked choice. Idempotent. Returns the meal ids it marked. */
export function inferMealOutcomes(db: Db, settings: SettingsReader, now = new Date(), emit?: Emit): string[] {
  const today = todayStr(now);
  const open = db.select({ id: meals.id, date: meals.date, slot: meals.slot, time: meals.time, dish: meals.dish }).from(meals)
    .where(and(isNull(meals.outcome), gte(meals.date, addDaysStr(today, -INFER_LOOKBACK_DAYS)), lte(meals.date, today))).all() as
    { id: string; date: string; slot: string; time: string | null; dish: string }[];
  const cook = timelineSettingsFrom(settings);
  const marked: string[] = [];
  for (const m of open) {
    if (!isPastLatest(m.date, m.slot, settings, now)) continue;
    const at = localDate(m.date, cookTimeFor(m.slot, m.time, cook) ?? latestTimeFor(m.slot, settings));
    db.update(meals).set({ outcome: "cooked", outcome_source: "inferred", outcome_at: at.toISOString(), updated_by: "app" })
      .where(and(eq(meals.id, m.id), isNull(meals.outcome))).run();
    logChoice(db, { kind: "meal_cooked", subject: m.id, detail: { date: m.date, slot: m.slot, dish: m.dish }, source: "inferred", at: now });
    emit?.("meals", m.id, "update");
    marked.push(m.id);
  }
  return marked;
}
