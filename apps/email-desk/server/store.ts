// Email Desk's own store: $APP_DATA_DIR/email-desk.db. The schema is today's built-in desk store, kept
// verbatim (account_id included), so a copy of the owner's existing email-desk.db opens unchanged.
// Idempotent: every table is CREATE IF NOT EXISTS, and PRAGMA user_version only ever moves up.
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

/** The schema version this app writes. A db already at a higher version is left alone. */
export const SCHEMA_VERSION = 1;

export function dbPath(dir: string): string {
  return join(dir, "email-desk.db");
}

export function openStore(dir: string): Database {
  mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath(dir));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    createSchema(db);
    const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
    if (user_version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } catch (err) {
    try { db.close(); } catch { /* the original error matters */ }
    throw err;
  }
  return db;
}

function addColumns(db: Database, table: string, columns: [string, string][]): void {
  const have = (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const [name, type] of columns) if (!have.includes(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

function createSchema(db: Database): void {
  db.exec(`
    -- The mail journal: one row per journaled inbound message. Carries the verbatim
    -- body (the "donation") once some reader has paid for the fetch.
    CREATE TABLE IF NOT EXISTS ingest_events (
      id          TEXT PRIMARY KEY,
      source_id   TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      event_id    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      actor       TEXT,
      thread_key  TEXT,
      ts          INTEGER NOT NULL,
      preview     TEXT,
      permalink   TEXT,
      raw         TEXT,
      created_at  INTEGER NOT NULL,
      body           TEXT,
      body_stored_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_events_dedup
      ON ingest_events(source_id, account_id, event_id);
    CREATE INDEX IF NOT EXISTS idx_ingest_events_source_created
      ON ingest_events(source_id, account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingest_events_created ON ingest_events(created_at);
    -- Message-time listing (2026-09-22): the event-llm dispatcher walks a mailbox's
    -- journal by the MESSAGE's own time (ts), oldest first, from its watermark.
    CREATE INDEX IF NOT EXISTS idx_ingest_events_source_ts
      ON ingest_events(source_id, account_id, ts);
    -- A thread's newest stored message (newestStoredThreadMessage: a Daily Brief prep seed).
    CREATE INDEX IF NOT EXISTS idx_ingest_events_thread
      ON ingest_events(thread_key, account_id, ts);

    -- Email CONTENT, split out of the fused ingest_events (email-desk-portability N1, doc 02
    -- §2.2a). The domain-specific half of a journal row — the actual mail (actor=sender,
    -- preview=snippet, raw=full fetched item, body=verbatim body) — keyed by the SAME
    -- (source,account,event) identity as the platform envelope. EXPAND phase: this is DUAL-
    -- WRITTEN alongside the fused ingest_events columns (which are NOT dropped in Set 1) and
    -- BACKFILLED from them (N4); readers resolve content NEW-FIRST from here with a fallback to
    -- the fused columns (COALESCE), so no reader ever sees empty content and a revert is safe.
    CREATE TABLE IF NOT EXISTS ingest_content (
      source_id      TEXT NOT NULL,
      account_id     TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      actor          TEXT,
      preview        TEXT,
      raw            TEXT,
      body           TEXT,
      body_stored_at INTEGER,
      PRIMARY KEY (source_id, account_id, event_id)
    );

    -- Per (source, account) fetch cursor.
    CREATE TABLE IF NOT EXISTS ingest_cursors (
      source_id   TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      cursor      TEXT,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (source_id, account_id)
    );

    -- Engaged domains (design 04 §4.1): domains the owner has actually corresponded
    -- with, per account. POSITIVES ONLY. 'count'/'last_sent_at' are vestigial (0).
    CREATE TABLE IF NOT EXISTS engaged_domains (
      account_id   TEXT NOT NULL,
      domain       TEXT NOT NULL,
      count        INTEGER NOT NULL DEFAULT 0,
      last_sent_at INTEGER NOT NULL DEFAULT 0,
      seeded       INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (account_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_engaged_domains_account ON engaged_domains(account_id);

    -- Draft records: one row per (account_id, thread_id) — the single Gmail draft
    -- written for that thread + body_written (the three-way-compare base that keeps
    -- an owner's Gmail edit from being silently overwritten).
    --
    -- sent_at / sent_by (send-on-approve, founder 2026-09-13): the "Sent by Flock"
    -- record is a SENT-STATUS ON THIS DRAFT ROW — NOT a separate content-duplicating
    -- log. When an Approve sends the draft, the send-email skill stamps sent_at + sent_by
    -- (the agent/routine). The "what did Flock send" view is a READ over these rows.
    -- The sensitive email content (body/recipients/subject) lives ONLY here, never in a
    -- platform log/audit.
    CREATE TABLE IF NOT EXISTS draft_records (
      account_id           TEXT NOT NULL,
      thread_id            TEXT NOT NULL,
      draft_id             TEXT NOT NULL,
      body_written         TEXT NOT NULL,
      answered_message_ref TEXT NOT NULL DEFAULT '',
      draft_message_id     TEXT NOT NULL DEFAULT '',
      updated_at           INTEGER NOT NULL,
      sent_at              INTEGER,
      sent_by              TEXT,
      PRIMARY KEY (account_id, thread_id)
    );

    -- Comprehension ledger: per-item, per-consumer processing state over the journal.
    CREATE TABLE IF NOT EXISTS ingest_comprehension (
      source_id  TEXT    NOT NULL,
      account_id TEXT    NOT NULL,
      event_id   TEXT    NOT NULL,
      consumer   TEXT    NOT NULL,
      state      TEXT    NOT NULL,
      reason     TEXT,
      attempts   INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, account_id, event_id, consumer)
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_comp_claim
      ON ingest_comprehension(consumer, source_id, account_id, state, updated_at);

    -- The messages of a thread a consumer's extraction actually read, by fingerprint
    -- (harvest message-fingerprint.ts): Gmail's print view gives no message ids, and a
    -- thread re-opened by a new reply heads these as already read. Recorded only when an
    -- extraction commits (POST /api/comprehension/mark, state 'extracted').
    CREATE TABLE IF NOT EXISTS extracted_messages (
      source_id   TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      consumer    TEXT NOT NULL,
      thread_key  TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (source_id, account_id, consumer, thread_key, fingerprint)
    );

    -- Per-account lifecycle state (email-desk-portability N3, doc 06 §6.3). The APP's own
    -- per-mailbox initialization sequence — "has this app initialized this account, when did
    -- it start / finish, when did it last make progress" — which used to live in the PLATFORM's
    -- onboarding.json (accountInitializations). One 'sequence' row per account today; the
    -- per-stage (extract/voice) shape is reserved by the (account_id, stage) key for when the
    -- stage marks move here too (Set 2 / C6). EXPAND phase: this mirrors onboarding.json (seeded
    -- at boot, re-derived on every init write), so the drafting/sweep holds answer identically
    -- while onboarding.json stays authoritative-on-fallback.
    CREATE TABLE IF NOT EXISTS lifecycle_state (
      account_id       TEXT NOT NULL,
      stage            TEXT NOT NULL,          -- 'sequence' (per-account) | 'extract' | 'voice'
      started_at       INTEGER,
      finished_at      INTEGER,
      outcome          TEXT,                   -- 'done' | 'capped' | NULL (in-flight)
      last_progress_at INTEGER,
      pending_sweeps   TEXT,                    -- JSON array of owed first-sweep routine ids
      updated_at       INTEGER NOT NULL,
      PRIMARY KEY (account_id, stage)
    );

    -- Send-on-approve idempotency ledger (design 03 §3.3d, Sam P0-1 / Vik P1-1).
    -- Keyed on (account_id, thread_id, draft_record) via idempotency_key. The
    -- send-email skill records 'in_flight' BEFORE calling gmail send and flips to
    -- 'sent' after — so a concurrent retry during in-flight blocks, and a replay
    -- after success returns without re-sending. Populated in Phase 1 slice 7.
    CREATE TABLE IF NOT EXISTS send_ledger (
      idempotency_key TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL,
      thread_id       TEXT NOT NULL,
      draft_id        TEXT,
      state           TEXT NOT NULL,            -- 'in_flight' | 'sent' | 'failed'
      result          TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_send_ledger_account ON send_ledger(account_id);

    -- Follow-up routine (spec Part 2): one row per (account, thread) the routine has judged,
    -- keyed to the owner message it judged, so one message is never nudged twice.
    CREATE TABLE IF NOT EXISTS follow_up_state (
      account_id     TEXT NOT NULL,
      thread_id      TEXT NOT NULL,
      owner_msg_key  TEXT NOT NULL,
      status         TEXT NOT NULL,   -- waiting | offered | considered | nudged | not_needed | replied
      checked_at     INTEGER NOT NULL,
      draft_id       TEXT,
      session_id     TEXT,            -- the follow-up routine session the thread was offered to
      offered_at     INTEGER,         -- when it was offered (grant window + daily limit)
      recipient_name TEXT,            -- first name for the follow-up card, from the runner's read
      PRIMARY KEY (account_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS follow_up_runs (
      account_id  TEXT PRIMARY KEY,
      last_run_at INTEGER NOT NULL
    );

    -- App-owned key/value metadata (durable one-shot flags the app records for itself, e.g.
    -- the S2.7 platform-journal-retired marker and the relocated v8 gmail-deeplink-repair flag).
    -- NOT the platform dataVersion watermark — this is the app's own applied-once bookkeeping.
    CREATE TABLE IF NOT EXISTS app_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at INTEGER NOT NULL
    );

    -- The message a draft answers (spec §4.10): the thread's newest incoming message for a
    -- reply, the owner's last sent message for a follow-up. Captured when the drafting
    -- session reads the thread (getReplyContext), read by the approval card publisher.
    CREATE TABLE IF NOT EXISTS reply_messages (
      account_id TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      kind       TEXT NOT NULL,
      from_addr  TEXT NOT NULL,
      to_addrs   TEXT NOT NULL DEFAULT '',
      date_text  TEXT NOT NULL DEFAULT '',
      subject    TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, thread_id)
    );

    -- The person's voice, per mailbox (Task 2.9, spec §2.6): one row per (account, dimension), learned from their sent
    -- mail (source 'voice-crawl') or written by them on the settings page (source 'owner-edit', which no re-learn
    -- overwrites). Flock's wiki_voice_profile kept rows per address; here the key is the account, like every table above.
    -- An owner-edit row with an empty value is a Forget: the drafter skips it and the crawl cannot learn it back.
    CREATE TABLE IF NOT EXISTS voice_profile (
      account_id        TEXT NOT NULL,
      dimension         TEXT NOT NULL,
      value             TEXT NOT NULL,
      examples          TEXT NOT NULL DEFAULT '[]',
      observation_count INTEGER NOT NULL DEFAULT 1,
      source            TEXT NOT NULL,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (account_id, dimension)
    );
  `);
  // A store made before these columns existed: CREATE TABLE IF NOT EXISTS will not add them.
  addColumns(db, "draft_records", [["sent_at", "INTEGER"], ["sent_by", "TEXT"]]);
  // The app's draft record (Task 2.5): its own id (the card's `draft:<id>`), the person-edit lock and the card's why.
  // A row the built-in desk wrote gets an id here, once, so every draft is addressable by the ops.
  addColumns(db, "draft_records", [["id", "TEXT"], ["person_edited", "INTEGER NOT NULL DEFAULT 0"], ["why", "TEXT"]]);
  db.run("UPDATE draft_records SET id = lower(hex(randomblob(16))) WHERE id IS NULL OR id = ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_records_id ON draft_records(id)");
  addColumns(db, "lifecycle_state", [["pending_sweeps", "TEXT"]]);
  addColumns(db, "reply_messages", [["quoted", "TEXT"]]);
  addColumns(db, "follow_up_state", [["session_id", "TEXT"], ["offered_at", "INTEGER"], ["recipient_name", "TEXT"]]);
  // Who the draft's reply reaches (drafts/addressing.ts, Ruling P3-R5): JSON { to, cc, recipients }, or NULL when unknown.
  addColumns(db, "draft_records", [["reply_all", "TEXT"]]);
}

// The copy's one open store, opened on first use in $APP_DATA_DIR (or the dir a caller names, e.g. the platform
// context's dataDir). Modules that keep the brief's id-only signatures (seen.ts) read it here.
let current: { dir: string; db: Database } | null = null;

export function getStore(dir?: string): Database {
  const want = dir ?? process.env.APP_DATA_DIR;
  if (current && (!want || want === current.dir)) return current.db;
  if (!want) throw new Error("email-desk store: no APP_DATA_DIR");
  current = { dir: want, db: openStore(want) };
  return current.db;
}

/** Tests: use this open db as the store (null forgets it; the caller closes its own db). */
export function _setStoreForTesting(db: Database | null, dir = "test"): void {
  current = db ? { dir, db } : null;
}
