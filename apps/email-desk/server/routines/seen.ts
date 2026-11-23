// What the gather already handed over (the Twitter desk's seen.ts, for mail). No new table: a handed-over message is the
// memory consumer's ledger row marked `extracted`, the state the built-in desk wrote when its harvest took a row. So the
// owner's moved store (Task 3.2) counts everything the built-in desk already extracted as handed over, and nothing is read
// twice across the upgrade.
//
// Ids are journal event ids (KeptMail.messageId). Handing over a thread through one message covers the messages before it
// in that thread too: they were in the same thread text.
import { getStore } from "../store";
import { GMAIL_SOURCE, MEMORY_CONSUMER } from "../journal";

export const HANDED_OVER_REASON = "handed_over";

/** Mark these messages, and the earlier still-claimable messages of their threads, as handed over. Idempotent. */
export function markHandedOver(ids: readonly string[]): void {
  const db = getStore();
  const rowOf = db.query(
    "SELECT account_id, thread_key, ts FROM ingest_events WHERE source_id = ? AND event_id = ?",
  );
  const covered = db.query(
    `SELECT event_id FROM ingest_events
      WHERE source_id = ? AND account_id = ? AND thread_key = ? AND ts <= ?`,
  );
  const mark = db.query(
    `INSERT INTO ingest_comprehension (source_id, account_id, event_id, consumer, state, reason, attempts, updated_at)
     VALUES (?,?,?,?, 'extracted', ?, 0, ?)
     ON CONFLICT(source_id, account_id, event_id, consumer) DO UPDATE SET
       state = 'extracted', reason = excluded.reason, updated_at = excluded.updated_at
     WHERE ingest_comprehension.state IN ('pending','failed')`,
  );
  const now = Date.now();
  db.transaction(() => {
    for (const id of ids) {
      const rows = rowOf.all(GMAIL_SOURCE, id) as { account_id: string; thread_key: string | null; ts: number }[];
      for (const r of rows) {
        const events = r.thread_key
          ? (covered.all(GMAIL_SOURCE, r.account_id, r.thread_key, r.ts) as { event_id: string }[]).map((e) => e.event_id)
          : [id];
        if (!events.includes(id)) events.push(id);
        for (const e of events) mark.run(GMAIL_SOURCE, r.account_id, e, MEMORY_CONSUMER, HANDED_OVER_REASON, now);
      }
    }
  })();
}

/** Was this message handed over already (by this copy, or extracted by the built-in desk before it)? */
export function wasHandedOver(id: string): boolean {
  return !!getStore().query(
    `SELECT 1 FROM ingest_comprehension WHERE source_id = ? AND event_id = ? AND consumer = ? AND state = 'extracted' LIMIT 1`,
  ).get(GMAIL_SOURCE, id, MEMORY_CONSUMER);
}
