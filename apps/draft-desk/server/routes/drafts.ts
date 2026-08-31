import { Hono, type Context } from "hono";
import * as repo from "../repositories/draftRepository";
import * as requests from "../repositories/requestRepository";
import {
  triggerDraftsRequested,
  triggerDraftSend,
  triggerDraftRevision,
} from "../services/agentIntent";
import { syncDraftTask, withdrawDraftTask } from "../services/taskSync";
import { SOURCES } from "../../shared/types";
import type {
  DraftSource,
  DraftStatus,
  ReplyDraft,
  RevisionAuthor,
  SendTarget,
  ThreadMessage,
} from "../../shared/types";

const drafts = new Hono();

const VALID_SOURCES = new Set<string>(SOURCES);
const PATCH_STATUSES = new Set<DraftStatus>(["approved", "needs_review", "discarded"]);
const LIST_STATUSES = new Set<DraftStatus>([
  "needs_review",
  "needs_revision",
  "approved",
  "sending",
  "sent",
  "discarded",
]);

// A draft that has been "sending" longer than this is treated as failed and recovered to
// needs_review (so a hung/dead spawned Milo run can't strand it forever). Checked lazily on
// the read + approve paths — same self-healing pattern as STALE_PENDING_MS for fetch-more.
const SENDING_STALE_MS = 10 * 60 * 1000; // 10 minutes

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Recover any send that has been stuck too long, before we read or act on draft state.
function recoverStaleSends(): void {
  repo.recoverStaleSending(Date.now() - SENDING_STALE_MS);
}

// source_url is optional: a non-empty string permalink, or null when absent/blank.
function normalizeSourceUrl(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// send_target is optional structured data: a plain object (the source's sub-object) or null.
// Anything that isn't a usable object degrades to null so a bad value can't break creation.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeSendTarget(v: unknown): SendTarget | null {
  return isPlainObject(v) ? (v as SendTarget) : null;
}

// thread_messages is optional structured data: the REAL recent messages of the thread. A valid
// value is an array whose every element is a plain object with string `sender` and string `text`.
function isThreadMessageArray(v: unknown): v is ThreadMessage[] {
  return (
    Array.isArray(v) &&
    v.every((m) => isPlainObject(m) && typeof m.sender === "string" && typeof m.text === "string")
  );
}

// Keep only the two known fields per message so callers can't smuggle extra keys into storage.
function normalizeThreadMessages(v: unknown): ThreadMessage[] | null {
  if (!isThreadMessageArray(v)) return null;
  return v.map((m) => ({ sender: m.sender, text: m.text }));
}

// POST /api/drafts — Milo creates a draft after processing ONE thread.
drafts.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);

  const { source, thread_ref, source_url, send_target, sender, subject, thread_summary, thread_messages, draft_body } =
    body;
  if (!VALID_SOURCES.has(source)) {
    return c.json({ error: "source must be one of email | linkedin | linkedin_comment | x" }, 400);
  }
  // thread_summary is no longer required — Milo sends the real thread_messages instead.
  for (const [key, val] of Object.entries({ thread_ref, sender, subject, draft_body })) {
    if (!isNonEmptyString(val)) return c.json({ error: `${key} is required` }, 400);
  }
  if (thread_summary !== undefined && thread_summary !== null && typeof thread_summary !== "string") {
    return c.json({ error: "thread_summary must be a string or null" }, 400);
  }
  if (
    thread_messages !== undefined &&
    thread_messages !== null &&
    !isThreadMessageArray(thread_messages)
  ) {
    return c.json({ error: "thread_messages must be an array of { sender, text }" }, 400);
  }
  if (source_url !== undefined && source_url !== null && typeof source_url !== "string") {
    return c.json({ error: "source_url must be a string or null" }, 400);
  }
  if (send_target !== undefined && send_target !== null && !isPlainObject(send_target)) {
    return c.json({ error: "send_target must be an object or null" }, 400);
  }

  const createInput = {
    source: source as DraftSource,
    thread_ref,
    source_url: normalizeSourceUrl(source_url),
    send_target: normalizeSendTarget(send_target),
    sender,
    subject,
    thread_summary: typeof thread_summary === "string" ? thread_summary : "",
    thread_messages: normalizeThreadMessages(thread_messages),
    draft_body,
  };

  // Dedup guard: a real conversation maps to ONE active draft. thread_ref is display-only and
  // changes per fetch-more run, so we key off the stable conversation identity. If an active
  // draft already covers this thread, return it instead of inserting a duplicate.
  const identity = repo.deriveThreadIdentity(createInput);
  if (identity) {
    const existing = repo.findActiveByThreadIdentity(identity);
    if (existing) {
      // 200 (not 201): nothing was created. Keep the draft fields at the top level for
      // backward compatibility with callers that read them there, and add {duplicate, draft}.
      return c.json({ ...existing, duplicate: true, draft: existing }, 200);
    }
  }

  const draft = repo.createDraft(createInput);
  // Task-native: publish the approval Task for the dashboard (§14.1). Fire-and-forget — the
  // create response never waits on (or fails for) the platform edge.
  void syncDraftTask(draft);
  return c.json({ ...draft, duplicate: false, draft }, 201);
});

