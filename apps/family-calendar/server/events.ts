// add_events: many events in one call, for the agent (agentOps.ts) and anyone else who has a family's week to put in at once.
// A child's classes set up one row at a time through /api/_data took 44 calls and all landed as reminders; this takes the
// week whole. Every event is checked before anything is written, and a call with one bad event writes nothing.
import type { Context, Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { events, members, todos } from "./db/schema";
import { COLOURS, KINDS, REPEATS } from "./db/constants";
import { addDays, isoDate, parseClock, parseDate, toMin } from "../src/pages/dates";
import { extras, setTodoDone, syncTodos, type Cal, type TasksPlatform } from "./calendar";
import { mountWidget } from "./widget";

type Db = BunSQLiteDatabase<any>;
/** Tell live pages a row changed, and who changed it (the kit's emitChange). */
type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;
type EventRow = typeof events.$inferSelect;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** A weekday however it was written ("Tue", "tuesday", "TUES") as 0 (Monday) to 6, or -1. */
const weekdayIndex = (v: unknown): number => {
  const w = typeof v === "string" ? v.trim().toLowerCase() : "";
  return w.length < 3 ? -1 : DAY_NAMES.findIndex((d) => d.startsWith(w));
};
/** The first date on or after `from` that falls on the weekday (0 = Monday). */
const firstOn = (from: string, day: number): string => addDays(from, (day - ((parseDate(from).getDay() + 6) % 7) + 7) % 7);
const realDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(parseDate(v)) === v ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: string | null, b: string | null): boolean => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** One event's fields, exactly as add_events reads them: the guide and the manifest name the same. */
export const EVENT_FIELDS = ["title", "who", "date", "weekdays", "repeat", "start_time", "end_time", "location", "notes", "reminder", "kind", "added_by"];
/** A timed event is nudged this long before it starts unless it says otherwise (`reminder`). */
export const DEFAULT_REMINDER_MINUTES = 30;
export const MEMBER_FIELDS = ["name", "emoji", "colour"];

/** An event as sent, checked: the rows it becomes (one per weekday for a weekly one). */
type Checked = { title: string; who: string | null; dates: string[]; repeat: (typeof REPEATS)[number]; dated: boolean; start_time: string | null; end_time: string | null;
  location?: string | null; notes?: string | null; reminder_minutes?: number | null; kind?: (typeof KINDS)[number]; added_by?: string | null };

