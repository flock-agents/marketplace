import type { DraftSource } from "../../shared/types";
import { SOURCE_ICON, SOURCE_LABEL } from "../lib/format";

export function SourceBadge({ source }: { source: DraftSource }) {
  return (
    <span className="flock-badge" style={{ color: "var(--flock-text-secondary)" }}>
      <span aria-hidden>{SOURCE_ICON[source]}</span>
      {SOURCE_LABEL[source]}
    </span>
  );
}
