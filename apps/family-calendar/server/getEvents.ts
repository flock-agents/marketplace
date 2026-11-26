// get_events: the family's calendar between two dates, for other apps and agents reading who is home or away (Meal Planner's
// slot model reads it to plan around trips and evenings out). Read-only. A repeating event is one entry per day it falls on in
// the range; an event over several days (a trip) is one entry with its own first and last day, when any of its days is in the
// range; cancelled events are left out; deadlines come with kind "deadline". The days are the app's own (`occurrences`, as the
// Week page, the brief and the schedule widget use), so a monthly-by-weekday event and a 29 February birthday read the same here.
// The sample family's events are never in it (samples.ts).
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { realEvents } from "./samples";
import { addDays, isoDate, lastDay, occurrences, parseDate } from "../src/pages/dates";

export const GET_EVENTS_FIELDS = ["from", "to"];
/** The most days one call reads, counting both ends. */
export const MAX_RANGE_DAYS = 62;

export type CalendarEntry = { id: string; title: string; date: string; end_date?: string; repeat: string; kind: string;
  start_time?: string; end_time?: string; who?: string; notes?: string };
type OpError = { error: string; code: string; status: number };
const refuse = (error: string): OpError => ({ error, code: "APP_REFUSED", status: 400 });
const realDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(parseDate(v)) === v;

export function getEvents(db: BunSQLiteDatabase<any>, p: Record<string, unknown>): { events: CalendarEntry[] } | OpError {
  for (const k of ["from", "to"] as const) if (!realDate(p[k])) return refuse(`${k} must be a real date as YYYY-MM-DD (got ${JSON.stringify(p[k] ?? null)})`);
  const from = p.from as string, to = p.to as string;
  if (from > to) return refuse(`from (${from}) is after to (${to})`);
  if (addDays(from, MAX_RANGE_DAYS - 1) < to) return refuse(`the range is more than ${MAX_RANGE_DAYS} days: ask for ${from} to ${addDays(from, MAX_RANGE_DAYS - 1)} at most, then the next part`);
  const out: CalendarEntry[] = [];
  for (const e of realEvents(db)) {
    if (e.status === "cancelled") continue;
    const days = occurrences(e, from, to);
    if (!days.length) continue;
    const last = lastDay(e);
    const entry = (date: string): CalendarEntry => ({ id: e.id, title: e.title, date, ...(last ? { end_date: last } : {}), repeat: e.repeat, kind: e.kind,
      ...(e.start_time ? { start_time: e.start_time } : {}), ...(e.end_time ? { end_time: e.end_time } : {}),
      ...(e.who ? { who: e.who } : {}), ...(e.notes ? { notes: e.notes } : {}) });
    // A trip is one entry with its own days (it may begin before `from` or end after `to`); a repeating event, one per day.
    if (last) out.push(entry(e.date)); else for (const d of days) out.push(entry(d));
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || Number(!!a.start_time) - Number(!!b.start_time) || (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.title.localeCompare(b.title));
  return { events: out };
}
