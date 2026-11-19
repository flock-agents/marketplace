// Carts: one `open` cart per shopping app, filled by the agent, the reminder and her taps on the Cart page. Nothing leaves it
// until she says yes (order_cart moves it to `ordering`); the agent then checks out and records it `placed`, and `paid` or
// `not_paid`. A placed order's lines are purchases (items.ts recordPurchase, the one door), so its items' cycles restart; one
// not paid voids them and puts its lines back on the app's open cart, and a late payment undoes both. Lines added while a cart
// is `ordering` go to a new open cart of that app, never onto the one being placed. cartRoutes.ts keeps the app's own cart in
// step through the agent.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { item_events, order_lines, orders } from "./db/schema";
import { APP_NAMES, CART_SYNC, SHOP_APPS, type GroceryApp, type LineSource } from "./db/constants";
import { list, refuse, shoppingApps, type Db, type Emit } from "./family";
import { itemFor, recomputeItem, recordPurchase, type ItemRow } from "./items";
import { normItem, parsePack, productFor } from "./products";
import { todayStr } from "./dates";
import { orderingNowText } from "./messages";

export type OrderRow = typeof orders.$inferSelect;
export type LineRow = typeof order_lines.$inferSelect;
export type Change = Parameters<Emit>;
/** `changes` collects what was written, for the caller to emit once its transaction is done; `at` is the app's clock. */
export type CartOpts = { changes?: Change[]; at?: Date };
export type LineInput = { item: string; qty: number; app?: GroceryApp; source: LineSource; for_note?: string | null; for_date?: string | null;
  product_id?: string; name_on_app?: string; pack?: string | null; price?: number | null; image?: string | null };

/** A moment strictly after `prev`: an edit and an ask in the same millisecond still tell which came first. */
export const after = (at: Date, prev: string | null | undefined): string =>
  new Date(Math.max(at.getTime(), prev ? Date.parse(prev) + 1 : -Infinity)).toISOString();

/** Emit each row once, in the order first written; a delete wins over what came before it. */
export function emitAll(emit: Emit, changes: Change[]): void {
  const by = new Map<string, Change>();
  for (const c of changes) if (!by.has(`${c[0]}:${c[1]}`) || c[2] === "delete") by.set(`${c[0]}:${c[1]}`, c);
  for (const c of by.values()) emit(...c);
}

const sorted = (db: Db, where: ReturnType<typeof eq>) =>
  db.select().from(order_lines).where(where).orderBy(asc(order_lines.created_at), sql`rowid`).all();
export const linesOf = (db: Db, orderId: string): LineRow[] => sorted(db, eq(order_lines.order_id, orderId));
export const cartOf = (db: Db, app: string, status: "open" | "ordering"): OrderRow | null =>
  db.select().from(orders).where(and(eq(orders.app, app), eq(orders.status, status))).orderBy(asc(orders.created_at), sql`rowid`).get() ?? null;
export const orderById = (db: Db, id: string): OrderRow | null => db.select().from(orders).where(eq(orders.id, id)).get() ?? null;

/** The line of an item on a cart, by the item's id or its name (a line may predate the item row). */
export function lineFor(db: Db, orderId: string, item: string): LineRow | null {
  const it = itemFor(db, item), key = normItem(item);
  return linesOf(db, orderId).find((l) => (it && l.item_id === it.id) || normItem(l.item) === key) ?? null;
}

/** The one open cart of the app, made when there is none. */
export function openCart(tx: Db, app: GroceryApp, opts: CartOpts = {}): OrderRow {
  const had = cartOf(tx, app, "open");
  if (had) return had;
  const row = tx.insert(orders).values({ app, status: "open", sync_state: CART_SYNC[app] ? null : "building_at_order", updated_by: "app" }).returning().get();
  opts.changes?.push(["orders", row.id, "insert", "app"]);
  return row;
}

/** The app an item's line goes to: the one it is bought on when the family is signed in to it, else the main app. */
export function lineApp(db: Db, item: ItemRow | null): GroceryApp {
  const s = shoppingApps(db), app = item?.app as GroceryApp | null | undefined;
  return app && (SHOP_APPS as readonly string[]).includes(app) && s.connected.includes(app) ? app : s.main;
}

