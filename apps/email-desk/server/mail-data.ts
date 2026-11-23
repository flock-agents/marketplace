// "Delete my mail data" (spec §5.4, rulings R23 and R29): the person's raw mail in this copy is deleted, and the copy goes on
// reading only mail newer than the delete.
//
//   - Every table of the app's db is emptied in one transaction, with SQLite's secure delete on (the freed pages are
//     zeroed) and the file vacuumed after, so the mail does not linger in free pages. The file, its schema and the process
//     stay.
//   - It never causes a re-read: each mailbox's lifecycle `sequence` row is written back as done (a mailbox with no row
//     would be read from scratch by the tick), and `mail_deleted_at` in app_meta is the watermark gather and the follow-up
//     pass honour: mail from before the delete is never journaled again, so it is never extracted again and never re-mints
//     the TODOs the person already ticked. Cost (R29): mail between the last read and the delete is never read.
//   - It refuses while a first read or a routine run is in progress for any mailbox (busyReason): those would write into
//     the store being emptied.
//   - The open draft cards (`draft:<id>`) and offered follow-up TODOs (`follow-up:<thread>`) it held come off Home: what
//     they point at is gone. Memory is Flock's and the person's: nothing here calls it.
import type { Database } from "bun:sqlite";
import { getStore } from "./store";
import { workInProgress } from "./activity";

export const MAIL_DELETED_AT_KEY = "mail_deleted_at";
/** lifecycle.ts STALL_MS (not imported: lifecycle reaches gather, which reads this module). lifecycle.test holds them equal. */
export const SEQUENCE_STALL_MS = 20 * 60_000;

/** When the person last deleted their mail data (epoch ms), or null. Gather and follow-up read nothing from before it. */
export function mailDeletedAt(db: Database = getStore()): number | null {
  const row = db.query("SELECT value FROM app_meta WHERE key = ?").get(MAIL_DELETED_AT_KEY) as { value: string } | null;
  const at = row ? Number(row.value) : NaN;
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** Writes the watermark (deleteMailData does; tests seed it). */
export function recordMailDeleted(at: number, db: Database = getStore()): void {
  db.run(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [MAIL_DELETED_AT_KEY, String(at), at],
  );
}

/** Why the delete must wait, or null: a routine run in this process, or a first read whose row shows life within SEQUENCE_STALL_MS
 *  (a row left by a dead process does not block). */
export function busyReason(db: Database = getStore(), now = Date.now()): string | null {
  const work = workInProgress();
  if (work.length > 0) return work.join(", ");
  const live = db.query(
    "SELECT account_id FROM lifecycle_state WHERE stage = 'sequence' AND finished_at IS NULL AND COALESCE(last_progress_at, started_at, 0) > ? LIMIT 1",
  ).get(now - SEQUENCE_STALL_MS) as { account_id: string } | null;
  return live ? `first read of ${live.account_id}` : null;
}

export interface DeletedMailData {
  rows: number;
  /** The `draft:<id>` cards and `follow-up:<thread>` TODOs that were open: the caller withdraws them. */
  withdraw: string[];
}

/**
 * Empties the app's db (see the header). `accounts`: mailboxes Flock knows, which get a done sequence row too. Synchronous
 * from its first read to the commit, so nothing can start in between.
 */
export function deleteMailData(db: Database = getStore(), opts: { now?: number; accounts?: readonly string[] } = {}): DeletedMailData {
  const now = opts.now ?? Date.now();
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((t) => t.name);
  const drafts = (db.query("SELECT id FROM draft_records WHERE sent_at IS NULL AND id IS NOT NULL").all() as { id: string }[])
    .map((r) => `draft:${r.id}`);
  const followUps = (db.query("SELECT thread_id FROM follow_up_state WHERE status = 'offered'").all() as { thread_id: string }[])
    .map((r) => `follow-up:${r.thread_id}`);
  const sequenced = (db.query("SELECT account_id FROM lifecycle_state WHERE stage = 'sequence'").all() as { account_id: string }[])
    .map((r) => r.account_id);
  const accounts = [...new Set([...sequenced, ...(opts.accounts ?? [])].filter(Boolean))];

  const prior = (db.query("PRAGMA secure_delete").get() as { secure_delete: number } | null)?.secure_delete ?? 0;
  db.exec("PRAGMA secure_delete = ON");
  let rows = 0;
  try {
    db.transaction(() => {
      for (const t of tables) rows += db.run(`DELETE FROM "${t.replace(/"/g, '""')}"`).changes;
      for (const a of accounts) {
        db.run(
          `INSERT INTO lifecycle_state (account_id, stage, started_at, finished_at, outcome, last_progress_at, updated_at)
           VALUES (?, 'sequence', ?, ?, 'done', ?, ?)`,
          [a, now, now, now, now],
        );
      }
      recordMailDeleted(now, db);
    })();
  } finally {
    try { db.exec(`PRAGMA secure_delete = ${prior ? "ON" : "OFF"}`); } catch { /* the rows are gone either way */ }
  }
  try { db.exec("VACUUM"); } catch { /* the rows are deleted and zeroed; the file is only not shrunk */ }
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* the rows are gone either way */ }
  return { rows, withdraw: [...drafts, ...followUps] };
}
