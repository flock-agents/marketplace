import { db } from "../db";
import type {
  CreateDraftInput,
  DraftDetail,
  DraftRevision,
  DraftStatus,
  ReplyDraft,
  RevisionAuthor,
  SendTarget,
  ThreadMessage,
} from "../../shared/types";
import { AWAITING_STATUS, QUEUE_STATUSES } from "../../shared/types";
import { id } from "./ids";

// All SQL for drafts + revisions lives here. Routes never touch the db directly.

// send_target and thread_messages are each persisted as a JSON string in a single TEXT column.
// The DB row therefore carries them as strings (or null); ReplyDraft exposes them parsed.
type DraftRow = Omit<ReplyDraft, "send_target" | "thread_messages"> & {
  send_target: string | null;
  thread_messages: string | null;
};

// Parse the stored JSON back into a SendTarget. A malformed/legacy value degrades to null
// rather than throwing — an unusable target simply forces the send path to fall back.
function parseSendTarget(raw: string | null): SendTarget | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SendTarget) : null;
  } catch {
    return null;
  }
}

// Parse the stored JSON back into a ThreadMessage[]. Only well-formed {sender, text} entries are
// kept; a malformed/legacy value degrades to null so the UI falls back to the legacy summary.
function parseThreadMessages(raw: string | null): ThreadMessage[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter(
      (m): m is ThreadMessage =>
        !!m && typeof m === "object" && typeof m.sender === "string" && typeof m.text === "string",
    );
    return messages.length > 0 ? messages : null;
  } catch {
    return null;
  }
}

// Turn a raw DB row into a ReplyDraft with its JSON columns hydrated. Every read path funnels
// through here so callers never see the raw JSON strings.
function hydrate(row: DraftRow | null | undefined): ReplyDraft | null {
  if (!row) return null;
  return {
    ...row,
    send_target: parseSendTarget(row.send_target),
    thread_messages: parseThreadMessages(row.thread_messages),
  };
}