/** Check one event. Every problem is said with its field, so the caller fixes the call in one go. */
function checkEvent(v: unknown, today: string, near: (given: string, names: string[]) => string | null): { ok: Checked } | { errors: string[] } {
  if (!isObject(v)) return { errors: ["must be an object: { title, who?, date? or weekdays?, start_time?, end_time?, location?, notes?, reminder?, kind?, added_by? }"] };
  const errors: string[] = [];
  for (const k of Object.keys(v)) if (!EVENT_FIELDS.includes(k)) { const n = near(k, EVENT_FIELDS); errors.push(`${k} is not a field of an event${n ? ` (did you mean ${n}?)` : ""}; the fields: ${EVENT_FIELDS.join(", ")}`); }
  const title = text(v.title);
  if (!title) errors.push("title is required");
  if (v.who != null && typeof v.who !== "string") errors.push("who must be one family member's name, or left out for everyone");

  // When: one date, or every week on weekdays (from `date`, or from today), or from a date on as `repeat` says.
  const repeat = v.repeat == null ? null : (REPEATS as readonly unknown[]).includes(v.repeat) ? (v.repeat as (typeof REPEATS)[number]) : null;
  if (v.repeat != null && !repeat) errors.push(`repeat must be one of: ${REPEATS.join(", ")}`);
  const date = v.date == null ? null : realDate(v.date);
  if (v.date != null && !date) errors.push(`date must be a real date as YYYY-MM-DD (${JSON.stringify(v.date)} is not)`);
  let days: number[] = [];
  if (v.weekdays != null) {
    if (!Array.isArray(v.weekdays) || !v.weekdays.length) errors.push(`weekdays must be a list of weekdays (${WEEKDAYS.join(", ")})`);
    else {
      days = v.weekdays.map(weekdayIndex);
      const bad = v.weekdays.filter((_, i) => days[i] < 0);
      if (bad.length) errors.push(`weekdays: ${bad.map((d) => JSON.stringify(d)).join(", ")} is not a weekday (${WEEKDAYS.join(", ")})`);
      if (repeat && repeat !== "weekly") errors.push("an event with weekdays happens every week: leave repeat out, or give a date instead of weekdays");
    }
  }
  if (!days.length && v.date == null) errors.push(repeat && repeat !== "none" ? `a ${repeat} event needs the date of its first day${repeat === "weekly" ? ", or weekdays" : repeat === "yearly" ? " (a birthday's date, any year)" : ""}`
    : "give a date (YYYY-MM-DD) for an event on one day, or weekdays for one that happens every week");

  // The times: typed as on the page ("16:30" or "4:30 pm"); none means all day.
  const times: Record<"start_time" | "end_time", string | null> = { start_time: null, end_time: null };
  for (const k of ["start_time", "end_time"] as const) {
    if (v[k] == null || v[k] === "") continue;
    const t = parseClock(v[k]);
    if (t) times[k] = t; else errors.push(`${k} must be a time like "16:30" or "4:30 pm" (${JSON.stringify(v[k])} is not)`);
  }
  if (times.end_time && !times.start_time && v.start_time == null) errors.push("start_time is needed when there is an end_time");
  if (times.start_time && times.end_time && toMin(times.end_time) <= toMin(times.start_time)) errors.push(`end_time (${times.end_time}) must be after start_time (${times.start_time})`);
  for (const k of ["location", "notes"] as const) if (v[k] != null && typeof v[k] !== "string") errors.push(`${k} must be text`);

  // The reminder: how long before the start, kept on the event itself (reminder_minutes). There is no "evening before" any more:
  // the 9 pm brief tells the family about tomorrow.
  let reminder_minutes: number | null | undefined;
  if (v.reminder === null) reminder_minutes = null;
  else if (typeof v.reminder === "number" && Number.isInteger(v.reminder) && v.reminder >= 0) reminder_minutes = v.reminder;
  else if (typeof v.reminder === "string" && /^(the\s+)?evening[\s_-]+before$/i.test(v.reminder.trim())) errors.push(`reminder "evening before" is gone: the 9 pm brief already tells the family about tomorrow. Leave reminder out (a timed event is nudged ${DEFAULT_REMINDER_MINUTES} minutes before), or give whole minutes`);
  else if (v.reminder !== undefined) errors.push(`reminder must be whole minutes before the start, like 60, or null for none (${JSON.stringify(v.reminder)} is not)`);
  const kind = v.kind == null ? undefined : (KINDS as readonly unknown[]).includes(v.kind) ? (v.kind as (typeof KINDS)[number]) : null;
  if (kind === null) errors.push(`kind must be one of: ${KINDS.join(", ")} (a deadline is a day something is due by)`);
  if (v.added_by != null && typeof v.added_by !== "string") errors.push("added_by must be the name of the family member who asked");

  if (errors.length) return { errors };
  const from = date ?? today;
  const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
  return { ok: { title: title!, who: text(v.who), repeat: uniqueDays.length ? "weekly" : repeat ?? "none", dated: date != null,
    dates: uniqueDays.length ? uniqueDays.map((d) => firstOn(from, d)) : [from], ...times,
    ...(v.location !== undefined ? { location: text(v.location) } : {}), ...(v.notes !== undefined ? { notes: text(v.notes) } : {}),
    ...(reminder_minutes !== undefined ? { reminder_minutes } : {}), ...(kind ? { kind } : {}), ...(v.added_by !== undefined ? { added_by: text(v.added_by) } : {}) } };
}

type CheckedMember = { name: string; emoji?: string | null; colour?: string };
function checkMember(v: unknown, near: (given: string, names: string[]) => string | null): { ok: CheckedMember } | { errors: string[] } {
  if (!isObject(v)) return { errors: ["must be an object: { name, emoji?, colour? }"] };
  const errors: string[] = [];
  for (const k of Object.keys(v)) if (!MEMBER_FIELDS.includes(k)) { const n = near(k, MEMBER_FIELDS); errors.push(`${k} is not a field of a member${n ? ` (did you mean ${n}?)` : ""}; the fields: ${MEMBER_FIELDS.join(", ")}`); }
  const name = text(v.name);
  if (!name) errors.push("name is required");
  if (v.emoji != null && typeof v.emoji !== "string") errors.push("emoji must be one emoji");
  if (v.colour != null && !(COLOURS as readonly unknown[]).includes(v.colour)) errors.push(`colour must be one of: ${COLOURS.join(", ")}`);
  if (errors.length) return { errors };
  return { ok: { name: name!, ...(v.emoji !== undefined ? { emoji: text(v.emoji) } : {}), ...(v.colour != null ? { colour: v.colour as string } : {}) } };
}

