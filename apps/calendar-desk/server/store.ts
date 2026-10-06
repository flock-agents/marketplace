// Calendar Desk's OWN store. Nothing else reads it.
//
// Calendar events (scraped), the notes the owner leaves on meetings, the record of which meetings
// were prepped, and the app's cursors live here. Reminders are Flock TODOs now, not this app's.
// This file has no platform import and no platform table.
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
  // Reminders fold into Flock TODOs: the tables and the cursors only they used go.
  `DROP TABLE IF EXISTS reminders`,
  `DROP TABLE IF EXISTS fires`,
  `DELETE FROM cursors WHERE key = 'facts_since' OR key LIKE 'reminder_session:%'`,
  // Part B: dated facts from memory are events too. Rows the scraper writes keep 'google'.
  `ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'google';
   ALTER TABLE events ADD COLUMN fact_id INTEGER;
   ALTER TABLE events ADD COLUMN source_link TEXT`,
  // Event details (2026-10-06): read from Google's detail popover.
  `ALTER TABLE events ADD COLUMN google_event_id TEXT;
   ALTER TABLE events ADD COLUMN guests_json TEXT;
   ALTER TABLE events ADD COLUMN guest_summary TEXT;
   ALTER TABLE events ADD COLUMN description TEXT;
   ALTER TABLE events ADD COLUMN meet_link TEXT;
   ALTER TABLE events ADD COLUMN details_at INTEGER`,
  // 2026-10-06: a missing mark from a read that saw rows is a confirmed removal; a blank read only hides the day.
  `ALTER TABLE events ADD COLUMN missing_confirmed INTEGER`,
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

// Calendar Desk's own copy of the google-calendar skill's detail types (no import across repos).
// The owner is never a guest: the skill leaves the signed-in account out.
export interface EventGuest { email: string; name?: string; rsvp?: "yes" | "no" | "maybe" | "awaiting"; organiser?: true }
/** `guests` absent = the skill could not read them reliably: stored as null (unknown), like never read. */
export interface EventDetails { guests?: EventGuest[]; guestSummary?: string; location?: string; description?: string; meetLink?: string }

/** `guests === null` means the details were never read (not "no guests"). */
export interface EventRow { accountId: string; eventKey: string; calendar: string | null; title: string; startAt: number | null; endAt: number | null; allDay: boolean; localDate: string; attendeesText: string | null; location: string | null; rawTimeText: string | null; firstSeenAt: number; lastSeenAt: number; missingSince: number | null; missingConfirmed: boolean; source: "google" | "fact"; factId: number | null; sourceLink: string | null;
  googleEventId: string | null; guests: EventGuest[] | null; guestSummary: string | null; description: string | null; meetLink: string | null; detailsAt: number | null }
/** What a scrape writes: everything but the store's own bookkeeping and the details (saveEventDetails). */
export type ScrapedEventRow = Omit<EventRow, "accountId" | "firstSeenAt" | "lastSeenAt" | "missingSince" | "missingConfirmed" | "source" | "factId" | "sourceLink" | "googleEventId" | "guests" | "guestSummary" | "description" | "meetLink" | "detailsAt"> & { googleEventId?: string | null }
function rowToEvent(r: any): EventRow {
  return {
    accountId: r.account_id, eventKey: r.event_key, calendar: r.calendar, title: r.title,
    startAt: r.start_at, endAt: r.end_at, allDay: !!r.all_day, localDate: r.local_date,
    attendeesText: r.attendees_text, location: r.location, rawTimeText: r.raw_time_text,
    firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, missingSince: r.missing_since, missingConfirmed: r.missing_confirmed === 1,
    source: r.source ?? "google", factId: r.fact_id ?? null, sourceLink: r.source_link ?? null,
    googleEventId: r.google_event_id ?? null, guests: r.guests_json ? JSON.parse(r.guests_json) : null, guestSummary: r.guest_summary ?? null,
    description: r.description ?? null, meetLink: r.meet_link ?? null, detailsAt: r.details_at ?? null,
  };
}

// ── events ────────────────────────────────────────────────────────────────────────────────

