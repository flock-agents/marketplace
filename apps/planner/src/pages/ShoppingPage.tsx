import { useState } from "react";
import { Page, Tabs, label } from "../flock/ui";
import { CartPanel } from "./CartPanel";
import { OrdersList } from "./OrdersList";
import { useLive, type CartView } from "./shared";

/** Shopping: the cart of each app, filled by the reminders and the chat, and the orders placed from them. */
export function ShoppingPage() {
  const [tab, setTab] = useState("cart");
  const carts = useLive<{ carts: CartView[] }>("carts", ["orders", "order_lines"]);
  const picked = (carts.data?.carts ?? []).filter((c) => c.status === "open").reduce((n, c) => n + c.lines.filter((l) => (l.qty ?? 0) > 0).length, 0);
  const tabs = [{ id: "cart", label: "Cart", count: picked || undefined }, { id: "orders", label: "Orders" }];
  return (
    <Page title={label("title.shopping", "Shopping")}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "cart" ? <CartPanel carts={carts} /> : <OrdersList />}
    </Page>
  );
}
