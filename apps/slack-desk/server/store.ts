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

  // --- Cost work, 2026-09-25 ---------------------------------------------------
  //
  // WHICH SOURCE A ROW CAME FROM. Nothing recorded it, so once a message was stored
  // there was no way to know it arrived as a DM, a saved item, a mention hit or a
  // channel read. Two of the four attention signals are exactly that question, so the
  // triage below cannot be written without it. ALTER, not a new CREATE: the table
  // already exists on every install, and `CREATE TABLE IF NOT EXISTS` would not add it.
  `ALTER TABLE messages ADD COLUMN source TEXT`,
  // Slack's own subtype (channel_join, file_share, thread_broadcast, bot_message...)
  // and the bot id a bot post carries INSTEAD of a user. Both were discarded on the way
  // in, which is why a bot message reached `isWorthRemembering` with an empty author and
  // died at the wrong test, and why a join notice reads as the owner speaking.
  `ALTER TABLE messages ADD COLUMN subtype TEXT`,
  `ALTER TABLE messages ADD COLUMN bot_id TEXT`,
  // Slack surfaces an edit as the SAME ts with new text, and the row was written with
  // ON CONFLICT DO NOTHING — so an edit never changed the store, and therefore could
  // never change a content hash either. Keeping the edit stamp makes the change visible.
  `ALTER TABLE messages ADD COLUMN edited_ts TEXT`,

  // THREADS WE HAVE SEEN, so replies can be re-polled off the channel cursor.
  //
  // `conversations.history(oldest=cursor)` returns thread PARENTS only, and a reply does
  // not bump its parent's ts — so a thread read on Monday that gains fifteen replies on
  // Tuesday is invisible to history and its replies never enter the store at all. This is
  // the set to re-poll instead: every thread we know of, with what we last saw of it.
  //
  // `attended` is the sticky attention bit. Once a thread has EVER carried a signal — the
  // owner spoke, was mentioned, it is a DM, they saved it — every future block for it is
  // full-tier, because a conversation the owner is part of does not stop being theirs
  // because they went quiet for a day.
  `CREATE TABLE IF NOT EXISTS threads (
     account_id     TEXT NOT NULL,
     channel_id     TEXT NOT NULL,
     thread_ts      TEXT NOT NULL,
     last_reply_ts  TEXT,
     reply_count    INTEGER NOT NULL DEFAULT 0,
     attended       INTEGER NOT NULL DEFAULT 0,
     last_polled_at INTEGER,
     updated_at     INTEGER NOT NULL,
     PRIMARY KEY (account_id, channel_id, thread_ts)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_threads_poll ON threads(account_id, last_polled_at)`,

  // THE LEDGER — what this app has extracted, and what it looked like when it did.
  //
  // The platform kept a timestamp watermark until 2026-09-25 and no longer does: the
  // reader owns the record of what it has read, because only the reader knows what a unit
  // of content is. This is that record. Keyed on the block id the app already mints
  // (`channel:anchorTs`), it holds the newest message ts covered and a hash of the exact
  // text sent, so an unchanged conversation costs nothing and a changed one is re-read.
  //
  // `tasks_terminal` is the one thing a content hash cannot tell us: the platform's task
  // dedup index is PARTIAL (it excludes done/dismissed), so re-extracting a thread whose
  // task the owner already completed can MINT IT AGAIN. A thread marked here is never
  // re-extracted for tasks, whatever its text does.
  `CREATE TABLE IF NOT EXISTS ledger (
     account_id      TEXT NOT NULL,
     block_id        TEXT NOT NULL,
     last_message_ts TEXT,
     text_hash       TEXT,
     extracted_at    INTEGER NOT NULL,
     deferred_count  INTEGER NOT NULL DEFAULT 0,
     tasks_terminal  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (account_id, block_id)
   )`,

  // WHAT A PASS SPENT, AND WHY IT STOPPED. A cap with no record of stopping is just
  // truncation: `harvest_days` said a day had run and nothing said it had run OUT. A pass
  // that stopped on budget must leave the day claimable so the next tick resumes it, which
  // is the shape email-desk already uses.
  `ALTER TABLE harvest_days ADD COLUMN calls_spent INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE harvest_days ADD COLUMN stop_reason TEXT`,
  // Spend and claim are different facts, and conflating them deadlocks the resume: a pass that
  // stopped on budget must record what it spent, but the row recording it would otherwise make
  // `harvestRanToday` true and lock out the tick that was supposed to finish the work. Existing
  // rows default to claimed, because that is what they meant when they were written.
  `ALTER TABLE harvest_days ADD COLUMN claimed INTEGER NOT NULL DEFAULT 1`,
  // Per-channel engagement, so discovery can decay instead of expiring on a cliff edge
  // and can be seeded from MEMBERSHIP rather than from "has posted here".
  `CREATE TABLE IF NOT EXISTS channel_engagement (
     account_id    TEXT NOT NULL,
     channel_id    TEXT NOT NULL,
     score         REAL NOT NULL DEFAULT 0,
     mention_count INTEGER NOT NULL DEFAULT 0,
     num_members   INTEGER,
     is_member     INTEGER NOT NULL DEFAULT 0,
     last_seen_at  INTEGER NOT NULL,
     PRIMARY KEY (account_id, channel_id)
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
  /** WHICH READ PRODUCED THIS ROW: "dms", "mentions", "engaged", "saved" or "channel".
   *  Two of the attention signals are this question, and it used to be unanswerable once
   *  the row was stored. */
  source?: string;
  /** Slack's own subtype: channel_join, file_share, thread_broadcast, bot_message… */
  subtype?: string;
  /** A bot post carries this INSTEAD of `author`, which is why bot content died at the
   *  empty-author test rather than at the bot test. */
  botId?: string;
  /** Set when Slack reports the message as edited. Same ts, new text. */
  editedTs?: string;
}

/** Store messages; returns how many were genuinely new. Dedup is OURS, by (account, channel, ts). */
export function upsertMessages(accountId: string, msgs: SlackMessage[]): number {
  if (msgs.length === 0) return 0;
  // RETURNING tells us whether the row was actually inserted; a conflict yields nothing.
  // Counting via `changes()` around the statement looks equivalent and is not — it is why this
  // returned nonsense on the first write of a batch.
  const ins = db.query(
    `INSERT INTO messages (account_id, channel_id, ts, thread_ts, author, text, permalink, seen_at,
                           source, subtype, bot_id, edited_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, channel_id, ts) DO NOTHING
     RETURNING ts`,
  );
  // AN EDIT IS THE SAME ts WITH NEW TEXT, so the insert above conflicts and does nothing —
  // which is how "let's ship Thursday" edited to "moving to Tuesday" stayed Thursday in the
  // store forever, and therefore could never change a content hash either. A second statement
  // takes the new text, but ONLY when Slack says it was edited and the stamp is newer: an
  // unconditional UPDATE would rewrite every row on every pass and make every hash churn.
  const upd = db.query(
    `UPDATE messages
        SET text = ?, edited_ts = ?, subtype = COALESCE(?, subtype), bot_id = COALESCE(?, bot_id)
      WHERE account_id = ? AND channel_id = ? AND ts = ?
        AND ? IS NOT NULL AND (edited_ts IS NULL OR edited_ts < ?)`,
  );
  let inserted = 0;
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const m of msgs) {
      const row = ins.get(
        accountId, m.channelId, m.ts, m.threadTs ?? null, m.author ?? null, m.text ?? null,
        m.permalink ?? null, now, m.source ?? null, m.subtype ?? null, m.botId ?? null,
        m.editedTs ?? null,
      );
      if (row) { inserted++; continue; }
      upd.run(
        m.text ?? null, m.editedTs ?? null, m.subtype ?? null, m.botId ?? null,
        accountId, m.channelId, m.ts, m.editedTs ?? null, m.editedTs ?? null,
      );
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
     ON CONFLICT(account_id) DO UPDATE SET
       started_at  = excluded.started_at,
       -- A RETRY IS A FRESH ATTEMPT. Leaving the previous run's verdict in place would show the
       -- owner a stale "failed" while the retry is in flight, and would make the record read as
       -- finished to anything checking finished_at.
       finished_at = NULL,
       outcome     = NULL,
       note        = excluded.note`,
  ).run(accountId, Date.now(), note ?? null);
}

