import { useEffect, useState } from "react";
import type { DraftDetail as DraftDetailData, ReplyDraft, SendTarget } from "../../shared/types";
import { api } from "../lib/api";
import { SOURCE_LABEL } from "../lib/format";
import { OpenOriginalLink } from "./OpenOriginalLink";
import { RevisionHistory } from "./RevisionHistory";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";

// Only `sent` is immutable. `discarded` is recoverable — its editor stays UNLOCKED so the owner
// can edit, restore, or approve it — so it is deliberately NOT in this set.
const TERMINAL = new Set(["sent"]);

// A bare LinkedIn feed URL is useless as an "original" link — treat it (and empty strings) as
// absent so the button hides rather than dumping the owner on their feed.
function isUsableOriginal(url: string | null | undefined): url is string {
  if (!url || !url.trim()) return false;
  return !/^https?:\/\/(www\.)?linkedin\.com\/feed\/?(?:$|[?#])/i.test(url.trim());
}

// Prefer the exact conversation/post permalink captured in send_target over the generic
// source_url, so "Open original ↗" lands on the specific thread/post/comment when we have it.
// For a post comment: commentUrl (deep-links to THAT comment) → a comment-scoped source_url →
// the canonical activity postUrl (never a bare /feed/) → source_url. Any bare-feed candidate is
// rejected so the button hides instead of misleading.
function openOriginalUrl(sendTarget: SendTarget | null, sourceUrl: string | null): string | null {
  const c = sendTarget?.linkedin_comment;
  if (c) {
    const candidates = [c.commentUrl, sourceUrl, c.postUrl];
    const usable = candidates.find(isUsableOriginal);
    return usable ?? null;
  }
  const generic = [sendTarget?.linkedin?.conversationUrl, sourceUrl].find(isUsableOriginal);
  return generic ?? null;
}

// While the agent is working — a send in flight (`sending`) or a revision in flight
// (`needs_revision`) — we poll the draft until it resolves back to a state the owner acts on.
// The server self-heals a stuck send after ~10 min; the cap is a backstop so the interval can't
// outlive a genuinely wedged tab.
const WORK_POLL_MS = 3000;
const MAX_WORK_POLLS = 240; // ~12 min backstop

export function DraftDetail({
  id,
  onBack,
  onToast,
  onError,
}: {
  id: string;
  onBack: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<DraftDetailData | null>(null);
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .getDraft(id)
      .then((d) => {
        setDraft(d);
        setBody(d.draft_body);
      })
      .catch((e) => onError(e.message));
  };

  // Adopt a mutation's OWN response as the authoritative state for the fields it changed, so the
  // just-saved text is what the UI shows immediately — no dependence on a follow-up GET that could
  // lag. The PATCH returns a ReplyDraft (no revisions); merge it over the current detail to keep
  // the revision trail, then sync the editor and bodyChanged baseline to the saved body.
  const applyUpdated = (updated: ReplyDraft) => {
    setDraft((prev) => (prev ? { ...prev, ...updated } : prev));
    setBody(updated.draft_body);
  };

  useEffect(load, [id]);

  // Poll while the agent is working, until the draft resolves: a send flips to "sent" (success) or
  // back to "needs_review" (failure); a revision flips from "needs_revision" back to
  // "needs_review" with the agent's rewritten body. Either way the owner-actionable state ends the poll.
  useEffect(() => {
    if (draft?.status !== "sending" && draft?.status !== "needs_revision") return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      load();
      if (polls >= MAX_WORK_POLLS) clearInterval(timer);
    }, WORK_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.status]);

  if (!draft) return <div className="loading">Loading…</div>;

  const isSending = draft.status === "sending";
  // needs_revision means the agent is actively rewriting — it's the agent's turn, not the owner's, so we
  // lock the card and show a "revising…" indicator until the new draft lands (back to needs_review).
  const isRevising = draft.status === "needs_revision";
  const isDiscarded = draft.status === "discarded";
  const inFlight = isSending || isRevising;
  const locked = TERMINAL.has(draft.status) || inFlight;
  const bodyChanged = body.trim() !== draft.draft_body.trim();
  // Show status notes everywhere except mid-send (transient) and on a delivered draft.
  const showNotes = !isSending && draft.status !== "sent";

  const run = async (fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      if (successMsg) onToast(successMsg);
      load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = () =>
    run(async () => {
      const updated = await api.patchDraft(id, { draft_body: body });
      applyUpdated(updated);
    }, "Edits saved");

  // Send EXACTLY what's in the draft field: one atomic PATCH that always carries the current body.
  // The backend persists this draft_body (last-second edit) before it begins sending, so the field
  // text is authoritative regardless of any prior save state — no bodyChanged gamble.
  const approveAndSend = () =>
    run(() => api.patchDraft(id, { status: "approved", draft_body: body }), "Approved — sending now…");

  const requestRevision = () =>
    run(async () => {
      const res = await api.comment(id, { comment });
      setComment("");
      onToast(
        res.triggered
          ? "Sent to your agent — revising now…"
          : "Saved your comment, but your agent couldn't be reached — add it again to retry.",
      );
    }, "");

  const discard = () =>
    run(() => api.patchDraft(id, { status: "discarded" }), "Draft discarded");

  const restore = () =>
    run(async () => {
      const updated = await api.restore(id);
      applyUpdated(updated);
    }, "Draft restored — back in your queue");

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>
        ← Back to queue
      </button>

      <header className="detail-head">
        <div className="badges">
          <SourceBadge source={draft.source} />
          <StatusBadge status={draft.status} />
        </div>
        <h2>{draft.subject}</h2>
        <div className="from-row">
          <span className="from">
            {SOURCE_LABEL[draft.source]} · from <strong>{draft.sender}</strong>
          </span>
          <OpenOriginalLink url={openOriginalUrl(draft.send_target, draft.source_url)} />
        </div>
      </header>

      {/* Thread context — the ACTUAL last few messages/comments, read-only and visually
          distinct from the editable draft below. Falls back to the legacy summary (older drafts)
          or a subtle placeholder when neither is present. */}
      <section className="context-card">
        <div className="card-label">
          {draft.source === "linkedin_comment" ? "Post comments" : "Recent messages"}
        </div>
        {draft.thread_messages && draft.thread_messages.length > 0 ? (
          <div className="thread-messages">
            {draft.thread_messages.map((msg, i) => (
              <div className="thread-message" key={i}>
                <div className="msg-sender">{msg.sender}</div>
                <div className="msg-text">{msg.text}</div>
              </div>
            ))}
          </div>
        ) : draft.thread_summary ? (
          <p className="thread-summary">{draft.thread_summary}</p>
        ) : (
          <p className="thread-empty">No thread preview</p>
        )}
        <div className="thread-ref-row">
          <span className="thread-ref-label">Thread reference</span>
          <code className="thread-ref">{draft.thread_ref}</code>
        </div>
      </section>

      {/* A subtle notice when viewing a recoverable, discarded draft. */}
      {isDiscarded && (
        <div className="note-banner discarded-note">
          This draft was discarded — you can restore, edit, or approve it.
        </div>
      )}

      {/* The owner's OWN revision request — distinct from any system/status message below. */}
      {draft.user_comment && showNotes && (
        <div className="note-banner comment-note">
          <span className="note-label">Your revision request</span>
          {draft.user_comment}
        </div>
      )}

      {/* A system/status message (e.g. a send/revise failure). Never the owner's text. */}
      {draft.system_note && showNotes && (
        <div className="note-banner system-note">
          <span className="note-label">System</span>
          {draft.system_note}
        </div>
      )}

      {/* Editable draft — the thing the owner acts on. */}
      <section className="draft-card">
        <div className="card-label accent">
          {draft.source === "linkedin_comment" ? "Your comment draft" : "Your draft"}{" "}
          {isSending ? "(sending…)" : isRevising ? "(agent revising…)" : locked ? "" : "(editable)"}
        </div>
        <textarea
          className="flock-input draft-editor"
          value={body}
          disabled={locked || busy}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your draft…"
        />

        {isSending && (
          <div className="action-bar sending-bar">
            <span className="sending-note">Sending… your agent is delivering this draft.</span>
          </div>
        )}

        {isRevising && (
          <div className="action-bar sending-bar">
            <span className="sending-note">
              Your agent's revising… this updates automatically when the new draft is ready.
            </span>
          </div>
        )}

        {!locked && (
          <div className="action-bar">
            <button
              className="flock-btn flock-btn-primary"
              disabled={busy}
              onClick={approveAndSend}
            >
              Approve &amp; send
            </button>
            <button
              className="flock-btn"
              disabled={busy || !bodyChanged}
              onClick={saveEdits}
            >
              Save edits
            </button>
            <span className="spacer" />
            {isDiscarded ? (
              <button className="flock-btn flock-btn-ghost" disabled={busy} onClick={restore}>
                Restore
              </button>
            ) : (
              <button className="flock-btn flock-btn-ghost" disabled={busy} onClick={discard}>
                Discard
              </button>
            )}
          </div>
        )}
      </section>

      {!locked && (
        <section className="comment-card">
          <div className="card-label">Request a revision from your agent</div>
          <textarea
            className="flock-input comment-editor"
            placeholder="e.g. warmer tone, push the meeting to Friday"
            value={comment}
            disabled={busy}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="action-bar">
            <button
              className="flock-btn"
              disabled={busy || comment.trim().length === 0}
              onClick={requestRevision}
            >
              Add comment / request revision
            </button>
          </div>
        </section>
      )}

      <RevisionHistory revisions={draft.revisions} />
    </div>
  );
}
