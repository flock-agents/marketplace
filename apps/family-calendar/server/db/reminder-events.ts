// 3.0 has no reminders table: a reminder becomes a `deadline` event on its due date with one to-do (its title, due that day).
// Shared by the update from 2.x (migrate-v2.ts) and the move from 1.x (migrate-v1.ts), so both carry a reminder across alike.
import { addDays, nextOccurrence } from "../../src/pages/dates";

/** A to-do's key: a slug of its title ("Pay the school fee" → "pay-the-school-fee"), at most 40 characters. */
export const slug = (title: string): string =>
  title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "todo";

/** When a to-do shows on Home when nothing says: 3 days before it is due, never before today. */
export const SHOW_DAYS_BEFORE = 3;
export const defaultShowFrom = (due: string, today: string): string => { const s = addDays(due, -SHOW_DAYS_BEFORE); return s < today ? today : s; };

export interface ReminderLike { title: string; due: string; repeat?: string | null; who?: string | null }

/**
 * The event a reminder becomes: a deadline on its due date, at its time (with a nudge at that time, as the reminder had),
 * repeating as it did. Its to-do is due on the next day it falls on from today; none for a one-off already past.
 */
export function reminderAsDeadline(r: ReminderLike, today: string) {
  const date = r.due.slice(0, 10), time = /^\d{2}:\d{2}$/.test(r.due.slice(11, 16)) ? r.due.slice(11, 16) : null;
  const repeat = r.repeat && r.repeat !== "none" ? r.repeat : "none";
  const event = { title: r.title, date, repeat, start_time: time, end_time: null, who: r.who ?? null, location: null, notes: null,
    reminder_minutes: time ? 0 : null, kind: "deadline", status: "active", added_by: null, imported: 0 };
  const due = nextOccurrence(event, today);
  const todo = due ? { key: slug(r.title), title: r.title, due, show_from: defaultShowFrom(due, today) } : null;
  return { event, todo };
}
