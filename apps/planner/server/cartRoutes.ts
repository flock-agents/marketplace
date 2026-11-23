// The carts' routes (the agent's get_cart, set_cart_line, sync_cart, order_cart, record_order and cancel_order, and the Cart
// page's picks, refresh and Orders tab), and keeping each app's real cart in step. The app cannot touch a shopping app
// itself: after her edits on the page it asks the agent (the declared `sync-cart` intent) to copy the cart over, once per
// burst of edits per app (SYNC_DEBOUNCE_SEC after the last), never with an ask already in flight, and never for Amazon,
// whose cart is built when she orders. The agent's own edits are mirrored by the agent in the same turn and never ask.
import type { Context, Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { house, order_lines, orders } from "./db/schema";
import { APP_NAMES, appOf, CART_STALE_MIN, CART_SYNC, LINE_SOURCES, SHOP_APPS, SYNC_ASK_COOLDOWN_MIN, SYNC_DEBOUNCE_SEC,
  type GroceryApp, type LineSource } from "./db/constants";
import { getHouse, isObject, name, refuse, shoppingApps, words, writeRoutes, type Db, type Emit } from "./family";
import { itemFor } from "./items";
import { productId } from "./products";
import { dateOf } from "./meals";
import { todayStr } from "./dates";
import { after, applyPicks, cartOf, cartsView, cartView, emitAll, lineApp, lineFor, linesOf, markPaid, markPlaced, orderById, orderCart, reopenCart,
  rollUnpaid, setLine, setOrderRef, type Change, type LineInput, type OrderRow } from "./cart";

export type CartDeps = {
  /** The platform's intent call (flock.platform.agent.intent). */
  askAgent: (intent: string, payload: Record<string, unknown>) => Promise<unknown>;
  /** A per-key timer: a new run for a key takes the place of the one waiting; null only clears it. */
  schedule: (key: string, run: (() => void) | null, ms: number) => void;
  now?: () => Date;
};

const PICKS_SHAPE = "picks must be a list of { line_id, qty } (qty a whole number, 0 or more)";
const wholeQty = (v: unknown, what: string): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : refuse(`${what} must be a whole number, 0 or more`));
const price = (v: unknown, what: string): number | null =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : refuse(`${what} must be a number, 0 or more`);
const appIn = (v: unknown, what = "app"): GroceryApp => appOf(v) ?? refuse(`${what} must be one of: ${SHOP_APPS.join(", ")}`);

function picksOf(v: unknown): { line_id: string; qty: number }[] {
  if (!Array.isArray(v)) return refuse(PICKS_SHAPE);
  return v.map((p) => (isObject(p) && typeof p.line_id === "string" ? { line_id: p.line_id, qty: wholeQty(p.qty, "a pick's qty") } : refuse(PICKS_SHAPE)));
}

/** The lines the page showed when she tapped (optional): what was added since is not hers to have picked. */
function seenOf(v: unknown): Set<string> | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? new Set(v as string[]) : refuse("seen must be a list of line ids");
}

function lineInput(b: Record<string, unknown>): LineInput {
  const l: LineInput = { item: name(b.item, "item"), qty: wholeQty(b.qty, "qty"),
    source: b.source == null ? "added" : (LINE_SOURCES as readonly unknown[]).includes(b.source) ? (b.source as LineSource) : refuse(`source must be one of: ${LINE_SOURCES.join(", ")}`) };
  if (b.app != null) l.app = appIn(b.app);
  if (b.for_note !== undefined) l.for_note = words(b.for_note, "for_note");
  if (b.for_date !== undefined) l.for_date = b.for_date === null ? null : dateOf(b.for_date, "for_date");
  if (b.product_id != null) l.product_id = productId(b.product_id);
  if (b.name_on_app != null) l.name_on_app = name(b.name_on_app, "name_on_app");
  for (const k of ["pack", "image"] as const) if (b[k] !== undefined) l[k] = words(b[k], k);
  if (b.price !== undefined) l.price = price(b.price, "price");
  return l;
}