function insertRevision(
  draftId: string,
  author: RevisionAuthor,
  bodySnapshot: string | null,
  comment: string | null,
  at: number,
): void {
  db.query(
    `INSERT INTO draft_revisions (id, draft_id, author, body_snapshot, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id("rev"), draftId, author, bodySnapshot, comment, at);
}

// --- Thread-identity dedup ---
//
// A single real conversation must map to a single ACTIVE draft. thread_ref is NOT a reliable
// key: Milo's fetch-more generates a fresh slug per run for the same thread. The stable key is
// the conversation URL / thread id captured in send_target; source_url (a specific permalink)
// and thread_ref are only weaker fallbacks. See docs/design.md "Thread-identity dedup".

// Drafts still in play. A new message on a sent/discarded thread SHOULD create a fresh draft,
// so those terminal states are deliberately excluded.
const ACTIVE_DEDUP_STATUSES: DraftStatus[] = ["needs_review", "needs_revision", "sending"];

// Trim + strip trailing slashes so ".../thread/X/" and ".../thread/X" compare equal.
function normalizeIdentityValue(v: string): string {
  return v.trim().replace(/\/+$/, "");
}

// A source_url only counts as an identity when it points at ONE specific thread. A generic
// inbox landing (e.g. ".../messaging/" with no thread id) is shared by every conversation and
// would wrongly collapse unrelated drafts — so it is rejected here.
const GENERIC_INBOX_LEAVES = new Set(["messaging", "messages", "inbox", "mail", "chat", "dm", "dms"]);

function isSpecificThreadPermalink(rawUrl: string): boolean {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    // Not a parseable URL — treat the whole string as opaque and usable.
    return normalizeIdentityValue(rawUrl).length > 0;
  }
  const trimmed = path.replace(/\/+$/, "").toLowerCase();
  if (trimmed === "" || trimmed === "/") return false; // bare origin, no thread
  const lastSegment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return !GENERIC_INBOX_LEAVES.has(lastSegment);
}

// Fields needed to identify a thread — satisfied by both CreateDraftInput and ReplyDraft.
type ThreadIdentityInput = Pick<CreateDraftInput, "source" | "send_target" | "source_url" | "thread_ref">;

// The send_target field that identifies a thread, per source. Only the sub-object matching the
// draft's source is ever populated, so this is the authoritative conversation key when present.
function sendTargetKey(input: ThreadIdentityInput): string | null {
  const t = input.send_target;
  if (!t) return null;
  if (input.source === "linkedin") return t.linkedin?.conversationUrl ?? null;
  // A post comment is identified by the stable comment URN (its exact reply target); the post URL
  // is a weaker fallback so two drafts for the same comment still collapse into one active draft.
  if (input.source === "linkedin_comment") return t.linkedin_comment?.commentId ?? t.linkedin_comment?.postUrl ?? null;
  if (input.source === "email") return t.email?.threadId ?? null;
  if (input.source === "x") return t.x?.conversationId ?? null;
  return null;
}

// Derive a stable, kind-tagged thread identity. The kind prefix keeps a thread_ref value from
// ever colliding with a source_url value. Priority: conversation key → specific permalink →
// thread_ref (last resort). Returns null only if nothing usable exists (never expected).
export function deriveThreadIdentity(input: ThreadIdentityInput): string | null {
  const key = sendTargetKey(input);
  if (key && key.trim().length > 0) {
    const kind =
      input.source === "linkedin" ? "li"
      : input.source === "linkedin_comment" ? "lic"
      : input.source === "email" ? "em"
      : "x";
    return `${kind}:${normalizeIdentityValue(key)}`;
  }
  if (input.source_url && isSpecificThreadPermalink(input.source_url)) {
    return `url:${normalizeIdentityValue(input.source_url)}`;
  }
  if (input.thread_ref && input.thread_ref.trim().length > 0) {
    return `ref:${normalizeIdentityValue(input.thread_ref)}`;
  }
  return null;
}

// Find an ACTIVE draft that resolves to the same thread identity, or null. Scans the small
// active set (needs_review/needs_revision/sending) and compares derived identities — no schema
// change needed. Returns the most recently updated match.
export function findActiveByThreadIdentity(identity: string): ReplyDraft | null {
  const placeholders = ACTIVE_DEDUP_STATUSES.map(() => "?").join(", ");
  const rows = db
    .query(`SELECT * FROM drafts WHERE status IN (${placeholders}) ORDER BY updated_at DESC`)
    .all(...ACTIVE_DEDUP_STATUSES) as DraftRow[];
  for (const row of rows) {
    const draft = hydrate(row)!;
    if (deriveThreadIdentity(draft) === identity) return draft;
  }
  return null;
}

// --- All-status URL lookup (social-listening dedup) ---
//
// Unlike findActiveByThreadIdentity (which only guards the small ACTIVE set to keep ONE live
// draft per thread), this answers a different question for Milo's social-listening flow: "have I
// EVER drafted for this post URL, under ANY status — including approved/sent/discarded?" A post
// that was already handled (posted, rejected, or awaiting review) must never be re-drafted, so
// terminal states are deliberately INCLUDED here. Read-only; no schema change.
//
// A post URL can live in either of two places depending on how the draft was created:
//   - source_url — the permalink stored on any draft, or
//   - send_target.linkedin_comment.postUrl — the canonical activity URL of the commented post.
// Both are normalized the same way as normalizeIdentityValue (trim + strip trailing slash) so
// ".../activity/123/" and ".../activity/123" compare equal. Returns every match, newest first.
export function findByUrlAnyStatus(rawUrl: string): ReplyDraft[] {
  const target = normalizeIdentityValue(rawUrl);
  if (target.length === 0) return [];
  const rows = db.query(`SELECT * FROM drafts ORDER BY updated_at DESC`).all() as DraftRow[];
  const matches: ReplyDraft[] = [];
  for (const row of rows) {
    const draft = hydrate(row)!;
    const candidates = [draft.source_url, draft.send_target?.linkedin_comment?.postUrl];
    if (candidates.some((c) => c && normalizeIdentityValue(c) === target)) {
      matches.push(draft);
    }
  }
  return matches;
}

export function createDraft(input: CreateDraftInput): ReplyDraft {
  const now = Date.now();
  const draftId = id("drf");
  const tx = db.transaction(() => {
    db.query(
      `INSERT INTO drafts
        (id, source, thread_ref, source_url, send_target, sender, subject, thread_summary,
         thread_messages, draft_body, status, user_comment, notified_at, created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', NULL, NULL, ?, ?, NULL)`,
    ).run(
      draftId,
      input.source,
      input.thread_ref,
      input.source_url ?? null,
      input.send_target ? JSON.stringify(input.send_target) : null,
      input.sender,
      input.subject,
      // thread_summary is legacy/optional now; keep the NOT NULL column satisfied with "".
      input.thread_summary ?? "",
      input.thread_messages ? JSON.stringify(input.thread_messages) : null,
      input.draft_body,
      now,
      now,
    );
    // Seed the revision trail with Milo's original draft.
    insertRevision(draftId, "milo", input.draft_body, null, now);
  });
  tx();
  return getDraft(draftId)!;
}

