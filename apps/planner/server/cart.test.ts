// Carts: one open cart per app, filled by the agent, the reminder and her taps; ordered only on her yes; recorded placed, paid
// or not paid; and the app's real cart kept in step through a debounced sync-cart ask. Today is pinned: Saturday 21 Nov 2026,
// noon; a test moves the clock with `at`.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { items as itemsTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { setLine } from "./cart";

const TODAY = "2026-11-21";
const start = async (opts: { askAgent?: (intent: string, payload: object) => Promise<unknown> } = {}) => {
  let t = new Date(2026, 10, 21, 12).getTime();
  const k = await boot({ now: () => new Date(t), askAgent: opts.askAgent });
  await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["blinkit"] });
  // The products she buys on Zepto, as the agent remembered them.
  await k.op("remember_product", { item: "curd", app: "zepto", product_id: "z-curd", name_on_app: "Mother Dairy curd", pack: "400 g", price: 50 });
  await k.op("remember_product", { item: "bread", app: "zepto", product_id: "z-bread", name_on_app: "Harvest Gold bread", pack: "400 g", price: 45 });
  /** Move the clock on by minutes. */
  const at = (minutes: number) => { t += minutes * 60_000; };
  return Object.assign(k, { at });
};
type K = Awaited<ReturnType<typeof start>>;

const carts = async (k: K, app?: string) => (await k.owner("GET", `/api/carts${app ? `?app=${app}` : ""}`)).body.carts as any[];
const cartOf = async (k: K, app: string) => (await carts(k)).find((c) => c.app === app && c.status === "open");
const lineId = async (k: K, app: string, item: string) => (await cartOf(k, app)).lines.find((l: any) => l.item === item).id as string;
const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);
const order = (k: K, id: string) => k.rows("orders").find((o) => o.id === id);
/** Curd and bread on the Zepto cart, as the agent puts them (an agent's own edit never asks). */
const fill = async (k: K) => {
  await k.op("set_cart_line", { item: "curd", qty: 1 });
  await k.op("set_cart_line", { item: "bread", qty: 1 });
  return (await cartOf(k, "zepto")).order_id as string;
};
/** Fill, order and record the Zepto cart as placed. */
const placed = async (k: K, extra: object = {}) => {
  const id = await fill(k);
  await k.owner("POST", "/api/carts/zepto/order", {});
  expect(await k.op("record_order", { order_id: id, placed: true, ...extra })).toMatchObject({ order: { status: "placed" } });
  return id;
};

