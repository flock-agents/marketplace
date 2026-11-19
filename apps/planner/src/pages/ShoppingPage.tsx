import { useState } from "react";
import { Button, Empty, ErrorCard, Page, Row, Skeleton, Tabs, label } from "../flock/ui";
import { addDays, todayStr } from "../../server/dates";
import { EverydayItems } from "./EverydayItems";
import { OrderCard } from "./OrderCard";
import { useLive, type OrderView } from "./shared";

const TABS = [{ id: "orders", label: "Orders" }, { id: "everyday", label: "Everyday items" }];
/** How far back the orders are shown until "Show earlier orders" is pressed. */
const RECENT_DAYS = 30;

/** Shopping: the grocery orders, and the everyday items every order carries. */
export function ShoppingPage() {
  const [tab, setTab] = useState("orders");
  return (
    <Page title={label("title.shopping", "Shopping")} subtitle={tab === "orders" ? "Each order is placed on its own at its time; change the scheduled ones here" : "Bought again and again, whatever is cooked"}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "orders" ? <Orders /> : <EverydayItems />}
    </Page>
  );
}

function Orders() {
  const [from, setFrom] = useState<string | null>(() => addDays(todayStr(), -RECENT_DAYS));
  const list = useLive<{ orders: OrderView[] }>(from ? `orders?from=${from}` : "orders", ["orders", "order_lines"]);
  // Where an unpaid order's items went, for as long as the page is open: the order itself keeps no trace of it.
  const [moved, setMoved] = useState<Record<string, string>>({});
  if (list.error && !list.data) return <ErrorCard title="Couldn't load the orders" message={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <Skeleton variant="card" lines={5} />;
  const earlier = from ? <Row justify="end"><Button size="sm" variant="ghost" onClick={() => setFrom(null)}>Show earlier orders</Button></Row> : null;
  if (!list.data.orders.length) return <><Empty title="No orders yet" hint="Orders are made when a week's plan is final. Ask the assistant to plan the week." object="grocery-bag" />{earlier}</>;
  return (
    <>
      {list.data.orders.map((o) => (
        <OrderCard key={o.id} order={o} movedTo={moved[o.id]} onChanged={() => void list.refetch()} onMoved={(id, to) => setMoved((m) => ({ ...m, [id]: to }))} />
      ))}
      {earlier}
    </>
  );
}
