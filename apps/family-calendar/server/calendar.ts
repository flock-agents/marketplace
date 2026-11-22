// Family Calendar 3.0's own logic beside the kit's data routes: events imported from sources (import_events), their to-dos on
// Flock's list (the SDK's tasks.publish / withdraw), the prep plan (the plan-prep routine and plan_done) and the brief. The
// contract these follow: docs/specs/2026-11-22-family-calendar-3-contract.md (marketplace repo).
//
// To-dos are kept here too (the private `todos` table), and Flock is told after each write: a row with `synced = 0` is one
// Flock does not have yet (published when open, withdrawn when done or withdrawn). A call Flock did not take stays unsynced and
// goes on the next run, so a write never waits on Flock or fails for it.
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { and, eq } from "drizzle-orm";
import { events, event_sources, members, todos } from "./db/schema";
import { COLOURS, KINDS } from "./db/constants";
import { addDays, clock12, isoDate, nextOccurrence, occurrences, pad, parseClock, parseDate, repeats, shortDate, toMin, weekday } from "../src/pages/dates";
import { defaultShowFrom, slug } from "./db/reminder-events";

type Db = BunSQLiteDatabase<any>;
type EventRow = typeof events.$inferSelect;
type TodoRow = typeof todos.$inferSelect;
export type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;
export interface KitLike { db: Db; sqlite: Database; emitChange: Emit }

/** The part of the SDK's PlatformContext the app uses: Flock's to-do list. */
type Res<T = unknown> = { ok: true; data: T } | { ok: false; reason?: string };
export interface TasksPlatform {
  tasks: {
    publish(task: Record<string, unknown>): Promise<Res>;
    withdraw(sourceRef: string, opts?: { reason?: string }): Promise<Res>;
    list(opts?: { prefix?: string }): Promise<Res<{ tasks: { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true }[] }>>;
  };
}
/** What every piece here needs: the kit's database, the clock, and Flock (null when the app runs with no Flock, as in a check). */
export interface Cal { kit: KitLike; now: () => Date; platform: () => TasksPlatform | null }
export type OpError = { error: string; code: string; status: number };
const refuse = (error: string, status = 400): OpError => ({ error, code: "APP_REFUSED", status });

/** The app's own bookkeeping, beside the kit's tables (mountKit keepTables: the kit never changes or shows them):
 *  fc_meta, a few values (the open plan, the brief's mark, the update's marks); fc_log, what imports added, moved or cancelled. */