/** A cart was edited: it is no longer the same as the app's own cart (Amazon's is only built when she orders). */
export function touchCart(tx: Db, cart: OrderRow, by: string, opts: CartOpts = {}): void {
  tx.update(orders).set({ sync_state: CART_SYNC[cart.app as GroceryApp] ? "pending" : "building_at_order",
    updated_at: after(opts.at ?? new Date(), cart.sync_asked_at), updated_by: by }).where(eq(orders.id, cart.id)).run();
  opts.changes?.push(["orders", cart.id, "update", by]);
}

/** Put an item on its app's open cart, or change its line there. qty 0 on a `low` line keeps it, at 0 (shown, not ordered);
 *  qty 0 on any other takes the line off. A subscribed item is refused (code SUBSCRIPTION). The product is the one given,
 *  else the line's, else the one remembered for that app. Answers the line, or null when it was taken off. */
export function setLine(tx: Db, l: LineInput, by: string, opts: CartOpts = {}): LineRow | null {
  const it = itemFor(tx, l.item);
  if (it?.subscription) refuse(`${it.name} comes from ${it.subscription}, so it is never put in a cart`, "SUBSCRIPTION");
  const app = l.app ?? lineApp(tx, it);
  const cart = openCart(tx, app, opts);
  const had = lineFor(tx, cart.id, l.item);
  let row: LineRow | null = null;
  if (l.qty === 0 && l.source !== "low") {
    if (!had) return null;
    tx.delete(order_lines).where(eq(order_lines.id, had.id)).run();
    opts.changes?.push(["order_lines", had.id, "delete", by]);
  } else {
    const p = l.product_id === undefined && !had?.product_id ? productFor(tx, l.item, app) : null;
    const set = { qty: l.qty, source: l.source, item_id: it?.id ?? had?.item_id ?? null,
      product_id: l.product_id ?? had?.product_id ?? p?.product_id ?? null, name_on_app: l.name_on_app ?? had?.name_on_app ?? p?.name_on_app ?? null,
      pack: l.pack !== undefined ? l.pack : had ? had.pack : p?.pack ?? null, price: l.price !== undefined ? l.price : had ? had.price : p?.price ?? null,
      image: l.image !== undefined ? l.image : had ? had.image : p?.image ?? null,
      ...(l.for_note !== undefined ? { for_note: l.for_note } : {}), ...(l.for_date !== undefined ? { for_date: l.for_date } : {}),
      updated_at: new Date().toISOString(), updated_by: by };
    row = had
      ? tx.update(order_lines).set(set).where(eq(order_lines.id, had.id)).returning().get()
      : tx.insert(order_lines).values({ ...set, order_id: cart.id, item: it?.name ?? l.item.trim() }).returning().get();
    opts.changes?.push(["order_lines", row.id, had ? "update" : "insert", by]);
  }
  touchCart(tx, cart, by, opts);
  return row;
}

/** The page's ItemPicker as it was submitted: each picked line takes its qty, every other line of the cart goes to 0 (kept,
 *  shown, not ordered). With `seen` (the lines the page showed), a line the page never showed (added by the agent or the
 *  reminder since it loaded) is left as it is. A pick naming a line of another cart is refused. */
export function applyPicks(tx: Db, cart: OrderRow, picks: { line_id: string; qty: number }[], by: string, opts: CartOpts & { seen?: Set<string> } = {}): void {
  const lines = linesOf(tx, cart.id), want = new Map(picks.map((p) => [p.line_id, p.qty]));
  for (const id of want.keys()) if (!lines.some((l) => l.id === id)) refuse(`line ${id} is not on this cart`);
  for (const l of lines) {
    if (opts.seen && !opts.seen.has(l.id) && !want.has(l.id)) continue;
    const qty = want.get(l.id) ?? 0;
    if (l.qty === qty) continue;
    tx.update(order_lines).set({ qty, updated_at: new Date().toISOString(), updated_by: by }).where(eq(order_lines.id, l.id)).run();
    opts.changes?.push(["order_lines", l.id, "update", by]);
  }
  touchCart(tx, cart, by, opts);
}

/** Her yes: the cart leaves `open` and is being ordered. `reminder_key`: the reminder that ordered it without asking. */
export function startOrdering(tx: Db, cart: OrderRow, by: string, opts: CartOpts & { reminder_key?: string } = {}): void {
  tx.update(orders).set({ status: "ordering", ordering_at: (opts.at ?? new Date()).toISOString(), ...(opts.reminder_key ? { reminder_key: opts.reminder_key } : {}),
    updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, cart.id)).run();
  opts.changes?.push(["orders", cart.id, "update", by]);
}

