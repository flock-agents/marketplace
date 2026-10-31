import { useEffect, useState } from "react";
import { cx } from "../flock/ui";
import { serviceLabel, type Cart } from "./shared";
import { rangeText, readinessOf, readinessText, whenShort, type GroceryV2 } from "./shopping";
import { mealReadiness, type MealReadiness } from "./shoppingApi";

/** A meal's chip, only when there is something to tell (see readinessText); with `onOpen`, it links to those items. */
export function ReadinessBadge({ value, onOpen }: { value: ReturnType<typeof readinessText>; onOpen?: (groceryIds: string[]) => void }) {
  if (!value) return null;
  const className = cx("fl-pill", `fl-tone-${value.tone}`, "pl-ready");
  if (!onOpen || !value.ids.length) return <span className={className}>{value.text}</span>;
  return <button type="button" className={cx(className, "pl-ready-link")} onClick={(e) => { e.stopPropagation(); onOpen(value.ids); }}>{value.text} ›</button>;
}

interface Line { name: string; need: string | null; inStock: boolean; status: string }

const localLines = (rows: GroceryV2[], today: string): Line[] => rows.map((r) => ({
  name: r.item, need: rangeText(r),
  inStock: !!r.in_stock_until && r.in_stock_until >= today, status: r.status ?? "pending",
}));
const serverLines = (r: MealReadiness): Line[] | null => r.ingredients?.map((i) => ({ name: i.name, need: i.need ?? null, inStock: !!i.in_stock, status: i.status ?? "pending" })) ?? null;
type CartRef = { status: string; buy_at?: string; order_at?: string | null; chosen_service?: string | null };
/** "Ordered on Zepto", or when the draft covering the meal orders: "Order tomorrow 6:00 PM". */
const cartLine = (c: CartRef, today: string) => {
  if (c.status === "ordered") return `Ordered on ${serviceLabel(c.chosen_service ?? null)}`;
  const at = c.order_at ?? c.buy_at;
  return at ? `Order ${whenShort(at, today)}` : "On the shopping list";
};
const lineState = (l: Line) => (l.inStock ? "In stock" : l.status === "ordered" ? "Bought" : l.status === "skipped" ? "Skipped" : "To buy");

/** Under a tapped meal: its ingredients, which are in stock, and the order covering it. Asks the server
 *  (GET meals/:id/readiness) and shows the meal's own grocery rows until it answers, or if it can't. */
export function MealReadinessPanel({ mealId, rows, carts, today, onOpenGroceries }: { mealId: string; rows: GroceryV2[]; carts: Map<string, Cart>; today: string; onOpenGroceries?: (ids: string[]) => void }) {
  const [remote, setRemote] = useState<MealReadiness | null>(null);
  useEffect(() => {
    let live = true;
    mealReadiness(mealId).then((r) => { if (live) setRemote(r); }).catch(() => { /* the local rows stand in */ });
    return () => { live = false; };
  }, [mealId]);
  const badge = readinessText(remote?.status ?? readinessOf(rows, carts, today), rows, carts, today);
  const lines = (remote && serverLines(remote)) ?? localLines(rows, today);
  const cartId = remote?.cart?.id ?? rows.find((r) => r.cart_id && carts.has(r.cart_id))?.cart_id ?? null;
  const cart = remote?.cart ?? (cartId ? carts.get(cartId) : undefined);
  if (!badge && !cart && !lines.length) return null;
  return (
    <div className="pl-ready-panel">
      {badge || cart ? (
        <div className="pl-ready-head"><ReadinessBadge value={badge} onOpen={onOpenGroceries} />
          {cart ? <span>{cartLine(cart, today)}</span> : null}
        </div>
      ) : null}
      {lines.length ? (
        <ul className="pl-ready-lines">
          {lines.map((l) => <li key={l.name}><span>{l.name}{l.need ? <small> · {l.need}</small> : null}</span><em>{lineState(l)}</em></li>)}
        </ul>
      ) : null}
    </div>
  );
}
