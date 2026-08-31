import type { DraftRevision } from "../../shared/types";
import { relativeTime } from "../lib/format";

export function RevisionHistory({ revisions }: { revisions: DraftRevision[] }) {
  if (revisions.length === 0) return null;
  return (
    <div className="history">
      <div className="section-label">Revision history</div>
      {revisions.map((rev) => (
        <div className="rev" key={rev.id}>
          <span className={`who ${rev.author}`}>{rev.author}</span>
          <div className="body">
            {rev.comment ? <em>“{rev.comment}”</em> : rev.body_snapshot}
          </div>
          <span className="when">{relativeTime(rev.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