// GET /api/drafts/queue — Milo's ONLY work-poll endpoint. Must precede /:id.
drafts.get("/queue", (c) => c.json(repo.listQueue()));

// GET /api/drafts/count — number of drafts awaiting the owner (header badge). Precede /:id.
drafts.get("/count", (c) => {
  recoverStaleSends();
  return c.json({ count: repo.countAwaiting() });
});

// GET /api/drafts/by-url?source_url=<url> — all-status dedup lookup for Milo's social-listening
// flow. Returns every draft whose source_url OR send_target.linkedin_comment.postUrl matches the
// given URL, across ALL statuses (incl. approved/sent/discarded), so Milo can skip a post it has
// already drafted for regardless of what happened to that draft. Read-only. Must precede /:id.
drafts.get("/by-url", (c) => {
  const sourceUrl = c.req.query("source_url");
  if (!isNonEmptyString(sourceUrl)) {
    return c.json({ error: "source_url query parameter is required" }, 400);
  }
  const matches = repo.findByUrlAnyStatus(sourceUrl);
  return c.json({ matches, exists: matches.length > 0 });
});

// A pending fetch-more request only counts as "in flight" for this long. If a triggered
// Milo run hangs or dies without calling /fulfilled, the request would otherwise block the
// button forever — so anything older is auto-expired (self-healing) before we dedupe.
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes

// POST /api/drafts/request-more — owner asks Milo for more drafts. Precede /:id.
// Deduped: if a FRESH fetch is in flight (a DraftRequest is `pending` and newer than
// STALE_PENDING_MS), we return it WITHOUT spawning Milo again — at most one fetch runs at
// a time. Stale pending requests are auto-fulfilled first so a hung Milo run can't deadlock
// the button. Otherwise we create a pending DraftRequest and trigger Milo; if the trigger
// can't fire, the request stays pending (Milo picks it up next run) and we still return 200.
drafts.post("/request-more", async (c) => {
  requests.expireStalePending(Date.now() - STALE_PENDING_MS);

  const pending = requests.listPendingRequests();
  if (pending.length > 0) {
    return c.json({ triggered: false, reason: "already_pending", request: pending[0] });
  }

  const request = requests.createRequest();
  const result = await triggerDraftsRequested();
  const reason = result.triggered ? undefined : result.reason;
  return c.json({ triggered: result.triggered, reason, request });
});

// GET /api/drafts?status=&source= — UI list.
drafts.get("/", (c) => {
  recoverStaleSends();
  const status = c.req.query("status");
  const source = c.req.query("source");
  if (status && !LIST_STATUSES.has(status as DraftStatus)) {
    return c.json({ error: "invalid status filter" }, 400);
  }
  if (source && !VALID_SOURCES.has(source)) {
    return c.json({ error: "invalid source filter" }, 400);
  }
  return c.json(repo.listDrafts({ status: status as DraftStatus | undefined, source }));
});

// GET /api/drafts/:id — full draft + revision history.
drafts.get("/:id", (c) => {
  recoverStaleSends();
  const detail = repo.getDraftDetail(c.req.param("id"));
  if (!detail) return c.json({ error: "draft not found" }, 404);
  return c.json(detail);
});

// DELETE /api/drafts/:id — hard-delete a draft and its revision trail. Distinct from discard
// (a soft terminal status): this purges the rows entirely, so throwaway/test drafts leave no
// residue. Returns { deleted: true, id } on success, 404 if the id doesn't exist.
drafts.delete("/:id", (c) => {
  const draftId = c.req.param("id");
  const deleted = repo.deleteDraft(draftId);
  if (!deleted) return c.json({ error: "draft not found" }, 404);
  // The record is gone — withdraw any approval Task the dashboard still shows for it.
  void withdrawDraftTask(draftId);
  return c.json({ deleted: true, id: draftId });
});