export type OrderAnswer = { order_id: string; app: string; lines: LineRow[]; message: string; already?: true };

/** What is being ordered on a cart, and the message said before it is placed. */
export function orderAnswer(db: Db, o: OrderRow, already = false): OrderAnswer {
  const lines = linesOf(db, o.id).filter((l) => (l.qty ?? 0) > 0);
  return { order_id: o.id, app: o.app, lines, message: orderingNowText({ app: o.app, lines }), ...(already ? { already: true as const } : {}) };
}

/** A yes to one app's cart: order_cart, and the reminder when Order without asking is on. One order at a time per app: while one
 *  is being ordered, the answer is that one (`already`) and the open cart stays open. With `picks` (the page's ItemPicker) they
 *  are saved first; with `seen` (the lines the page showed) a line added since moves to the app's new open cart instead of
 *  being ordered or zeroed. A copy to the app still waiting is dropped (`schedule`: checking out makes the app's cart match).
 *  `refused`: nothing to order, or the page's picks name a line no longer on the cart. */
export function orderCart(tx: Db, app: GroceryApp, by: string, opts: CartOpts & { picks?: { line_id: string; qty: number }[] | null; seen?: Set<string>;
  reminder_key?: string; schedule?: (key: string, run: null, ms: number) => void } = {}): OrderAnswer | { refused: string } {
  const ordering = cartOf(tx, app, "ordering");
  if (ordering) return orderAnswer(tx, ordering, true);
  const cart = cartOf(tx, app, "open");
  const empty = { refused: `there is nothing on your ${APP_NAMES[app]} cart to order` };
  if (!cart) return empty;
  const lines = linesOf(tx, cart.id), picks = opts.picks ?? null;
  if (picks) for (const p of picks) if (!lines.some((l) => l.id === p.line_id)) return { refused: "the cart changed: reload it" };
  const shown = opts.seen ? new Set([...opts.seen, ...(picks ?? []).map((p) => p.line_id)]) : undefined;
  const unseen = shown ? lines.filter((l) => !shown.has(l.id)).map((l) => l.id) : [];
  if (!(picks ? picks.some((p) => p.qty > 0) : lines.some((l) => (!shown || shown.has(l.id)) && (l.qty ?? 0) > 0))) return empty;
  if (picks) applyPicks(tx, cart, picks, by, { ...opts, seen: shown });
  startOrdering(tx, cart, by, opts);
  moveToOpen(tx, cart, unseen, by, opts);
  opts.schedule?.(`sync:${app}`, null, 0);
  return orderAnswer(tx, orderById(tx, cart.id)!);
}

/** An `ordering` cart that was not placed is open again. A cart opened for that app meanwhile is folded into it, so the app
 *  keeps one open cart: its lines move over (an item on both keeps the larger qty) and it goes. */
export function reopenCart(tx: Db, o: OrderRow, by: string, opts: CartOpts & { note?: string } = {}): void {
  const other = cartOf(tx, o.app, "open");
  if (other && other.id !== o.id) {
    for (const l of linesOf(tx, other.id)) {
      const mine = lineFor(tx, o.id, l.item);
      if (mine) {
        if ((l.qty ?? 0) > (mine.qty ?? 0)) tx.update(order_lines).set({ qty: l.qty, updated_by: by }).where(eq(order_lines.id, mine.id)).run();
        tx.delete(order_lines).where(eq(order_lines.id, l.id)).run();
        opts.changes?.push(["order_lines", mine.id, "update", by], ["order_lines", l.id, "delete", by]);
      } else {
        tx.update(order_lines).set({ order_id: o.id, updated_by: by }).where(eq(order_lines.id, l.id)).run();
        opts.changes?.push(["order_lines", l.id, "update", by]);
      }
    }
    tx.delete(orders).where(eq(orders.id, other.id)).run();
    opts.changes?.push(["orders", other.id, "delete", by]);
  }
  tx.update(orders).set({ status: "open", ordering_at: null, reminder_key: null, ...(opts.note !== undefined ? { note: opts.note } : {}) }).where(eq(orders.id, o.id)).run();
  touchCart(tx, { ...o, status: "open" }, by, opts);
}

