import { useState } from "react";
import { Button } from "../flock/ui";
import { QuickDateOptions } from "./QuickDateOptions";
import { inStockOptionsFor } from "./shared";

export interface ActionBarProps {
  count: number; now: string; category: string | null;
  onAddToCart: () => void; onInStock: (date: string) => void;
  onMarkBought: () => void; onSkip: () => void; onRemove: () => void; onClear: () => void;
}

/** The one place every selected item's (or a whole group's) actions live, so no row or heading needs its own
 *  button. Slides up from the bottom the moment anything is selected. "In stock until" is the one way to push a
 *  purchase out — it never touches the item's own needed-by date, just skips buying it until that date.
 *  `category` is the one shared by every selected row, or null for a mixed selection (falls back to the
 *  pantry-ish default quick picks, same as an item with no category of its own). */
export function ActionBar({ count, now, category, onAddToCart, onInStock, onMarkBought, onSkip, onRemove, onClear }: ActionBarProps) {
  // A plain `menu` (Button's own dropdown) always opens downward — with nowhere below it in a bar fixed to the
  // bottom of the screen, it ran off-screen. Both panels here open upward, above the row, instead.
  const [open, setOpen] = useState<"stock" | "more" | null>(null);
  const toggle = (which: "stock" | "more") => setOpen((o) => (o === which ? null : which));
  if (!count) return null;
  return (
    <div className="pl-bar">
      {open === "stock" ? (
        <div className="pl-bar-panel">
          <QuickDateOptions options={inStockOptionsFor(category, now)} onPick={(date) => { setOpen(null); onInStock(date); }} />
        </div>
      ) : null}
      {open === "more" ? (
        <div className="pl-bar-panel pl-bar-more">
          <Button size="sm" variant="ghost" icon="skip-forward" onClick={() => { setOpen(null); onSkip(); }}>Skip</Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => { setOpen(null); onRemove(); }}>Remove from cart</Button>
        </div>
      ) : null}
      <div className="pl-bar-row" role="toolbar" aria-label="Selected grocery items">
        <span className="pl-bar-count">{count} selected</span>
        <Button size="sm" variant="soft" onClick={onAddToCart}>Add to cart</Button>
        <Button size="sm" variant="soft" icon="check" onClick={onMarkBought}>Mark bought</Button>
        <Button size="sm" variant="ghost" onClick={() => toggle("stock")}>In stock until</Button>
        <Button size="sm" variant="ghost" onClick={() => toggle("more")}>More</Button>
        <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}