/** A re-scrape never clobbers stored details; once details are read, the popover owns the location (even when it has none). */
export function upsertEvents(accountId: string, rows: ScrapedEventRow[], seenAt: number): { inserted: number; updated: number } {
  let inserted = 0, updated = 0;
  const ins = db.query(`INSERT INTO events (account_id, event_key, calendar, title, start_at, end_at, all_day, local_date, attendees_text, location, raw_time_text, first_seen_at, last_seen_at, missing_since, google_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(account_id, event_key) DO UPDATE SET calendar=excluded.calendar, title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at, all_day=excluded.all_day,
      local_date=excluded.local_date, attendees_text=excluded.attendees_text,
      location=CASE WHEN events.details_at IS NOT NULL THEN events.location ELSE excluded.location END,
      raw_time_text=excluded.raw_time_text, last_seen_at=excluded.last_seen_at, missing_since=NULL, missing_confirmed=NULL,
      google_event_id=COALESCE(excluded.google_event_id, events.google_event_id)`);
  const exists = db.query("SELECT 1 FROM events WHERE account_id = ? AND event_key = ?");
  const tx = db.transaction(() => {
    for (const r of rows) {
      const had = !!exists.get(accountId, r.eventKey);
      ins.run(accountId, r.eventKey, r.calendar, r.title, r.startAt, r.endAt, r.allDay ? 1 : 0, r.localDate, r.attendeesText, r.location, r.rawTimeText, seenAt, seenAt, r.googleEventId ?? null);
      if (had) updated++; else inserted++;
    }
  });
  tx();
  return { inserted, updated };
}

/** `rowLocation` is this scrape's agenda location: the fallback when the popover shows none. */
export function saveEventDetails(accountId: string, eventKey: string, d: EventDetails, at: number, rowLocation: string | null = null): void {
  db.query(`UPDATE events SET guests_json = ?, guest_summary = ?, description = ?, meet_link = ?, details_at = ?,
      location = ? WHERE account_id = ? AND event_key = ?`)
    .run(d.guests ? JSON.stringify(d.guests) : null, d.guestSummary ?? null, d.description ?? null, d.meetLink ?? null, at, d.location ?? rowLocation ?? null, accountId, eventKey);
}

export const DETAIL_FIRST_READ_MAX = 60;
export const DETAIL_STEADY_MAX = 15;
/** After a detail pass that got nothing back, the next scrapes only probe this many for a day. */
export const DETAIL_PROBE_MAX = 3;
const DETAIL_MISS_BACKOFF_MS = 24 * 3600_000;
export const detailMissCursor = (accountId: string) => `detail_miss:${accountId}`;
const DETAIL_FRESH_MS = 24 * 3600_000;
const DETAIL_HORIZON_MS = 48 * 3600_000;
const DETAIL_WINDOW_DAYS = 7;
const pad2 = (n: number) => String(n).padStart(2, "0");
const localYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localMidnight = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y!, m! - 1, d!).getTime(); };

/** What the next scrape asks the skill to read. A first read (no details yet, or more than 15 upcoming
 *  timed events in the 7-day window without them) covers up to 60; after that 15 per scrape. Events whose
 *  details are under a day old, or that start more than 48h out, are skipped (ordered by start), and so are
 *  events already over. `forceIds` (the meeting about to be prepped) are never skipped. */
export function detailPlan(accountId: string, now: Date, opts: { forceIds?: string[] } = {}): { max: number; skipIds: string[] } {
  const t = now.getTime();
  const force = new Set(opts.forceIds ?? []);
  const read = db.query(`SELECT google_event_id, start_at, local_date, details_at FROM events
    WHERE account_id = ? AND source = 'google' AND missing_since IS NULL AND google_event_id IS NOT NULL AND details_at IS NOT NULL`)
    .all(accountId) as { google_event_id: string; start_at: number | null; local_date: string; details_at: number }[];
  const skip = read
    .map((r) => ({ id: r.google_event_id, start: r.start_at ?? localMidnight(r.local_date), detailsAt: r.details_at }))
    .filter((r) => r.detailsAt > t - DETAIL_FRESH_MS || r.start > t + DETAIL_HORIZON_MS)
    .sort((a, b) => a.start - b.start)
    .map((r) => r.id);
  const over = db.query(`SELECT google_event_id FROM events WHERE account_id = ? AND source = 'google' AND missing_since IS NULL
      AND google_event_id IS NOT NULL AND COALESCE(end_at, start_at) IS NOT NULL AND COALESCE(end_at, start_at) < ? ORDER BY start_at`)
    .all(accountId, t) as { google_event_id: string }[];
  for (const r of over) if (!skip.includes(r.google_event_id)) skip.push(r.google_event_id);
  const skipIds = skip.filter((id) => !force.has(id));
  const anyRead = (db.query("SELECT 1 FROM events WHERE account_id = ? AND source = 'google' AND details_at IS NOT NULL LIMIT 1").get(accountId)) != null;
  const end = new Date(now); end.setDate(end.getDate() + DETAIL_WINDOW_DAYS);
  const unread = (db.query(`SELECT COUNT(*) AS n FROM events WHERE account_id = ? AND source = 'google' AND missing_since IS NULL
      AND all_day = 0 AND start_at IS NOT NULL AND start_at >= ? AND local_date BETWEEN ? AND ? AND details_at IS NULL`)
    .get(accountId, t, localYmd(now), localYmd(end)) as { n: number }).n;
  const missAt = Number(getCursor(detailMissCursor(accountId)) || 0);
  if (missAt && t - missAt < DETAIL_MISS_BACKOFF_MS) return { max: DETAIL_PROBE_MAX, skipIds };
  const firstRead = !anyRead || unread > DETAIL_STEADY_MAX;
  return { max: firstRead ? DETAIL_FIRST_READ_MAX : DETAIL_STEADY_MAX, skipIds };
}

