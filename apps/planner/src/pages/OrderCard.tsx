import { useState } from "react";
import { Button, Card, Confirm, Icon, RowList, formatINR, useChat, useToast } from "../flock/ui";
import { dayLabel } from "../../server/dates";
import { beingPlaced, lineFor, orderHeading, orderMoney, orderWhen } from "./format";
import { send, why, type LineRow, type OrderView } from "./shared";

/** The days an order buys for: "Mon 23 Nov", or "Mon 23 Nov to Tue 24 Nov". An order made for an added item has none. */
const coversText = (o: OrderView): string | null =>
  !o.week_start ? null : o.covers_from === o.covers_to ? `For ${dayLabel(o.covers_from)}` : `For ${dayLabel(o.covers_from)} to ${dayLabel(o.covers_to)}`;
/** The recorded amount when there is one, else "about" the estimate from the lines. */
const moneyText = (o: OrderView): string | null => {
  const m = orderMoney(o);
  return m ? (m.estimate ? `about ${formatINR(m.amount)}` : formatINR(m.amount)) : null;
};
/** Under a line's name: its pack, how much the plan needs of it, and what it is for. */
const lineMeta = (l: LineRow): string => {
  const need = l.amount == null ? null : `needs ${[l.amount, l.unit].filter(Boolean).join(" ")} of ${l.item}`;
  return [l.pack, l.name_on_app ? need ?? l.item : need, lineFor(l), l.product_id ? null : "the product is picked when the order is placed"].filter(Boolean).join(" · ");
};

/** One order: when it is placed and how it stands, what it costs, and its lines. Only a scheduled order changes here: packs
 *  and removals in place, additions through the assistant; not while the assistant is placing it, which is done from the
 *  order as it was read. A placed order can be given up as not paying; the rest are read-only. */
export function OrderCard({ order: o, movedTo, onChanged, onMoved }: { order: OrderView; movedTo?: string; onChanged: () => void; onMoved: (orderId: string, to: string) => void }) {
  const toast = useToast();
  const chat = useChat();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);   // the line being saved, or "order"
  const scheduled = o.status === "scheduled", placed = o.status === "placed";
  const editable = scheduled && !beingPlaced(o);   // the family can still change it here
  const failed = (e: unknown) => toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" });

  const setQty = async (l: LineRow, qty: number) => {
    setBusy(l.id);
    // Packs set by the family are checked packs: the assistant does not work them out again when it places the order.
    try { await send(`_data/order_lines/${l.id}`, { qty, qty_checked: 1 }, "PATCH"); onChanged(); } catch (e) { failed(e); } finally { setBusy(null); }
  };
  const removeLine = async (l: LineRow) => {
    setBusy(l.id);
    try {
      const out = await send<{ changeId?: string } | null>(`_data/order_lines/${l.id}`, {}, "DELETE");
      onChanged();
      const changeId = out?.changeId;
      toast.show({ message: `Took ${l.name_on_app ?? l.item} off the order`, tone: "success",
        action: changeId ? { label: "Undo", onClick: () => { void send(`_data/_changes/${changeId}/undo`).then(onChanged, failed); } } : undefined });
    } catch (e) { failed(e); } finally { setBusy(null); }
  };
  /** Cancel a scheduled order; give up a placed one as not paid, whose items then move to the next order. */
  const cancel = async () => {
    setAsking(false); setBusy("order");
    try {
      const out = await send<{ rolled_into?: OrderView | null }>(`orders/${o.id}/cancel`);
      onChanged();
      if (!placed) toast.show({ message: "Order cancelled", tone: "success" });
      else if (out.rolled_into) { onMoved(o.id, orderWhen(out.rolled_into)); toast.show({ message: `Not paid. Its items moved to the order of ${orderWhen(out.rolled_into)}`, tone: "success" }); }
      else toast.show({ message: "Not paid. There is no later order for its items.", tone: "success" });
    } catch (e) { failed(e); } finally { setBusy(null); }
  };

  return (
    <Card
      title={orderHeading(o)}
      meta={[coversText(o), moneyText(o), o.note].filter(Boolean).join(" · ") || undefined}
      actions={scheduled ? (
        <>
          {chat.available ? <Button size="sm" variant="soft" icon="plus" onClick={() => chat.openChat({ message: `Add to ${dayLabel(o.place_at.slice(0, 10))}'s order: `, send: false })}>Add</Button>
            : <span className="pl-quiet">To add something, tell the assistant.</span>}
          {editable ? <Button size="sm" variant="ghost" icon="x" loading={busy === "order"} onClick={() => setAsking(true)}>Cancel order</Button> : null}
        </>
      ) : placed ? <Button size="sm" variant="ghost" loading={busy === "order"} onClick={() => setAsking(true)}>Not paying</Button> : undefined}
    >
      <div className="pl-lines">
      <RowList
        rows={o.lines}
        title={(l) => l.name_on_app ?? l.item}
        meta={(l) => lineMeta(l) || null}
        trailing={(l) => (
          <>
            {l.price == null ? null : <span className="pl-price">{formatINR(l.price)}</span>}
            {editable ? (
              <>
                <span className="pl-stepper">
                  <button type="button" aria-label={`One less of ${l.item}`} disabled={busy === l.id || (l.qty ?? 1) <= 1} onClick={() => void setQty(l, (l.qty ?? 1) - 1)}><Icon name="minus" size={14} /></button>
                  <span aria-label={`${l.qty ?? 1} of ${l.item}`}>{l.qty ?? 1}</span>
                  <button type="button" aria-label={`One more of ${l.item}`} disabled={busy === l.id} onClick={() => void setQty(l, (l.qty ?? 1) + 1)}><Icon name="plus" size={14} /></button>
                </span>
                <Button size="sm" variant="ghost" icon="trash" disabled={busy === l.id} onClick={() => void removeLine(l)}>Remove</Button>
              </>
            ) : <span className="pl-quiet">× {l.qty ?? 1}</span>}
          </>
        )}
        empty={<p className="pl-quiet">{o.status === "not_paid" ? `Its items moved to ${movedTo ? `the order of ${movedTo}` : "the next order"}.` : "Nothing is on this order."}</p>}
      />
      </div>
      {scheduled && o.skipped_items.length ? <p className="pl-quiet">Left off because you have it at home: {o.skipped_items.join(", ")}.</p> : null}
      <Confirm
        open={asking}
        title={placed ? "Not paying for this order?" : "Cancel this order?"}
        body={placed ? "This order will not be paid. Its items move to the next order, when there is one." : "It will not be placed, and nothing on it is bought."}
        confirmLabel={placed ? "Not paying" : "Yes, cancel the order"} tone="danger" onConfirm={() => void cancel()} onCancel={() => setAsking(false)}
      />
    </Card>
  );
}
