import type { DraftSource, DraftStatus } from "../../shared/types";
import { SOURCE_LABEL, STATUS_FILTERS } from "../lib/format";

export interface FilterState {
  status: DraftStatus | "";
  source: DraftSource | "";
}

const SOURCE_FILTERS: { label: string; value: DraftSource | "" }[] = [
  { label: "All", value: "" },
  { label: SOURCE_LABEL.email, value: "email" },
  { label: SOURCE_LABEL.linkedin, value: "linkedin" },
  { label: SOURCE_LABEL.linkedin_comment, value: "linkedin_comment" },
  { label: SOURCE_LABEL.x, value: "x" },
];

export function Filters({
  value,
  onChange,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
}) {
  return (
    <div className="filters">
      <div className="filter-row">
        <span className="filter-label">Status</span>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            className={`seg ${value.status === f.value ? "active" : ""}`}
            onClick={() => onChange({ ...value, status: f.value })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <span className="filter-label">Source</span>
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            className={`seg ${value.source === f.value ? "active" : ""}`}
            onClick={() => onChange({ ...value, source: f.value })}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
