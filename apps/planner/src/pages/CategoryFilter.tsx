import { useEffect, useRef, useState } from "react";
import { Icon, cx } from "../flock/ui";

export interface FilterOption { id: string; label: string }
interface Props { label: string; value: string; options: FilterOption[]; onChange: (v: string) => void }

/** The Groceries page's one filter (what to show: a status or a category), built from scratch — no native `<select>` (its own dropdown can't be styled and its click
 *  target is only as wide as its text, not the whole pill) and no shared Button/FilterPill. A plain toggle
 *  button opens a row of plain option pills that wraps onto its own line right below the toolbar, in the normal
 *  page flow — nothing floats or overlays, so there's nothing for a popup to clip or mis-position. */
export function CategoryFilter({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div className="pl-catf" ref={ref}>
      <button type="button" className="pl-catf-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((o) => !o)}>
        <span className="pl-catf-lbl">{label}:</span>
        <span className="pl-catf-val">{options.find((o) => o.id === value)?.label ?? value}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
      </button>
      {open ? (
        <div className="pl-catf-opts" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={value === o.id} className={cx("pl-catf-opt", value === o.id && "pl-catf-opt-on")} onClick={() => pick(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
