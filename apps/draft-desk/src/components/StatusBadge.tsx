import type { DraftStatus } from "../../shared/types";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/format";

export function StatusBadge({ status }: { status: DraftStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span className="flock-badge" style={{ color, borderColor: color }}>
      {STATUS_LABEL[status]}
    </span>
  );
}
