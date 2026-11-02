import { Icon, cx } from "../flock/ui";

export type TriState = "none" | "some" | "all";

/** Reuses the Checklist's own `.fl-cbx`/`.fl-check-done` look (so it matches the item rows below it) for a
 *  checkbox that can also show "some of these are picked", which Checklist itself never needs. */
export function TriCheckbox({ state, onToggle, label }: { state: TriState; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={state === "some" ? "mixed" : state === "all"} aria-label={label}
      className={cx("fl-check", "pl-tri-cbx", state !== "none" && "fl-check-done")}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <span className="fl-cbx" aria-hidden><Icon name={state === "some" ? "minus" : "check"} size={13} /></span>
    </button>
  );
}

/** One heading line, for a cart (order) group or a category/date subgroup inside it: a checkbox that selects the
 *  whole group, the group's own info (never a button — everything actionable lives in the bulk action bar), and
 *  an optional collapse toggle for a cart already ordered or skipped. */
export function GroupHeading({ title, state, onToggleAll, collapsible, collapsed, onToggleCollapse, size = "md" }: {
  title: string; state: TriState; onToggleAll: () => void;
  collapsible?: boolean; collapsed?: boolean; onToggleCollapse?: () => void; size?: "md" | "sm";
}) {
  return (
    <div className={cx("pl-grp-h", size === "sm" && "pl-grp-h-sm", collapsible && "pl-grp-h-collapsible")}
      onClick={collapsible ? onToggleCollapse : undefined} role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined} aria-expanded={collapsible ? !collapsed : undefined}
      onKeyDown={collapsible ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleCollapse?.(); } } : undefined}>
      <TriCheckbox state={state} onToggle={onToggleAll} label={`Select all · ${title}`} />
      <span className="pl-grp-h-title">{title}</span>
      {collapsible ? <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={16} /> : null}
    </div>
  );
}