export function listDrafts(filters: { status?: DraftStatus; source?: string }): ReplyDraft[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.source) {
    clauses.push("source = ?");
    params.push(filters.source);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM drafts ${where} ORDER BY updated_at DESC`)
    .all(...params) as DraftRow[];
  return rows.map((r) => hydrate(r)!);
}

// Milo's work queue — the ONLY endpoint Milo polls. Excludes parked/needs_review/terminal.
export function listQueue(): ReplyDraft[] {
  const placeholders = QUEUE_STATUSES.map(() => "?").join(", ");
  const rows = db
    .query(`SELECT * FROM drafts WHERE status IN (${placeholders}) ORDER BY updated_at ASC`)
    .all(...QUEUE_STATUSES) as DraftRow[];
  return rows.map((r) => hydrate(r)!);
}

// Count of drafts still awaiting the owner (needs_review) — powers the header badge.
export function countAwaiting(): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM drafts WHERE status = ?`)
    .get(AWAITING_STATUS) as { n: number };
  return row.n;
}

export function getDraft(draftId: string): ReplyDraft | null {
  return hydrate(db.query(`SELECT * FROM drafts WHERE id = ?`).get(draftId) as DraftRow | undefined);
}

export function getRevisions(draftId: string): DraftRevision[] {
  return db
    .query(`SELECT * FROM draft_revisions WHERE draft_id = ? ORDER BY created_at ASC`)
    .all(draftId) as DraftRevision[];
}

export function getDraftDetail(draftId: string): DraftDetail | null {
  const draft = getDraft(draftId);
  if (!draft) return null;
  return { ...draft, revisions: getRevisions(draftId) };
}

