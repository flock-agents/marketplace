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
  // WHO THE OWNER IS, AND WHAT EVERYONE ELSE IS CALLED.
  //
  // Extraction was attributing every message in a thread to the owner, because the block it
  // sent said `U0C2S2W19EZ: <text>` and nothing anywhere said which of those opaque ids was
  // the owner. A colleague's bug report became "Yogesh reports…". The fix needs two facts the
  // app never held: the owner's own user id, and a display name per author. Both are stable,
  // so they are cached here rather than re-fetched per message.
  //
  // `url` is the workspace base ("https://acme.slack.com/"), the only way to build a permalink.
  `CREATE TABLE IF NOT EXISTS workspace (
     account_id TEXT PRIMARY KEY,
     user_id    TEXT,
     user_name  TEXT,
     team       TEXT,
     team_id    TEXT,
     url        TEXT,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS user_names (
     account_id TEXT NOT NULL,
     user_id    TEXT NOT NULL,
     name       TEXT,
     is_bot     INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (account_id, user_id)
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

/**
 * Messages inside the lookback window, ordered so the caller can group them.
 *
 * The window is on `ts` — WHEN THE MESSAGE WAS SENT — not on `seen_at`, when this app happened
 * to store the row. Filtering on seen_at made `lookbackHours` mean "whatever I fetched recently",
 * which is a different thing wearing the same name: a backfill that pulled a week of history in
 * one pass put all of it inside a 24-hour window, and a re-run that fetched nothing new excluded
 * messages that genuinely were from today.
 *
 * `ts` is Slack's epoch-seconds-with-fraction, stored as TEXT, so it is compared as a real.
 */
export function messagesSince(accountId: string, sinceMs: number): SlackMessage[] {
  return (db.query(
    `SELECT channel_id, ts, thread_ts, author, text, permalink FROM messages
      WHERE account_id = ? AND CAST(ts AS REAL) >= ? ORDER BY channel_id, CAST(ts AS REAL)`,
  ).all(accountId, sinceMs / 1000) as any[]).map((r) => ({
    channelId: r.channel_id, ts: r.ts, threadTs: r.thread_ts,
    author: r.author, text: r.text, permalink: r.permalink,
  }));
}

// --- Identity ---

export interface Workspace {
  userId: string | null;
  userName: string | null;
  team: string | null;
  teamId: string | null;
  url: string | null;
}

export function getWorkspace(accountId: string): Workspace | null {
  const r = db.query("SELECT user_id, user_name, team, team_id, url FROM workspace WHERE account_id = ?")
    .get(accountId) as any;
  return r ? { userId: r.user_id, userName: r.user_name, team: r.team, teamId: r.team_id, url: r.url } : null;
}

export function setWorkspace(accountId: string, w: Workspace): void {
  db.query(
    `INSERT INTO workspace (account_id, user_id, user_name, team, team_id, url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       user_id = excluded.user_id, user_name = excluded.user_name, team = excluded.team,
       team_id = excluded.team_id, url = excluded.url, updated_at = excluded.updated_at`,
  ).run(accountId, w.userId, w.userName, w.team, w.teamId, w.url, Date.now());
}

/** Cached display names for the given ids. Ids with no cached name are simply absent. */
export function getUserNames(accountId: string, userIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const q = db.query(`SELECT user_id, name FROM user_names WHERE account_id = ? AND user_id = ?`);
  for (const id of userIds) {
    const r = q.get(accountId, id) as any;
    if (r?.name) out.set(r.user_id, r.name);
  }
  return out;
}

export function setUserName(accountId: string, userId: string, name: string | null, isBot = false): void {
  db.query(
    `INSERT INTO user_names (account_id, user_id, name, is_bot, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, user_id) DO UPDATE SET
       name = excluded.name, is_bot = excluded.is_bot, updated_at = excluded.updated_at`,
  ).run(accountId, userId, name, isBot ? 1 : 0, Date.now());
}

export { db as _db };