describe("one open cart per app", () => {
  it("each app has one open cart; an item's line goes to the app she buys it on, else the main app", async () => {
    const k = await start();
    // Ghee is bought on Blinkit (connected), salt on BigBasket (not connected).
    await k.op("import_order_history", { app: "blinkit", orders: [{ date: "2026-11-10", items: [{ item: "ghee", product: "Amul Ghee", pack: "1 l" }] }] });
    await k.op("import_order_history", { app: "bigbasket", orders: [{ date: "2026-11-10", items: [{ item: "salt", pack: "1 kg" }] }] });
    for (const it of ["curd", "bread", "ghee", "salt", "eggs"]) {
      const r = await k.op("set_cart_line", { item: it, qty: 1 });
      expect(r.error, it).toBeUndefined();
    }
    const open = k.rows("orders").filter((o) => o.status === "open");
    expect(open.map((o) => o.app).sort()).toEqual(["zepto", "zomato-blinkit"]);
    const zepto = await cartOf(k, "zepto"), blinkit = await cartOf(k, "zomato-blinkit");
    expect(zepto.lines.map((l: any) => l.item)).toEqual(["curd", "bread", "salt", "eggs"]);
    expect(blinkit.lines.map((l: any) => l.item)).toEqual(["ghee"]);
    // A remembered product fills the line; the cart's name and sync are shown.
    expect(zepto.lines[0]).toMatchObject({ product_id: "z-curd", name_on_app: "Mother Dairy curd", pack: "400 g", price: 50, qty: 1, source: "added" });
    expect(zepto).toMatchObject({ app_name: "Zepto", status: "open", sync_state: "pending", building_at_order: false });
    // The same item again changes its line; get_cart takes an app by name.
    await k.op("set_cart_line", { item: "Curd", qty: 3 });
    expect((await cartOf(k, "zepto")).lines.filter((l: any) => l.item === "curd").map((l: any) => l.qty)).toEqual([3]);
    expect((await k.op("get_cart", { app: "Blinkit" })).carts.map((c: any) => c.app)).toEqual(["zomato-blinkit"]);
    // qty 0 takes an added line off; a low line stays, at 0.
    await k.op("set_cart_line", { item: "eggs", qty: 0 });
    await k.op("set_cart_line", { item: "onion", qty: 0, source: "low", for_note: "might be running low" });
    expect((await cartOf(k, "zepto")).lines.map((l: any) => [l.item, l.qty])).toEqual([["curd", 3], ["bread", 1], ["salt", 1], ["onion", 0]]);
    // An app named on the line wins, and Amazon has a cart that is built when she orders.
    await k.op("set_cart_line", { item: "rice", qty: 1, app: "amazon" });
    expect(await cartOf(k, "amazon")).toMatchObject({ app_name: "Amazon Fresh", sync_state: "building_at_order", building_at_order: true });
    expect(k.rows("orders").filter((o) => o.status === "open")).toHaveLength(3);
    expect((await k.op("set_cart_line", { item: "rice", qty: 1, app: "dmart" })).code).toBe("APP_REFUSED");
  });

  it("a line for a subscribed item is refused", async () => {
    const k = await start();
    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: true });
    const r = await k.op("set_cart_line", { item: "Milk", qty: 2 });
    expect(r.code).toBe("SUBSCRIPTION");
    expect(r.error).toContain("Country Delight");
    expect(k.rows("order_lines")).toEqual([]);
    // Her "low" answer for it puts nothing on a cart either; another item's does, at qty 1.
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-10", items: [{ item: "ghee", pack: "1 l" }] }] });
    const a = await k.op("answer_running_low", { answers: [{ item: "ghee", answer: "low" }] });
    expect(a.to_cart).toEqual(["ghee"]);
    expect(k.rows("order_lines").map((l) => [l.item, l.qty, l.source])).toEqual([["ghee", 1, "low"]]);
    // Answered low again with more already on the cart: her quantity stays.
    await k.op("set_cart_line", { item: "ghee", qty: 2 });
    await k.op("answer_running_low", { answers: [{ item: "ghee", answer: "low" }] });
    expect(k.rows("order_lines").map((l) => [l.item, l.qty])).toEqual([["ghee", 2]]);
  });
});

