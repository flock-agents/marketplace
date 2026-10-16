// Carries a 1.x install's rows into 2.0's tables on the first start after the update.
//
// 1.x kept its rows in the same app.db, in tables with the SAME names as 2.0's (members, events, reminders) but another shape
// (integer ids, hex colours, ISO date-times, a member_id link). Left there, the kit's schema sync would drop their columns. So, before
// mountKit, two steps:
//  1. Move: 1.x-shaped tables under 2.0's names are renamed to a free set of kept names (v1_members, v1_events, v1_reminders; or
//     v1_members_2 and so on when those are taken), rows and definition as they were. Every v1_* table is listed in mountKit's
//     keepTables, so the kit never touches them. This step is always safe and always runs.
//  2. Import: the oldest kept set the kit has not imported yet (its importId is not in the kit's _imports) is written as the kit's
//     boot import (.flock/import.json), which mountKit applies in one transaction after creating 2.0's tables. A leftover import of
//     ours (a rolled-back attempt) is replaced with the rows as they are now; someone else's waiting import is left alone, and ours is
//     written on a later boot, once the kit has applied theirs. A set with no rows to bring gives no import, so an install whose 1.x
//     tables were empty starts with the samples like a fresh one.
// Whether a set is done is the kit's own record, never a file, so a crash or a rollback at any point is picked up by the next boot.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { COLOURS } from "./constants";

const TABLES = ["members", "events", "reminders"] as const;
type V1Table = (typeof TABLES)[number];
/** The kept names of set `n`: v1_members for the first, v1_members_2 for the second, and so on. */
export const v1Names = (n = 1): Record<V1Table, string> =>
  Object.fromEntries(TABLES.map((t) => [t, `v1_${t}${n === 1 ? "" : `_${n}`}`])) as Record<V1Table, string>;
const KEPT_NAME = /^v1_(members|events|reminders)(?:_(\d+))?$/;
export const V1_IMPORT_ID = "family-calendar-1x";
/** The boot import of set `n`. */
export const v1ImportId = (n = 1) => (n === 1 ? V1_IMPORT_ID : `${V1_IMPORT_ID}-${n}`);
const isOurImport = (id: unknown) => typeof id === "string" && (id === V1_IMPORT_ID || id.startsWith(`${V1_IMPORT_ID}-`));
const IMPORT_BY = "app:family-calendar";

export interface V1Member { id: number; name: string; color: string | null; emoji: string | null; created_at?: string | null }
export interface V1Event {
  id: number; title: string; start_time: string; end_time: string; member_id: number | null;
  category: string | null; status: string | null; notes: string | null; created_at?: string | null;
}
export interface V1Reminder { id: number; title: string; due_time: string; event_id: number | null; status: string | null; created_at?: string | null }
export interface V1Rows { members: V1Member[]; events: V1Event[]; reminders: V1Reminder[] }

type Colour = (typeof COLOURS)[number];
type Row = Record<string, unknown> & { $key: string };
export interface V1Import { importId: string; by: string; rows: { members: Row[]; events: Row[]; reminders: Row[] } }

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nextDay = (date: string) => { const [y, m, d] = date.split("-").map(Number); return localDate(new Date(y, m - 1, d + 1)); };

/**
 * A 1.x date-time as the family's own date and "HH:MM" (null for a date alone). A value with no zone ("2026-10-17T16:30",
 * "2026-10-17 16:30:00") or with an offset ("2026-10-17T16:30:00+05:30", how agents wrote them) already says the family's clock
 * time and is read as written. Only a UTC value ("…Z", a browser's toISOString) is converted, to this machine's time, which is the
 * owner's. Null when it cannot be read.
 */
export function localParts(value: string | null | undefined): { date: string; time: string | null } | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  if (!/Z$/i.test(s)) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (m) return { date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : null };
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { date: localDate(d), time: localTime(d) };
}

/** A 1.x hex colour as the nearest 2.0 theme tone, by hue: red danger, orange and yellow warning, green and teal success, cyan and
 *  blue info, and indigo, violet, pink and greys accent (1.x's default #6366f1 is indigo). */
