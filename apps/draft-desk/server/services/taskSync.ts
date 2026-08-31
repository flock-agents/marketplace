// Task sync — projects a Draft Desk draft onto the platform Task spine (§4, §5, §14.1). Draft Desk
// owns the canonical draft record; the dashboard renders a lightweight, context-carrying
// projection (a `reply-approval` Task) with a deep-link back into the workbench (principle #4).
//
//   draft created / updated (needs_review) → publish/upsert the approval Task
//   draft sent / discarded / deleted       → withdraw the Task + invalidate the approvals widget
//
// The Task carries the DECISION UNIT the user needs to approve without opening the app (principle
// #2, context-gated actions): a preview of the draft, the agent's "why", the recipient, and the
// incoming message it replies to. Its actions are:
//   • Approve & send — script_then_agent, sideEffect: the platform runs the send deterministically
//     via the granted skill mapped from the draft's source (email→gmail, linkedin/​linkedin_comment
//     →linkedin, x→twitter), escalating to the agent only on failure (§9).
//   • Review & edit — a link into the deep workbench for high-stakes / editable cases.
//
// All calls fail soft (platformClient). Sync failures are logged and swallowed so the /api/drafts
// workbench never breaks when the platform edge is unavailable (§3 availability).

import type { ReplyDraft, DraftSource, ThreadMessage } from "../../shared/types";
import type { ActionSpec } from "../../shared/tasks";
import {
  publishTask,
  withdrawTask,
  invalidateApprovalsWidget,
  platformConfigured,
} from "./platformClient";

// The app-relative deep-link into the workbench for a draft (§7.2 deeplink). Hash-routed SPA.
export function draftDeeplink(draftId: string): string {
  return `/a/draft-desk/#/draft/${draftId}`;
}

// Map a draft's source to the granted skill that sends it (§14.1). The platform's action executor
// uses this to run the approved send through the right skill in the paired agent's context.
export function skillForSource(source: DraftSource): "gmail" | "linkedin" | "twitter" {
  switch (source) {
    case "email":
      return "gmail";
    case "linkedin":
    case "linkedin_comment":
      return "linkedin";
    case "x":
      return "twitter";
  }
}

// Human label for the destination, used in the task title/context.
function destinationLabel(source: DraftSource): string {
  switch (source) {
    case "email":
      return "Email";
    case "linkedin":
      return "LinkedIn message";
    case "linkedin_comment":
      return "LinkedIn comment";
    case "x":
      return "X";
  }
}

// The recipient/target address, best-effort from the captured send_target, else the sender name.
function recipientFor(draft: ReplyDraft): string {
  const t = draft.send_target;
  if (t) {
    if (draft.source === "email" && t.email?.to) return t.email.to;
    if (draft.source === "linkedin" && t.linkedin?.profileUrl) return t.linkedin.profileUrl;
    if (draft.source === "linkedin_comment" && t.linkedin_comment?.commenterProfileUrl) {
      return t.linkedin_comment.commenterProfileUrl;
    }
    if (draft.source === "x" && t.x?.handle) return t.x.handle;
  }
  return draft.sender;
}

// The incoming message this draft replies to — the real recent thread messages when captured,
// else the legacy summary. Plain text only (the platform stores context as plain text — §10 T7).
function incomingText(draft: ReplyDraft): string {
  const msgs: ThreadMessage[] | null = draft.thread_messages;
  if (msgs && msgs.length > 0) {
    return msgs.map((m) => `${m.sender}: ${m.text}`).join("\n");
  }
  return draft.thread_summary || "";
}

// Truncate long text for the card preview (the full record lives in the workbench).
function excerpt(text: string, max = 400): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

