import { useState } from "react";
import { Button, Confirm, cx } from "../flock/ui";
import { CartSnapshotView } from "./CartSnapshot";
import { serviceLabel, whenSaid } from "./shared";
import { bestOf, otherQuotes, parseSnapshot, quoteSnapshot, type CartV2, type OrderStatus } from "./shopping";

interface Props {
  cart: CartV2 | null; status: OrderStatus;
  /** The next draft's two actions; left out on every other order. */
  onOrder?: (service: string) => Promise<void>; onLetGo?: () => Promise<void>;
  /** Items on this order and the next order's time, for the skip confirmation. */
  itemCount?: number; nextOrderAt?: string | null; today?: string;
}

/** Under an order's heading: its plain-language status; on the next draft, "Order with <best service>" once a quote is
 *  in and "Skip this order" (asks first); the other services' totals; and the cart (the best quote's, or the order's frozen copy). */
export function OrderStatusLine({ cart, status, onOrder, onLetGo, itemCount, nextOrderAt, today }: Props) {
  const [busy, setBusy] = useState(false);
  const [askSkip, setAskSkip] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const best = cart && cart.status === "draft" ? bestOf(cart) : null;
  const shown = cart?.status === "ordered" ? parseSnapshot(cart.snapshot) : best ? quoteSnapshot(best) : null;
  const others = best && cart ? otherQuotes(cart) : "";
  const canAct = cart?.status === "draft" && !cart.yes_at;
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div className="pl-order">
      <div className="pl-order-row">
        {status.text ? <span className={cx("pl-order-text", `pl-order-${status.tone}`)}>{status.text}</span> : null}
        {/* Actions sit together on the right, the primary one last. */}
        <span className="pl-order-actions">
          {shown ? <Button size="sm" variant="ghost" icon={showCart ? "chevron-up" : "chevron-down"} onClick={() => setShowCart(!showCart)}>{showCart ? "Hide cart" : "See cart"}</Button> : null}
          {canAct && onLetGo ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAskSkip(true)}>Skip this order</Button> : null}
          {canAct && best && onOrder ? <Button size="sm" variant="app" loading={busy} onClick={run(() => onOrder(best.service))}>Order with {serviceLabel(best.service)}</Button> : null}
        </span>
      </div>
      {others ? <span className="pl-order-text pl-order-muted">{others}</span> : null}
      {shown && showCart ? <CartSnapshotView snapshot={shown} /> : null}
      {onLetGo ? (
        <Confirm open={askSkip} title="Skip this order?" confirmLabel="Skip order" onCancel={() => setAskSkip(false)}
          onConfirm={() => { setAskSkip(false); void run(onLetGo)(); }}
          body={nextOrderAt && today
            ? `Nothing is ordered now. Items for meals after the next order (${whenSaid(nextOrderAt.slice(0, 10), today)}) move to it; items only needed before then are dropped.`
            : `Nothing is ordered now. ${itemCount ? `Its ${itemCount} item${itemCount === 1 ? "" : "s"} wait` : "Its items wait"} for the next order.`} />
      ) : null}
    </div>
  );
}
