// The app's two routines.
// - `due-reminders` (every 15 minutes): what has come due since its last run (an event's own nudge, `reminder_minutes` before its
//   start, every week for a weekly event; a deadline's notice a week before) is handed to the agent to send. The app decides what
//   is due and what each line says; the agent only delivers it. Nothing due: no wake, so no model call.
// - `plan-prep` (hourly): imported events that are new or have moved are handed to the agent with the manifest's planning prompt;
//   its answer comes back through plan_done (calendar.ts). Nothing to plan: no wake.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { events } from "./db/schema";
import { addDays, deadlineNoticeAt, DEADLINE_NOTICE_DAYS, eventRemindersDue, isoDate, pad, shortDate, starts, weekday } from "../src/pages/dates";
import { eventLine, planPrep, type KitLike, type TasksPlatform } from "./calendar";

/** What the routine uses of its run: the SDK's RoutineContext (the wake, its own small state, Flock) and the kit's database. */
export type RoutineCtx = {
  kit: KitLike | { db: BunSQLiteDatabase<any> };
  state: { get<T = unknown>(): T | null; set(value: unknown): void };
  platform?: TasksPlatform;
  wakeAgent(message: string, data?: unknown): Promise<{ ok: boolean; reason?: string }>;
};
export type Due = { who: string | null; text: string; at: string };

/** A run looks back no further than this: a first run, or one after the app was stopped for a day, does not send a backlog. */
export const LOOK_BACK_MIN = 60;

export const DUE_PROMPT = "These Family Calendar reminders are due now. Tell each person the reminders that are theirs: `who` names the family member, and an empty `who` is for everyone in the family. Send each `text` as it is, one short message per person, and nothing else. Do not ask anything and do not wait for a reply.";

const local = (d: Date): string => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Everything due after `from` and up to `to` (local moments), soonest first. A cancelled event says nothing. */
export function dueBetween(db: BunSQLiteDatabase<any>, from: string, to: string): Due[] {
  const today = to.slice(0, 10), out: Due[] = [];
  for (const e of db.select().from(events).all()) {
    if (e.status === "cancelled") continue;
    for (const r of eventRemindersDue(e, from, to)) out.push({ who: e.who, text: eventLine(e, r.date, today), at: r.at });
    // A deadline, a week before its day.
    if (e.kind === "deadline")
      for (const date of starts(e, addDays(from.slice(0, 10), DEADLINE_NOTICE_DAYS), addDays(to.slice(0, 10), DEADLINE_NOTICE_DAYS))) {
        const at = deadlineNoticeAt(date);
        if (at > from && at <= to) out.push({ who: e.who, text: eventLine({ ...e, start_time: null, end_time: null, notes: null }, date, today, `due in a week, on ${weekday(date)} ${shortDate(date)}`), at });
      }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** One run: from where the last one stopped (kept in the routine's own state) to now. The state moves on only once the wake
 *  went, so a wake that failed is tried again on the next run, and a failed run shows in the routine's history. */
export async function dueReminders(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  const to = local(now), floor = local(new Date(now.getTime() - LOOK_BACK_MIN * 60_000));
  const last = ctx.state.get<{ until?: string }>()?.until;
  const from = typeof last === "string" && last > floor && last <= to ? last : floor;
  const due = dueBetween(ctx.kit.db, from, to);
  if (due.length) {
    const r = await ctx.wakeAgent(DUE_PROMPT, { reminders: due.map(({ who, text }) => ({ who, text })) });
    if (!r?.ok) throw new Error(`the agent was not woken: ${r?.reason ?? "no answer"}`);
  }
  ctx.state.set({ until: to });
}

/** One plan-prep run (calendar.ts planPrep), with the run's Flock and wake. */
export async function planPrepRoutine(ctx: Omit<RoutineCtx, "state"> & { state?: RoutineCtx["state"] }, now?: Date): Promise<void> {
  // The app's own id (a person's copy has a suffixed one) is the SDK platform's: the pointer a TODO is tied to starts with it.
  const appId = (ctx.platform as { appId?: string } | undefined)?.appId;
  const r = await planPrep({ kit: ctx.kit as KitLike, now: () => now ?? new Date(), platform: () => ctx.platform ?? null, ...(appId ? { appId } : {}) }, (m, d) => ctx.wakeAgent(m, d));
  if (r.woke) console.log(`[family-calendar] plan-prep: woke the agent with plan ${r.planId}`);
}

export const routines: Record<string, (ctx: any) => Promise<void>> = {
  "due-reminders": (ctx) => dueReminders(ctx),
  "plan-prep": (ctx) => planPrepRoutine(ctx),
};
