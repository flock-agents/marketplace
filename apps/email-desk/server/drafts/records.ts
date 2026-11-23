// Draft records: the one draft per (account, thread), in draft_records. Ported from Flock's draft-records.ts and the
// ingest-db.ts draft functions, now direct db calls on the copy's own store, plus what the app's draft needs: its own `id`
// (the card is `draft:<id>`), the person-edit lock and the card's why.
//
// What "open" means is fixed (memory-extraction.ts reads it): a row with sent_at IS NULL is an open draft on its thread.
// So a discarded draft's row is deleted, never kept with a mark (as the source's clearDraftRecord did): a thread with no
// row is a thread with no draft.
//
// `bodyWritten` is what Gmail held after our last write (the writer's own read-back, bodyAsSaved), the base of the
// three-way compare that tells a person's edit in Gmail from our own text (draftStatus).
import type { Database } from "bun:sqlite";

export interface DraftRecord {
  id: string;
  accountId: string;
  threadId: string;
  /** Gmail's draft id (a reply draft's id is its thread's). */
  draftId: string;
  bodyWritten: string;
  /** The journal event id of the message this draft answers; "" when unknown. */
  answeredMessageRef: string;
  /** The draft's own message id, as Gmail's #drafts row gives it. */
  draftMessageId: string;
  updatedAt: number;
  sentAt: number | null;
  sentBy: string | null;
  /** The person changed this draft (on its card, or in Gmail): the agent may not change it again. */
  personEdited: boolean;
  why: string | null;
}

export type DraftStatus = "untouched" | "person-edited" | "missing";

function toRecord(r: any): DraftRecord {
  return {
    id: r.id,
    accountId: r.account_id,
    threadId: r.thread_id,
    draftId: r.draft_id,
    bodyWritten: r.body_written,
    answeredMessageRef: r.answered_message_ref ?? "",
    draftMessageId: r.draft_message_id ?? "",
    updatedAt: r.updated_at,
    sentAt: r.sent_at ?? null,
    sentBy: r.sent_by ?? null,
    personEdited: r.person_edited === 1,
    why: typeof r.why === "string" && r.why ? r.why : null,
  };
}

export function getDraft(db: Database, id: string): DraftRecord | null {
  if (!id) return null;
  const r = db.query("SELECT * FROM draft_records WHERE id = ?").get(id);
  return r ? toRecord(r) : null;
}

/** The thread's draft row, sent or not (one per thread). */
export function getDraftForThread(db: Database, accountId: string, threadId: string): DraftRecord | null {
  const r = db.query("SELECT * FROM draft_records WHERE account_id = ? AND thread_id = ?").get(accountId, threadId);
  return r ? toRecord(r) : null;
}

/** The thread's open draft (sent_at IS NULL), or null. */
export function openDraftForThread(db: Database, accountId: string, threadId: string): DraftRecord | null {
  const d = getDraftForThread(db, accountId, threadId);
  return d && d.sentAt === null ? d : null;
}

export interface NewDraft {
  accountId: string;
  threadId: string;
  draftId: string;
  bodyWritten: string;
  answeredMessageRef?: string;
  draftMessageId?: string;
  why?: string | null;
}

/** Records the thread's one draft under a new id. A row already there (a sent draft: create_draft refuses an open one) is
 *  replaced, never joined by a second. */
export function recordDraft(db: Database, d: NewDraft, now = Date.now()): DraftRecord {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, answered_message_ref, draft_message_id,
       updated_at, sent_at, sent_by, id, person_edited, why)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?)
     ON CONFLICT(account_id, thread_id) DO UPDATE SET draft_id = excluded.draft_id, body_written = excluded.body_written,
       answered_message_ref = excluded.answered_message_ref, draft_message_id = excluded.draft_message_id,
       updated_at = excluded.updated_at, sent_at = NULL, sent_by = NULL, id = excluded.id, person_edited = 0, why = excluded.why`,
    [d.accountId, d.threadId, d.draftId, d.bodyWritten, d.answeredMessageRef ?? "", d.draftMessageId ?? "", now, id, d.why ?? null],
  );
  return getDraft(db, id)!;
}

/** The body Gmail now holds for the draft; `personEdited` sets the lock (it is never cleared here). */
export function setDraftBody(db: Database, id: string, bodyWritten: string, opts: { personEdited?: boolean } = {}, now = Date.now()): void {
  db.run(
    `UPDATE draft_records SET body_written = ?, updated_at = ?, person_edited = CASE WHEN ? THEN 1 ELSE person_edited END WHERE id = ?`,
    [bodyWritten, now, opts.personEdited ? 1 : 0, id],
  );
}

/** The person changed the draft outside its card (in Gmail): lock it against the agent. */
export function lockDraft(db: Database, id: string, now = Date.now()): void {
  db.run("UPDATE draft_records SET person_edited = 1, updated_at = ? WHERE id = ?", [now, id]);
}

/** The draft is gone (discarded, or deleted in Gmail): the thread has no draft. */
export function deleteDraft(db: Database, id: string): void {
  db.run("DELETE FROM draft_records WHERE id = ?", [id]);
}

/**
 * The three-way compare (source draftStatus): `gmailBody` is the draft's text in Gmail now, null when Gmail no longer has
 * it. Exact on purpose: both sides come from the gmail skill's one extractor, and a false "untouched" overwrites the
 * person's own writing. When in doubt it reads "person-edited".
 */
export function draftStatus(record: Pick<DraftRecord, "bodyWritten">, gmailBody: string | null | undefined): DraftStatus {
  if (gmailBody === null || gmailBody === undefined) return "missing";
  return gmailBody === record.bodyWritten ? "untouched" : "person-edited";
}