export function mountCartRoutes(hono: Hono<any>, db: Db, emit: Emit, deps: CartDeps) {
  const write = writeRoutes(hono);
  const now = () => (deps.now ?? (() => new Date()))();
  const run = <T>(work: (tx: Db, changes: Change[]) => T): T => {
    const changes: Change[] = [];
    const out = db.transaction((tx) => work(tx as unknown as Db, changes));
    emitAll(emit, changes);
    return out;
  };
  const appParam = (c: Context): GroceryApp => appIn(c.req.param("app"), "the app in the path");
  const conflict = (reason: string) => ({ status: 409 as const, body: { reason } });

  // ── Keeping the app's own cart in step ──

  /** Is an ask to copy this cart still waiting for its sync_cart? One unanswered past the cooldown counts as lost. */
  const inFlight = (o: OrderRow): boolean => !!o.sync_asked_at && (!o.synced_at || o.sync_asked_at > o.synced_at)
    && now().getTime() - Date.parse(o.sync_asked_at) < SYNC_ASK_COOLDOWN_MIN * 60_000;

  /** Ask the agent to make the app's cart hold the open cart's lines; true when it asked. The ask reuses the session the last
   *  one started, so a follow-up carries little new context. */
  const fire = (app: GroceryApp): boolean => {
    const cart = cartOf(db, app, "open");
    // An app the family has not signed in to has no cart of its own to copy to: nothing is asked until it is connected.
    if (!cart || !CART_SYNC[app] || !shoppingApps(db).connected.includes(app)) return false;
    const lines = linesOf(db, cart.id);
    // Nothing to put on the app's cart, and nothing it may hold to take off.
    if (!lines.some((l) => (l.qty ?? 0) > 0) && !(lines.length && (cart.synced_at || cart.sync_asked_at))) return false;
    if (inFlight(cart)) return false;
    const session = getHouse(db).sync_session_id;
    const asked = after(now(), cart.updated_at), before = cart.sync_asked_at;
    db.update(orders).set({ sync_asked_at: asked }).where(eq(orders.id, cart.id)).run();
    emit("orders", cart.id, "update", "app");
    const payload = { order_id: cart.id, app, lines: lines.map((l) => ({ item: l.item, product_id: l.product_id, name_on_app: l.name_on_app, qty: l.qty ?? 0 })),
      ...(session ? { reuseSessionId: session } : {}) };
    // An ask that did not go is not in flight: the next edit or page open asks again.
    const lost = () => {
      const o = orderById(db, cart.id);
      if (o?.sync_asked_at === asked) db.update(orders).set({ sync_asked_at: before }).where(eq(orders.id, cart.id)).run();
    };
    deps.askAgent("sync-cart", payload).then((res: any) => {
      if (!res || res.ok !== true) { if (res && res.ok === false) lost(); return; }
      const id = res.data?.sessionId;
      if (typeof id === "string" && id && id !== getHouse(db).sync_session_id) {
        const h = db.update(house).set({ sync_session_id: id }).where(eq(house.id, getHouse(db).id)).returning().get();
        emit("house", h.id, "update", "app");
      }
    }, lost);
    return true;
  };

  /** After an edit: ask once the edits to that app's cart have stopped for SYNC_DEBOUNCE_SEC; each edit restarts the wait. */
  const requestSync = (app: GroceryApp): void => {
    if (CART_SYNC[app]) deps.schedule(`sync:${app}`, () => { fire(app); }, SYNC_DEBOUNCE_SEC * 1000);
  };

  // ── Reads ──

  // get_cart { app? }: the open and ordering carts.
  hono.get("/api/carts", (c) => {
    const q = c.req.query("app");
    const all = cartsView(db);
    if (!q) return c.json(all);
    const app = appOf(q);
    return app ? c.json({ carts: all.carts.filter((x) => x.app === app) }) : c.json({ ok: false, reason: `app must be one of: ${SHOP_APPS.join(", ")}` }, 400);
  });

  // The Orders tab: placed, paid, not paid and cancelled orders from a date on, newest first.
  hono.get("/api/orders", (c) => {
    const from = c.req.query("from");
    const day = (o: OrderRow) => todayStr(new Date(o.placed_at ?? o.updated_at));
    const rows = db.select().from(orders).where(inArray(orders.status, ["placed", "paid", "not_paid", "cancelled"])).all()
      .filter((o) => !from || day(o) >= from)
      .sort((a, b) => (b.placed_at ?? b.updated_at).localeCompare(a.placed_at ?? a.updated_at));
    return c.json({ orders: rows.map((o) => cartView(db, o)) });
  });

  // ── The cart ──

  // set_cart_line { item, qty, app?, source?, for_note?, product_id?, name_on_app?, pack?, price?, image? }: on the app's open cart.
  // The agent may also take off or lower a line of a cart being ordered ("remove the ghee"); anything new, or more of an item
  // already being ordered, goes to the open cart.
  write("/api/carts/line", (b, by) => {
    const l = lineInput(b);
    const app = l.app ?? lineApp(db, itemFor(db, l.item));
    const agent = by.startsWith("agent:");
    const ordering = agent ? cartOf(db, app, "ordering") : null;
    const onOrdering = ordering ? lineFor(db, ordering.id, l.item) : null;
    if (ordering && onOrdering && l.qty < (onOrdering.qty ?? 0)) {
      const line = run((tx, changes) => {
        if (l.qty === 0) {
          tx.delete(order_lines).where(eq(order_lines.id, onOrdering.id)).run();
          changes.push(["order_lines", onOrdering.id, "delete", by]);
          return null;
        }
        changes.push(["order_lines", onOrdering.id, "update", by]);
        return tx.update(order_lines).set({ qty: l.qty, updated_at: new Date().toISOString(), updated_by: by }).where(eq(order_lines.id, onOrdering.id)).returning().get();
      });
      return { body: { line, cart: cartView(db, orderById(db, ordering.id)!) } };
    }
    const line = run((tx, changes) => setLine(tx, { ...l, app }, by, { changes, at: now() }));
    if (!agent) requestSync(app);
    return { body: { line, cart: cartView(db, cartOf(db, app, "open")!) } };
  });

  // The Cart page's ItemPicker as she taps it: the picked lines' qty, every other line of the cart at 0; then the copy to the
  // app, after the taps stop. With `seen` (the lines the page showed), a line added since is left as it is. 409 when the cart
  // has left `open` (the page reloads).
  write("/api/carts/:app/picks", (b, by, c) => {
    const app = appParam(c);
    const picks = picksOf(b.picks), seen = seenOf(b.seen);
    const homes = new Set(picks.map((p) => db.select({ order_id: order_lines.order_id }).from(order_lines).where(eq(order_lines.id, p.line_id)).get()?.order_id ?? null));
    if (homes.has(null) || homes.size > 1) return conflict("the cart changed: reload it");
    const cart = homes.size ? orderById(db, [...homes][0]!) : cartOf(db, app, "open");
    if (!cart || cart.app !== app || cart.status !== "open") return conflict(`your ${APP_NAMES[app]} cart is no longer open: reload it`);
    run((tx, changes) => applyPicks(tx, cart, picks, by, { changes, at: now(), seen }));
    requestSync(app);
    return { body: { cart: cartView(db, orderById(db, cart.id)!) } };
  });

  // order_cart { app, picks?, seen? }: her yes. The page's picks are saved first; the cart leaves `open` (a line added from now on
  // goes to a new open cart), and a copy to the app still waiting is dropped (checking out makes the app's cart match). With
  // `seen` (the lines the page showed) a line added since she looked moves to the app's new open cart instead of being ordered
  // or zeroed. One order at a time per app: while one is being ordered, asking again answers that one.
  write("/api/carts/:app/order", (b, by, c) => {
    const app = appParam(c);
    const picks = b.picks == null ? null : picksOf(b.picks), seen = seenOf(b.seen);
    const res = run((tx, changes) => orderCart(tx, app, by, { changes, at: now(), picks, seen, schedule: deps.schedule }));
    return "refused" in res ? conflict(res.refused) : { body: res };
  });

  // sync_cart { order_id, lines: [{ product_id, qty, price?, in_stock? }], total?, delivery_gap?, outside_lines? }: what the app's
  // own cart holds now. A cart edited after the ask this answers stays pending, and is asked for once more.
  write("/api/carts/:id/sync", (b, by, c) => {
    const o = orderById(db, c.req.param("id") ?? "");
    if (!o) return { status: 404, body: { reason: "no such cart" } };
    if (o.status !== "open" && o.status !== "ordering") return conflict(`this cart is ${o.status.replace("_", " ")}: only an open or ordering cart is copied`);
    if (!Array.isArray(b.lines)) refuse("lines must be a list of { product_id, qty, price?, in_stock? }");
    const got = (b.lines as unknown[]).map((x) => {
      if (!isObject(x)) return refuse("lines must be a list of { product_id, qty, price?, in_stock? }");
      const id = productId(x.product_id, "a line's product_id");
      return { product_id: id, price: x.price == null ? null : price(x.price, `${id}: price`),
        in_stock: x.in_stock == null ? true : typeof x.in_stock === "boolean" ? x.in_stock : refuse(`${id}: in_stock must be true or false`) };
    });
    const total = b.total === undefined ? undefined : price(b.total, "total");
    const gap = b.delivery_gap === undefined ? undefined : price(b.delivery_gap, "delivery_gap");
    let outside: string | undefined;
    if (b.outside_lines !== undefined) {
      if (!Array.isArray(b.outside_lines) || !b.outside_lines.every((x) => isObject(x) && typeof x.name === "string")) refuse("outside_lines must be a list of { name, qty? }");
      outside = JSON.stringify((b.outside_lines as Record<string, unknown>[]).map((x) => ({ name: String(x.name), ...(typeof x.qty === "number" ? { qty: x.qty } : {}) })));
    }
    const away = `not on ${APP_NAMES[o.app as GroceryApp] ?? o.app} today`;
    const asked = !!o.sync_asked_at && (!o.synced_at || o.sync_asked_at > o.synced_at);
    const stale = asked && o.updated_at > o.sync_asked_at!;
    run((tx, changes) => {
      for (const l of linesOf(tx, o.id)) {
        const g = got.find((x) => x.product_id === l.product_id);
        if (!g) continue;
        const set: Partial<typeof order_lines.$inferInsert> = {};
        if (g.price != null && g.price !== l.price) set.price = g.price;
        if (!g.in_stock && l.for_note !== away) set.for_note = away;
        if (g.in_stock && l.for_note === away) set.for_note = null;
        if (!Object.keys(set).length) continue;
        tx.update(order_lines).set({ ...set, updated_by: by }).where(eq(order_lines.id, l.id)).run();
        changes.push(["order_lines", l.id, "update", by]);
      }
      tx.update(orders).set({ synced_at: after(now(), o.sync_asked_at), sync_state: stale ? "pending" : CART_SYNC[o.app as GroceryApp] ? "in_step" : "building_at_order",
        ...(total !== undefined ? { total } : {}), ...(gap !== undefined ? { delivery_gap: gap } : {}), ...(outside !== undefined ? { outside_lines: outside } : {}),
        updated_by: by }).where(eq(orders.id, o.id)).run();
      changes.push(["orders", o.id, "update", by]);
    });
    if (stale && o.status === "open") requestSync(o.app as GroceryApp);
    return { body: { cart: cartView(db, orderById(db, o.id)!) } };
  });

  // The Cart page opened: each open cart with something on it that was not copied lately, or has edits not yet copied, is
  // copied now (no wait), unless an ask for it is still in flight.
  write("/api/carts/refresh", () => {
    const stale = (o: OrderRow) => o.sync_state === "pending" || !o.synced_at || now().getTime() - Date.parse(o.synced_at) > CART_STALE_MIN * 60_000;
    const asked: string[] = [];
    for (const c of cartsView(db).carts) {
      const o = orderById(db, c.order_id)!;
      if (c.status !== "open" || !CART_SYNC[o.app as GroceryApp] || !c.lines.some((l) => (l.qty ?? 0) > 0) || !stale(o)) continue;
      if (fire(o.app as GroceryApp)) asked.push(o.app);
    }
    return { body: { asked } };
  });

  // ── Orders ──

  // record_order { order_id, placed?: true, paid?: boolean, app_order_ref?, total? }: what happened to an order being placed.
  write("/api/orders/:id/record", (b, by, c) => {
    const o = orderById(db, c.req.param("id") ?? "");
    if (!o) return { status: 404, body: { reason: "no such order" } };
    const placed = b.placed == null ? false : b.placed === true ? true : refuse("placed must be true");
    const paid = b.paid == null ? undefined : typeof b.paid === "boolean" ? b.paid : refuse("paid must be true or false");
    const ref = b.app_order_ref == null ? null : typeof b.app_order_ref === "number" ? String(b.app_order_ref) : name(b.app_order_ref, "app_order_ref");
    const total = b.total == null ? undefined : price(b.total, "total");
    if (!placed && paid === undefined && !ref && total === undefined) refuse("give placed: true, paid, app_order_ref or total");
    // Each step checked before anything is written.
    if (placed && !["ordering", "placed", "paid", "not_paid"].includes(o.status)) return conflict(`this cart is ${o.status}: order it with order_cart first`);
    const status = placed && o.status === "ordering" ? "placed" : o.status;
    if (paid === true && !["placed", "paid", "not_paid"].includes(status)) return conflict(`this order is ${status.replace("_", " ")}, not placed`);
    if (paid === false && !["placed", "not_paid"].includes(status)) return conflict(`this order is ${status.replace("_", " ")}: it cannot be not paid`);
    const taken: { order_id: string; items: string[] }[] = [];
    run((tx, changes) => {
      const opts = { changes, at: now() };
      if (placed && o.status === "ordering") markPlaced(tx, o, ref, by, opts);
      else if (ref && ref !== o.app_order_ref) setOrderRef(tx, o, ref, by, opts);
      if (total !== undefined) { tx.update(orders).set({ total, updated_by: by }).where(eq(orders.id, o.id)).run(); changes.push(["orders", o.id, "update", by]); }
      const cur = orderById(tx, o.id)!;
      if (paid === true && cur.status !== "paid") taken.push(...markPaid(tx, cur, by, opts));
      // The agent records it in the conversation and says it there: the clock has nothing more to tell.
      if (paid === false && cur.status === "placed") rollUnpaid(tx, cur, by, { ...opts, notice: "sent" });
    });
    // Lines it had returned that were on a cart being ordered: take them off the checkout on the app too.
    return { body: { order: cartView(db, orderById(db, o.id)!), ...(taken.length ? { taken_off: taken } : {}) } };
  });

  // cancel_order { order_id }: an order being ordered goes back to the open cart (nothing was placed); a placed one is not paid.
  write("/api/orders/:id/cancel", (_b, by, c) => {
    const o = orderById(db, c.req.param("id") ?? "");
    if (!o) return { status: 404, body: { reason: "no such order" } };
    if (o.status !== "ordering" && o.status !== "placed") return conflict(`this cart is ${o.status.replace("_", " ")}: only an order being placed or placed can be cancelled`);
    run((tx, changes) => (o.status === "ordering" ? reopenCart(tx, o, by, { changes, at: now() }) : rollUnpaid(tx, o, by, { changes, at: now(), notice: "sent" })));
    return { body: { order: cartView(db, orderById(db, o.id)!) } };
  });
}
