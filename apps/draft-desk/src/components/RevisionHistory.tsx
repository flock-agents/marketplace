import type { DraftRevision, RevisionAuthor } from "../../shared/types";
import { relativeTime } from "../lib/format";

// Map the STORED author discriminator to a display label. The stored value stays stable ("milo" is
// the legacy agent-author enum, also the CSS hook), but it is never shown raw: an agent-authored
// revision renders the paired agent's real name (falling back to "Agent" — never "milo" — when the
// name is unknown, incl. legacy rows on an unpaired app), and "user" renders as "You".
function authorLabel(author: RevisionAuthor, agentName: string | null): string {
  if (author === "user") return "You";
  return agentName ?? "Agent";
}

export function RevisionHistory({
  revisions,
  agentName,
}: {
  revisions: DraftRevision[];
  // The paired agent's display name, or null when unknown/unpaired (→ neutral "Agent").
  agentName: string | null;
}) {
  if (revisions.length === 0) return null;
  return (
    <div className="history">
      <div className="section-label">Revision history</div>
      {revisions.map((rev) => (
        <div className="rev" key={rev.id}>
          {/* CSS class stays keyed to the STORED author value; the visible text is the mapped label. */}
          <span className={`who ${rev.author}`}>{authorLabel(rev.author, agentName)}</span>
          <div className="body">
            {rev.comment ? <em>“{rev.comment}”</em> : rev.body_snapshot}
          </div>
          <span className="when">{relativeTime(rev.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
