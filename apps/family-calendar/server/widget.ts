// The schedule widget Flock reads for "Your Schedule" (contract addendum 2026-11-22, flock.app.json `widgets`): Calendar Desk's
// wire format (apps/calendar-desk/server/widget.ts, Flock's schedule-items.ts ScheduleWidgetWire), from the requested day
// through the next 7 (Flock narrows to a day itself). Repeating events are expanded onto each day they fall on; cancelled ones
// are left out. Items carry no link: Flock gives every item from an app its paired agent's chat.
import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { events } from "./db/schema";
import { addDays, isoDate, lastDay, occurrences, parseDate, repeats, toMin } from "../src/pages/dates";

export const WIDGET_DAYS = 7;
const localMs = (date: string, hhmm: string) => parseDate(date).getTime() + toMin(hhmm) * 60_000;

export function scheduleItems(db: BunSQLiteDatabase<any>, from: string) {
  const to = addDays(from, WIDGET_DAYS);
  const items = db.select().from(events).all().filter((e) => e.status !== "cancelled").flatMap((e) =>
    occurrences(e, from, to).map((date) => ({
      // A repeating event is one row: each day it falls on is an item of its own; so is each day of an event over several days
      // (its times, when it has them, are each day's).
      id: repeats(e) || lastDay(e) ? `${e.id}@${date}` : e.id, kind: "event" as const, title: e.title, date,
      startAt: e.start_time ? localMs(date, e.start_time) : null, endAt: e.start_time && e.end_time ? localMs(date, e.end_time) : null, allDay: !e.start_time,
      ...(e.location ? { location: e.location } : {}),
      // Who it is for shows as the item's tag (Flock shows a `calendar` other than "primary").
      ...(e.who ? { calendar: e.who } : {}),
    })));
  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startAt ?? 0) - (b.startAt ?? 0) || a.title.localeCompare(b.title));
}

/** Loopback-only and unauthenticated, like every widget dataUrl: the platform's widget proxy is the only caller. */
export function mountWidget(hono: Hono<any>, db: BunSQLiteDatabase<any>, now: () => Date) {
  hono.get("/api/widget/schedule", (c) => {
    const asked = c.req.query("from") ?? c.req.query("date");
    if (asked !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(asked) && isoDate(parseDate(asked)) === asked)) return c.json({ error: "from must be a date as YYYY-MM-DD" }, 400);
    const from = asked ?? isoDate(now());
    return c.json({ template: "schedule", date: from, connected: true, fault: null, connector: "ok", items: scheduleItems(db, from) });
  });
}
