// The two daily reminders: at 15:00 about tonight's dinner, at 19:00 about tomorrow's meals (reminder.ts builds each). The
// routine only decides whether the agent is woken: it builds the reminder as a dry run (nothing kept) and wakes the agent when
// there is something to say, or, in the evening, when a shopping app is connected (the day's read of its order history). The
// agent then builds the same reminder for real with get_reminder and sends it. Each run also records the time of day it
// really runs at, for the how-to-use intro to name.
import { eq } from "drizzle-orm";
import { house } from "../db/schema";
import { addDays, todayStr } from "../dates";
import { getHouse, houseView, isObject, shoppingApps } from "../family";
import { familyKnown } from "../gate";
import { buildReminder, type Which } from "../reminder";
import { wake, type RoutineCtx } from "./ctx";

/** The time of day a routine runs at, as "HH:MM", read from its trigger as Flock sends it (`{ type: "schedule", cron }`, or
 *  the cron itself). `daily`: "0 15 * * *" is 15:00. `weekly`: one day of the week, "0 11 * * 0" is 11:00. Null for anything
 *  that is not one time a day (or a week): every 15 minutes, weekdays only, two times a day. */
export function scheduleTime(trigger: unknown, kind: "daily" | "weekly"): string | null {
  const cron = typeof trigger === "string" ? trigger : isObject(trigger) && trigger.type === "schedule" && typeof trigger.cron === "string" ? trigger.cron : null;
  const day = kind === "daily" ? "\\*" : "[0-7]";
  const m = cron ? new RegExp(`^(\\d{1,2}) +(\\d{1,2}) +\\* +\\* +${day}$`).exec(cron.trim()) : null;
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return null;
  return `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
}
export const dailyTime = (trigger: unknown): string | null => scheduleTime(trigger, "daily");

/** Write the time a routine runs at on the house, on every run, family or not. A routine with no one time has none: a time
 *  written earlier is cleared, so the intro never names a time that no longer holds. Nothing is written before the app's
 *  tables are there. */
export function recordTime(ctx: RoutineCtx, column: "afternoon_time" | "evening_time" | "plan_time", time: string | null): void {
  try {
    const home = getHouse(ctx.kit.db);
    if ((home[column] ?? null) === time) return;
    ctx.kit.db.update(house).set({ [column]: time, updated_at: new Date().toISOString() }).where(eq(house.id, home.id)).run();
    ctx.kit.emitChange("house", home.id, "update", "app");
  } catch (e) { console.warn(`[planner] ${column} was not recorded`, e); }
}

/** What the agent does when a reminder wakes it, as the app's operations in the order they are called. */
export const REMINDER_PROMPT = (which: Which): string => [
  which === "afternoon"
    ? "The 15:00 reminder about tonight's dinner is due. The data below has `which` and `date` (the reminder's day)."
    : "The 19:00 reminder about tomorrow's meals is due. The data below has `which`, `date` (the reminder's day), `connected` (the shopping apps the family signed in to) and `since` (how far each app's order history was read).",
  ...(which === "evening"
    ? ["1. Order history: for each app in `connected` whose connector can read past orders, read the orders placed since `since[app]` (the last 3 months for an app not in `since`) and give them to import_order_history, about 8 orders a call, one app a call. Skip an app whose connector cannot read orders. Nothing new: go on."]
    : []),
  `${which === "evening" ? 2 : 1}. get_reminder { which: "${which}", date } with the \`date\` from the data. If it answers \`empty\`: true, stop and send nothing.`,
  `${which === "evening" ? 3 : 2}. Send its \`text\` on WhatsApp word for word, or its \`app_text\` with its \`block\` in the app chat. When it has a delivery_gap, read that app's cart again before you send: the gap is from the cart's last copy. If the app's cart says otherwise, sync_cart what it holds and call get_reminder again (the same reminder: nothing is asked twice), then send that one.`,
  `${which === "evening" ? 4 : 3}. For each cart in \`carts\` with sync: true, put the same lines in that app's cart with its connector, then sync_cart what it holds.`,
  `${which === "evening" ? 5 : 4}. For each cart in \`ordered\` (Order without asking is on; a retry lists the same ones): send its \`message\` word for word, check out on its app as the guide says, then record_order { order_id, placed: true, app_order_ref }.`,
  `${which === "evening" ? 6 : 5}. The family's replies: running low or still in stock ("1 low, 2 fine for 2 weeks") is answer_running_low; "add dal" is set_cart_line; a yes to a cart is order_cart { app }; a change to a meal is set_meal / set_dish.`,
].join("\n");

/** One reminder's run: record its time; for a family the app knows, wake the agent when the reminder has something to say
 *  (a dry run: nothing is kept), or in the evening when an app is connected. The wake carries the reminder's `date`, so the
 *  agent's get_reminder builds this same reminder whenever it runs (a wake held past midnight included). */
export async function reminder(ctx: RoutineCtx, which: Which, now: Date = new Date()): Promise<void> {
  recordTime(ctx, which === "afternoon" ? "afternoon_time" : "evening_time", dailyTime(ctx.routine?.trigger));
  if (!familyKnown(ctx.kit.sqlite)) return;
  const { db } = ctx.kit;
  const today = todayStr(now), date = which === "afternoon" ? today : addDays(today, 1);
  const { connected } = shoppingApps(db);
  const r = buildReminder(db, which, now, { dryRun: true, date });
  if (r.empty && !(which === "evening" && connected.length)) return;
  await wake(ctx, REMINDER_PROMPT(which), which === "evening"
    ? { which, date, connected, since: houseView(getHouse(db)).history_synced }
    : { which, date });
}

export const afternoonReminder = (ctx: RoutineCtx, now?: Date) => reminder(ctx, "afternoon", now);
export const eveningReminder = (ctx: RoutineCtx, now?: Date) => reminder(ctx, "evening", now);
