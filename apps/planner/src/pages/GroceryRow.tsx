import { useEffect, useRef } from "react";
import { Button, InlinePanel, cx } from "../flock/ui";
import { inStockOptionsFor, whenSaid } from "./shared";
import { rangeText, type GroceryV2 } from "./shopping";
import { TriCheckbox } from "./GroupHeading";
import { QuickDateOptions } from "./QuickDateOptions";

/** The small status word at the end of a row: derived from the row's own status/in_stock_until, never a field of
 *  its own. */
function chip(r: GroceryV2, now: string): { label: string; tone: "neutral" | "info" | "success" | "muted" } | null {
  const status = r.status ?? "pending";
  if (status === "ordered") return { label: "Ordered", tone: "success" };
  if (status === "skipped") return { label: "Skipped", tone: "muted" };
  if (r.in_stock_until && r.in_stock_until > now) return { label: `In stock till ${whenSaid(r.in_stock_until, now)}`, tone: "muted" };
  // An item still to buy needs no chip: being on the list says it.
  return status === "confirmed" ? { label: "In cart", tone: "info" } : null;
}

interface Props {
  row: GroceryV2; now: string; mealLabel?: string | null; selected: boolean; onToggleSelect: () => void;
  expanded: boolean; onToggleExpand: () => void;
  /** Opened from a meal's "Need …" chip: highlighted, and the first one scrolled into view. */
  focused?: boolean;
  onMarkBought: () => void; onInStock: (date: string) => void; onSkip: () => void;
}

/** One grocery item: a checkbox (selection, for the bulk action bar), its name (tap opens the quick-action panel
 *  below), its rough range and meal meta line, and its status chip. No other button lives on the row itself —
 *  marking just this one item bought lives in that panel too, so it never needs the bulk bar at the bottom. */
export function GroceryRow({ row, now, mealLabel, selected, onToggleSelect, expanded, onToggleExpand, focused, onMarkBought, onInStock, onSkip }: Props) {
  const c = chip(row, now);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused && expanded) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focused, expanded]);
  // The rough range to buy and the meal it is for; a staple or manual item says when it is needed instead.
  const forWhat = mealLabel ? `For ${mealLabel}${row.for_dish ? ` (${row.for_dish})` : ""}` : row.for_dish ? `For ${row.for_dish}` : row.needed_by ? `Needed ${whenSaid(row.needed_by, now)}` : null;
  const meta = [rangeText(row), forWhat].filter(Boolean).join(" · ");
  return (
    <div ref={ref} className={cx("pl-row", focused && "pl-row-focus")} data-fl-inline>
      <div className={cx("pl-row-main", row.status === "ordered" && "pl-row-done")}>
        <TriCheckbox state={selected ? "all" : "none"} onToggle={onToggleSelect} label={`Select ${row.item}`} />
        <button type="button" className="pl-row-name" aria-expanded={expanded} onClick={onToggleExpand}>
          <span>{row.item}</span>
          {meta ? <small>{meta}</small> : null}
        </button>
        {c ? <span className={cx("fl-pill", `fl-tone-${c.tone}`, "pl-row-chip")}>{c.label}</span> : null}
      </div>
      {expanded ? (
        <InlinePanel label={`Quick actions for ${row.item}`} onClose={onToggleExpand}>
          <div className="pl-row-panel">
            <Button size="sm" variant="soft" icon="check" onClick={onMarkBought}>Mark bought</Button>
            <div className="pl-row-panel-sec">
              <span className="pl-row-panel-lbl">Already have it, until</span>
              <QuickDateOptions options={inStockOptionsFor(row.category, now)} onPick={onInStock} />
            </div>
            <Button size="sm" variant="ghost" icon="skip-forward" onClick={onSkip}>Skip this item</Button>
          </div>
        </InlinePanel>
      ) : null}
    </div>
  );
}
