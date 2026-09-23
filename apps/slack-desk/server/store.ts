// Slack Desk's OWN store. Nothing else reads it.
//
// The whole point of the app boundary (slack-desk SPEC D3′): the platform never touches Slack
// content. It keeps its own read-loop bookkeeping — dedup keys, cursors — and the app keeps the
// messages. So this file has no platform import and no platform table.
//
// `$APP_DATA_DIR` is handed to the process at spawn (app-process.ts buildCleanEnv) and lives
// OUTSIDE the served code, so a redeploy replaces the code and leaves the data.

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

const dataDir = process.env.APP_DATA_DIR ?? ".";
// The platform creates APP_DATA_DIR at spawn, but an app that only works when someone else made
// its directory is an app that dies at import with no log line — which is exactly how this first
// failed: `new Database()` on a missing directory throws before `listen()` is ever reached, so the
// process exits silently and the platform sees only a health-check timeout.
try { mkdirSync(dataDir, { recursive: true }); } catch { /* exists, or unwritable — the open reports it */ }
const db = new Database(`${dataDir}/slack-desk.db`);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

// Append-only. Add at the end; never edit or reorder an existing entry.
const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS messages (
     account_id TEXT NOT NULL,
     channel_id TEXT NOT NULL,
     ts         TEXT NOT NULL,
     thread_ts  TEXT,
     author     TEXT,
     text       TEXT,
     permalink  TEXT,
     seen_at    INTEGER NOT NULL,
     PRIMARY KEY (account_id, channel_id, ts)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(account_id, channel_id, thread_ts)`,
  `CREATE TABLE IF NOT EXISTS cursors (
     account_id TEXT NOT NULL,
     channel_id TEXT NOT NULL,
     last_ts    TEXT,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (account_id, channel_id)
   )`,
  // Per-workspace initialization, DURABLE (U4). The platform keeps no copy — it asks.
  `CREATE TABLE IF NOT EXISTS init_state (
     account_id  TEXT PRIMARY KEY,
     started_at  INTEGER NOT NULL,
     finished_at INTEGER,
     outcome     TEXT,
     note        TEXT
   )`,
  // One harvest per workspace per day, so a restart cannot re-run today's.
  `CREATE TABLE IF NOT EXISTS harvest_days (
     account_id TEXT NOT NULL,
     day        TEXT NOT NULL,
     ran_at     INTEGER NOT NULL,
     published  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (account_id, day)
   )`,
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

export interface SlackMessage {
  channelId: string;
  ts: string;
  threadTs?: string | null;
  author?: string;
  text?: string;
  permalink?: string;
  /** How many replies hang off this message. Non-zero means a thread to fetch — and means
   *  `conversations.history` alone would report the channel as far quieter than it is. */
  replyCount?: number;
}

/** Store messages; returns how many were genuinely new. Dedup is OURS, by (account, channel, ts). */
export function upsertMessages(accountId: string, msgs: SlackMessage[]): number {
  if (msgs.length === 0) return 0;
  // RETURNING tells us whether the row was actually inserted; a conflict yields nothing. Counting
  // via `changes()` around the statement looks equivalent and is not — it is why this returned
  // nonsense on the first write of a batch.
  const ins = db.query(
    `INSERT INTO messages (account_id, channel_id, ts, thread_ts, author, text, permalink, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, channel_id, ts) DO NOTHING
     RETURNING ts`,
  );
  let inserted = 0;
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const m of msgs) {
      const row = ins.get(accountId, m.channelId, m.ts, m.threadTs ?? null, m.author ?? null, m.text ?? null, m.permalink ?? null, now);
      if (row) inserted++;
    }
  });
  tx();
  return inserted;
}

export function getCursor(accountId: string, channelId: string): string | null {
  const r = db.query("SELECT last_ts FROM cursors WHERE account_id = ? AND channel_id = ?")
    .get(accountId, channelId) as { last_ts?: string } | null;
  return r?.last_ts ?? null;
}

export function setCursor(accountId: string, channelId: string, lastTs: string | null): void {
  db.query(
    `INSERT INTO cursors (account_id, channel_id, last_ts, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, channel_id) DO UPDATE SET last_ts = excluded.last_ts, updated_at = excluded.updated_at`,
  ).run(accountId, channelId, lastTs, Date.now());
}

export interface InitRecord {
  accountId: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: string | null;
  note: string | null;
}

export function getInit(accountId: string): InitRecord | null {
  const r = db.query("SELECT account_id, started_at, finished_at, outcome, note FROM init_state WHERE account_id = ?")
    .get(accountId) as any;
  return r ? { accountId: r.account_id, startedAt: r.started_at, finishedAt: r.finished_at, outcome: r.outcome, note: r.note } : null;
}

export function listInit(): InitRecord[] {
  return (db.query("SELECT account_id, started_at, finished_at, outcome, note FROM init_state").all() as any[])
    .map((r) => ({ accountId: r.account_id, startedAt: r.started_at, finishedAt: r.finished_at, outcome: r.outcome, note: r.note }));
}

export function markInitStarted(accountId: string, note?: string): void {
  db.query(
    `INSERT INTO init_state (account_id, started_at, finished_at, outcome, note) VALUES (?, ?, NULL, NULL, ?)
     ON CONFLICT(account_id) DO UPDATE SET note = excluded.note`,
  ).run(accountId, Date.now(), note ?? null);
}

export function markInitFinished(accountId: string, outcome: "done" | "failed", note?: string): void {
  db.query("UPDATE init_state SET finished_at = ?, outcome = ?, note = ? WHERE account_id = ?")
    .run(Date.now(), outcome, note ?? null, accountId);
}

/** Has today's harvest already run for this workspace? The restart guard. */
export function harvestRanToday(accountId: string, day: string): boolean {
  return !!db.query("SELECT 1 FROM harvest_days WHERE account_id = ? AND day = ?").get(accountId, day);
}

export function markHarvestRan(accountId: string, day: string, published: number): void {
  db.query(
    `INSERT INTO harvest_days (account_id, day, ran_at, published) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, day) DO UPDATE SET ran_at = excluded.ran_at, published = excluded.published`,
  ).run(accountId, day, Date.now(), published);
}

/** Messages worth extracting from, newest window first. Grouped by thread by the caller. */
export function messagesSince(accountId: string, sinceMs: number): SlackMessage[] {
  return (db.query(
    `SELECT channel_id, ts, thread_ts, author, text, permalink FROM messages
      WHERE account_id = ? AND seen_at >= ? ORDER BY channel_id, ts`,
  ).all(accountId, sinceMs) as any[]).map((r) => ({
    channelId: r.channel_id, ts: r.ts, threadTs: r.thread_ts,
    author: r.author, text: r.text, permalink: r.permalink,
  }));
}

export { db as _db };
