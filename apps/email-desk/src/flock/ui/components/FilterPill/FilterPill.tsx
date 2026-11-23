import "./filter.css";
import { Icon } from "../Icon/Icon";
export interface FilterPillProps { label: string; options: string[]; value: string | null; onChange: (v: string | null) => void }
export function FilterPill({ label, options, value, onChange }: FilterPillProps) {
  return (
    <label className="fl-drop">
      <span className="fl-drop-label">{label}:</span>
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <Icon name="chevron-down" size={14} />
    </label>
  );
}