export function markInitFinished(accountId: string, outcome: "done" | "failed", note?: string): void {
  db.query("UPDATE init_state SET finished_at = ?, outcome = ?, note = ? WHERE account_id = ?")
    .run(Date.now(), outcome, note ?? null, accountId);
}

/** Has today's harvest already run for this workspace? The restart guard. */
export function harvestRanToday(accountId: string, day: string): boolean {
  // CLAIMED, not merely present. A row with claimed=0 is a pass that spent reads and stopped
  // early; the day is still owed and the next tick must be allowed to pick it up.
  return !!db.query("SELECT 1 FROM harvest_days WHERE account_id = ? AND day = ? AND claimed = 1")
    .get(accountId, day);
}

export function markHarvestRan(
  accountId: string, day: string, published: number,
  callsSpent = 0, stopReason: string | null = null,
): void {
  db.query(
    `INSERT INTO harvest_days (account_id, day, ran_at, published, calls_spent, stop_reason)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, day) DO UPDATE SET
       ran_at      = excluded.ran_at,
       published   = harvest_days.published + excluded.published,
       calls_spent = harvest_days.calls_spent + excluded.calls_spent,
       stop_reason = excluded.stop_reason,
       claimed     = 1`,
  ).run(accountId, day, Date.now(), published, callsSpent, stopReason);
}