/** The amount a line buys, pack × qty, from the line's pack or the product remembered for it; null when it has no size. */
function boughtAmount(tx: Db, l: LineRow, app: string): { amount: number; unit: string } | null {
  const qty = l.qty ?? 0;
  const own = parsePack(l.pack);
  if (own) return { amount: own.amount * qty, unit: own.unit };
  const p = productFor(tx, l.item, app);
  return p?.pack_amount != null && p.pack_unit ? { amount: p.pack_amount * qty, unit: p.pack_unit } : null;
}

/** The order went through: every line with a qty becomes a purchase on the order's app, carrying the order and its ref (so the
 *  same order read again from the app's history is the same purchase), and each item is recomputed: its cycle restarts. */
export function markPlaced(tx: Db, o: OrderRow, ref: string | null, by: string, opts: CartOpts = {}): void {
  const at = opts.at ?? new Date(), day = todayStr(at);
  tx.update(orders).set({ status: "placed", placed_at: at.toISOString(), ...(ref ? { app_order_ref: ref } : {}), updated_at: new Date().toISOString(), updated_by: by })
    .where(eq(orders.id, o.id)).run();
  opts.changes?.push(["orders", o.id, "update", by]);
  const touched = new Set<string>();
  for (const l of linesOf(tx, o.id)) {
    if (!l.qty) continue;
    const size = boughtAmount(tx, l, o.app);
    const r = recordPurchase(tx, { item: l.item, date: day, app: o.app as GroceryApp, product: l.name_on_app ?? undefined, product_id: l.product_id ?? undefined,
      amount: size?.amount ?? null, unit: size?.unit ?? null, count: l.qty, price: l.price != null ? l.price * l.qty : undefined,
      order_ref: ref ?? o.app_order_ref ?? undefined, order_id: o.id });
    if ("event_id" in r) opts.changes?.push(["item_events", r.event_id, "insert", by]);
    touched.add(itemFor(tx, l.item)!.id);
  }
  for (const id of touched) { recomputeItem(tx, id, day); opts.changes?.push(["items", id, "update", by]); }
}

/** The app's order id, told after the order was recorded: kept on the order and on its purchases. */
export function setOrderRef(tx: Db, o: OrderRow, ref: string, by: string, opts: CartOpts = {}): void {
  tx.update(orders).set({ app_order_ref: ref, updated_by: by }).where(eq(orders.id, o.id)).run();
  tx.update(item_events).set({ order_ref: ref }).where(and(eq(item_events.order_id, o.id), isNull(item_events.order_ref))).run();
  opts.changes?.push(["orders", o.id, "update", by]);
}

/** Purchases of an order made to count, or not, again; each item recomputed. */
function voidPurchases(tx: Db, o: OrderRow, value: 0 | 1, by: string, opts: CartOpts): void {
  const evs = tx.select().from(item_events).where(and(eq(item_events.order_id, o.id), eq(item_events.kind, "purchase"))).all();
  if (!evs.length) return;
  tx.update(item_events).set({ void: value }).where(inArray(item_events.id, evs.map((e) => e.id))).run();
  const day = todayStr(opts.at ?? new Date());
  for (const e of evs) opts.changes?.push(["item_events", e.id, "update", by]);
  for (const id of new Set(evs.map((e) => e.item_id))) { recomputeItem(tx, id, day); opts.changes?.push(["items", id, "update", by]); }
}

/** A placed order that was not paid: `not_paid`, its purchases stop counting, and its lines go back on the app's open cart as
 *  `returned` (an item already there with a qty keeps its line). The family is told once (unpaid_notice pending). */