describe("ordering", () => {
  it("order_cart applies the page's picks, moves the cart to ordering and says what it will order", async () => {
    const k = await start();
    const id = await fill(k);
    await k.op("set_cart_line", { item: "eggs", qty: 1 });
    const picks = [{ line_id: await lineId(k, "zepto", "curd"), qty: 1 }, { line_id: await lineId(k, "zepto", "bread"), qty: 1 }];
    const r = (await k.owner("POST", "/api/carts/zepto/order", { picks })).body;
    expect(r.message).toBe("Ordering this now: Mother Dairy curd, Harvest Gold bread, ~₹95 on Zepto");
    expect(r).toMatchObject({ order_id: id, app: "zepto" });
    expect(r.lines.map((l: any) => l.item)).toEqual(["curd", "bread"]);
    // Eggs, not picked, stay on the cart at 0.
    expect(k.rows("order_lines").map((l) => [l.item, l.qty])).toEqual([["curd", 1], ["bread", 1], ["eggs", 0]]);
    expect(order(k, id)).toMatchObject({ status: "ordering" });
    expect(order(k, id).ordering_at).toBeTruthy();
    expect((await carts(k)).map((c) => [c.app, c.status])).toEqual([["zepto", "ordering"]]);
    // The agent asking again gets the same order; an app with nothing on its cart is refused.
    expect(await k.op("order_cart", { app: "Zepto" })).toMatchObject({ order_id: id, app: "zepto" });
    expect((await k.owner("POST", "/api/carts/blinkit/order", {})).status).toBe(409);
    await k.op("set_cart_line", { item: "onion", qty: 0, source: "low", app: "blinkit" });
    expect((await k.owner("POST", "/api/carts/blinkit/order", {})).status).toBe(409);
  });

  // Review Focus 5.
  it("a line added while a cart is ordering goes to a new open cart of that app", async () => {
    const k = await start();
    const id = await fill(k);
    await k.owner("POST", "/api/carts/zepto/order", {});
    // The agent from a conversation, and the reminder (setLine), while Zepto's cart is being ordered.
    await k.op("set_cart_line", { item: "eggs", qty: 1 });
    setLine(k.kit.db, { item: "milk", qty: 1, source: "everyday", for_date: "2026-11-22" }, "app");
    const fresh = await cartOf(k, "zepto");
    expect(fresh.order_id).not.toBe(id);
    expect(fresh.lines.map((l: any) => l.item)).toEqual(["eggs", "milk"]);
    expect(k.rows("order_lines").filter((l) => l.order_id === id).map((l) => l.item)).toEqual(["curd", "bread"]);
    // "Remove the bread" from the agent mid-checkout takes it off the order being placed.
    await k.op("set_cart_line", { item: "bread", qty: 0 });
    expect(k.rows("order_lines").filter((l) => l.order_id === id).map((l) => l.item)).toEqual(["curd"]);
    // Placing it records curd only; the new open cart is untouched.
    await k.op("record_order", { order_id: id, placed: true });
    expect(k.rows("item_events").map((e) => item(k, "curd").id === e.item_id)).toEqual([true]);
    expect((await cartOf(k, "zepto")).lines.map((l: any) => l.item)).toEqual(["eggs", "milk"]);
  });

  it("placed: the lines become purchases and the items' cycles restart", async () => {
    const k = await start();
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-01", items: [{ item: "curd", group: "daily", product: "Mother Dairy curd", product_id: "z-curd", pack: "400 g", price: 50 }] }] });
    k.kit.db.update(itemsTable).set({ asks_unanswered: 2 }).where(eq(itemsTable.id, item(k, "curd").id)).run();
    const id = await fill(k);
    await k.op("set_cart_line", { item: "eggs", qty: 0, source: "low" });
    await k.owner("POST", "/api/carts/zepto/order", {});
    const r = await k.op("record_order", { order_id: id, placed: true, total: 97 });
    expect(r.order).toMatchObject({ order_id: id, status: "placed", total: 97 });
    expect(order(k, id).placed_at).toBeTruthy();
    const bought = k.rows("item_events").filter((e) => e.order_id === id);
    expect(bought.map((e) => [e.kind, e.date, e.app, e.product, e.product_id, e.amount, e.count, e.price])).toEqual([
      ["purchase", TODAY, "zepto", "Mother Dairy curd", "z-curd", 400, 1, 50], ["purchase", TODAY, "zepto", "Harvest Gold bread", "z-bread", 400, 1, 45]]);
    // A qty 0 line is not bought.
    expect(item(k, "eggs")).toBeUndefined();
    expect(item(k, "curd")).toMatchObject({ last_bought: TODAY, asks_unanswered: 0 });
    expect(item(k, "bread")).toMatchObject({ last_bought: TODAY, unit: "g" });
    // Recorded placed again: nothing doubles.
    await k.op("record_order", { order_id: id, placed: true });
    expect(k.rows("item_events").filter((e) => e.order_id === id)).toHaveLength(2);
    // An open cart is not placed: it is ordered first.
    await k.op("set_cart_line", { item: "eggs", qty: 1 });
    expect((await k.op("record_order", { order_id: (await cartOf(k, "zepto")).order_id, placed: true })).status).toBe(409);
    expect((await k.op("record_order", { order_id: "nope", placed: true })).status).toBe(404);
    expect((await k.op("record_order", { order_id: id })).code).toBe("APP_REFUSED");
  });

  // Review Focus 1.
  it("an order recorded placed and then read again from history is one purchase", async () => {
    const k = await start();
    const history = { app: "zepto", orders: [{ date: TODAY, order_ref: "Z9", items: [
      { item: "curd", product: "Mother Dairy curd", product_id: "z-curd", pack: "400 g" }, { item: "bread", product: "Harvest Gold bread", product_id: "z-bread", pack: "400 g" }] }] };
    // With its ref when placed.
    const id = await placed(k, { app_order_ref: "Z9" });
    expect(k.rows("item_events").map((e) => e.order_ref)).toEqual(["Z9", "Z9"]);
    expect(await k.op("import_order_history", history)).toMatchObject({ recorded: 0, duplicates: 2 });
    expect(k.rows("item_events")).toHaveLength(2);
    expect(order(k, id).app_order_ref).toBe("Z9");

    // Ref-less when placed, the ref told by a later record_order: kept on the order and its purchases.
    const k2 = await start();
    const id2 = await placed(k2);
    expect(k2.rows("item_events").map((e) => e.order_ref)).toEqual([null, null]);
    await k2.op("record_order", { order_id: id2, app_order_ref: "Z9" });
    expect(order(k2, id2).app_order_ref).toBe("Z9");
    expect(k2.rows("item_events").map((e) => e.order_ref)).toEqual(["Z9", "Z9"]);
    expect(await k2.op("import_order_history", history)).toMatchObject({ recorded: 0, duplicates: 2 });
    expect(k2.rows("item_events")).toHaveLength(2);

    // Ref-less when placed and never told: the history's copy is still the same purchase (date and product), and teaches the ref.
    const k3 = await start();
    await placed(k3);
    expect(await k3.op("import_order_history", history)).toMatchObject({ recorded: 0, duplicates: 2 });
    expect(k3.rows("item_events").map((e) => e.order_ref)).toEqual(["Z9", "Z9"]);
  });

  // Review Focus 4.
  it("not paid: purchases stop counting, lines return to the open cart; a late payment brings both back", async () => {
    const k = await start();
    const id = await placed(k);
    // Something she put on the new cart herself meanwhile.
    await k.op("set_cart_line", { item: "eggs", qty: 1 });
    const r = await k.op("record_order", { order_id: id, paid: false });
    expect(r.order).toMatchObject({ status: "not_paid" });
    expect(order(k, id).unpaid_notice).toBe("pending");
    expect(k.rows("item_events").map((e) => e.void)).toEqual([1, 1]);
    expect(item(k, "curd").last_bought).toBeNull();
    const back = await cartOf(k, "zepto");
    expect(back.order_id).not.toBe(id);
    expect(back.lines.map((l: any) => [l.item, l.qty, l.source, l.rolled_from])).toEqual([["eggs", 1, "added", null], ["curd", 1, "returned", id], ["bread", 1, "returned", id]]);
    expect(back.lines[1]).toMatchObject({ product_id: "z-curd", name_on_app: "Mother Dairy curd", price: 50 });
    // Not paid twice changes nothing.
    await k.op("record_order", { order_id: id, paid: false });
    expect((await cartOf(k, "zepto")).lines).toHaveLength(3);
    // Paid after all: the purchases count again and the returned lines leave the open cart; hers stays.
    expect((await k.op("record_order", { order_id: id, paid: true })).order).toMatchObject({ status: "paid" });
    expect(order(k, id).paid_at).toBeTruthy();
    expect(k.rows("item_events").map((e) => e.void)).toEqual([0, 0]);
    expect(item(k, "curd").last_bought).toBe(TODAY);
    expect((await cartOf(k, "zepto")).lines.map((l: any) => l.item)).toEqual(["eggs"]);
    // A paid order cannot become not paid.
    expect((await k.op("record_order", { order_id: id, paid: false })).status).toBe(409);
  });

  it("cancel_order on an ordering cart puts it back to open; on a placed one it is not paid", async () => {
    const k = await start();
    const id = await fill(k);
    await k.owner("POST", "/api/carts/zepto/order", {});
    // A line added meanwhile went to a new open cart: cancelling brings both together again, as one open cart.
    await k.op("set_cart_line", { item: "eggs", qty: 1 });
    setLine(k.kit.db, { item: "curd", qty: 0, source: "low", for_note: "might be running low" }, "app");
    expect((await cartOf(k, "zepto")).lines.map((l: any) => [l.item, l.qty])).toEqual([["eggs", 1], ["curd", 0]]);
    expect(await k.op("cancel_order", { order_id: id })).toMatchObject({ order: { order_id: id, status: "open" } });
    expect(k.rows("orders").map((o) => [o.app, o.status])).toEqual([["zepto", "open"]]);
    expect((await cartOf(k, "zepto")).lines.map((l: any) => [l.item, l.qty])).toEqual([["curd", 1], ["bread", 1], ["eggs", 1]]);
    expect(order(k, id).ordering_at).toBeNull();
    // An open cart cannot be cancelled.
    expect((await k.op("cancel_order", { order_id: id })).status).toBe(409);
    // A placed one: exactly not paid.
    await k.owner("POST", "/api/carts/zepto/order", {});
    await k.op("record_order", { order_id: id, placed: true });
    expect((await k.op("cancel_order", { order_id: id })).order).toMatchObject({ status: "not_paid" });
    expect(order(k, id).unpaid_notice).toBe("pending");
    expect(k.rows("item_events").every((e) => e.void === 1)).toBe(true);
    expect((await cartOf(k, "zepto")).lines.map((l: any) => [l.item, l.source])).toEqual([["curd", "returned"], ["bread", "returned"], ["eggs", "returned"]]);
    // The Orders tab lists it.
    const orders = (await k.owner("GET", `/api/orders?from=${TODAY}`)).body.orders;
    expect(orders.map((o: any) => [o.order_id, o.status, o.app_name])).toEqual([[id, "not_paid", "Zepto"]]);
    expect((await k.owner("GET", "/api/orders?from=2026-11-22")).body.orders).toEqual([]);
  });
});