/**
 * Record what an unfinished pass spent, WITHOUT claiming the day.
 *
 * email-desk's shape: a run that stopped early leaves its work due so the next tick resumes it,
 * and its own comment records what stamping it instead cost — most of a first landing unread
 * until 05:00 the next morning.
 */
export function markPartialSpend(accountId: string, day: string, callsSpent: number, stopReason: string | null): void {
  db.query(
    `INSERT INTO harvest_days (account_id, day, ran_at, published, calls_spent, stop_reason, claimed)
     VALUES (?, ?, ?, 0, ?, ?, 0)
     ON CONFLICT(account_id, day) DO UPDATE SET
       ran_at      = excluded.ran_at,
       calls_spent = harvest_days.calls_spent + excluded.calls_spent,
       stop_reason = excluded.stop_reason`,
  ).run(accountId, day, Date.now(), callsSpent, stopReason);
}

/** Let the FIRST harvest try a wider window: it remembered nothing, so there is nothing to
 *  protect from a re-read. Never used by the daily path, where the guard is the point. */
export function clearHarvestDay(accountId: string, day: string): void {
  db.query("DELETE FROM harvest_days WHERE account_id = ? AND day = ?").run(accountId, day);
}

/** What today's passes have already spent, so a resumed pass does not start its budget over. */
export function callsSpentToday(accountId: string, day: string): number {
  const r = db.query("SELECT calls_spent FROM harvest_days WHERE account_id = ? AND day = ?")
    .get(accountId, day) as { calls_spent?: number } | null;
  return r?.calls_spent ?? 0;
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
    `SELECT channel_id, ts, thread_ts, author, text, permalink, source, subtype, bot_id, edited_ts
       FROM messages
      WHERE account_id = ? AND CAST(ts AS REAL) >= ? ORDER BY channel_id, CAST(ts AS REAL)`,
  ).all(accountId, sinceMs / 1000) as any[]).map(rowToMessage);
}

/**
 * A thread's FULL stored history, whatever window a pass is working in.
 *
 * Attention has to be scored over this rather than over the lookback slice. The owner asks
 * a question at 17:00 Monday and the answers land at 10:00 Tuesday; Tuesday's window holds
 * only the answers, in which the owner never speaks and nobody re-tags them, so every signal
 * reads false and the answer to their own question would be skipped. The rows are already
 * here and `idx_messages_thread` already indexes them — only the candidate query was narrow.
 */
export function threadMessages(accountId: string, channelId: string, threadTs: string): SlackMessage[] {
  return (db.query(
    `SELECT channel_id, ts, thread_ts, author, text, permalink, source, subtype, bot_id, edited_ts
       FROM messages
      WHERE account_id = ? AND channel_id = ? AND (thread_ts = ? OR ts = ?)
      ORDER BY CAST(ts AS REAL)`,
  ).all(accountId, channelId, threadTs, threadTs) as any[]).map(rowToMessage);
}