// Update draft body, status, and/or send address. A body change snapshots a revision
// authored by `user`. send_target/source_url are partial — only written when provided.
export function updateDraft(
  draftId: string,
  changes: {
    draft_body?: string;
    status?: DraftStatus;
    author?: RevisionAuthor;
    send_target?: SendTarget | null;
    source_url?: string | null;
    thread_messages?: ThreadMessage[] | null;
  },
): ReplyDraft | null {
  const existing = getDraft(draftId);
  if (!existing) return null;
  const now = Date.now();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];

  if (changes.draft_body !== undefined) {
    sets.push("draft_body = ?");
    params.push(changes.draft_body);
  }
  if (changes.status !== undefined) {
    sets.push("status = ?");
    params.push(changes.status);
  }
  // Persist send_target as a JSON string (or null) — same encoding as createDraft.
  if (changes.send_target !== undefined) {
    sets.push("send_target = ?");
    params.push(changes.send_target ? JSON.stringify(changes.send_target) : null);
  }
  if (changes.source_url !== undefined) {
    sets.push("source_url = ?");
    params.push(changes.source_url);
  }
  // Persist thread_messages as a JSON string (or null) — same encoding as createDraft.
  if (changes.thread_messages !== undefined) {
    sets.push("thread_messages = ?");
    params.push(changes.thread_messages ? JSON.stringify(changes.thread_messages) : null);
  }

  const tx = db.transaction(() => {
    params.push(draftId);
    db.query(`UPDATE drafts SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    if (changes.draft_body !== undefined && changes.draft_body !== existing.draft_body) {
      insertRevision(draftId, changes.author ?? "user", changes.draft_body, null, now);
    }
  });
  tx();
  return getDraft(draftId);
}

// Owner requests a revision: store the comment (the ONLY writer of user_comment), flip to
// needs_revision, append a user revision, and clear any stale system_note — a fresh revision
// cycle starts clean. Works from any non-terminal status, including a discarded draft (restore).
export function addComment(draftId: string, comment: string): ReplyDraft | null {
  const existing = getDraft(draftId);
  if (!existing) return null;
  const now = Date.now();
  const tx = db.transaction(() => {
    db.query(
      `UPDATE drafts SET status = 'needs_revision', user_comment = ?, system_note = NULL, updated_at = ? WHERE id = ?`,
    ).run(comment, now, draftId);
    insertRevision(draftId, "user", null, comment, now);
  });
  tx();
  return getDraft(draftId);
}

// Transition an approvable draft into the "sending" state and clear any stale system_note (a
// fresh send attempt starts clean). Guarded in SQL so it ONLY fires from needs_review or a
// discarded draft (approving a discarded draft restores + sends it) — a concurrent/duplicate
// approve finds the row already moved and this no-ops. Callers must check the returned status is
// "sending" before triggering a send.
export function beginSending(draftId: string): ReplyDraft | null {
  const now = Date.now();
  db.query(
    `UPDATE drafts SET status = 'sending', system_note = NULL, updated_at = ?
       WHERE id = ? AND status IN ('needs_review', 'discarded')`,
  ).run(now, draftId);
  return getDraft(draftId);
}

// Return a draft to needs_review after a system failure, with an explanatory note recorded in
// system_note (NEVER user_comment) and a Milo revision for the trail. Used when a send can't
// start, when Milo reports a send failure, when a send goes stale, and when a revise can't start.
// A failure NEVER discards the draft and NEVER touches draft_body or user_comment — the owner's
// edited text and revision instruction are preserved exactly, and they can always retry.
export function revertSendToReview(draftId: string, systemNote: string): ReplyDraft | null {
  const existing = getDraft(draftId);
  if (!existing) return null;
  const now = Date.now();
  const tx = db.transaction(() => {
    db.query(
      `UPDATE drafts SET status = 'needs_review', system_note = ?, updated_at = ? WHERE id = ?`,
    ).run(systemNote, now, draftId);
    insertRevision(draftId, "milo", null, systemNote, now);
  });
  tx();
  return getDraft(draftId);
}

// Self-heal stuck sends: any draft that has been "sending" since before `cutoff` (a ms
// timestamp) is treated as failed and returned to needs_review so the owner can retry,
// rather than being stuck forever if the spawned Milo run hung or died silently.
export function recoverStaleSending(cutoff: number): number {
  const stale = db
    .query(`SELECT id FROM drafts WHERE status = 'sending' AND updated_at <= ?`)
    .all(cutoff) as { id: string }[];
  for (const { id } of stale) {
    revertSendToReview(id, "Sending timed out — approve again to retry.");
  }
  return stale.length;
}

// Hard-delete a draft and every row scoped to it (its revision trail) in one transaction.
// Unlike "discarded" (a soft terminal status), this removes the data entirely — used to purge
// throwaway/test drafts so no residue is left behind. Revisions are removed first, then the
// draft; both share one transaction so a partial delete can never orphan revision rows. Returns
// true if a draft with that id existed and was removed, false if there was nothing to delete
// (the route maps false → 404).
export function deleteDraft(draftId: string): boolean {
  const existing = getDraft(draftId);
  if (!existing) return false;
  const tx = db.transaction(() => {
    db.query(`DELETE FROM draft_revisions WHERE draft_id = ?`).run(draftId);
    db.query(`DELETE FROM drafts WHERE id = ?`).run(draftId);
  });
  tx();
  return true;
}

// The agent marks an item sent after the underlying skill actually delivers it.
export function markSent(draftId: string): ReplyDraft | null {
  const existing = getDraft(draftId);
  if (!existing) return null;
  const now = Date.now();
  db.query(
    `UPDATE drafts SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now, now, draftId);
  return getDraft(draftId);
}