// Approve → send. Event-driven: flips the draft to "sending" and fires a one-shot send intent to
// the paired agent. Idempotent — an already sending/sent draft returns its current state WITHOUT
// re-triggering, so a double-click or retry can never send twice. Only a needs_review draft can be
// approved. This is the WORKBENCH approve path; the dashboard approve runs the Task action instead.
async function approveAndSend(c: Context, draftId: string, existing: ReplyDraft, newBody?: string) {
  // Already in-flight or delivered: never re-trigger a send. Return the current state.
  if (existing.status === "sending" || existing.status === "sent") {
    return c.json(repo.getDraft(draftId));
  }
  // Approvable from needs_review OR discarded (approving a discarded draft restores + sends it).
  if (existing.status !== "needs_review" && existing.status !== "discarded") {
    return c.json({ error: "only a needs_review or discarded draft can be approved" }, 409);
  }

  // Persist a last-second body edit (owner tweaked then approved) before the send begins.
  if (newBody !== undefined && newBody !== existing.draft_body) {
    repo.updateDraft(draftId, { draft_body: newBody, author: "user" });
  }

  // Guarded transition — moves the draft to sending only from needs_review/discarded (no
  // double-send). beginSending also clears any stale system_note so the retry starts clean.
  const sending = repo.beginSending(draftId);
  if (!sending || sending.status !== "sending") {
    return c.json(repo.getDraft(draftId));
  }

  const result = await triggerDraftSend(draftId);
  if (!result.triggered) {
    // Couldn't even start the send — hand the draft straight back for a retry, don't strand it.
    // Reverts to needs_review with a system_note; draft_body + user_comment are untouched.
    const reverted = repo.revertSendToReview(draftId, "Send couldn't start — approve again to retry.");
    // The draft is back to needs_review — re-publish its approval Task so the dashboard reflects it.
    if (reverted) void syncDraftTask(reverted);
    return c.json(reverted);
  }
  // Send is in flight — the draft left needs_review, so withdraw its approval Task from the
  // dashboard (it's no longer a decision awaiting the user).
  void withdrawDraftTask(draftId);
  return c.json(sending);
}

