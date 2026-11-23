// The app's one routine, `due-reminders` (every 15 minutes): what has come due since its last run, an event's own reminder
// (`reminder_minutes` before its start, every week for a weekly event) and the `reminders` rows, is handed to the agent to send.
// The app decides what is due and what each line says; the agent only delivers it. Nothing due: no wake, so no model call.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { events, reminders } from "./db/schema";
import { addDays, clock12, eventRemindersDue, isoDate, minutesBefore, nextDue, pad, shortDate, weekday } from "../src/pages/dates";

/** What the routine uses of its run: the SDK's RoutineContext (the wake, its own small state) and the kit's database. */
export type RoutineCtx = {
  kit: { db: BunSQLiteDatabase<any> };
  state: { get<T = unknown>(): T | null; set(value: unknown): void };
  wakeAgent(message: string, data?: unknown): Promise<{ ok: boolean; reason?: string }>;
};
export type Due = { who: string | null; text: string; at: string };

/** A run looks back no further than this: a first run, or one after the app was stopped for a day, does not send a backlog. */
export const LOOK_BACK_MIN = 60;

export const DUE_PROMPT = "These Family Calendar reminders are due now. Tell each person the reminders that are theirs: `who` names the family member, and an empty `who` is for everyone in the family. Send each `text` as it is, one short message per person, and nothing else. Do not ask anything and do not wait for a reply.";

const local = (d: Date): string => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Skating class: tomorrow, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" */
function eventLine(e: typeof events.$inferSelect, date: string, today: string): string {
  const day = date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : `on ${weekday(date)} ${shortDate(date)}`;
  const time = e.start_time ? `, ${clock12(e.start_time)}${e.end_time ? ` to ${clock12(e.end_time)}` : ""}` : "";
  return [`${e.title}: ${day}${time}${e.location ? `, ${e.location}` : ""}`, e.notes].filter(Boolean).join(". ");
}

/** Everything due after `from` and up to `to` (local moments), soonest first. */
export function dueBetween(db: BunSQLiteDatabase<any>, from: string, to: string): Due[] {
  const today = to.slice(0, 10), out: Due[] = [];
  for (const e of db.select().from(events).all())
    for (const r of eventRemindersDue(e, from, to)) out.push({ who: e.who, text: eventLine(e, r.date, today), at: r.at });
  // A reminder of its own is due at its next time at or after the minute following `from`.
  const after = minutesBefore(from.slice(0, 10), from.slice(11, 16), -1);
  for (const r of db.select().from(reminders).all()) {
    const at = nextDue(r, after);
    if (at && at <= to) out.push({ who: r.who, text: r.title, at });
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

export const routines: Record<string, (ctx: any) => Promise<void>> = { "due-reminders": (ctx) => dueReminders(ctx) };