function rowToMessage(r: any): SlackMessage {
  return {
    channelId: r.channel_id, ts: r.ts, threadTs: r.thread_ts, author: r.author,
    text: r.text, permalink: r.permalink, source: r.source ?? undefined,
    subtype: r.subtype ?? undefined, botId: r.bot_id ?? undefined,
    editedTs: r.edited_ts ?? undefined,
  };
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

// --- The thread set: what we know of, so replies can be re-polled ------------

export interface ThreadRow {
  channelId: string;
  threadTs: string;
  lastReplyTs: string | null;
  replyCount: number;
  attended: boolean;
  lastPolledAt: number | null;
}

/** Remember a thread, or update what we last saw of it. Never lowers `attended`. */
export function upsertThread(
  accountId: string, channelId: string, threadTs: string,
  opts: { lastReplyTs?: string | null; replyCount?: number; attended?: boolean; polled?: boolean } = {},
): void {
  db.query(
    `INSERT INTO threads (account_id, channel_id, thread_ts, last_reply_ts, reply_count,
                          attended, last_polled_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, channel_id, thread_ts) DO UPDATE SET
       last_reply_ts  = COALESCE(excluded.last_reply_ts, threads.last_reply_ts),
       reply_count    = MAX(threads.reply_count, excluded.reply_count),
       -- attended is STICKY: once a thread has carried a signal it keeps it, because a
       -- conversation the owner is part of does not stop being theirs when they go quiet.
       attended       = MAX(threads.attended, excluded.attended),
       last_polled_at = COALESCE(excluded.last_polled_at, threads.last_polled_at),
       updated_at     = excluded.updated_at`,
  ).run(
    accountId, channelId, threadTs, opts.lastReplyTs ?? null, opts.replyCount ?? 0,
    opts.attended ? 1 : 0, opts.polled ? Date.now() : null, Date.now(),
  );
}

/**
 * Threads worth re-polling: active recently, and not polled since `staleMs` ago.
 *
 * This is the answer to `conversations.history` returning parents only. Ordered by how long
 * they have gone unpolled so a capped pass rotates through them rather than starving the tail,
 * and attended threads first because those are the ones carrying asks.
 */
export function threadsToPoll(accountId: string, activeSinceMs: number, staleMs: number, limit: number): ThreadRow[] {
  const now = Date.now();
  return (db.query(
    `SELECT channel_id, thread_ts, last_reply_ts, reply_count, attended, last_polled_at
       FROM threads
      WHERE account_id = ?
        AND CAST(COALESCE(last_reply_ts, thread_ts) AS REAL) >= ?
        AND (last_polled_at IS NULL OR last_polled_at <= ?)
      ORDER BY attended DESC, COALESCE(last_polled_at, 0) ASC
      LIMIT ?`,
  ).all(accountId, activeSinceMs / 1000, now - staleMs, limit) as any[]).map((r) => ({
    channelId: r.channel_id, threadTs: r.thread_ts, lastReplyTs: r.last_reply_ts,
    replyCount: r.reply_count, attended: !!r.attended, lastPolledAt: r.last_polled_at,
  }));
}

export function isThreadAttended(accountId: string, channelId: string, threadTs: string): boolean {
  const r = db.query("SELECT attended FROM threads WHERE account_id = ? AND channel_id = ? AND thread_ts = ?")
    .get(accountId, channelId, threadTs) as { attended?: number } | null;
  return !!r?.attended;
}

// --- The ledger: what we extracted, and what it looked like ------------------

export interface LedgerRow {
  lastMessageTs: string | null;
  textHash: string | null;
  extractedAt: number;
  deferredCount: number;
  tasksTerminal: boolean;
}

export function getLedger(accountId: string, blockId: string): LedgerRow | null {
  const r = db.query(
    `SELECT last_message_ts, text_hash, extracted_at, deferred_count, tasks_terminal
       FROM ledger WHERE account_id = ? AND block_id = ?`,
  ).get(accountId, blockId) as any;
  return r ? {
    lastMessageTs: r.last_message_ts, textHash: r.text_hash, extractedAt: r.extracted_at,
    deferredCount: r.deferred_count, tasksTerminal: !!r.tasks_terminal,
  } : null;
}

/**
 * Record an extraction. CALL ONLY AFTER IT COMMITTED.
 *
 * The route reports `processedItems` / `failedItems` as counts with no per-item ids, so a batch
 * where some blocks failed cannot be attributed — which is why the caller sends small batches and
 * writes this only for what it can prove landed. Writing it optimistically is silent memory loss.
 */
export function writeLedger(accountId: string, blockId: string, lastMessageTs: string | null, textHash: string): void {
  db.query(
    `INSERT INTO ledger (account_id, block_id, last_message_ts, text_hash, extracted_at, deferred_count)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(account_id, block_id) DO UPDATE SET
       last_message_ts = excluded.last_message_ts,
       text_hash       = excluded.text_hash,
       extracted_at    = excluded.extracted_at,
       deferred_count  = 0`,
  ).run(accountId, blockId, lastMessageTs, textHash, Date.now());
}

/** A block the budget could not afford today. Its count is the rank key that ages it into priority. */
export function bumpDeferred(accountId: string, blockId: string): void {
  db.query(
    `INSERT INTO ledger (account_id, block_id, extracted_at, deferred_count)
     VALUES (?, ?, 0, 1)
     ON CONFLICT(account_id, block_id) DO UPDATE SET deferred_count = ledger.deferred_count + 1`,
  ).run(accountId, blockId);
}

/**
 * How far back the candidate window must reach to still SEE the blocks we deferred.
 *
 * THE QUEUE NEEDS SOMEWHERE TO COME BACK FROM. The pass builds candidates from
 * `messagesSince(now - lookbackHours)`, so with a 24-hour window a conversation deferred out of
 * a 14-day first run is not merely postponed — it is unreachable, and `deferred_count` counts
 * a loss instead of a debt. Measured on a real first pass: 11 of 12 deferred conversations sat
 * outside the next window.
 *
 * Returns the oldest anchor timestamp among still-deferred blocks (epoch seconds), or null when
 * nothing is owed. Widening the window costs only local SQLite work: the ledger's hash check
 * drops everything already extracted before any of it reaches a model.
 */
export function oldestDeferredTs(accountId: string): number | null {
  const r = db.query(
    `SELECT MIN(CAST(m.ts AS REAL)) AS oldest
       FROM ledger l
       JOIN messages m
         ON m.account_id = l.account_id
        AND l.block_id = m.channel_id || ':' || COALESCE(m.thread_ts, m.ts)
      WHERE l.account_id = ? AND l.deferred_count > 0`,
  ).get(accountId) as { oldest?: number } | null;
  return r?.oldest ?? null;
}

export function deferredCount(accountId: string, blockId: string): number {
  const r = db.query("SELECT deferred_count FROM ledger WHERE account_id = ? AND block_id = ?")
    .get(accountId, blockId) as { deferred_count?: number } | null;
  return r?.deferred_count ?? 0;
}

/** Never mint tasks for this conversation again: the platform's task dedup is partial. */
export function markTasksTerminal(accountId: string, blockId: string): void {
  db.query(
    `INSERT INTO ledger (account_id, block_id, extracted_at, tasks_terminal) VALUES (?, ?, ?, 1)
     ON CONFLICT(account_id, block_id) DO UPDATE SET tasks_terminal = 1`,
  ).run(accountId, blockId, Date.now());
}

// --- Per-channel engagement, so discovery decays instead of expiring --------

export function bumpEngagement(
  accountId: string, channelId: string,
  opts: { hits?: number; mentions?: number; numMembers?: number | null; isMember?: boolean } = {},
): void {
  db.query(
    `INSERT INTO channel_engagement (account_id, channel_id, score, mention_count, num_members, is_member, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, channel_id) DO UPDATE SET
       score         = channel_engagement.score + excluded.score,
       mention_count = channel_engagement.mention_count + excluded.mention_count,
       num_members   = COALESCE(excluded.num_members, channel_engagement.num_members),
       is_member     = MAX(channel_engagement.is_member, excluded.is_member),
       last_seen_at  = excluded.last_seen_at`,
  ).run(
    accountId, channelId, opts.hits ?? 0, opts.mentions ?? 0,
    opts.numMembers ?? null, opts.isMember ? 1 : 0, Date.now(),
  );
}

/**
 * Age every channel's score by `factor` (< 1).
 *
 * Decay is what lets old evidence fade instead of expiring on a cliff edge — but note it also
 * INTRODUCES eviction where there was none, so the caller floors it: a channel with a lifetime
 * mention or an explicit pick is never dropped however quiet it goes.
 */
export function decayEngagement(accountId: string, factor: number): void {
  db.query("UPDATE channel_engagement SET score = score * ? WHERE account_id = ?").run(factor, accountId);
}

export interface EngagedChannel {
  channelId: string;
  score: number;
  mentionCount: number;
  numMembers: number | null;
  isMember: boolean;
}

export function rankedChannels(accountId: string, limit: number): EngagedChannel[] {
  return (db.query(
    // A small channel matters more per message than a nine-hundred-person one, so members
    // are a tie-breaker rather than a filter; a lifetime mention outranks a bare score.
    // MEMBERSHIP RANKS, IT DOES NOT ADMIT. Being in a channel is a prior, not evidence: an
    // owner in a hundred channels would otherwise turn into a hundred reads a day, which is the
    // "read everything" this app exists not to do. A channel needs some actual sign it matters —
    // a search hit (score) or Slack's own mention count for it. That still catches the lurker
    // case the searches miss, because `mention_count` counts mentions in channels the owner
    // only ever reads.
    `SELECT channel_id, score, mention_count, num_members, is_member
       FROM channel_engagement
      WHERE account_id = ? AND (score > 0 OR mention_count > 0)
      ORDER BY (mention_count > 0) DESC, score DESC,
               CASE WHEN num_members IS NULL THEN 1 ELSE 0 END ASC, num_members ASC
      LIMIT ?`,
  ).all(accountId, limit) as any[]).map((r) => ({
    channelId: r.channel_id, score: r.score, mentionCount: r.mention_count,
    numMembers: r.num_members, isMember: !!r.is_member,
  }));
}
