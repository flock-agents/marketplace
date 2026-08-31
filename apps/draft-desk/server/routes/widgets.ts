// Widget data endpoint (§7.4). The platform's widget proxy fetches this server-side (with the
// app's own token injected) and renders the returned declarative shape with themed components —
// the app never ships HTML. This is the `approvals` widget declared in flock.app.json
// (widgets[].dataUrl → /api/widgets/approvals).
//
// It projects the pending-approval drafts (needs_review) as a list, with a header stat for the
// count. Each item deep-links into the workbench; the platform overlays the task's approve action
// from the published Task, so the widget itself carries only a "Review" link (the app never
// exposes a send action outside an approved Task — §10 T4).

import { Hono } from "hono";
import * as repo from "../repositories/draftRepository";
import type { WidgetData, WidgetListItem } from "../../shared/tasks";
import type { ReplyDraft, DraftSource } from "../../shared/types";
import { draftDeeplink } from "../services/taskSync";

const widgets = new Hono();

function destinationBadge(source: DraftSource): string {
  switch (source) {
    case "email":
      return "Email";
    case "linkedin":
      return "LinkedIn";
    case "linkedin_comment":
      return "LinkedIn comment";
    case "x":
      return "X";
  }
}

function previewOf(draft: ReplyDraft): string {
  const body = draft.draft_body.trim();
  return body.length > 140 ? body.slice(0, 139) + "…" : body;
}

function toItem(draft: ReplyDraft): WidgetListItem {
  return {
    id: draft.id,
    title: draft.sender,
    subtitle: draft.subject || undefined,
    preview: previewOf(draft),
    badge: destinationBadge(draft.source),
    actions: [
      {
        id: "review",
        label: "Review",
        kind: "link",
        href: draftDeeplink(draft.id),
      },
    ],
  };
}

// GET /api/widgets/approvals — declarative approvals-queue widget data.
widgets.get("/approvals", (c) => {
  const pending = repo.listDrafts({ status: "needs_review" });
  const data: WidgetData = {
    template: "list",
    title: "Drafts awaiting approval",
    stat: { label: "Awaiting you", value: pending.length },
    items: pending.map(toItem),
    emptyText: "No drafts awaiting your approval.",
  };
  return c.json(data);
});

export default widgets;
