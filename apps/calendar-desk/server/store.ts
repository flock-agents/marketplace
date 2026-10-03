// Calendar Desk's OWN store. Nothing else reads it.
//
// Calendar events (scraped), the notes the owner leaves on meetings, reminders (asked for, found
// by agents, or migrated), the record of what was fired when, and the app's cursors live here.
// The platform owns TODO rows; this file has no platform import and no platform table.
//
// `$APP_DATA_DIR` is handed to the process at spawn and lives OUTSIDE the served code, so a
// redeploy replaces the code and leaves the data.

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

const dataDir = process.env.APP_DATA_DIR ?? ".";
// An app that only works when someone else made its directory dies at import with no log line.
try { mkdirSync(dataDir, { recursive: true }); } catch { /* exists, or unwritable — the open reports it */ }
const db = new Database(`${dataDir}/calendar-desk.db`);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

// Append-only. Add at the end; never edit or reorder an existing entry.
const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS events (
     account_id TEXT NOT NULL, event_key TEXT NOT NULL, calendar TEXT, title TEXT NOT NULL,
     start_at INTEGER, end_at INTEGER, all_day INTEGER NOT NULL DEFAULT 0, local_date TEXT NOT NULL,
     attendees_text TEXT, location TEXT, raw_time_text TEXT,
     first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, missing_since INTEGER,
     PRIMARY KEY (account_id, event_key))`,
  `CREATE INDEX IF NOT EXISTS idx_events_date ON events(local_date, missing_since)`,
  `CREATE TABLE IF NOT EXISTS event_notes (
     account_id TEXT NOT NULL, event_key TEXT NOT NULL, note TEXT NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL,
     PRIMARY KEY (account_id, event_key))`,
  `CREATE TABLE IF NOT EXISTS reminders (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, due_date TEXT NOT NULL, due_time TEXT,
     recurrence TEXT NOT NULL DEFAULT 'none', lead_days TEXT NOT NULL DEFAULT '[0]',
     source_kind TEXT NOT NULL, source_ref TEXT, source_link TEXT, account_id TEXT,
     state TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_state_due ON reminders(state, due_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_source_ref ON reminders(source_ref) WHERE source_ref IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS fires (
     reminder_id TEXT NOT NULL, occurrence TEXT NOT NULL, kind TEXT NOT NULL, fired_at INTEGER NOT NULL,
     task_source_ref TEXT, session_id TEXT, status TEXT NOT NULL DEFAULT 'ok', attempts INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (reminder_id, occurrence, kind))`,
  `CREATE TABLE IF NOT EXISTS preps (account_id TEXT NOT NULL, event_key TEXT NOT NULL, prepared_at INTEGER NOT NULL, session_id TEXT, PRIMARY KEY (account_id, event_key))`,
  `CREATE TABLE IF NOT EXISTS cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS init_state (account_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT, note TEXT)`,
];

function applyMigrations(): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (idx INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const row = db.query("SELECT COALESCE(MAX(idx), -1) AS max FROM _migrations").get() as { max: number };
  const now = Date.now();
  const tx = db.transaction(() => {
    migrations.forEach((sql, idx) => {
      if (idx <= row.max) return;
      db.exec(sql);
      db.query("INSERT INTO _migrations (idx, applied_at) VALUES (?, ?)").run(idx, now);
    });
  });
  tx();
}
applyMigrations();

export interface EventRow { accountId: string; eventKey: string; calendar: string | null; title: string; startAt: number | null; endAt: number | null; allDay: boolean; localDate: string; attendeesText: string | null; location: string | null; rawTimeText: string | null; firstSeenAt: number; lastSeenAt: number; missingSince: number | null }
export interface ReminderRow { id: string; title: string; body: string | null; dueDate: string; dueTime: string | null; recurrence: "none" | "yearly"; leadDays: number[]; sourceKind: "user" | "fact" | "migrated"; sourceRef: string | null; sourceLink: string | null; accountId: string | null; state: "active" | "done" | "cancelled"; createdAt: number; updatedAt: number }
export interface FireRow { reminderId: string; occurrence: string; kind: "row" | "chat"; firedAt: number; taskSourceRef: string | null; sessionId: string | null; status: "ok" | "failed"; attempts: number }

function rowToEvent(r: any): EventRow {
  return {
    accountId: r.account_id, eventKey: r.event_key, calendar: r.calendar, title: r.title,
    startAt: r.start_at, endAt: r.end_at, allDay: !!r.all_day, localDate: r.local_date,
    attendeesText: r.attendees_text, location: r.location, rawTimeText: r.raw_time_text,
    firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, missingSince: r.missing_since,
  };
}

function parseLeadDays(s: string): number[] {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.filter((n) => typeof n === "number");
  } catch { /* fall through */ }
  return [0];
}

function rowToReminder(r: any): ReminderRow {
  return {
    id: r.id, title: r.title, body: r.body, dueDate: r.due_date, dueTime: r.due_time,
    recurrence: r.recurrence, leadDays: parseLeadDays(r.lead_days), sourceKind: r.source_kind,
    sourceRef: r.source_ref, sourceLink: r.source_link, accountId: r.account_id, state: r.state,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowToFire(r: any): FireRow {
  return {
    reminderId: r.reminder_id, occurrence: r.occurrence, kind: r.kind, firedAt: r.fired_at,
    taskSourceRef: r.task_source_ref, sessionId: r.session_id, status: r.status, attempts: r.attempts,
  };
}

// ── events ────────────────────────────────────────────────────────────────────────────────

export function upsertEvents(accountId: string, rows: Omit<EventRow, "accountId" | "firstSeenAt" | "lastSeenAt" | "missingSince">[], seenAt: number): { inserted: number; updated: number } {
  let inserted = 0, updated = 0;
  const ins = db.query(`INSERT INTO events (account_id, event_key, calendar, title, start_at, end_at, all_day, local_date, attendees_text, location, raw_time_text, first_seen_at, last_seen_at, missing_since)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(account_id, event_key) DO UPDATE SET calendar=excluded.calendar, title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at, all_day=excluded.all_day,
      local_date=excluded.local_date, attendees_text=excluded.attendees_text, location=excluded.location, raw_time_text=excluded.raw_time_text, last_seen_at=excluded.last_seen_at, missing_since=NULL`);
  const exists = db.query("SELECT 1 FROM events WHERE account_id = ? AND event_key = ?");
  const tx = db.transaction(() => {
    for (const r of rows) {
      const had = !!exists.get(accountId, r.eventKey);
      ins.run(accountId, r.eventKey, r.calendar, r.title, r.startAt, r.endAt, r.allDay ? 1 : 0, r.localDate, r.attendeesText, r.location, r.rawTimeText, seenAt, seenAt);
      if (had) updated++; else inserted++;
    }
  });
  tx();
  return { inserted, updated };
}

export function markMissingEvents(accountId: string, localDates: string[], presentKeys: string[], at: number): number {
  if (localDates.length === 0) return 0;
  const keys = new Set(presentKeys);
  const rows = db.query(`SELECT event_key FROM events WHERE account_id = ? AND missing_since IS NULL AND local_date IN (${localDates.map(() => "?").join(",")})`).all(accountId, ...localDates) as { event_key: string }[];
  const upd = db.query("UPDATE events SET missing_since = ? WHERE account_id = ? AND event_key = ?");
  let n = 0;
  for (const r of rows) if (!keys.has(r.event_key)) { upd.run(at, accountId, r.event_key); n++; }
  return n;
}

export function listEvents(opts: { fromDate: string; toDate: string; accountId?: string; includeMissing?: boolean }): EventRow[] {
  const where = ["local_date BETWEEN ? AND ?"];
  const args: (string | number)[] = [opts.fromDate, opts.toDate];
  if (opts.accountId) { where.push("account_id = ?"); args.push(opts.accountId); }
  if (!opts.includeMissing) where.push("missing_since IS NULL");
  const rows = db.query(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY local_date, all_day DESC, start_at`).all(...args) as any[];
  return rows.map(rowToEvent);
}