export const INTERNAL_TABLES = ["fc_meta", "fc_log"];
/** Written only by the app's own routes (import_events, plan_done, a tick on the page): hidden from /api/_data. */
export const PRIVATE_TABLES: Record<string, string> = {
  event_sources: "Read an event's sources with GET /api/events/extras; they are written only by import_events.",
  todos: "Read an event's to-dos with GET /api/events/extras; they come from plan-prep (plan_done) and import_events, never written by hand.",
};
export function ensureInternalTables(sqlite: Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fc_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, at INTEGER NOT NULL, change TEXT NOT NULL, was_date TEXT, was_time TEXT)`);
}
export const getMeta = <T,>(sqlite: Database, key: string): T | null => {
  const r = sqlite.query("SELECT value FROM fc_meta WHERE key = ?").get(key) as { value: string } | null;
  try { return r ? (JSON.parse(r.value) as T) : null; } catch { return null; }
};
export const setMeta = (sqlite: Database, key: string, value: unknown) => sqlite.run("INSERT INTO fc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
const logChange = (sqlite: Database, eventId: string, at: number, change: "added" | "moved" | "cancelled", was?: { date: string; time: string | null }) =>
  sqlite.run("INSERT INTO fc_log (event_id, at, change, was_date, was_time) VALUES (?, ?, ?, ?, ?)", [eventId, at, change, was?.date ?? null, was?.time ?? null]);

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const realDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(parseDate(v)) === v ? v : null);
const same = (a: string | null, b: string | null): boolean => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const stamp = () => new Date().toISOString();
export const basisOf = (e: { date: string; start_time: string | null }) => (e.start_time ? `${e.date}T${e.start_time}` : e.date);
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---- Members ----------------------------------------------------------------------------------------------------------------

/** The member of that name, whatever its capitals; made when there is none, with the next colour so each has their own. */
export function memberNamed(db: Db, name: string, by: string, added: string[], changes: [string, string, "insert" | "update"][]): string {
  const family = db.select().from(members).all();
  const had = family.find((f) => same(f.name, name));
  if (had) return had.name;
  const row = db.insert(members).values({ name, colour: COLOURS[family.length % COLOURS.length], emoji: null, updated_by: by }).returning().get();
  added.push(row.name); changes.push(["members", row.id, "insert"]);
  return row.name;
}

// ---- To-dos -----------------------------------------------------------------------------------------------------------------

export const todoRef = (eventId: string, key: string) => `event:${eventId}:${key}`;
const dayStart = (date: string) => parseDate(date).getTime();

/** The task Flock is given for a to-do: due on its day, hidden until show_from, never past its event (maxDue). */
function taskOf(t: TodoRow, e: EventRow | undefined): Record<string, unknown> {
  const day = e ? parseDate(e.date) : parseDate(t.due);
  const maxDue = e?.start_time ? day.getTime() + toMin(e.start_time) * 60_000 : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime();
  const reason = e ? `${e.title}, ${weekday(e.date)} ${shortDate(e.date)}${e.start_time ? ` ${e.start_time}` : ""}` : t.title;
  return { sourceRef: todoRef(t.event_id, t.key), title: t.title, due: dayStart(t.due), dueTimed: false, showFrom: t.show_from, status: "backlog",
    maxDue: Math.max(maxDue, dayStart(t.due)), maxDueReason: reason.length > 120 ? `${reason.slice(0, 119)}…` : reason,
    context: { app: "family-calendar", eventId: t.event_id, ...(t.why ? { why: t.why } : {}) } };
}

/** Write a to-do of an event: a new key is made open; an open one takes the new title and dates; a closed one is never made
 *  again (false). Leaves it unsynced when anything changed. */
export function putTodo(db: Db, eventId: string, t: { key: string; title: string; due: string; show_from: string; why?: string | null }, by: string): "added" | "changed" | "same" | "closed" {
  const had = db.select().from(todos).where(and(eq(todos.event_id, eventId), eq(todos.key, t.key))).get();
  if (had && had.status !== "open") return "closed";
  if (had) {
    if (had.title === t.title && had.due === t.due && had.show_from === t.show_from && (t.why === undefined || had.why === (t.why ?? null))) return "same";
    db.update(todos).set({ title: t.title, due: t.due, show_from: t.show_from, ...(t.why !== undefined ? { why: t.why } : {}), synced: 0, updated_at: stamp(), updated_by: by }).where(eq(todos.id, had.id)).run();
    return "changed";
  }
  db.insert(todos).values({ event_id: eventId, key: t.key, title: t.title, due: t.due, show_from: t.show_from, why: t.why ?? null, status: "open", synced: 0, updated_by: by }).run();
  return "added";
}

/** Take back an event's open to-dos (its event was cancelled or removed). */
export function withdrawTodos(db: Db, eventId: string, at: number, by: string): number {
  const open = db.select().from(todos).where(and(eq(todos.event_id, eventId), eq(todos.status, "open"))).all();
  for (const t of open) db.update(todos).set({ status: "withdrawn", closed_at: at, synced: 0, updated_at: stamp(), updated_by: by }).where(eq(todos.id, t.id)).run();
  return open.length;
}

/** An event that moved earlier: its open to-dos due after its new day come back to that day (and show by then). */
function clampTodos(db: Db, e: EventRow, by: string) {
  for (const t of db.select().from(todos).where(and(eq(todos.event_id, e.id), eq(todos.status, "open"))).all()) {
    if (t.due <= e.date) continue;
    db.update(todos).set({ due: e.date, show_from: t.show_from > e.date ? e.date : t.show_from, synced: 0, updated_at: stamp(), updated_by: by }).where(eq(todos.id, t.id)).run();
  }
}

/** Tell Flock every to-do it does not have yet. Returns how many Flock took and how many are still to go. */
export async function syncTodos(cal: Cal): Promise<{ sent: number; left: number }> {
  const platform = cal.platform();
  const { db } = cal.kit;
  const byId = new Map(db.select().from(events).all().map((e) => [e.id, e]));
  // An event deleted on the page, or cancelled, takes its open to-dos with it.
  for (const t of db.select().from(todos).where(eq(todos.status, "open")).all()) {
    const e = byId.get(t.event_id);
    if (!e || e.status === "cancelled") db.update(todos).set({ status: "withdrawn", closed_at: cal.now().getTime(), synced: 0, updated_at: stamp(), updated_by: "app" }).where(eq(todos.id, t.id)).run();
  }
  const waiting = db.select().from(todos).where(eq(todos.synced, 0)).all();
  if (!platform || !waiting.length) return { sent: 0, left: waiting.length };
  let sent = 0;
  for (const t of waiting) {
    let r: Res;
    try {
      r = t.status === "open" ? await platform.tasks.publish(taskOf(t, byId.get(t.event_id)))
        : await platform.tasks.withdraw(todoRef(t.event_id, t.key), { reason: t.status === "done" ? "Done in Family Calendar" : "Its event was cancelled" });
    } catch (err) { r = { ok: false, reason: (err as Error).message }; }
    if (!r.ok) { console.warn(`[family-calendar] Flock did not take to-do ${todoRef(t.event_id, t.key)}: ${r.reason ?? "unknown"}`); continue; }
    // Only the version sent is marked: a change made while Flock answered goes on the next run.
    db.update(todos).set({ synced: 1 }).where(and(eq(todos.id, t.id), eq(todos.updated_at, t.updated_at), eq(todos.status, t.status))).run();
    sent++;
  }
  return { sent, left: waiting.length - sent };
}

/** What the family did with the to-dos on Flock's list: one ticked or dismissed there is closed here too (never made again). */
export async function readBackTodos(cal: Cal): Promise<number> {
  const platform = cal.platform();
  if (!platform) return 0;
  const listed = await platform.tasks.list({ prefix: "event:" }).catch(() => null);
  if (!listed?.ok) return 0;
  const { db } = cal.kit;
  const state = new Map(listed.data.tasks.map((t) => [t.sourceRef, t]));
  let closed = 0;
  for (const t of db.select().from(todos).where(eq(todos.status, "open")).all()) {
    const f = state.get(todoRef(t.event_id, t.key));
    if (!f || f.status === "open" || f.withdrawn || !t.synced) continue;
    db.update(todos).set({ status: "done", closed_at: cal.now().getTime(), updated_at: stamp(), updated_by: "flock" }).where(eq(todos.id, t.id)).run();
    closed++;
  }
  return closed;
}

/** Tick (or untick) a to-do on the page: settled here and taken off Flock's list (the SDK has no "done" of its own). */
export function setTodoDone(cal: Cal, eventId: string, key: string, done: boolean, by: string): TodoRow | null {
  const { db } = cal.kit;
  const t = db.select().from(todos).where(and(eq(todos.event_id, eventId), eq(todos.key, key))).get();
  if (!t || t.status === "withdrawn") return null;
  const status = done ? "done" : "open";
  if (t.status === status) return t;
  return db.update(todos).set({ status, closed_at: done ? cal.now().getTime() : null, synced: 0, updated_at: stamp(), updated_by: by }).where(eq(todos.id, t.id)).returning().get();
}

// ---- import_events ----------------------------------------------------------------------------------------------------------

export const IMPORT_MAX_ITEMS = 50, IMPORT_MAX_BYTES = 32 * 1024;
export const IMPORT_FIELDS = ["source", "label", "items"];
export const ITEM_FIELDS = ["ref", "match", "kind", "title", "date", "start_time", "end_time", "who", "location", "notes", "cancelled", "todos"];
/** A new timed import is nudged this long before it starts. */
export const IMPORT_REMINDER_MINUTES = 30;

const STOP = new Set(["the", "a", "an", "of", "for", "to", "and", "on", "at", "in", "with", "is", "our", "your", "my", "s"]);
/** A title as the words that name the thing: lower case, no punctuation or possessive, no small words. */
export const titleWords = (t: string): Set<string> =>
  new Set(t.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9ऀ-ॿ]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)));
/** Rule 3's titles: one word set contains the other, or their Jaccard is 0.5 or more. */
export function titlesAlike(a: string, b: string): boolean {
  const A = titleWords(a), B = titleWords(b);
  if (!A.size || !B.size) return false;
  const inter = [...A].filter((w) => B.has(w)).length;
  if (inter === A.size || inter === B.size) return true;
  return inter / (A.size + B.size - inter) >= 0.5;
}
const timesNear = (a: string | null, b: string | null) => !a || !b || Math.abs(toMin(a) - toMin(b)) <= 60;
const idsOf = (m: string | null): string[] => { try { const v = JSON.parse(m ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const norm = (id: string) => id.trim().toLowerCase();

type Item = { ref: string; match: string[]; kind: (typeof KINDS)[number]; title: string; date: string; start_time: string | null; end_time: string | null;
  who: string | null; location: string | null; notes: string | null; cancelled: boolean; todos: { key: string; title: string; due: string | null; show_from: string | null }[];
  given: Set<string> };

/** One item, checked; every problem said, so the source can fix it. */
function checkItem(v: unknown): { ok: Item } | { why: string } {
  if (!isObject(v)) return { why: "an item must be an object: { ref, title, date, ... }" };
  const errors: string[] = [];
  const unknown = Object.keys(v).filter((k) => !ITEM_FIELDS.includes(k));
  if (unknown.length) errors.push(`${unknown.join(", ")} ${unknown.length > 1 ? "are not fields" : "is not a field"} of an item (${ITEM_FIELDS.join(", ")})`);
  const ref = text(v.ref), title = text(v.title), date = realDate(v.date);
  if (!ref) errors.push("ref is required");
  if (!title) errors.push("title is required");
  if (!date) errors.push(v.date == null ? "date is required" : `date must be a real date as YYYY-MM-DD (${JSON.stringify(v.date)} is not)`);
  const kind = v.kind == null ? "event" : (KINDS as readonly unknown[]).includes(v.kind) ? (v.kind as Item["kind"]) : null;
  if (!kind) errors.push(`kind must be one of: ${KINDS.join(", ")}`);
  const times: Record<"start_time" | "end_time", string | null> = { start_time: null, end_time: null };
  for (const k of ["start_time", "end_time"] as const) {
    if (v[k] == null || v[k] === "") continue;
    const t = parseClock(v[k]);
    if (t) times[k] = t; else errors.push(`${k} must be a time like "16:30"`);
  }
  if (times.end_time && !times.start_time) times.end_time = null;   // an end with no start says nothing a page can show
  if (times.start_time && times.end_time && toMin(times.end_time) <= toMin(times.start_time)) times.end_time = null;
  for (const k of ["who", "location", "notes"] as const) if (v[k] != null && typeof v[k] !== "string") errors.push(`${k} must be text`);
  if (v.match != null && (!Array.isArray(v.match) || v.match.some((m) => typeof m !== "string"))) errors.push("match must be a list of identifiers (text)");
  if (v.cancelled != null && typeof v.cancelled !== "boolean") errors.push("cancelled must be true or false");
  const list: Item["todos"] = [];
  if (v.todos != null) {
    if (!Array.isArray(v.todos)) errors.push("todos must be a list of { title, due?, show_from? }");
    else v.todos.forEach((t, i) => {
      if (!isObject(t) || !text(t.title)) { errors.push(`todos[${i}]: title is required`); return; }
      const due = t.due == null ? null : realDate(t.due), show = t.show_from == null ? null : realDate(t.show_from);
      if (t.due != null && !due) errors.push(`todos[${i}]: due must be a real date as YYYY-MM-DD`);
      if (t.show_from != null && !show) errors.push(`todos[${i}]: show_from must be a real date as YYYY-MM-DD`);
      if (date && due && due > date) errors.push(`todos[${i}]: due (${due}) is after the event (${date})`);
      if (show && (due ?? date) && show > (due ?? date)!) errors.push(`todos[${i}]: show_from is after its due date`);
      list.push({ key: slug(text(t.title)!), title: text(t.title)!, due, show_from: show });
    });
  }
  if (errors.length) return { why: errors.join("; ") };
  return { ok: { ref: ref!, match: ((v.match as string[] | undefined) ?? []).map((m) => m.trim()).filter(Boolean), kind: kind!, title: title!, date: date!, ...times,
    who: text(v.who), location: text(v.location), notes: text(v.notes), cancelled: v.cancelled === true, todos: list,
    given: new Set(Object.keys(v).filter((k) => v[k] != null)) } };
}

/** The event an item is: rule 1 (same source and ref), else rule 2 (a shared identifier on the same date), else rule 3 (the same
 *  date, titles alike, times within an hour). Rules 2 and 3 look only at events that do not repeat, and take a match only when
 *  exactly one event fits: when two could be meant, or a set `who` differs, nothing matches and both are kept. */
function findMatch(db: Db, source: string, it: Item): EventRow | null {
  const own = db.select().from(event_sources).where(and(eq(event_sources.source, source), eq(event_sources.ref, it.ref))).get();
  if (own) { const e = db.select().from(events).where(eq(events.id, own.event_id)).get(); if (e) return e; }
  const sameDay = db.select().from(events).where(eq(events.date, it.date)).all().filter((e) => !repeats(e) && !(it.who && e.who && !same(it.who, e.who)));
  if (it.match.length) {
    const want = new Set(it.match.map(norm));
    const hits = sameDay.filter((e) => db.select().from(event_sources).where(eq(event_sources.event_id, e.id)).all().some((s) => idsOf(s.match).some((m) => want.has(norm(m)))));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  const alike = sameDay.filter((e) => titlesAlike(e.title, it.title) && timesNear(e.start_time, it.start_time));
  return alike.length === 1 ? alike[0] : null;
}

/** The source that made the event: its first source row, for an event an import made; none for a typed-in one. */
const originOf = (db: Db, e: EventRow): string | null => {
  if (!e.imported) return null;
  const rows = db.select().from(event_sources).where(eq(event_sources.event_id, e.id)).all().sort((a, b) => a.first_seen_at - b.first_seen_at);
  return rows[0]?.source ?? null;
};

export type ImportResult = { ref: string; id?: string; result: "added" | "merged" | "updated" | "moved" | "cancelled" | "unchanged" | "ignored" | "refused"; reason?: string };

export async function importEvents(cal: Cal, p: Record<string, unknown>): Promise<{ results: ImportResult[]; members_added: string[] } | OpError> {
  const source = text(p.source);
  if (!source) return refuse("source is required, e.g. \"email:<personId>\"");
  if (!Array.isArray(p.items)) return refuse("items must be a list of { ref, title, date, ... }");
  if (p.items.length > IMPORT_MAX_ITEMS) return refuse(`at most ${IMPORT_MAX_ITEMS} items in one call (${p.items.length} sent): send the rest in another call`);
  if (JSON.stringify(p).length > IMPORT_MAX_BYTES) return refuse("a call carries 32 KB at most: send fewer items, or shorter notes");
  const label = text(p.label);
  const { db, sqlite } = cal.kit;
  const nowMs = cal.now().getTime(), today = isoDate(cal.now());
  const by = `import:${source}`;
  const results: ImportResult[] = [], added: string[] = [];
  const changes: [string, string, "insert" | "update"][] = [];
  for (const raw of p.items) {
    const ref = isObject(raw) && typeof raw.ref === "string" ? raw.ref : "?";
    const c = checkItem(raw);
    if ("why" in c) { results.push({ ref, result: "refused", reason: c.why }); continue; }
    const it = c.ok;
    try {
      results.push(db.transaction((tx) => importOne(tx as unknown as Db, sqlite, source, label, it, nowMs, today, by, added, changes)));
    } catch (err) {
      results.push({ ref: it.ref, result: "refused", reason: `not kept: ${(err as Error).message}` });
    }
  }
  for (const [table, id, op] of changes) cal.kit.emitChange(table, id, op, by);
  await syncTodos(cal);
  return { results, members_added: added };
}

function importOne(db: Db, sqlite: Database, source: string, label: string | null, it: Item, nowMs: number, today: string, by: string, added: string[], changes: [string, string, "insert" | "update"][]): ImportResult {
  const hit = findMatch(db, source, it);
  if (!hit && it.cancelled) return { ref: it.ref, result: "ignored", reason: "no event on the calendar matches this cancellation" };
  const who = it.who ? memberNamed(db, it.who, by, added, changes) : null;

  if (!hit) {
    const row = db.insert(events).values({ title: it.title, date: it.date, repeat: "none", start_time: it.start_time, end_time: it.end_time, who, location: it.location, notes: it.notes,
      reminder_minutes: it.start_time ? IMPORT_REMINDER_MINUTES : null, kind: it.kind, status: "active", added_by: null, imported: 1, updated_by: by }).returning().get();
    db.insert(event_sources).values({ event_id: row.id, source, ref: it.ref, label, match: JSON.stringify(it.match), first_seen_at: nowMs, last_seen_at: nowMs, updated_by: by }).run();
    for (const t of it.todos) { const due = t.due ?? row.date; putTodo(db, row.id, { key: t.key, title: t.title, due, show_from: t.show_from ?? defaultShowFrom(due, today) }, by); }
    logChange(sqlite, row.id, nowMs, "added");
    changes.push(["events", row.id, "insert"]);
    return { ref: it.ref, id: row.id, result: "added" };
  }

  // The source row: a new one joins the event (merged); a known one is seen again and takes any new identifiers.
  let joined = false;
  const mine = db.select().from(event_sources).where(and(eq(event_sources.event_id, hit.id), eq(event_sources.source, source), eq(event_sources.ref, it.ref))).get();
  if (!mine) {
    db.insert(event_sources).values({ event_id: hit.id, source, ref: it.ref, label, match: JSON.stringify(it.match), first_seen_at: nowMs, last_seen_at: nowMs, updated_by: by }).run();
    joined = true;
  } else {
    const ids = [...new Set([...idsOf(mine.match), ...it.match])];
    db.update(event_sources).set({ last_seen_at: nowMs, match: JSON.stringify(ids), ...(label && label !== mine.label ? { label } : {}) }).where(eq(event_sources.id, mine.id)).run();
  }

  if (it.cancelled) {
    if (hit.status === "cancelled") return { ref: it.ref, id: hit.id, result: "unchanged" };
    db.update(events).set({ status: "cancelled", updated_at: stamp(), updated_by: by }).where(eq(events.id, hit.id)).run();
    withdrawTodos(db, hit.id, nowMs, by);
    logChange(sqlite, hit.id, nowMs, "cancelled");
    changes.push(["events", hit.id, "update"]);
    return { ref: it.ref, id: hit.id, result: "cancelled" };
  }

  // Fields: the event's own source changes what it sends; any other source only fills what is empty. A cancelled event is
  // never brought back by an import (a re-send of the first mail would undo the cancellation that came after it).
  const fromOrigin = originOf(db, hit) === source;
  const want: Partial<EventRow> = { title: it.title, date: it.date, start_time: it.start_time, end_time: it.end_time, who, location: it.location, notes: it.notes, kind: it.kind };
  const field: Record<string, string> = { who: "who", start_time: "start_time", end_time: "end_time", location: "location", notes: "notes", kind: "kind", title: "title", date: "date" };
  const set: Partial<EventRow> = {};
  for (const [k, v] of Object.entries(want) as [keyof EventRow, any][]) {
    if (!it.given.has(field[k as string]) && k !== "title" && k !== "date") continue;   // a field the item left out is never cleared
    if (v == null || v === (hit as any)[k]) continue;
    if (fromOrigin || (hit as any)[k] == null || (hit as any)[k] === "") (set as any)[k] = v;
  }
  if (hit.status === "cancelled") for (const k of Object.keys(set)) delete (set as any)[k];
  const moved = set.date !== undefined || set.start_time !== undefined;
  let row = hit;
  if (Object.keys(set).length) {
    row = db.update(events).set({ ...set, updated_at: stamp(), updated_by: by }).where(eq(events.id, hit.id)).returning().get();
    if (moved) { logChange(sqlite, hit.id, nowMs, "moved", { date: hit.date, time: hit.start_time }); clampTodos(db, row, by); }
    changes.push(["events", hit.id, "update"]);
  }

  // The source's own to-dos: a new one is added; the event's own source may re-date one still open; a closed one stays closed.
  let todosChanged = false;
  if (row.status === "active") for (const t of it.todos) {
    const due = t.due && t.due <= row.date ? t.due : row.date;
    const exists = db.select().from(todos).where(and(eq(todos.event_id, row.id), eq(todos.key, t.key))).get();
    if (exists && !fromOrigin) continue;
    const r = putTodo(db, row.id, { key: t.key, title: t.title, due, show_from: t.show_from && t.show_from <= due ? t.show_from : exists?.show_from && exists.show_from <= due && !t.show_from ? exists.show_from : defaultShowFrom(due, today) }, by);
    if (r === "added" || r === "changed") todosChanged = true;
  }
  const result = moved ? "moved" : Object.keys(set).length ? (joined && !fromOrigin ? "merged" : "updated") : joined ? "merged" : todosChanged ? "updated" : "unchanged";
  return { ref: it.ref, id: hit.id, result };
}

// ---- plan-prep and plan_done ------------------------------------------------------------------------------------------------

/** How far ahead an imported event is planned. */
export const PLAN_HORIZON_DAYS = 90;
/** A plan the agent has not answered is waited for this long before the events are offered again. */
export const PLAN_WAIT_MS = 3 * 3600_000;
export const MAX_OPEN_STEPS = 3;
/** One wake carries at most this many events, soonest first, and stays under Flock's 20,000-character data limit; the rest wait
 *  for the next run. */
export const PLAN_MAX_EVENTS = 15, PLAN_MAX_CHARS = 18_000;
const KEY = /^[a-z0-9-]{1,40}$/;

type PlanRecord = { planId: string; createdAt: number; events: { ref: string; id: string; basis: string }[] };

/** The events plan-prep offers: imported, active, from today to 90 days ahead, never planned or no longer on the date and time
 *  they were planned for. Typed-in and repeating events never are. */
export function eventsToPlan(cal: Cal): { e: EventRow; change: "new" | "moved" }[] {
  const today = isoDate(cal.now()), last = addDays(today, PLAN_HORIZON_DAYS);
  return cal.kit.db.select().from(events).all()
    .filter((e) => e.imported === 1 && e.status === "active" && !repeats(e) && e.date >= today && e.date <= last)
    .filter((e) => e.planned_at == null || e.plan_basis !== basisOf(e))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    .map((e) => ({ e, change: e.planned_at == null ? "new" as const : "moved" as const }));
}

const labelsOf = (db: Db, eventId: string): string[] => {
  const out: string[] = [];
  for (const s of db.select().from(event_sources).where(eq(event_sources.event_id, eventId)).all().sort((a, b) => a.first_seen_at - b.first_seen_at)) {
    const l = s.label ?? s.source;
    if (!out.includes(l)) out.push(l);
  }
  return out;
};
const stepsOf = (db: Db, eventId: string) => db.select().from(todos).where(eq(todos.event_id, eventId)).all()
  .filter((t) => t.status !== "withdrawn").map((t) => ({ key: t.key, title: t.title, due: t.due, show_from: t.show_from, closed: t.status !== "open" }));

export const PLAN_MESSAGE = "These Family Calendar events are new or have moved. Decide for each what the family must physically do before it, then report with plan_done.";
export type Wake = (message: string, data?: unknown) => Promise<{ ok: boolean; reason?: string }>;

/** One plan-prep run. Nothing to plan, or a plan still waiting for its answer: no wake, no model call. */
export async function planPrep(cal: Cal, wake: Wake): Promise<{ woke: boolean; planId?: string; skipped?: "nothing" | "waiting" }> {
  const { sqlite, db } = cal.kit;
  await readBackTodos(cal);
  await syncTodos(cal);
  let picks = eventsToPlan(cal).slice(0, PLAN_MAX_EVENTS);
  if (!picks.length) return { woke: false, skipped: "nothing" };
  const now = cal.now(), nowMs = now.getTime();
  const open = getMeta<PlanRecord>(sqlite, "plan");
  if (open && nowMs - open.createdAt < PLAN_WAIT_MS && open.events.some((r) => picks.some((p) => p.e.id === r.id && basisOf(p.e) === r.basis))) return { woke: false, skipped: "waiting" };
  const planId = `p-${nowMs}`;
  const payloadOf = (list: typeof picks) => ({
    planId, today: isoDate(now), nowLocal: hhmm(now), timezone: timezone(),
    events: list.map(({ e, change }, i) => {
      const was = change === "moved" && e.plan_basis ? { date: e.plan_basis.slice(0, 10), start_time: e.plan_basis.length > 10 ? e.plan_basis.slice(11) : null } : undefined;
      return { ref: `e${i + 1}`, id: e.id, title: e.title, date: e.date, start_time: e.start_time, who: e.who, location: e.location, notes: e.notes, kind: e.kind,
        sources: labelsOf(db, e.id), change, ...(was ? { was } : {}), steps: stepsOf(db, e.id) };
    }),
  });
  let payload = payloadOf(picks);
  while (picks.length > 1 && JSON.stringify(payload, null, 2).length > PLAN_MAX_CHARS) payload = payloadOf(picks = picks.slice(0, -1));
  const r = await wake(PLAN_MESSAGE, payload);
  if (!r?.ok) throw new Error(`the agent was not woken: ${r?.reason ?? "no answer"}`);
  setMeta(sqlite, "plan", { planId, createdAt: nowMs, events: picks.map(({ e }, i) => ({ ref: `e${i + 1}`, id: e.id, basis: basisOf(e) })) } satisfies PlanRecord);
  return { woke: true, planId };
}

export const PLAN_DONE_FIELDS = ["planId", "events"];
export const STEP_FIELDS = ["key", "title", "due", "show_from", "why"];

/** The agent's report for a plan: each step checked and made a to-do, each listed event marked planned. */
export async function planDone(cal: Cal, p: Record<string, unknown>, by: string): Promise<{ accepted: string[]; refused: { step: string; reason: string }[] } | OpError> {
  const { sqlite, db } = cal.kit;
  const plan = getMeta<PlanRecord>(sqlite, "plan");
  if (typeof p.planId !== "string" || !plan || plan.planId !== p.planId) return refuse("planId is not the plan you were woken with (it was answered by a later plan, or never made): report the plan in your latest wake", 409);
  if (!Array.isArray(p.events)) return refuse("events must be a list of { event: \"e1\", steps: [{ key, title, due, show_from?, why? }] }");
  const now = cal.now(), today = isoDate(now), nowMs = now.getTime();
  const accepted: string[] = [], refused: { step: string; reason: string }[] = [];
  const seenEvents = new Set<string>();
  for (const entry of p.events as unknown[]) {
    const evRef = isObject(entry) && typeof entry.event === "string" ? entry.event : "?";
    const pr = plan.events.find((x) => x.ref === evRef);
    if (!pr) { refused.push({ step: evRef, reason: "event is not in this plan" }); continue; }
    if (seenEvents.has(evRef)) { refused.push({ step: evRef, reason: "event listed twice" }); continue; }
    seenEvents.add(evRef);
    const e = db.select().from(events).where(eq(events.id, pr.id)).get();
    if (!e) { refused.push({ step: evRef, reason: "the event is no longer on the calendar" }); continue; }
    const steps = (entry as Record<string, unknown>).steps;
    if (!Array.isArray(steps)) { refused.push({ step: evRef, reason: "steps must be a list (an empty one when nothing is needed)" }); continue; }
    db.transaction((tx) => {
      const t = tx as unknown as Db;
      if (e.status === "cancelled") {
        for (const s of steps) refused.push({ step: `${evRef}/${isObject(s) && typeof s.key === "string" ? s.key : "?"}`, reason: "the event was cancelled" });
        withdrawTodos(t, e.id, nowMs, by);
      } else {
        const mine = t.select().from(todos).where(eq(todos.event_id, e.id)).all();
        const closed = new Set(mine.filter((x) => x.status !== "open").map((x) => x.key));
        const open = new Set(mine.filter((x) => x.status === "open").map((x) => x.key));
        const seen = new Set<string>();
        for (const s of steps) {
          const key = isObject(s) && typeof s.key === "string" ? s.key : "?";
          const why = stepRefusal(s, e, today, seen, closed, open);
          if (why) { refused.push({ step: `${evRef}/${key}`, reason: why }); continue; }
          const st = s as Record<string, string>;
          const due = st.due, show = st.show_from ? (st.show_from < today ? today : st.show_from) : defaultShowFrom(due, today);
          putTodo(t, e.id, { key, title: st.title.trim(), due, show_from: show, why: text(st.why) }, by);
          open.add(key);
          accepted.push(`${evRef}/${key}`);
        }
        clampTodos(t, e, by);
      }
      // Every event listed is planned, with no steps too, for the date and time it was offered on (a move since is offered again).
      t.update(events).set({ planned_at: nowMs, plan_basis: pr.basis }).where(eq(events.id, e.id)).run();
    });
  }
  await syncTodos(cal);
  return { accepted, refused };
}

function stepRefusal(s: unknown, e: EventRow, today: string, seen: Set<string>, closed: Set<string>, open: Set<string>): string | null {
  if (!isObject(s)) return "a step must be an object: { key, title, due, show_from?, why? }";
  const bad = Object.keys(s).filter((k) => !STEP_FIELDS.includes(k));
  if (bad.length) return `${bad.join(", ")} is not a field of a step (${STEP_FIELDS.join(", ")})`;
  if (typeof s.key !== "string" || !KEY.test(s.key)) return "key must be lowercase letters, digits and hyphens, at most 40";
  if (seen.has(s.key)) return `key ${s.key} is used twice`;
  seen.add(s.key);
  if (closed.has(s.key)) return `step ${s.key} was already done or taken back: it is never made again`;
  if (!text(s.title)) return "title is required";
  if (String(s.title).length > 200) return "title is longer than 200 characters";
  if (!realDate(s.due)) return "due must be a real date, YYYY-MM-DD";
  if ((s.due as string) > e.date) return `due (${s.due}) is after the event (${e.date})`;
  if ((s.due as string) < today) return `due (${s.due}) is before today (${today})`;
  if (s.show_from != null && !realDate(s.show_from)) return "show_from must be a real date, YYYY-MM-DD";
  if (s.show_from != null && (s.show_from as string) > (s.due as string)) return "show_from is after its due date";
  if (s.why != null && typeof s.why !== "string") return "why must be text";
  if (!open.has(s.key) && open.size >= MAX_OPEN_STEPS) return `the event already has ${open.size} open steps (at most ${MAX_OPEN_STEPS})`;
  return null;
}

// ---- brief ------------------------------------------------------------------------------------------------------------------

export const BRIEF_FIELDS = ["kind"];

/** The day's events and to-dos for the family's morning or evening brief, with what imports added, moved or cancelled since the
 *  last brief of either kind; the call moves that mark on. */
export function brief(cal: Cal, p: Record<string, unknown>): Record<string, unknown> | OpError {
  if (p.kind !== "morning" && p.kind !== "evening") return refuse("kind must be \"morning\" (today) or \"evening\" (tomorrow)");
  const { db, sqlite } = cal.kit;
  const now = cal.now(), today = isoDate(now);
  const day = p.kind === "morning" ? today : addDays(today, 1);
  const all = db.select().from(events).all();
  const byId = new Map(all.map((e) => [e.id, e]));
  const openTodos = db.select().from(todos).where(eq(todos.status, "open")).all().filter((t) => byId.get(t.event_id)?.status === "active");
  const onDay = all.filter((e) => occurrences(e, day, day).length)
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.title.localeCompare(b.title))
    .map((e) => {
      const mine = openTodos.filter((t) => t.event_id === e.id).sort((a, b) => a.due.localeCompare(b.due));
      return { id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time, who: e.who, location: e.location, notes: e.notes, kind: e.kind, status: e.status,
        sources: labelsOf(db, e.id), added_by: e.added_by, todos: { open: mine.length, titles: mine.map((t) => t.title) } };
    });

  const mark = getMeta<number>(sqlite, "brief_mark") ?? 0;
  const log = sqlite.query("SELECT event_id, at, change, was_date FROM fc_log WHERE at > ? ORDER BY seq").all(mark) as { event_id: string; at: number; change: string; was_date: string | null }[];
  const fresh = new Set(log.filter((l) => l.change === "added").map((l) => l.event_id));
  const news = [...fresh].map((id) => byId.get(id)).filter((e): e is EventRow => !!e && e.status === "active")
    .map((e) => ({ id: e.id, title: e.title, date: e.date, sources: labelsOf(db, e.id) }));
  const changed: { id: string; title: string; date: string; status: "cancelled" | "moved"; was?: string }[] = [];
  for (const id of new Set(log.filter((l) => l.change !== "added" && !fresh.has(l.event_id)).map((l) => l.event_id))) {
    const e = byId.get(id);
    if (!e) continue;
    if (e.status === "cancelled") { changed.push({ id, title: e.title, date: e.date, status: "cancelled" }); continue; }
    const first = log.find((l) => l.event_id === id && l.change === "moved");
    if (first?.was_date && first.was_date !== e.date) changed.push({ id, title: e.title, date: e.date, status: "moved", was: first.was_date });
  }

  const due = (p.kind === "morning" ? openTodos.filter((t) => t.show_from <= today) : openTodos.filter((t) => t.due === day))
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))
    .map((t) => ({ title: t.title, due: t.due, event: byId.get(t.event_id)!.title }));
  setMeta(sqlite, "brief_mark", now.getTime());
  return { day, timezone: timezone(), events: onDay, changed, new: news, todos_due: due };
}

// ---- The page's view of the extras ------------------------------------------------------------------------------------------

/** Per event: its source labels and its to-dos (open and done), for the pages. */
export function extras(db: Db): Record<string, { sources: string[]; todos: { key: string; title: string; due: string; show_from: string; done: boolean }[] }> {
  const out: Record<string, { sources: string[]; todos: { key: string; title: string; due: string; show_from: string; done: boolean }[] }> = {};
  const at = (id: string) => (out[id] ??= { sources: [], todos: [] });
  for (const s of db.select().from(event_sources).all().sort((a, b) => a.first_seen_at - b.first_seen_at)) {
    const l = s.label ?? s.source;
    if (!at(s.event_id).sources.includes(l)) at(s.event_id).sources.push(l);
  }
  for (const t of db.select().from(todos).all().sort((a, b) => a.due.localeCompare(b.due))) {
    if (t.status === "withdrawn") continue;
    at(t.event_id).todos.push({ key: t.key, title: t.title, due: t.due, show_from: t.show_from, done: t.status === "done" });
  }
  return out;
}

/** "Skating class: tomorrow, 4 pm to 5:30 pm, Rink. Lakshmi drops": what a nudge says. */
export function eventLine(e: { title: string; start_time: string | null; end_time: string | null; location: string | null; notes: string | null }, date: string, today: string, prefix?: string): string {
  const day = prefix ?? (date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : `on ${weekday(date)} ${shortDate(date)}`);
  const time = e.start_time ? `, ${clock12(e.start_time)}${e.end_time ? ` to ${clock12(e.end_time)}` : ""}` : "";
  return [`${e.title}: ${day}${time}${e.location ? `, ${e.location}` : ""}`, e.notes].filter(Boolean).join(". ");
}
export { nextOccurrence };