/** Stored Google events on these dates not yet marked missing (what a read that saw none of them would mark). */
export function unmissedEvents(accountId: string, localDates: string[]): { eventKey: string; googleEventId: string | null }[] {
  if (localDates.length === 0) return [];
  return (db.query(`SELECT event_key, google_event_id FROM events WHERE account_id = ? AND source = 'google' AND missing_since IS NULL AND local_date IN (${localDates.map(() => "?").join(",")}) ORDER BY local_date, start_at`)
    .all(accountId, ...localDates) as { event_key: string; google_event_id: string | null }[]).map((r) => ({ eventKey: r.event_key, googleEventId: r.google_event_id }));
}

/** `confirmed`: Google said it can't find the event (a removal); unconfirmed = superseded by a renamed/moved copy. */
export function markEventsMissing(accountId: string, eventKeys: string[], at: number, confirmed: boolean): void {
  const upd = db.query("UPDATE events SET missing_since = ?, missing_confirmed = ? WHERE account_id = ? AND event_key = ? AND missing_since IS NULL");
  for (const k of eventKeys) upd.run(at, confirmed ? 1 : 0, accountId, k);
}

/** Marks every stored event on these dates that is not in `presentKeys` (tests and seeding; sync asks Google per event). */
export function markMissingEvents(accountId: string, localDates: string[], presentKeys: string[], at: number, confirmed = true): number {
  const keys = new Set(presentKeys);
  const gone = unmissedEvents(accountId, localDates).map((r) => r.eventKey).filter((k) => !keys.has(k));
  markEventsMissing(accountId, gone, at, confirmed);
  return gone.length;
}

export function listEvents(opts: { fromDate: string; toDate: string; accountId?: string; includeMissing?: boolean; source?: "google" | "fact" }): EventRow[] {
  const where = ["local_date BETWEEN ? AND ?"];
  const args: (string | number)[] = [opts.fromDate, opts.toDate];
  if (opts.accountId) { where.push("account_id = ?"); args.push(opts.accountId); }
  if (opts.source) { where.push("source = ?"); args.push(opts.source); }
  if (!opts.includeMissing) where.push("missing_since IS NULL");
  const rows = db.query(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY local_date, all_day DESC, start_at`).all(...args) as any[];
  return rows.map(rowToEvent);
}

export const factEventKey = (factId: number) => `fact:${factId}`;
export interface FactEventInput { accountId: string; factId: number; title: string; localDate: string; startAt: number | null; sourceLink: string | null }
/** One row per fact (key fact:<id>). The account can change if the fact's link changes: the old row goes. */
export function upsertFactEvent(r: FactEventInput, at: number): "inserted" | "updated" | "unchanged" {
  const key = factEventKey(r.factId);
  const prev = db.query("SELECT * FROM events WHERE source = 'fact' AND event_key = ?").get(key) as any;
  if (prev && prev.account_id !== r.accountId) db.query("DELETE FROM events WHERE account_id = ? AND event_key = ?").run(prev.account_id, key);
  else if (prev && prev.title === r.title && prev.local_date === r.localDate && (prev.start_at ?? null) === r.startAt && (prev.source_link ?? null) === r.sourceLink) {
    db.query("UPDATE events SET last_seen_at = ? WHERE account_id = ? AND event_key = ?").run(at, r.accountId, key);
    return "unchanged";
  }
  db.query(`INSERT INTO events (account_id, event_key, calendar, title, start_at, end_at, all_day, local_date, attendees_text, location, raw_time_text, first_seen_at, last_seen_at, missing_since, source, fact_id, source_link)
    VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, NULL, 'fact', ?, ?)
    ON CONFLICT(account_id, event_key) DO UPDATE SET title=excluded.title, start_at=excluded.start_at, all_day=excluded.all_day, local_date=excluded.local_date, last_seen_at=excluded.last_seen_at, source_link=excluded.source_link`)
    .run(r.accountId, key, r.title, r.startAt, r.startAt == null ? 1 : 0, r.localDate, at, at, r.factId, r.sourceLink);
  return prev && prev.account_id === r.accountId ? "updated" : "inserted";
}
export function listFactEvents(): EventRow[] {
  return (db.query("SELECT * FROM events WHERE source = 'fact' ORDER BY local_date, start_at").all() as any[]).map(rowToEvent);
}
export function deleteFactEvent(accountId: string, eventKey: string): void {
  db.query("DELETE FROM events WHERE source = 'fact' AND account_id = ? AND event_key = ?").run(accountId, eventKey);
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

// ── preps ─────────────────────────────────────────────────────────────────────────────────

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