export function rollUnpaid(tx: Db, o: OrderRow, by: string, opts: CartOpts = {}): void {
  tx.update(orders).set({ status: "not_paid", unpaid_notice: "pending", updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
  opts.changes?.push(["orders", o.id, "update", by]);
  voidPurchases(tx, o, 1, by, opts);
  const lines = linesOf(tx, o.id).filter((l) => (l.qty ?? 0) > 0 && !itemFor(tx, l.item)?.subscription);
  if (!lines.length) return;
  const cart = openCart(tx, o.app as GroceryApp, opts);
  for (const l of lines) {
    const had = lineFor(tx, cart.id, l.item);
    if (had?.qty) continue;
    const set = { qty: l.qty, source: "returned", rolled_from: o.id, item_id: l.item_id, product_id: l.product_id, name_on_app: l.name_on_app,
      pack: l.pack, price: l.price, image: l.image, for_note: l.for_note, for_date: l.for_date, updated_by: by };
    const row = had
      ? tx.update(order_lines).set(set).where(eq(order_lines.id, had.id)).returning().get()
      : tx.insert(order_lines).values({ ...set, order_id: cart.id, item: l.item }).returning().get();
    opts.changes?.push(["order_lines", row.id, had ? "update" : "insert", by]);
  }
  touchCart(tx, cart, by, opts);
}

/** Lines a cart she has not said yes to yet (`unseen`, not shown on her page) move to the app's open cart, made when there is
 *  none: a cart going to `ordering` takes only what she saw. */
export function moveToOpen(tx: Db, from: OrderRow, lineIds: string[], by: string, opts: CartOpts = {}): void {
  if (!lineIds.length) return;
  const cart = openCart(tx, from.app as GroceryApp, opts);
  for (const id of lineIds) {
    tx.update(order_lines).set({ order_id: cart.id, updated_by: by }).where(eq(order_lines.id, id)).run();
    opts.changes?.push(["order_lines", id, "update", by]);
  }
  touchCart(tx, cart, by, opts);
}

/** A not-paid order was paid after all: `paid`, its purchases count again, and the lines it returned leave every cart not yet
 *  placed. Answers what left a cart being ordered, so the agent takes it off the checkout too. */
export function markPaid(tx: Db, o: OrderRow, by: string, opts: CartOpts = {}): { order_id: string; items: string[] }[] {
  tx.update(orders).set({ status: "paid", paid_at: (opts.at ?? new Date()).toISOString(), updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
  opts.changes?.push(["orders", o.id, "update", by]);
  if (o.status !== "not_paid") return [];
  voidPurchases(tx, o, 0, by, opts);
  const returned = tx.select({ id: order_lines.id, order_id: order_lines.order_id, item: order_lines.item, status: orders.status }).from(order_lines)
    .innerJoin(orders, eq(order_lines.order_id, orders.id))
    .where(and(eq(order_lines.rolled_from, o.id), inArray(orders.status, ["open", "ordering"]))).all();
  for (const l of returned) { tx.delete(order_lines).where(eq(order_lines.id, l.id)).run(); opts.changes?.push(["order_lines", l.id, "delete", by]); }
  const taken: { order_id: string; items: string[] }[] = [];
  for (const id of new Set(returned.map((l) => l.order_id))) {
    const mine = returned.filter((l) => l.order_id === id);
    if (mine[0].status === "open") touchCart(tx, orderById(tx, id)!, by, opts);
    else taken.push({ order_id: id, items: mine.map((l) => l.item) });
  }
  return taken;
}

/** A cart or an order as the pages and the agent read it. `total` is the app's own total, from its last copy. */
export function cartView(db: Db, o: OrderRow) {
  return { order_id: o.id, app: o.app, app_name: APP_NAMES[o.app as GroceryApp] ?? o.app, status: o.status, lines: linesOf(db, o.id), reminder_key: o.reminder_key,
    total: o.total, delivery_gap: o.delivery_gap, sync_state: o.sync_state, synced_at: o.synced_at, sync_asked_at: o.sync_asked_at,
    outside_lines: list<{ name: string; qty?: number }>(o.outside_lines), building_at_order: !CART_SYNC[o.app as GroceryApp],
    ordering_at: o.ordering_at, placed_at: o.placed_at, paid_at: o.paid_at, app_order_ref: o.app_order_ref, note: o.note };
}
export type CartView = ReturnType<typeof cartView>;

/** The open and ordering carts: the main app's first, then the others in the app list's order. */
export function cartsView(db: Db): { carts: CartView[] } {
  const main = shoppingApps(db).main;
  const rank = (app: string) => (app === main ? -1 : (SHOP_APPS as readonly string[]).indexOf(app));
  const rows = db.select().from(orders).where(inArray(orders.status, ["open", "ordering"])).orderBy(asc(orders.created_at), sql`rowid`).all()
    .map((o, n) => ({ o, n })).sort((a, b) => rank(a.o.app) - rank(b.o.app) || a.n - b.n).map(({ o }) => o);
  return { carts: rows.map((o) => cartView(db, o)) };
}