export function getEvent(accountId: string, eventKey: string): EventRow | null {
  const r = db.query("SELECT * FROM events WHERE account_id = ? AND event_key = ?").get(accountId, eventKey) as any;
  return r ? rowToEvent(r) : null;
}

export function setEventNote(accountId: string, eventKey: string, note: string, setBy: "user" | "agent"): void {
  db.query(`INSERT INTO event_notes (account_id, event_key, note, set_by, set_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, event_key) DO UPDATE SET note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at`)
    .run(accountId, eventKey, note, setBy, Date.now());
}

export function getEventNote(accountId: string, eventKey: string): { note: string; setBy: string; setAt: number } | null {
  const r = db.query("SELECT note, set_by, set_at FROM event_notes WHERE account_id = ? AND event_key = ?").get(accountId, eventKey) as any;
  return r ? { note: r.note, setBy: r.set_by, setAt: r.set_at } : null;
}

// ── reminders ─────────────────────────────────────────────────────────────────────────────

export function insertReminder(r: Omit<ReminderRow, "createdAt" | "updatedAt">): ReminderRow {
  const now = Date.now();
  db.query(`INSERT INTO reminders (id, title, body, due_date, due_time, recurrence, lead_days, source_kind, source_ref, source_link, account_id, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.title, r.body, r.dueDate, r.dueTime, r.recurrence, JSON.stringify(r.leadDays), r.sourceKind, r.sourceRef, r.sourceLink, r.accountId, r.state, now, now);
  return getReminder(r.id)!;
}

export function updateReminder(id: string, patch: Partial<Pick<ReminderRow, "title" | "body" | "dueDate" | "dueTime" | "leadDays" | "state" | "sourceLink">>): ReminderRow | null {
  const cols: Record<string, string> = { title: "title", body: "body", dueDate: "due_date", dueTime: "due_time", leadDays: "lead_days", state: "state", sourceLink: "source_link" };
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(cols)) {
    if (!(k in patch)) continue;
    const v = (patch as Record<string, unknown>)[k];
    sets.push(`${col} = ?`);
    args.push(k === "leadDays" ? JSON.stringify(v) : (v as string | null));
  }
  if (sets.length === 0) return getReminder(id);
  sets.push("updated_at = ?");
  args.push(Date.now(), id);
  db.query(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return getReminder(id);
}

export function getReminder(id: string): ReminderRow | null {
  const r = db.query("SELECT * FROM reminders WHERE id = ?").get(id) as any;
  return r ? rowToReminder(r) : null;
}

export function findReminderBySourceRef(sourceRef: string): ReminderRow | null {
  const r = db.query("SELECT * FROM reminders WHERE source_ref = ?").get(sourceRef) as any;
  return r ? rowToReminder(r) : null;
}

export function findActiveReminderByTitleDate(title: string, dueDate: string): ReminderRow | null {
  const r = db.query("SELECT * FROM reminders WHERE state = 'active' AND due_date = ? AND lower(title) = lower(?) LIMIT 1").get(dueDate, title) as any;
  return r ? rowToReminder(r) : null;
}

export function listActiveReminders(): ReminderRow[] {
  return (db.query("SELECT * FROM reminders WHERE state = 'active' ORDER BY due_date, due_time").all() as any[]).map(rowToReminder);
}

export function searchActiveReminders(q: string): ReminderRow[] {
  return (db.query("SELECT * FROM reminders WHERE state = 'active' AND lower(title) LIKE '%' || lower(?) || '%' ORDER BY due_date LIMIT 20").all(q) as any[]).map(rowToReminder);
}

// ── fires, preps ──────────────────────────────────────────────────────────────────────────

export function recordFire(f: Omit<FireRow, "firedAt" | "attempts"> & { attempts?: number }): void {
  db.query(`INSERT INTO fires (reminder_id, occurrence, kind, fired_at, task_source_ref, session_id, status, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reminder_id, occurrence, kind) DO UPDATE SET fired_at = excluded.fired_at, task_source_ref = excluded.task_source_ref, session_id = excluded.session_id, status = excluded.status, attempts = excluded.attempts`)
    .run(f.reminderId, f.occurrence, f.kind, Date.now(), f.taskSourceRef, f.sessionId, f.status, f.attempts ?? 1);
}

export function getFire(reminderId: string, occurrence: string, kind: "row" | "chat"): FireRow | null {
  const r = db.query("SELECT * FROM fires WHERE reminder_id = ? AND occurrence = ? AND kind = ?").get(reminderId, occurrence, kind) as any;
  return r ? rowToFire(r) : null;
}

export function listFiresOn(occurrence: string): FireRow[] {
  return (db.query("SELECT * FROM fires WHERE occurrence = ? ORDER BY fired_at").all(occurrence) as any[]).map(rowToFire);
}

export function recordPrep(accountId: string, eventKey: string, sessionId: string | null): void {
  db.query(`INSERT INTO preps (account_id, event_key, prepared_at, session_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, event_key) DO UPDATE SET prepared_at = excluded.prepared_at, session_id = excluded.session_id`)
    .run(accountId, eventKey, Date.now(), sessionId);
}

export function getPrep(accountId: string, eventKey: string): { preparedAt: number; sessionId: string | null } | null {
  const r = db.query("SELECT prepared_at, session_id FROM preps WHERE account_id = ? AND event_key = ?").get(accountId, eventKey) as any;
  return r ? { preparedAt: r.prepared_at, sessionId: r.session_id } : null;
}

// ── cursors, init ─────────────────────────────────────────────────────────────────────────

export function getCursor(key: string): string | null {
  const r = db.query("SELECT value FROM cursors WHERE key = ?").get(key) as { value: string } | null;
  return r ? r.value : null;
}

export function setCursor(key: string, value: string): void {
  db.query(`INSERT INTO cursors (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, Date.now());
}

export function listInit(): { accountId: string; startedAt: number; finishedAt: number | null; outcome: string | null; note: string | null }[] {
  return (db.query("SELECT * FROM init_state ORDER BY started_at").all() as any[]).map((r) => ({
    accountId: r.account_id, startedAt: r.started_at, finishedAt: r.finished_at, outcome: r.outcome, note: r.note,
  }));
}

export function markInitStarted(accountId: string, note?: string): void {
  db.query(`INSERT INTO init_state (account_id, started_at, finished_at, outcome, note) VALUES (?, ?, NULL, NULL, ?)
    ON CONFLICT(account_id) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL, outcome = NULL, note = excluded.note`)
    .run(accountId, Date.now(), note ?? null);
}

export function markInitFinished(accountId: string, outcome: "done" | "failed", note?: string): void {
  const now = Date.now();
  db.query(`INSERT INTO init_state (account_id, started_at, finished_at, outcome, note) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET finished_at = excluded.finished_at, outcome = excluded.outcome, note = COALESCE(excluded.note, init_state.note)`)
    .run(accountId, now, now, outcome, note ?? null);
}

export { db as _db };
