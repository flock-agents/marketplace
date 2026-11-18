// The two daily check-ins: in the afternoon about tonight's dinner, in the evening about tomorrow's meals (which is also the
// cook's brief). The app writes the message; the agent is woken to send it as it is, and only when there is a meal to check.
// Each check-in also records the time of day it really runs at, for the how-to-use intro to name (record_order).
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { house, order_lines, orders, saved_recipes } from "../db/schema";
import { addDays, mondayOf, todayStr, weekdayOf } from "../dates";
import { getHouse, houseView, isObject, list, type Db } from "../family";
import { routinesMayRun } from "../gate";
import { weekView, type MealView } from "../meals";
import { dinnerCheckText, tomorrowCheckText } from "../messages";
import { normItem } from "../products";
import type { RoutineCtx } from "./index";

const SEND = "Send the family this check-in exactly, then handle replies (set_dish, set_meal, add_to_order)";

/** The time of day a routine runs at, as "HH:MM", read from its trigger as Flock sends it (`{ type: "schedule", cron }`, or
 *  the cron itself). Null unless it runs once a day at a fixed time: "0 15 * * *" is 15:00; every 15 minutes, weekdays only
 *  or two times a day are not one time. */
export function dailyTime(trigger: unknown): string | null {
  const cron = typeof trigger === "string" ? trigger : isObject(trigger) && trigger.type === "schedule" && typeof trigger.cron === "string" ? trigger.cron : null;
  const m = cron ? /^(\d{1,2}) +(\d{1,2}) +\* +\* +\*$/.exec(cron.trim()) : null;
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return null;
  return `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
}

/** Write the time this check-in runs at on the house, on every run, family or not. Nothing is written when the routine has
 *  no one daily time, or before the app's tables are there. */
function recordTime(ctx: RoutineCtx, column: "dinner_check_time" | "tomorrow_check_time"): void {
  const time = dailyTime(ctx.routine?.trigger);
  if (!time) return;
  try {
    const home = getHouse(ctx.kit.db);
    if (home[column] === time) return;
    ctx.kit.db.update(house).set({ [column]: time, updated_at: new Date().toISOString() }).where(eq(house.id, home.id)).run();
    ctx.kit.emitChange("house", home.id, "update", "app");
  } catch (e) { console.warn(`[planner] ${column} was not recorded`, e); }
}

/** The meals of one day, from a plan that is final: a draft is not what the family is eating yet. */
function mealsOn(db: Db, date: string): MealView[] {
  const week = weekView(db, mondayOf(date));
  return week.status === "final" ? week.days.find((d) => d.date === date)?.meals ?? [] : [];
}

/** The fresh items the meals of `date` need, split by whether a line on an order covering that day has them. An order that
 *  is scheduled, placed, paid or not paid covers its days; a cancelled one covers nothing. */
function freshItems(db: Db, date: string, meals: MealView[]): { covered: string[]; missing: string[] } {
  const covering = db.select({ id: orders.id }).from(orders).where(and(ne(orders.status, "cancelled"), lte(orders.covers_from, date), gte(orders.covers_to, date))).all().map((o) => o.id);
  const onOrder = new Set(covering.length ? db.select({ item: order_lines.item }).from(order_lines).where(inArray(order_lines.order_id, covering)).all().map((l) => normItem(l.item)) : []);
  const fresh = new Map<string, string>();
  for (const i of meals.flatMap((m) => m.dishes).flatMap((d) => d.ingredients)) if (i.keeps !== "long" && !fresh.has(normItem(i.item))) fresh.set(normItem(i.item), i.item);
  const of = (on: boolean) => [...fresh].filter(([key]) => onOrder.has(key) === on).map(([, item]) => item);
  return { covered: of(true), missing: of(false) };
}

/** Each dish's video: its own, else the first link of its saved recipe. */
function videosOf(db: Db, meals: MealView[]): { dish: string; url: string }[] {
  const all = meals.flatMap((m) => m.dishes);
  const ids = [...new Set(all.map((d) => d.recipe_id).filter((id): id is string => !!id))];
  const links = new Map((ids.length ? db.select().from(saved_recipes).where(inArray(saved_recipes.id, ids)).all() : []).map((r) => [r.id, list<string>(r.links)[0]]));
  return all.flatMap((d) => { const url = d.video_url ?? (d.recipe_id ? links.get(d.recipe_id) : undefined); return url ? [{ dish: d.name, url }] : []; });
}

export async function dinnerCheck(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  recordTime(ctx, "dinner_check_time");
  if (!routinesMayRun(ctx.kit.sqlite)) return;
  const { db } = ctx.kit, today = todayStr(now);
  const meal = mealsOn(db, today).find((m) => m.slot === "Dinner") ?? null;
  const text = dinnerCheckText({ meal, ...freshItems(db, today, meal ? [meal] : []) });
  if (text) await ctx.wakeAgent(SEND, { text, meal_id: meal!.id });
}

export async function tomorrowCheck(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  recordTime(ctx, "tomorrow_check_time");
  if (!routinesMayRun(ctx.kit.sqlite)) return;
  const { db } = ctx.kit, date = addDays(todayStr(now), 1);
  const meals = mealsOn(db, date), home = houseView(getHouse(db));
  // The videos are addressed to the cook only when they come that day, and the app knows who they are and when they arrive.
  const cook = home.cook_name && home.cook_arrival ? { name: home.cook_name, arrival: home.cook_arrival, today: home.cook_days.includes(weekdayOf(date)) } : undefined;
  const text = tomorrowCheckText({ date, meals, cook, videos: videosOf(db, meals), missing: freshItems(db, date, meals).missing });
  if (text) await ctx.wakeAgent(SEND, { text, date, meal_ids: meals.map((m) => m.id) });
}
