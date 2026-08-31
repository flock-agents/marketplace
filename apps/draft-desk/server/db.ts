import { Database } from "bun:sqlite";

// Durable per-app storage — survives redeploys/restarts. NEVER write into the served dir.
const dataDir = process.env.APP_DATA_DIR ?? ".";
const db = new Database(`${dataDir}/app.db`);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

// Append-only migrations. Add new entries at the end — never edit or reorder existing ones.
const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS drafts (
    id             TEXT PRIMARY KEY,
    source         TEXT NOT NULL,
    thread_ref     TEXT NOT NULL,
    sender         TEXT NOT NULL,
    subject        TEXT NOT NULL,
    thread_summary TEXT NOT NULL,
    draft_body     TEXT NOT NULL,
    status         TEXT NOT NULL,
    user_comment   TEXT,
    notified_at    INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    sent_at        INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS draft_revisions (
    id            TEXT PRIMARY KEY,
    draft_id      TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    author        TEXT NOT NULL,
    body_snapshot TEXT,
    comment       TEXT,
    created_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_revisions_draft ON draft_revisions(draft_id)`,
  // Clickable permalink to the original thread. Nullable so pre-existing rows survive.
  `ALTER TABLE drafts ADD COLUMN source_url TEXT`,
  // "Fetch-more" signals raised by the owner and fulfilled by Milo.
  `CREATE TABLE IF NOT EXISTS draft_requests (
    id           TEXT PRIMARY KEY,
    status       TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    fulfilled_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requests_status ON draft_requests(status)`,
  // Exact send address (JSON) captured at draft time for a direct, search-free send.
  // Nullable so pre-existing rows survive; stored/read as a JSON string in the repository.
  `ALTER TABLE drafts ADD COLUMN send_target TEXT`,
  // System/status/failure note, kept SEPARATE from the owner's user_comment so a status
  // message (e.g. a send failure) can never clobber the owner's revision instruction. Nullable.
  `ALTER TABLE drafts ADD COLUMN system_note TEXT`,
  // The real recent messages of the thread (JSON array of {sender, text}), shown instead of the
  // hallucination-prone thread_summary. Nullable so pre-existing rows survive and fall back to
  // the summary; stored/read as a JSON string in the repository.
  `ALTER TABLE drafts ADD COLUMN thread_messages TEXT`,
];

function applyMigrations() {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (idx INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const row = db.query("SELECT COALESCE(MAX(idx), -1) AS max FROM _migrations").get() as { max: number };
  const applied = row.max;
  const now = Date.now();
  const tx = db.transaction(() => {
    migrations.forEach((sql, idx) => {
      if (idx <= applied) return;
      db.exec(sql);
      db.query("INSERT INTO _migrations (idx, applied_at) VALUES (?, ?)").run(idx, now);
    });
  });
  tx();
}

applyMigrations();

export { db };
