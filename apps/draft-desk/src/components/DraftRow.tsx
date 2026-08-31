import type { KeyboardEvent } from "react";
import type { ReplyDraft } from "../../shared/types";
import { relativeTime } from "../lib/format";
import { OpenOriginalLink } from "./OpenOriginalLink";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";

// The row is a clickable region (not a <button>) so the "Open original" link can nest
// legally. Enter/Space open the draft; the link stops propagation so it opens the thread.
export function DraftRow({ draft, onOpen }: { draft: ReplyDraft; onOpen: (id: string) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(draft.id);
    }
  };

  return (
    <div
      className="draft-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(draft.id)}
      onKeyDown={onKey}
    >
      <div className="main">
        <div className="sender">{draft.sender}</div>
        <div className="subject">{draft.subject}</div>
        <OpenOriginalLink url={draft.source_url} className="row-open" />
      </div>
      <div className="meta">
        <div className="badges">
          <SourceBadge source={draft.source} />
          <StatusBadge status={draft.status} />
        </div>
        <span className="age">{relativeTime(draft.updated_at)}</span>
      </div>
    </div>
  );
}
