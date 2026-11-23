// What the gather already handed over (the Twitter desk's seen.ts, for mail). No new table: a handed-over message is the
// memory consumer's ledger row marked `extracted`, the state the built-in desk wrote when its harvest took a row. So the
// owner's moved store (Task 3.2) counts everything the built-in desk already extracted as handed over, and nothing is read
// twice across the upgrade.
//
// Ids are journal event ids (KeptMail.messageId). Handing over a thread through one message covers the messages before it
// in that thread too: they were in the same thread text.
//
// WHICH MESSAGES WERE READ (ruling R13, harvest earlierReadOf). When the gather keeps a thread it notes the fingerprints of
// the messages in the text it handed out (app_meta `handover:<messageId>`); the hand-over records them in
// extracted_messages, as the built-in desk's mark did on `extracted`. A later reply on the thread then reads those
// messages as earlier (EARLIER_MESSAGE_MARK) and only the new one as new.
import { getStore } from "../store";
import { GMAIL_SOURCE, MEMORY_CONSUMER } from "../journal";

export const HANDED_OVER_REASON = "handed_over";

/** Mark these messages, and the earlier still-claimable messages of their threads, as handed over. Idempotent. */
const HANDOVER_KEY = (id: string) => `handover:${id}`;

/** The gather's note of what a kept mail's text held: read back by markHandedOver. Replaced on every gather. */
export function noteHandoverFingerprints(id: string, accountId: string, threadKey: string, fingerprints: readonly string[]): void {
  getStore().run(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [HANDOVER_KEY(id), JSON.stringify({ accountId, threadKey, fingerprints }), Date.now()],
  );
}

export function markHandedOver(ids: readonly string[]): void {
  const db = getStore();
  const note = db.query("SELECT value FROM app_meta WHERE key = ?");
  const dropNote = db.query("DELETE FROM app_meta WHERE key = ?");
  const record = db.query(
    `INSERT OR IGNORE INTO extracted_messages (source_id, account_id, consumer, thread_key, fingerprint, created_at)
     VALUES (?,?,?,?,?,?)`,
  );
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
      const noted = note.get(HANDOVER_KEY(id)) as { value: string } | null;
      if (noted) {
        try {
          const n = JSON.parse(noted.value) as { accountId: string; threadKey: string; fingerprints: string[] };
          for (const f of n.fingerprints ?? []) if (f) record.run(GMAIL_SOURCE, n.accountId, MEMORY_CONSUMER, n.threadKey, f, now);
        } catch { /* a broken note costs the earlier mark, never the hand-over */ }
        dropNote.run(HANDOVER_KEY(id));
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