export function toneOf(hex: string | null | undefined): Colour {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((hex ?? "").trim());
  if (!m) return "accent";
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < 0.15) return "accent";   // grey, black or white: no hue to go by
  const hue = (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  if (hue < 15 || hue >= 345) return "danger";
  if (hue < 65) return "warning";
  if (hue < 180) return "success";
  if (hue < 230) return "info";
  return "accent";
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const joinNotes = (parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join("\n") || null;

function eventRow(e: V1Event, who: string | null, now: Date): Row {
  const start = localParts(e.start_time);
  const end = localParts(e.end_time);
  const date = start?.date ?? localParts(e.created_at)?.date ?? localDate(now);
  const sameDay = !!start && !!end && end.date === start.date;
  // 1.x had no all-day event: one was written midnight to 23:59 (or to the next midnight). 2.0 says it with no times.
  const allDay = !!start && start.time === "00:00" && !!end && ((sameDay && end.time === "23:59") || (end.time === "00:00" && end.date === nextDay(start.date)));
  // What 2.0 has no field for, kept in the notes so nothing the family wrote is lost.
  const extras = [
    e.category && e.category !== "other" ? `Category: ${capital(e.category)}` : null,
    e.status && e.status !== "confirmed" ? `Status: ${e.status}` : null,
  ].filter(Boolean).join(". ");
  return {
    $key: `e${e.id}`, title: e.title, date,
    start_time: allDay ? null : start?.time ?? null,
    end_time: !allDay && sameDay ? end!.time : null,
    who, location: null,
    notes: joinNotes([
      e.notes,
      extras ? `${extras}.` : null,
      !start ? `Was set for "${e.start_time}".` : null,
      start && end && !sameDay && !allDay ? `Until ${end.date}${end.time ? ` ${end.time}` : ""}.` : null,
    ]),
    reminder_minutes: null,
  };
}

/**
 * The boot import that carries 1.x's rows into 2.0, or null when there are none. A member keeps its name and emoji, its hex colour
 * becomes the nearest tone. An event names its member by name (`who`), splits its start into date and time, keeps its end time when it
 * ends the same day (else says when it ends in the notes), becomes all-day (no times) when it ran midnight to midnight, and keeps its
 * category and a status other than confirmed in the notes.
 * A reminder keeps its title and due time (repeat none) and is for its event's member. One the family already dealt with (any status
 * but pending) whose time has not come is left out: 2.0 has no status and would remind about it again. One whose time has passed comes
 * across either way (2.0 shows a past one-off as done). Everything stays in the v1_* tables either way.
 */
export function v1Import(v1: V1Rows, now = new Date(), importId = V1_IMPORT_ID): V1Import | null {
  const names = new Map(v1.members.map((m) => [m.id, m.name]));
  const whoOf = (memberId: number | null) => (memberId === null ? null : names.get(memberId) ?? null);
  const eventMember = new Map(v1.events.map((e) => [e.id, e.member_id]));
  const nowLocal = `${localDate(now)}T${localTime(now)}`;

  const members: Row[] = v1.members.map((m) => ({ $key: `m${m.id}`, name: m.name, colour: toneOf(m.color), emoji: m.emoji?.trim() || null }));
  const events: Row[] = v1.events.map((e) => eventRow(e, whoOf(e.member_id), now));
  const reminders: Row[] = [];
  for (const r of v1.reminders) {
    const at = localParts(r.due_time) ?? localParts(r.created_at);
    const due = `${at?.date ?? localDate(now)}T${at?.time ?? "00:00"}`;
    if (!isPending(r.status) && due > nowLocal) continue;
    reminders.push({ $key: `r${r.id}`, title: r.title, due, repeat: "none", who: whoOf(r.event_id === null ? null : eventMember.get(r.event_id) ?? null) });
  }
  if (!members.length && !events.length && !reminders.length) return null;
  return { importId, by: IMPORT_BY, rows: { members, events, reminders } };
}

/** 1.x's API stored whatever status it was sent (its own pages wrote "pending" and "done", and listed only those two). Only pending,
 *  or no status at all, is a reminder still to come; any other (done, dismissed, cancelled…) is one the family has dealt with. */
const isPending = (status: string | null | undefined) => !status?.trim() || status.trim().toLowerCase() === "pending";

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const tableNames = (db: Database) => new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
/** A 1.x table: 1.x's integer id (2.0's ids are text). */
function isV1Table(db: Database, name: string): boolean {
  const cols = db.query(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[];
  return cols.some((c) => c.name === "id" && /int/i.test(c.type));
}
const readAll = <T>(db: Database, table: string, ok: boolean): T[] => (ok ? (db.query(`SELECT * FROM ${q(table)} ORDER BY id`).all() as T[]) : []);
/** The importIds the kit has applied; none before its first start. */
function importsDone(db: Database): Set<string> {
  try { return new Set((db.query(`SELECT import_id FROM "_imports"`).all() as { import_id: string }[]).map((r) => r.import_id)); }
  catch { return new Set(); }
}
/** The import file waiting for the kit: absent, ours (any set's), or someone else's (or unreadable, which is never ours to replace). */
function waitingImport(path: string): "none" | "ours" | "other" {
  if (!existsSync(path)) return "none";
  try { return isOurImport(JSON.parse(readFileSync(path, "utf8"))?.importId) ? "ours" : "other"; } catch { return "other"; }
}

/** Step 1: rename the 1.x tables under 2.0's names to the first set of kept names that is wholly free. Never fails on a taken name. */
function moveV1Tables(db: Database): string[] {
  const live = tableNames(db);
  const moving = TABLES.filter((t) => live.has(t) && isV1Table(db, t));
  if (!moving.length) return [];
  let n = 1;
  while (TABLES.some((t) => live.has(v1Names(n)[t]))) n++;
  const to = v1Names(n);
  // Parents first, so each later table's link is rewritten to the renamed parent (members, then events, then reminders).
  db.transaction(() => { for (const t of moving) db.exec(`ALTER TABLE ${q(t)} RENAME TO ${q(to[t])}`); })();
  return moving.map((t) => to[t]);
}

/** Every kept set's number, oldest first. */
function keptSets(db: Database): number[] {
  const ns = new Set<number>();
  for (const name of tableNames(db)) { const m = KEPT_NAME.exec(name); if (m) ns.add(m[2] ? Number(m[2]) : 1); }
  return [...ns].sort((a, b) => a - b);
}

/** Step 2: the oldest kept set not yet imported, written as the boot import; one per boot (the kit applies one file per start). */
function importNextSet(db: Database, dataDir: string, now?: Date): Pick<V1Outcome, "imported" | "waiting"> {
  const done = importsDone(db);
  const live = tableNames(db);
  for (const n of keptSets(db)) {
    const id = v1ImportId(n);
    if (done.has(id)) continue;
    const names = v1Names(n);
    const has = (t: V1Table) => live.has(names[t]) && isV1Table(db, names[t]);
    const plan = v1Import({
      members: readAll<V1Member>(db, names.members, has("members")),
      events: readAll<V1Event>(db, names.events, has("events")),
      reminders: readAll<V1Reminder>(db, names.reminders, has("reminders")),
    }, now, id);
    if (!plan) continue;
    const target = join(dataDir, ".flock", "import.json");
    if (waitingImport(target) === "other") {
      console.warn(`[family-calendar] another import is waiting; the 1.x rows (${id}) are imported on a later start`);
      return { imported: null, waiting: id };
    }
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(target, JSON.stringify(plan, null, 2));
    return { imported: { importId: id, members: plan.rows.members.length, events: plan.rows.events.length, reminders: plan.rows.reminders.length }, waiting: null };
  }
  return { imported: null, waiting: null };
}

export interface V1Outcome {
  /** The tables this start renamed. */
  moved: string[];
  /** The import this start wrote for the kit, if any. */
  imported: { importId: string; members: number; events: number; reminders: number } | null;
  /** A set left for a later start because someone else's import is waiting. */
  waiting: string | null;
  /** Every kept 1.x table, for mountKit's keepTables: the kit would otherwise drop them as tables its schema does not describe. */
  keep: string[];
}

/**
 * Before mountKit: step 1 (move) and, unless `writeImport` is false, step 2 (import). Does nothing but report the kept tables when
 * there is no 1.x table left to move and nothing left to import. `writeImport` is false in the kit's check mode, which the platform
 * only runs on a throwaway copy of the data: the move still happens there, so the trial reports 2.0's tables as new rather than 1.x's
 * columns as deleted.
 */
export function prepareV1Data(dataDir: string, o: { writeImport?: boolean; now?: Date } = {}): V1Outcome {
  const file = join(dataDir, "app.db");
  if (!existsSync(file)) return { moved: [], imported: null, waiting: null, keep: [] };
  const db = new Database(file);
  try {
    // legacy_alter_table off, so a rename rewrites the other tables' links to it (some SQLite builds default it on).
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA legacy_alter_table = OFF");
    const moved = moveV1Tables(db);
    const { imported, waiting } = o.writeImport === false ? { imported: null, waiting: null } : importNextSet(db, dataDir, o.now);
    const keep = [...tableNames(db)].filter((t) => KEPT_NAME.test(t)).sort();
    if (moved.length || imported) console.log(`[family-calendar] ${moved.length ? `kept the 1.x tables as ${moved.join(", ")}` : "1.x tables already kept"}${imported ? `; carrying ${imported.members} members, ${imported.events} events and ${imported.reminders} reminders across (${imported.importId})` : ""}`);
    return { moved, imported, waiting, keep };
  } finally { db.close(); }
}