describe("the app's real cart, kept in step", () => {
  it("sync_cart stores the app's prices, total and free-delivery gap, and marks lines it does not have", async () => {
    const k = await start();
    const id = await fill(k);
    const r = await k.op("sync_cart", { order_id: id, lines: [{ product_id: "z-curd", qty: 1, price: 52 }, { product_id: "z-bread", qty: 1, in_stock: false }],
      total: 97, delivery_gap: 102, outside_lines: [{ name: "Lay's Magic Masala", qty: 1 }] });
    expect(r.error).toBeUndefined();
    const c = await cartOf(k, "zepto");
    expect(c).toMatchObject({ total: 97, delivery_gap: 102, sync_state: "in_step", outside_lines: [{ name: "Lay's Magic Masala", qty: 1 }] });
    expect(c.synced_at).toBeTruthy();
    expect(c.lines.map((l: any) => [l.item, l.price, l.for_note])).toEqual([["curd", 52, null], ["bread", 45, "not on Zepto today"]]);
    // Back in stock the next time: the note goes.
    await k.op("sync_cart", { order_id: id, lines: [{ product_id: "z-bread", qty: 1 }] });
    expect((await cartOf(k, "zepto")).lines[1].for_note).toBeNull();
    expect((await k.op("sync_cart", { order_id: "nope", lines: [] })).status).toBe(404);
    expect((await k.op("sync_cart", { order_id: id, lines: [{ qty: 1 }] })).code).toBe("APP_REFUSED");
  });

  it("the Cart page's refresh asks the agent once per stale cart, and not again while that ask is in flight; never for Amazon", async () => {
    const k = await start({ askAgent: async () => ({ ok: true, data: { sessionId: "s1", reused: false } }) });
    const id = await fill(k);
    await k.op("set_cart_line", { item: "ghee", qty: 1, app: "blinkit" });
    await k.op("set_cart_line", { item: "rice", qty: 1, app: "amazon" });
    // Blinkit was copied a minute ago: not stale.
    await k.op("sync_cart", { order_id: (await cartOf(k, "zomato-blinkit")).order_id, lines: [] });
    k.at(1);
    expect(k.asked).toEqual([]);
    expect((await k.owner("POST", "/api/carts/refresh", {})).body).toEqual({ asked: ["zepto"] });
    expect(k.asked.map((a) => a.intent)).toEqual(["sync-cart"]);
    expect(k.asked[0].payload).toEqual({ order_id: id, app: "zepto", lines: [
      { item: "curd", product_id: "z-curd", name_on_app: "Mother Dairy curd", qty: 1 }, { item: "bread", product_id: "z-bread", name_on_app: "Harvest Gold bread", qty: 1 }] });
    // The page opened again while that ask is in flight: nothing.
    expect((await k.owner("POST", "/api/carts/refresh", {})).body).toEqual({ asked: [] });
    expect(k.asked).toHaveLength(1);
    // The session it started is kept, and the next ask goes to it. An ask unanswered past the cooldown counts as lost.
    expect(k.rows("house")[0].sync_session_id).toBe("s1");
    k.at(31);
    expect((await k.owner("POST", "/api/carts/refresh", {})).body.asked.sort()).toEqual(["zepto", "zomato-blinkit"]);
    expect(k.asked.map((a: any) => [a.payload.app, a.payload.reuseSessionId])).toEqual([["zepto", undefined], ["zepto", "s1"], ["zomato-blinkit", "s1"]]);
    expect(k.asked.some((a: any) => a.payload.app === "amazon")).toBe(false);
  });

  it("five page edits to one app's cart are one ask, after the last edit; two apps are two asks", async () => {
    const k = await start();
    await fill(k);
    await k.op("set_cart_line", { item: "ghee", qty: 1, app: "blinkit" });
    // The agent's own edits never ask.
    expect(k.pending()).toBe(false);
    const curd = await lineId(k, "zepto", "curd"), bread = await lineId(k, "zepto", "bread");
    for (const qty of [1, 2, 3, 2, 1]) {
      const r = await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty }] });
      expect(r.status).toBe(200);
    }
    expect(k.asked).toHaveLength(0);           // still waiting
    expect((await cartOf(k, "zepto")).sync_state).toBe("pending");
    k.settle("sync:zepto");
    expect(k.asked).toHaveLength(1);
    expect((k.asked[0].payload as any).lines.find((l: any) => l.item === "curd").qty).toBe(1);
    // Bread was not in the picks: it goes to 0, and the app is told to take it off.
    expect((k.asked[0].payload as any).lines.find((l: any) => l.item === "bread").qty).toBe(0);
    expect(k.rows("order_lines").find((l) => l.id === bread).qty).toBe(0);
    const ghee = await lineId(k, "zomato-blinkit", "ghee");
    await k.owner("POST", "/api/carts/blinkit/picks", { picks: [{ line_id: ghee, qty: 2 }] });
    k.settle();
    expect(k.asked.map((a: any) => a.payload.app)).toEqual(["zepto", "zomato-blinkit"]);
    expect((await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty: -1 }] })).status).toBe(400);
  });

  it("an edit while an ask is in flight waits for its sync_cart, then asks once more", async () => {
    const k = await start();
    const id = await fill(k);
    const curd = await lineId(k, "zepto", "curd");
    await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty: 2 }] });
    k.settle("sync:zepto");
    expect(k.asked).toHaveLength(1);
    k.at(1);
    await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty: 3 }] });
    k.settle("sync:zepto");
    expect(k.asked).toHaveLength(1);            // the first ask is still in flight
    expect((await cartOf(k, "zepto")).sync_state).toBe("pending");
    // Its answer is for the cart as it was: still pending, and one more ask goes out with the newest lines.
    k.at(1);
    await k.op("sync_cart", { order_id: id, lines: [{ product_id: "z-curd", qty: 2 }], total: 100 });
    expect((await cartOf(k, "zepto")).sync_state).toBe("pending");
    expect(k.pending("sync:zepto")).toBe(true);
    k.settle("sync:zepto");
    expect(k.asked).toHaveLength(2);
    expect((k.asked[1].payload as any).lines.find((l: any) => l.item === "curd").qty).toBe(3);
    // Its answer finds the cart unchanged: in step, and nothing more is asked.
    k.at(1);
    await k.op("sync_cart", { order_id: id, lines: [{ product_id: "z-curd", qty: 3 }], total: 150 });
    expect((await cartOf(k, "zepto")).sync_state).toBe("in_step");
    expect(k.pending()).toBe(false);
  });

  it("ordering drops a waiting ask; Amazon's cart edits never ask", async () => {
    const k = await start();
    await fill(k);
    const curd = await lineId(k, "zepto", "curd");
    await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty: 2 }] });
    expect(k.pending("sync:zepto")).toBe(true);
    await k.owner("POST", "/api/carts/zepto/order", { picks: [{ line_id: curd, qty: 2 }] });
    expect(k.pending("sync:zepto")).toBe(false);
    k.settle();
    expect(k.asked).toEqual([]);
    expect(k.rows("order_lines").find((l) => l.id === curd).qty).toBe(2);
    // Amazon: the cart is built when she orders.
    await k.op("set_cart_line", { item: "rice", qty: 1, app: "amazon" });
    const rice = await lineId(k, "amazon", "rice");
    expect((await k.owner("POST", "/api/carts/amazon/picks", { picks: [{ line_id: rice, qty: 2 }] })).status).toBe(200);
    k.settle();
    expect(k.asked).toEqual([]);
    expect(await cartOf(k, "amazon")).toMatchObject({ sync_state: "building_at_order" });
    expect((await k.owner("POST", "/api/carts/refresh", {})).body).toEqual({ asked: [] });
  });

  it("picks on a cart that is no longer open are refused (409)", async () => {
    const k = await start();
    const id = await fill(k);
    const curd = await lineId(k, "zepto", "curd");
    await k.owner("POST", "/api/carts/zepto/order", {});
    expect((await k.owner("POST", "/api/carts/zepto/picks", { picks: [{ line_id: curd, qty: 3 }] })).status).toBe(409);
    expect(k.rows("order_lines").find((l) => l.id === curd).qty).toBe(1);
    expect(order(k, id).status).toBe("ordering");
    expect((await k.owner("POST", "/api/carts/blinkit/picks", { picks: [] })).status).toBe(409);
    expect(k.pending()).toBe(false);
  });
});
