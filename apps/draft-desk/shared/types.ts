// Types shared by BOTH src/ (frontend) and server/ (backend).
// This module is the single source of truth for the API contract.

export type DraftSource = "email" | "linkedin" | "linkedin_comment" | "x";

export type DraftStatus =
  | "needs_review"
  | "needs_revision"
  | "approved"
  | "sending"
  | "sent"
  | "discarded";

export type RevisionAuthor = "milo" | "user";

// The EXACT address to deliver a reply to, captured when the draft is created (Milo is
// already inside the thread then). Used for a DIRECT send — no re-searching at send time.
// Every field is optional; only the sub-object for the draft's `source` is populated.
// Old drafts predate this and carry `null` — the send path falls back to locating the thread.
export interface SendTarget {
  linkedin?: { profileUrl?: string; conversationUrl?: string };
  // `commentUrl` is a deep-link permalink to the SPECIFIC comment (so "Open original" lands on the
  // comment, not the feed). `postUrl` is the canonical activity URL — never a bare /feed/.
  linkedin_comment?: { postUrl: string; commentId?: string; commenterProfileUrl?: string; commentUrl?: string };
  email?: { threadId?: string; messageId?: string; to?: string };
  x?: { conversationId?: string; tweetId?: string; handle?: string };
}

// One actual message from the original thread, captured by Milo at draft time. We show the
// REAL recent messages (chronological, oldest→newest, last 3–5) instead of an LLM-written
// summary that could hallucinate context and poison the draft. Nullable — legacy drafts predate
// this and fall back to `thread_summary`.
export interface ThreadMessage {
  sender: string;
  text: string;
}

export interface ReplyDraft {
  id: string;
  source: DraftSource;
  thread_ref: string;
  // Clickable permalink to the original message/thread so the owner can open and read
  // the full thread (e.g. the Gmail/LinkedIn/X URL). Nullable — hidden in the UI when absent.
  source_url: string | null;
  // Exact send address captured at draft time for a direct, search-free send. Nullable —
  // old drafts have null and fall back to locating the thread. See SendTarget.
  send_target: SendTarget | null;
  sender: string;
  subject: string;
  // Legacy LLM-written thread summary. Retained for backward-compat with old drafts, but no
  // longer required on create and no longer the primary context shown — see `thread_messages`.
  // May be an empty string on newer drafts that carry real messages instead.
  thread_summary: string;
  // The ACTUAL last few messages of the original thread (oldest→newest), shown in the UI as the
  // authoritative context. Nullable — legacy drafts have null and fall back to `thread_summary`.
  thread_messages: ThreadMessage[] | null;
  draft_body: string;
  status: DraftStatus;
  // The owner's latest revision request — written ONLY by POST /:id/comment, never by the system.
  user_comment: string | null;
  // A system/status/failure message (e.g. "Send failed — approve again to retry"). Written ONLY
  // by the app, kept separate from user_comment so a status message never overwrites the owner's
  // revision instruction. Surfaced in the UI as a distinct, subtle banner. Nullable.
  system_note: string | null;
  notified_at: number | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

export type DraftRequestStatus = "pending" | "fulfilled";

// A "fetch-more" signal — created when the owner asks for more drafts; Milo fulfills it
// by scanning sources and creating new drafts, then marks it fulfilled.
export interface DraftRequest {
  id: string;
  status: DraftRequestStatus;
  requested_at: number;
  fulfilled_at: number | null;
}

// Response to POST /api/drafts/request-more. `request` is the pending DraftRequest (either
// newly created, or the one already in flight). `reason` explains a non-triggered outcome:
//   - already_pending: a fetch is already running; Milo was NOT re-spawned (dedupe).
//   - no_token / spawn_failed: request stays pending; Milo will pick it up next run.
export interface RequestMoreResponse {
  triggered: boolean;
  reason?: "already_pending" | "no_token" | "spawn_failed";
  request: DraftRequest;
}

export interface DraftRevision {
  id: string;
  draft_id: string;
  author: RevisionAuthor;
  body_snapshot: string | null;
  comment: string | null;
  created_at: number;
}

export interface DraftDetail extends ReplyDraft {
  revisions: DraftRevision[];
}

// --- Request payloads ---

export interface CreateDraftInput {
  source: DraftSource;
  thread_ref: string;
  source_url?: string | null;
  send_target?: SendTarget | null;
  sender: string;
  subject: string;
  // Optional now: Milo SHOULD send `thread_messages` (the real recent messages) instead. When
  // omitted it defaults to an empty string. Kept only for backward-compat with older callers.
  thread_summary?: string;
  // The real recent messages of the thread — the preferred context to capture (see ThreadMessage).
  thread_messages?: ThreadMessage[] | null;
  draft_body: string;
}

export interface PatchDraftInput {
  draft_body?: string;
  status?: Extract<DraftStatus, "approved" | "needs_review" | "discarded">;
  // Who authored a body edit, for the revision trail. Owner UI omits it (defaults to
  // "user"); Milo sets "milo" when it rewrites a draft after a revision request.
  author?: RevisionAuthor;
  // Backfill the exact send address / permalink onto an existing (needs_review) draft.
  // Partial: only the fields provided are written. See SendTarget / ReplyDraft.source_url.
  send_target?: SendTarget | null;
  source_url?: string | null;
  // Backfill the real recent messages onto an existing draft (e.g. migrating a legacy draft off
  // its summary). Partial: only written when provided. See ThreadMessage.
  thread_messages?: ThreadMessage[] | null;
}

export interface CommentInput {
  comment: string;
}

// Response to POST /api/drafts/:id/comment. The comment sets the draft to `needs_revision`
// and fires an event-driven revise spawn (mirrors approve→send). `triggered` reflects whether
// Milo was spawned; on a soft-fail the draft is reverted to `needs_review` (see `reason`) so it
// re-enters "awaiting you" rather than being stranded in `needs_revision` with no one working it.
export interface CommentResponse {
  draft: ReplyDraft;
  triggered: boolean;
  reason?: "no_token" | "spawn_failed";
}

// Body of POST /api/drafts/:id/send-failed — Milo reports why a send failed in ONE call.
// The draft is returned to needs_review with the reason recorded so the owner can retry.
export interface SendFailedInput {
  error: string;
}

export interface AckInput {
  ids: string[];
}

// --- Constants shared with the UI ---

export const SOURCES: DraftSource[] = ["email", "linkedin", "linkedin_comment", "x"];

export const STATUSES: DraftStatus[] = [
  "needs_review",
  "needs_revision",
  "approved",
  "sending",
  "sent",
  "discarded",
];

// Statuses that make up Milo's work queue (revision work only). Sending is event-driven —
// approval triggers a one-shot send-only spawn (the send intent) and never rests as a queued
// "approved" item — so the queue no longer includes it. See docs/design.md "Event-driven send".
export const QUEUE_STATUSES: DraftStatus[] = ["needs_revision"];

// The status that counts as "awaiting the owner" for the header badge.
export const AWAITING_STATUS: DraftStatus = "needs_review";
