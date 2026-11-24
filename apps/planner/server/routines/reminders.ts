// The two daily reminders: at 15:00 about tonight's dinner, at 19:00 about tomorrow's meals (reminder.ts builds each). The
// routine only decides whether the agent is woken: it builds the reminder as a dry run (nothing kept) and wakes the agent when
// there is something to say, or, in the evening, when a shopping app is connected (the day's read of its order history). The
// agent then builds the same reminder for real with get_reminder and sends it. Each run also records the time of day it
// really runs at, for the how-to-use intro to name.
import { eq } from "drizzle-orm";
import { house } from "../db/schema";
import { addDays, todayStr } from "../dates";
import { getHouse, houseView, isObject, readUntil, shoppingApps } from "../family";
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

/** What the agent does when a reminder wakes it, as the app's operations in the order they are called. The reminder's own
 *  lines are copied to the apps' carts before it is sent, so the delivery gap it quotes is the app's cart as it now is. */
export const REMINDER_PROMPT = (which: Which): string => [
  `The ${which === "afternoon" ? "15:00 reminder about tonight's dinner" : "19:00 reminder about tomorrow's meals"} is due. The data below has \`which\`, \`date\` (the reminder's day), \`connected\` (the shopping apps the family signed in to) and \`since\` (how far you read each app's order history).`,
  "1. Order history first, so nothing bought already is asked about: for each app in `connected` whose connector can read past orders, read the orders placed since `since[app]` (the last 3 months for an app not in `since`) and give them to import_order_history oldest first, delivered or paid orders only, about 8 orders a call, one app a call. Holding more than one account of an app: read each, pass its `account` (its account id, else its label, always the same), and read from `since[\"app:account\"]`, else 3 months back. Skip an app whose connector cannot read orders. Nothing new: go on.",
  `2. get_reminder { which: "${which}", date } with the \`date\` from the data. If it answers \`empty\`: true, stop and send nothing.`,
  "3. For each cart in `carts` with sync: true, put the same lines in that app's cart with its connector, then sync_cart what the app's cart now holds (its delivery gap included).",
  `4. Call get_reminder { which: "${which}", date } again with the same date: the same reminder, nothing is asked or added twice, and its delivery_gap is now the app's cart as it is. Send that answer's \`text\` on WhatsApp word for word, or its \`app_text\` with its \`block\` in the app chat.`,
  "5. For each cart in `ordered` (Order without asking is on; a retry lists the same ones): send its `message` word for word, check out on its app as the guide says, then record_order { order_id, placed: true, app_order_ref }.",
  "6. The family's replies: running low or still in stock (\"1 low, 2 fine for 2 weeks\") is answer_running_low; \"add dal\" is set_cart_line; a yes to a cart is order_cart { app }; the answer to \"Yesterday's plan had <dish>...\" (the afternoon text's last lines, from its `feedback`) is record_feedback { date, slot, dish, made, liked, again } for each dish, nothing when they do not answer. Never ask anything else about what was cooked.",
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
  // How far the agent woken read each app: its own reading only, so orders another person's agent gave from that person's
  // account never make this one skip its own. A run that does not say which agent it wakes gets the earliest reading of each
  // app: orders read twice are recorded once, orders skipped are lost. An account read with import_order_history's `account`
  // is its own entry, since["<app>:<account>"]; an account with none yet reads 3 months back.
  const synced = houseView(getHouse(db)).history_synced;
  const mine = (app: string) => (ctx.agentId ? readUntil(synced, app, `agent:${ctx.agentId}`, true) : Object.values(synced[app]).sort()[0] ?? null);
  const since = Object.fromEntries(Object.keys(synced).map((app) => [app, mine(app)]).filter((e): e is [string, string] => !!e[1]));
  await wake(ctx, REMINDER_PROMPT(which), { which, date, connected, since });
}

export const afternoonReminder = (ctx: RoutineCtx, now?: Date) => reminder(ctx, "afternoon", now);
export const eveningReminder = (ctx: RoutineCtx, now?: Date) => reminder(ctx, "evening", now);