/** Who is writing: the agent Flock relayed, the person on the page, or the app itself. */
const writer = (c: Context): string => {
  const agent = c.req.header("x-flock-agent")?.trim(); if (agent) return `agent:${agent}`;
  const user = c.req.header("x-flock-user")?.trim(); return user ? `user:${user}` : "app";
};

/** `now`: the app's clock, for tests. `near`: the closest of a list of names to a mistyped one (agentOps.ts closest).
 *  `platform`: Flock's to-do list (the SDK's PlatformContext), for a to-do ticked on the page. */
export function mountEventRoutes(hono: Hono<any>, kit: { db: Db; sqlite: any; emitChange: Emit }, deps: { now?: () => Date; near?: (given: string, names: string[]) => string | null; platform?: () => TasksPlatform | null } = {}) {
  const { db } = kit;
  const near = deps.near ?? (() => null);
  const cal: Cal = { kit, now: deps.now ?? (() => new Date()), platform: deps.platform ?? (() => null) };

  // "Your Schedule" in Flock reads the family's days here (flock.app.json widgets).
  mountWidget(hono, db, cal.now);

  // Each event's source labels and to-dos, for the pages (the two tables are the app's own: not on /api/_data).
  hono.get("/api/events/extras", (c) => c.json({ events: extras(db) }));

  // A to-do ticked (or unticked) on the page: { event_id, key, done }. Settled here, and taken off Flock's list.
  hono.post("/api/todos/done", async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.event_id !== "string" || typeof b.key !== "string" || typeof b.done !== "boolean") return c.json({ ok: false, reason: "send { event_id, key, done }" }, 400);
    const by = writer(c);
    // Who ticked it, as Flock knows them: "owner" for the owner, else the proxy's X-Flock-User ("user:<id>").
    const user = c.req.header("x-flock-user")?.trim() || null;
    const person = c.req.header("x-flock-role")?.trim() === "owner" ? "owner" : user;
    const t = setTodoDone(cal, b.event_id, b.key, b.done, by, person);
    if (!t) return c.json({ ok: false, reason: "no such to-do" }, 404);
    kit.emitChange("events", b.event_id, "update", by);
    await syncTodos(cal);
    // Someone else had settled it on Flock's list first: say so ("Already done by Ravi.").
    const now = cal.kit.db.select().from(todos).where(eq(todos.id, t.id)).get();
    return c.json({ ok: true, todo: { key: t.key, title: t.title, due: t.due, done: t.status === "done" }, ...(now?.done_note ? { message: now.done_note } : {}) });
  });

  // add_events { events: [...], members?: [...] } → POST /api/events/add. All or nothing: a refusal (400) names each bad event
  // and field, and nothing is written. An event sent again (the same title, person, start time and day) changes the one there,
  // so a call repeated after a timeout does not double the calendar.
  hono.post("/api/events/add", async (c) => {
    let b: unknown = null;
    try { b = await c.req.json(); } catch { /* no JSON: refused below */ }
    const refuse = (reason: string) => c.json({ ok: false, reason }, 400);
    if (!isObject(b) || !Array.isArray(b.events) || !b.events.length) return refuse("events must be a list with at least one event: { title, who?, date? or weekdays?, start_time?, end_time?, location?, notes?, reminder?, kind?, added_by? }");
    if (b.members != null && !Array.isArray(b.members)) return refuse("members must be a list of { name, emoji?, colour? }");
    if (b.added_by != null && typeof b.added_by !== "string") return refuse("added_by must be the name of the family member who asked");
    const addedBy = text(b.added_by);
    const today = isoDate((deps.now ?? (() => new Date()))());
    const problems: string[] = [], checked: Checked[] = [], people: CheckedMember[] = [];
    (b.events as unknown[]).forEach((e, i) => {
      const r = checkEvent(e, today, near);
      const label = `events[${i}]${isObject(e) && text(e.title) ? ` (${text(e.title)})` : ""}`;
      if ("errors" in r) problems.push(...r.errors.map((m) => `${label}: ${m}`)); else checked.push(r.ok);
    });
    ((b.members as unknown[] | undefined) ?? []).forEach((m, i) => {
      const r = checkMember(m, near);
      if ("errors" in r) problems.push(...r.errors.map((x) => `members[${i}]: ${x}`)); else people.push(r.ok);
    });
    if (problems.length) return refuse(`Nothing was added. ${problems.join(". ")}. Fix these and send the whole call again.`);

    const by = writer(c);
    // The sample family and its week give way to the real one: cleared through the kit's own route (one change the owner can
    // undo), and only now that the call is known to be good. Rows the owner edited are theirs and stay.
    let samples_cleared = 0;
    if (by !== "app") {
      const headers: Record<string, string> = {};
      for (const h of ["x-flock-agent", "x-flock-user"]) { const v = c.req.header(h); if (v) headers[h] = v; }
      const res = await hono.request("/api/_data/_samples/clear", { method: "POST", headers });
      if (res.ok) samples_cleared = Number(((await res.json().catch(() => null)) as any)?.cleared ?? 0);
    }

    const changes: [string, string, "insert" | "update"][] = [];
    const out = db.transaction((tx) => {
      const family = tx.select().from(members).all();
      const added: string[] = [];
      /** The member of that name, whatever its capitals; made when there is none, with the next colour so each has their own. */
      const member = (m: CheckedMember) => {
        const had = family.find((f) => same(f.name, m.name));
        if (had) {
          if (m.emoji === undefined && m.colour === undefined) return had;
          const row = tx.update(members).set({ ...(m.emoji !== undefined ? { emoji: m.emoji } : {}), ...(m.colour ? { colour: m.colour } : {}), updated_at: new Date().toISOString(), updated_by: by })
            .where(eq(members.id, had.id)).returning().get();
          family[family.indexOf(had)] = row; changes.push(["members", row.id, "update"]);
          return row;
        }
        const row = tx.insert(members).values({ name: m.name, colour: m.colour ?? COLOURS[family.length % COLOURS.length], emoji: m.emoji ?? null, updated_by: by }).returning().get();
        family.push(row); added.push(row.name); changes.push(["members", row.id, "insert"]);
        return row;
      };
      for (const m of people) member(m);

      const existing = tx.select().from(events).all();
      const rows: EventRow[] = [];
      let made = 0, updated = 0;
      for (const e of checked) {
        // `who` is written exactly as the member's name: the week view matches on it.
        const who = e.who ? member({ name: e.who }).name : null;
        for (const date of e.dates) {
          // The same event: on the same day for a one-off, the same weekday for a weekly one, the same day of the month for a
          // monthly one; a daily one has no day to differ by.
          const day = (d: string) => (e.repeat === "weekly" ? parseDate(d).getDay() : e.repeat === "monthly" ? parseDate(d).getDate() : e.repeat === "yearly" ? d.slice(5) : e.repeat === "daily" ? 0 : d);
          const had = existing.find((x) => same(x.title, e.title) && same(x.who, who) && x.repeat === e.repeat && (x.start_time ?? null) === e.start_time && day(x.date) === day(date));
          const set = { end_time: e.end_time, ...(e.location !== undefined ? { location: e.location } : {}), ...(e.notes !== undefined ? { notes: e.notes } : {}),
            ...(e.reminder_minutes !== undefined ? { reminder_minutes: e.reminder_minutes } : {}), ...(e.kind ? { kind: e.kind } : {}) };
          let row: EventRow;
          if (had) {
            // A repeating event already there keeps the day it began, unless this call says the date.
            row = tx.update(events).set({ ...set, ...(e.repeat !== "none" && !e.dated ? {} : { date }), updated_at: new Date().toISOString(), updated_by: by }).where(eq(events.id, had.id)).returning().get();
            existing[existing.indexOf(had)] = row; updated++; changes.push(["events", row.id, "update"]);
          } else {
            // A new timed event is nudged before it starts unless the call said otherwise; who asked is kept as added_by.
            const added_by = e.added_by !== undefined ? e.added_by : addedBy;
            row = tx.insert(events).values({ title: e.title, date, repeat: e.repeat, start_time: e.start_time, who, added_by,
              ...(e.start_time && e.reminder_minutes === undefined ? { reminder_minutes: DEFAULT_REMINDER_MINUTES } : {}), ...set, updated_by: by }).returning().get();
            existing.push(row); made++; changes.push(["events", row.id, "insert"]);
          }
          rows.push(row);
        }
      }
      return { added: made, updated, members_added: added, events: rows };
    });
    for (const [table, id, op] of changes) kit.emitChange(table, id, op, by);
    return c.json({ ...out, samples_cleared,
      events: out.events.map((r) => ({ id: r.id, title: r.title, who: r.who, date: r.date, repeat: r.repeat, start_time: r.start_time, end_time: r.end_time, reminder_minutes: r.reminder_minutes, kind: r.kind, added_by: r.added_by })) });
  });
}
