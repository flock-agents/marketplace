// Carries a 1.x install's rows into 2.0's tables, once, on the first start after the update.
//
// 1.x kept its rows in the same app.db, in tables with the SAME names as 2.0's (members, events, reminders) but another shape
// (integer ids, hex colours, ISO date-times, a member_id link). Left there, the kit's schema sync would drop their columns. So, before
// mountKit: the 1.x tables are renamed to v1_* (kept as they are, rows and definition, and listed in mountKit's keepTables so the
// kit never touches them), and their rows are written as the kit's boot import (.flock/import.json), which mountKit applies in one
// transaction after creating 2.0's tables. An install whose 1.x tables are empty gets no import, so it starts with the samples like
// a fresh one. A later boot finds no 1.x-shaped table and does nothing.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { COLOURS } from "./constants";

/** Where each 1.x table goes: kept under this name for good (never dropped, never read by 2.0). */
export const V1_TABLES = { members: "v1_members", events: "v1_events", reminders: "v1_reminders" } as const;
/** For mountKit's keepTables, on every boot: the kit would otherwise drop them as tables its schema does not describe. */
export const KEPT_V1_TABLES: string[] = Object.values(V1_TABLES);
export const V1_IMPORT_ID = "family-calendar-1x";
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
 * A reminder keeps its title and due time (repeat none) and is for its event's member. A reminder already marked done whose time has
 * not come is left out: 2.0 would remind about it again. Everything stays in the v1_* tables either way.
 */
export function v1Import(v1: V1Rows, now = new Date()): V1Import | null {
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
    if (r.status === "done" && due > nowLocal) continue;
    reminders.push({ $key: `r${r.id}`, title: r.title, due, repeat: "none", who: whoOf(r.event_id === null ? null : eventMember.get(r.event_id) ?? null) });
  }
  if (!members.length && !events.length && !reminders.length) return null;
  return { importId: V1_IMPORT_ID, by: IMPORT_BY, rows: { members, events, reminders } };
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
/** A 1.x table: there under its 2.0 name with 1.x's integer id (2.0's ids are text). */
function isV1Table(db: Database, name: string): boolean {
  const cols = db.query(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[];
  return cols.some((c) => c.name === "id" && /int/i.test(c.type));
}
const readAll = <T>(db: Database, table: string, present: boolean): T[] => (present ? (db.query(`SELECT * FROM ${q(table)} ORDER BY id`).all() as T[]) : []);

export interface V1Outcome { moved: string[]; imported: { members: number; events: number; reminders: number } | null }

/**
 * Before mountKit: rename any 1.x tables to v1_* and, unless `writeImport` is false, leave their rows as the kit's boot import.
 * Does nothing when there is no app.db or no 1.x table in it. An import.json already waiting (the platform's own) is never replaced.
 * `writeImport` is false in the kit's check mode, which the platform only runs on a throwaway copy of the data: the rename still
 * happens there, so the trial reports 2.0's tables as new rather than 1.x's columns as deleted.
 */
export function prepareV1Data(dataDir: string, o: { writeImport?: boolean; now?: Date } = {}): V1Outcome {
  const file = join(dataDir, "app.db");
  if (!existsSync(file)) return { moved: [], imported: null };
  const db = new Database(file);
  try {
    // legacy_alter_table off, so a rename rewrites the other tables' links to it (some SQLite builds default it on).
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA legacy_alter_table = OFF");
    const present = Object.fromEntries(Object.keys(V1_TABLES).map((t) => [t, isV1Table(db, t)])) as Record<keyof typeof V1_TABLES, boolean>;
    const moved = (Object.keys(V1_TABLES) as (keyof typeof V1_TABLES)[]).filter((t) => present[t]);
    if (!moved.length) return { moved: [], imported: null };

    const plan = v1Import({
      members: readAll<V1Member>(db, "members", present.members),
      events: readAll<V1Event>(db, "events", present.events),
      reminders: readAll<V1Reminder>(db, "reminders", present.reminders),
    }, o.now);
    // The import file first, then the renames: a crash between them finds the 1.x tables still there and writes the same file again.
    let imported: V1Outcome["imported"] = null;
    if (plan && o.writeImport !== false) {
      const target = join(dataDir, ".flock", "import.json");
      if (existsSync(target)) console.warn("[family-calendar] an import is already waiting; the 1.x rows stay in the v1_* tables");
      else {
        mkdirSync(join(dataDir, ".flock"), { recursive: true });
        writeFileSync(target, JSON.stringify(plan, null, 2));
        imported = { members: plan.rows.members.length, events: plan.rows.events.length, reminders: plan.rows.reminders.length };
      }
    }
    // Parents first, so each later table's link is rewritten to the renamed parent (members, then events, then reminders).
    db.transaction(() => { for (const t of moved) db.exec(`ALTER TABLE ${q(t)} RENAME TO ${q(V1_TABLES[t])}`); })();
    console.log(`[family-calendar] kept the 1.x tables as ${moved.map((t) => V1_TABLES[t]).join(", ")}${imported ? `; carrying ${imported.members} members, ${imported.events} events and ${imported.reminders} reminders across` : ""}`);
    return { moved: moved.map((t) => V1_TABLES[t]), imported };
  } finally { db.close(); }
}
