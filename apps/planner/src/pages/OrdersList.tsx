import { useState } from "react";
import { Button, Empty, ErrorCard, Row, RowList, Skeleton, Stack, Value } from "../flock/ui";
import { addDays, todayStr } from "../../server/dates";
import { ORDER_TONES, orderRow } from "./format";
import { useLive, type CartView } from "./shared";

/** How far back the orders are shown until "Show earlier orders" is pressed. */
const RECENT_DAYS = 30;

/** The Orders tab: each order placed from a cart, newest first, with its app and how it stands (waiting for payment, paid, not
 *  paid, cancelled). */
export function OrdersList() {
  const [from, setFrom] = useState<string | null>(() => addDays(todayStr(), -RECENT_DAYS));
  const list = useLive<{ orders: CartView[] }>(from ? `orders?from=${from}` : "orders", ["orders", "order_lines"]);
  if (list.error && !list.data) return <ErrorCard title="Couldn't load the orders" message={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <Skeleton variant="row" lines={5} />;
  const earlier = from ? <Row justify="end"><Button size="sm" variant="ghost" onClick={() => setFrom(null)}>Show earlier orders</Button></Row> : null;
  const rows = list.data.orders.map((o) => ({ id: o.order_id, ...orderRow(o) }));
  return (
    <Stack gap="sm">
      <RowList rows={rows} rowKey={(r) => r.id} title={(r) => r.title} meta={(r) => r.meta || null}
        trailing={(r) => <Value kind="select" value={r.status} tones={ORDER_TONES} />}
        empty={<Empty title="No orders yet" hint="An order shows here once you tap Order on a cart." object="grocery-bag" />} />
      {earlier}
    </Stack>
  );
}
