import type { DraftSource, DraftStatus } from "../../shared/types";

export const STATUS_LABEL: Record<DraftStatus, string> = {
  needs_review: "Needs review",
  needs_revision: "Awaiting agent",
  approved: "Approved · sending",
  sending: "Sending",
  sent: "Sent",
  discarded: "Discarded",
};

// Maps a status to a Flock theme color token used for badge tinting.
export const STATUS_COLOR: Record<DraftStatus, string> = {
  needs_review: "var(--flock-warning)",
  needs_revision: "var(--flock-info)",
  approved: "var(--flock-accent)",
  sending: "var(--flock-accent)",
  sent: "var(--flock-success)",
  discarded: "var(--flock-text-muted)",
};

export const SOURCE_LABEL: Record<DraftSource, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  linkedin_comment: "LinkedIn Post",
  x: "X",
};

export const SOURCE_ICON: Record<DraftSource, string> = {
  email: "✉️",
  linkedin: "in",
  linkedin_comment: "💬",
  x: "𝕏",
};

// UI filter groupings — "Awaiting agent" folds the two agent-action statuses together.
export const STATUS_FILTERS: { label: string; value: DraftStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Needs review", value: "needs_review" },
  { label: "Awaiting agent", value: "needs_revision" },
  { label: "Sending", value: "sending" },
  { label: "Sent", value: "sent" },
  { label: "Discarded", value: "discarded" },
];

export function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