// Build the two context-gated actions for the approval card (§5.2, §9).
function buildActions(draft: ReplyDraft): ActionSpec[] {
  const skill = skillForSource(draft.source);
  const deeplink = draftDeeplink(draft.id);
  return [
    {
      id: "approve-send",
      label: "Approve & send",
      kind: "primary",
      requiresContext: true,
      sideEffect: true,
      executor: {
        mode: "script_then_agent",
        skill,
        scriptName: "send.sh",
        // The platform resolves <draftId> against the drafts API to perform the send via the
        // skill; kept as a stable, machine-readable arg list.
        args: [skill, "send-draft", draft.id],
        idempotencyKey: `draft-desk:send:${draft.id}`,
        onFailure: "agent",
        agentSeed:
          `The owner approved Draft Desk draft ${draft.id} to send via ${skill}. ` +
          `Open the draft (GET /api/drafts/${draft.id}), send it to the captured recipient, ` +
          `then mark it sent (POST /api/drafts/${draft.id}/sent). If the send fails, ` +
          `report why (POST /api/drafts/${draft.id}/send-failed).`,
      },
    },
    {
      id: "review-edit",
      label: "Review & edit",
      kind: "link",
      executor: { mode: "link", href: deeplink },
    },
  ];
}

// The agent's "why" — a short rationale surfaced on the card. Derived deterministically from the
// draft (the app doesn't invent a rationale; it states what the draft is). Plain text.
function buildWhy(draft: ReplyDraft): string {
  return (
    `Drafted a ${destinationLabel(draft.source).toLowerCase()} reply to ${draft.sender}` +
    (draft.subject ? ` about "${draft.subject}"` : "") +
    `. Approve to send it as written, or open it to edit first.`
  );
}

// A draft is "pending approval" (surfaces as a task) only in needs_review. needs_revision means
// the agent is rewriting (its turn); sending/sent/discarded are past the approval point.
export function isPendingApproval(draft: ReplyDraft): boolean {
  return draft.status === "needs_review";
}

// Publish (upsert) the approval Task for a draft that needs review. No-op (soft) when the platform
// edge is unconfigured. Logs and swallows failures.
export async function syncDraftTask(draft: ReplyDraft): Promise<void> {
  if (!platformConfigured()) return;
  try {
    if (!isPendingApproval(draft)) {
      // Left the approval state — make sure no stale task lingers.
      await withdrawDraftTask(draft.id);
      return;
    }
    const context: Record<string, unknown> = {
      preview: excerpt(draft.draft_body),
      why: buildWhy(draft),
      recipient: recipientFor(draft),
      incoming: excerpt(incomingText(draft), 600),
      destination: destinationLabel(draft.source),
      source: draft.source,
      subject: draft.subject,
    };
    if (draft.source_url) context.sourceUrl = draft.source_url;

    const res = await publishTask({
      sourceRef: draft.id,
      type: "reply-approval",
      title: `Approve ${destinationLabel(draft.source).toLowerCase()} to ${draft.sender}`,
      priority: "normal",
      deeplink: draftDeeplink(draft.id),
      context,
      actions: buildActions(draft),
    });
    if (!res.ok && !("skipped" in res && res.skipped)) {
      console.warn(`[taskSync] publish task failed for ${draft.id}: ${res.reason}`);
    }
    await invalidateApprovalsWidget();
  } catch (err: any) {
    console.warn(`[taskSync] syncDraftTask error for ${draft.id}: ${err?.message}`);
  }
}

// Withdraw the approval Task for a draft (sent / discarded / deleted) and refresh the widget.
export async function withdrawDraftTask(draftId: string): Promise<void> {
  if (!platformConfigured()) return;
  try {
    const res = await withdrawTask(draftId);
    // A 404 (already withdrawn) is benign — only log genuine transport failures.
    if (!res.ok && !("skipped" in res && res.skipped) && res.status !== 404) {
      console.warn(`[taskSync] withdraw task failed for ${draftId}: ${res.reason}`);
    }
    await invalidateApprovalsWidget();
  } catch (err: any) {
    console.warn(`[taskSync] withdrawDraftTask error for ${draftId}: ${err?.message}`);
  }
}