// PATCH /api/drafts/:id — update body and/or status. Approval routes to the send path above.
drafts.patch("/:id", async (c) => {
  const draftId = c.req.param("id");
  recoverStaleSends();
  const existing = repo.getDraft(draftId);
  if (!existing) return c.json({ error: "draft not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);

  if (body.draft_body !== undefined && !isNonEmptyString(body.draft_body)) {
    return c.json({ error: "draft_body must be a non-empty string" }, 400);
  }
  if (body.author !== undefined && body.author !== "milo" && body.author !== "user") {
    return c.json({ error: "author must be milo | user" }, 400);
  }
  if (body.send_target !== undefined && body.send_target !== null && !isPlainObject(body.send_target)) {
    return c.json({ error: "send_target must be an object or null" }, 400);
  }
  if (body.source_url !== undefined && body.source_url !== null && typeof body.source_url !== "string") {
    return c.json({ error: "source_url must be a string or null" }, 400);
  }
  if (
    body.thread_messages !== undefined &&
    body.thread_messages !== null &&
    !isThreadMessageArray(body.thread_messages)
  ) {
    return c.json({ error: "thread_messages must be an array of { sender, text }" }, 400);
  }

  // Approval is an event-driven transition with its own idempotency + trigger logic.
  if (body.status === "approved") {
    return approveAndSend(c, draftId, existing, body.draft_body);
  }

  const changes: {
    draft_body?: string;
    status?: DraftStatus;
    author?: RevisionAuthor;
    send_target?: SendTarget | null;
    source_url?: string | null;
    thread_messages?: ThreadMessage[] | null;
  } = {};
  if (body.draft_body !== undefined) changes.draft_body = body.draft_body;
  if (body.author !== undefined) changes.author = body.author as RevisionAuthor;
  if (body.send_target !== undefined) changes.send_target = normalizeSendTarget(body.send_target);
  if (body.source_url !== undefined) changes.source_url = normalizeSourceUrl(body.source_url);
  if (body.thread_messages !== undefined) changes.thread_messages = normalizeThreadMessages(body.thread_messages);

  if (body.status !== undefined) {
    if (!PATCH_STATUSES.has(body.status)) {
      return c.json({ error: "status must be approved | needs_review | discarded" }, 400);
    }
    changes.status = body.status;
  }

  if (
    changes.draft_body === undefined &&
    changes.status === undefined &&
    changes.send_target === undefined &&
    changes.source_url === undefined &&
    changes.thread_messages === undefined
  ) {
    return c.json({ error: "nothing to update" }, 400);
  }

  // Only `sent` is terminal (immutable). A `discarded` draft is recoverable: it can be edited,
  // restored, or approved. Editing its body implicitly restores it to needs_review with the new
  // text (unless the caller explicitly sets another status), so a saved edit brings it back.
  if (existing.status === "sent") {
    return c.json({ error: "cannot modify a sent draft" }, 409);
  }
  if (existing.status === "discarded" && changes.draft_body !== undefined && changes.status === undefined) {
    changes.status = "needs_review";
  }

  const updated = repo.updateDraft(draftId, changes);
  // Keep the dashboard Task in step with the edit: needs_review → (re)publish, otherwise withdraw.
  if (updated) void syncDraftTask(updated);
  return c.json(updated);
});

// POST /api/drafts/:id/comment — owner requests a revision. Event-driven, mirrors approve→send:
// store the comment (→ needs_revision), then fire a one-shot revise intent to the paired agent.
// Each comment call triggers exactly one revise (a re-comment is an explicit new request and
// re-fires). On a soft-fail the draft is reverted to needs_review with a note so it re-enters
// "awaiting you" rather than sitting in needs_revision with nobody working it.
drafts.post("/:id/comment", async (c) => {
  const draftId = c.req.param("id");
  const existing = repo.getDraft(draftId);
  if (!existing) return c.json({ error: "draft not found" }, 404);
  // Only `sent` is terminal. Commenting on a discarded draft restores it (→ needs_revision).
  if (existing.status === "sent") {
    return c.json({ error: "cannot comment on a sent draft" }, 409);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !isNonEmptyString(body.comment)) {
    return c.json({ error: "comment is required" }, 400);
  }

  const updated = repo.addComment(draftId, body.comment);
  // Moved to needs_revision (the agent's turn) — withdraw the approval Task from the dashboard.
  void withdrawDraftTask(draftId);
  const result = await triggerDraftRevision(draftId);
  if (!result.triggered) {
    // Soft-fail: revert to needs_review with a system_note; user_comment (the owner's request)
    // and draft_body are preserved so the owner can comment again to retry.
    const reverted = repo.revertSendToReview(draftId, "Revision couldn't start — comment again to retry.");
    // Back to needs_review — re-publish the approval Task so the dashboard shows it again.
    if (reverted) void syncDraftTask(reverted);
    return c.json({ draft: reverted, triggered: false, reason: result.reason });
  }
  return c.json({ draft: updated, triggered: true });
});

// POST /api/drafts/:id/restore — bring a discarded draft back to needs_review so it re-enters
// the queue. `discarded` is non-terminal; only `sent` is immutable. A no-op-safe convenience
// alongside PATCH {status:"needs_review"} — rejects anything that isn't currently discarded.
drafts.post("/:id/restore", (c) => {
  const draftId = c.req.param("id");
  const existing = repo.getDraft(draftId);
  if (!existing) return c.json({ error: "draft not found" }, 404);
  if (existing.status !== "discarded") {
    return c.json({ error: "only a discarded draft can be restored" }, 409);
  }
  const restored = repo.updateDraft(draftId, { status: "needs_review" });
  // Back in the queue awaiting the owner — (re)publish its approval Task.
  if (restored) void syncDraftTask(restored);
  return c.json(restored);
});

// POST /api/drafts/:id/sent — the agent marks an item sent after delivery.
drafts.post("/:id/sent", (c) => {
  const draftId = c.req.param("id");
  const existing = repo.getDraft(draftId);
  if (!existing) return c.json({ error: "draft not found" }, 404);
  if (existing.status === "discarded") {
    return c.json({ error: "cannot send a discarded draft" }, 409);
  }
  const sent = repo.markSent(draftId);
  // Terminal — withdraw the approval Task from the dashboard.
  void withdrawDraftTask(draftId);
  return c.json(sent);
});

// POST /api/drafts/:id/send-failed — the agent reports a failed send in ONE call. Returns the
// draft to needs_review with the error recorded, so the owner sees why and can retry.
drafts.post("/:id/send-failed", async (c) => {
  const draftId = c.req.param("id");
  const existing = repo.getDraft(draftId);
  if (!existing) return c.json({ error: "draft not found" }, 404);
  if (existing.status === "sent" || existing.status === "discarded") {
    return c.json({ error: `cannot mark a ${existing.status} draft as failed` }, 409);
  }
  const body = await c.req.json().catch(() => null);
  const reason = body && isNonEmptyString(body.error) ? body.error.trim() : "unknown error";
  const reverted = repo.revertSendToReview(draftId, `Send failed: ${reason} — approve again to retry.`);
  // Back to needs_review — re-publish its approval Task so the owner can retry from the dashboard.
  if (reverted) void syncDraftTask(reverted);
  return c.json(reverted);
});

export default drafts;
