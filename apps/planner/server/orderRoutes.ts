// The orders' routes, behind the agent's ask_low_or_out, add_to_order, place_order, record_order and cancel_order, and the
// wiring that keeps the orders in step with the plan: a final plan builds its week's orders, and any later change to a
// meal, a dish or an everyday item (by the agent, or by the family on a page) rebuilds the ones not yet placed.
// An order goes scheduled → placed (waiting for the person's payment) → paid or not paid; or cancelled before it is placed.
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { KitEvent } from "@flock/app-kit";
import { house, order_lines, orders } from "./db/schema";
import { APP_NAMES, type GroceryApp } from "./db/constants";
import { localStamp, todayStr, weekdayLong } from "./dates";
import { getHouse, groceryApp, name, refuse, words, writeRoutes, type Db, type Emit } from "./family";
import { dateOf, flag, type MealHooks } from "./meals";
import { introText, orderingNowText } from "./messages";
import { productFor, productId, productOf, rememberProduct } from "./products";
import type { RegularHooks } from "./regulars";
import { applyLowOrOut, buildOrdersForWeek, commitOrders, extraOrder, lineRemoved, lineRestored, lowOrOutQuestion, nextScheduled, orderView,
  rebuildScheduledOrders, rollUnpaid, type OrderRow } from "./orders";

export type OrderOptions = {
  /** The time, for tests. */
  now?: () => Date;
  /** The kit's change events (kit.ctx.events): what the family edits on the pages goes through the kit, not these routes. */
  events?: { subscribe(fn: (e: KitEvent) => void): unknown };
  /** How a rebuild is put off after a change. By default it runs once, 2 s after the last change of a burst. */
  schedule?: (run: () => void) => void;
};

/** A change to one of these, by anyone but the app itself, changes what the orders need. */
const PLAN_TABLES = ["plan_meals", "dishes", "dish_items", "regulars"];
const REBUILD_AFTER_MS = 2000;
/** The check-in times the intro names until each check-in has run once and written its own. */
const DINNER_CHECK = "15:00", TOMORROW_CHECK = "19:00";
const STATUS_TEXT: Record<string, string> = { scheduled: "scheduled", placed: "placed, waiting for payment", paid: "paid", not_paid: "not paid", cancelled: "cancelled" };

function debounced(ms: number): (run: () => void) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (run) => { clearTimeout(timer); timer = setTimeout(run, ms); };
}

const timeOr = (v: string | null, fallback: string): string => (v && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);

export function mountOrderRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: OrderOptions = {}): { mealHooks: MealHooks; regularHooks: RegularHooks } {
  const write = writeRoutes(hono);
  const now = opts.now ?? (() => new Date());
  const schedule = opts.schedule ?? debounced(REBUILD_AFTER_MS);
  const find = (id: string | undefined): OrderRow | undefined => (id ? db.select().from(orders).where(eq(orders.id, id)).get() : undefined);
  const notFound = (id: unknown) => ({ status: 404 as const, body: { reason: `no order has the id ${JSON.stringify(id)}` } });
  const conflict = (reason: string) => ({ status: 409 as const, body: { reason } });
  const appName = (o: OrderRow) => APP_NAMES[o.app as GroceryApp] ?? o.app;

  // ── Keeping the orders in step with the plan ──
  const changed = () => schedule(() => {
    // Nobody is waiting on this run: a failure is logged, and the next change tries again.
    try { rebuildScheduledOrders(db, emit); } catch (e) { console.warn("[planner] the orders were not rebuilt", e); }
  });
  opts.events?.subscribe((e) => {
    if (e.by === "app") return;
    if (PLAN_TABLES.includes(e.table)) changed();
    else if (e.table === "order_lines" && e.op === "delete") lineRemoved(db, e.id, emit);
    else if (e.table === "order_lines" && e.op === "insert") lineRestored(db, e.id, emit);
  });

  // ask_low_or_out { week_start, low_or_out? }: without an answer, the week's long-life items and the question to ask about
  // them. With one (the family's words, or a list of items), the items it names are ordered and the rest are at home.
  write("/api/orders/low-or-out", (b, by) => {
    const weekStart = dateOf(b.week_start, "week_start");
    if (b.low_or_out == null) return { body: lowOrOutQuestion(db, weekStart) };
    const answer = typeof b.low_or_out === "string" ? [b.low_or_out]
      : Array.isArray(b.low_or_out) && b.low_or_out.every((a) => typeof a === "string") ? (b.low_or_out as string[])
      : refuse("low_or_out must be the family's answer as text, or a list of the items that are low or out");
    return { body: { order: applyLowOrOut(db, weekStart, answer, now(), by, emit) } };
  });

  // add_to_order { order_id?, item, qty?, product_id?, name_on_app?, pack?, pack_amount?, pack_unit?, price?, image? }: one more
  // line, on the order given, else the next scheduled one, else a new order placed now. With a product_id the product is
  // remembered as the item's; without one the item's remembered product is used.
  write("/api/orders/add", (b, by) => {
    const item = name(b.item, "item");
    const qty = b.qty == null ? null : typeof b.qty === "number" && Number.isInteger(b.qty) && b.qty > 0 ? b.qty : refuse("qty must be a whole number of packs, 1 or more");
    const given = b.order_id == null ? undefined : find(String(b.order_id));
    if (b.order_id != null && !given) return notFound(b.order_id);
    if (given && given.status !== "scheduled") return conflict(`that order is ${STATUS_TEXT[given.status] ?? given.status}: leave order_id out and it goes on the next order`);
    const waiting = given ?? nextScheduled(db);
    const app = waiting?.app ?? groceryApp(db);
    const sent = b.product_id == null ? null : productOf({ ...b, item }, app as GroceryApp);
    const ids = commitOrders(db, emit, (tx, changes) => {
      const o = waiting ?? extraOrder(tx, app, now(), by, changes);
      const had = productFor(tx, item, app);
      const p = sent ? rememberProduct(tx, sent, by) : had;
      if (sent) changes.push(["products", p!.id, had ? "update" : "insert", by]);
      const line = tx.insert(order_lines).values({ order_id: o.id, item, qty: qty ?? 1, qty_checked: qty != null || sent ? 1 : 0, source: "added", updated_by: by,
        ...(p ? { product_id: p.product_id, name_on_app: p.name_on_app, pack: p.pack, price: p.price, image: p.image } : {}) }).returning().get();
      changes.push(["order_lines", line.id, "insert", by]);
      return { order: o.id, line: line.id };
    });
    const order = orderView(db, ids.order)!;
    return { body: { order, line: order.lines.find((l) => l.id === ids.line) } };
  });

  // place_order { order_id }: the agent is about to place it. Answers with the order, the message to send first, and the
  // lines that still need a product or a number of packs. Only a scheduled order with something on it is placed.
  write("/api/orders/:id/place", (_b, by, c) => {
    const o = find(c.req.param("id"));
    if (!o) return notFound(c.req.param("id"));
    if (o.status !== "scheduled") return conflict(`this order is ${STATUS_TEXT[o.status] ?? o.status}: only a scheduled order is placed`);
    if (!orderView(db, o.id)!.lines.length) return conflict("this order has nothing on it yet");
    db.update(orders).set({ wake_sent_at: localStamp(now()), updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
    emit("orders", o.id, "update", by);
    const order = orderView(db, o.id)!;
    return { body: { order, message: orderingNowText(order), needs_product: order.lines.filter((l) => !l.product_id), needs_qty: order.lines.filter((l) => !l.qty_checked) } };
  });

  // record_order { order_id, placed?: boolean, paid?: boolean, total?, app_order_ref?, note? }: what happened on the grocery app.
  // placed: true → placed, waiting for the payment; placed: false → still scheduled, with the note, to be tried again.
  // paid: true → paid; paid: false → not paid, and its lines move to the next order (`rolled_into`).
  // The first order of a planned week recorded placed answers with `intro`, the how-to-use message, once.
  write("/api/orders/:id/record", (b, by, c) => {
    const o = find(c.req.param("id"));
    if (!o) return notFound(c.req.param("id"));
    const placed = b.placed === undefined ? undefined : flag(b.placed, "placed");
    const paid = b.paid === undefined ? undefined : flag(b.paid, "paid");
    if (placed === undefined && paid === undefined) refuse("say what happened: placed: true or false, or paid: true or false");
    if (placed === false && paid !== undefined) refuse("an order that was not placed has no payment: send placed: false alone");
    const set: Partial<typeof orders.$inferInsert> = {};
    if (b.total !== undefined) set.total = b.total === null ? null : typeof b.total === "number" && Number.isFinite(b.total) && b.total >= 0 ? b.total : refuse("total must be a number, 0 or more");
    if (b.app_order_ref !== undefined) set.app_order_ref = b.app_order_ref === null ? null : productId(b.app_order_ref, "app_order_ref");
    if (b.note !== undefined) set.note = words(b.note, "note");
    const is = STATUS_TEXT[o.status] ?? o.status;
    if (placed !== undefined && o.status !== "scheduled") return conflict(`this order is ${is}: only a scheduled order is recorded placed or not placed`);
    if (paid !== undefined && !(o.status === "placed" || placed)) return conflict(`this order is ${is}: only a placed order is recorded paid or not paid`);
    const at = localStamp(now());
    const out = commitOrders(db, emit, (tx, changes) => {
      if (placed) Object.assign(set, { status: "placed", placed_at: at });
      if (placed === false) set.wake_sent_at = null;
      if (paid) Object.assign(set, { status: "paid", paid_at: at });
      tx.update(orders).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
      changes.push(["orders", o.id, "update", by]);
      let intro: string | undefined;
      const home = getHouse(tx);
      if (placed && o.week_start && !home.intro_sent_at) {
        intro = introText(weekdayLong(todayStr(now())), { dinner: timeOr(home.dinner_check_time, DINNER_CHECK), tomorrow: timeOr(home.tomorrow_check_time, TOMORROW_CHECK) });
        tx.update(house).set({ intro_sent_at: new Date().toISOString() }).where(eq(house.id, home.id)).run();
        changes.push(["house", home.id, "update", "app"]);
      }
      return { intro, ...(paid === false ? { rolled: rollUnpaid(tx, o, now(), by, changes) } : {}) };
    });
    return { body: { order: orderView(db, o.id), ...(out.intro ? { intro: out.intro } : {}),
      ...("rolled" in out ? { rolled_into: out.rolled ? orderView(db, out.rolled) : null } : {}) } };
  });

  // cancel_order { order_id }: a scheduled order is cancelled, and no longer covers its days. A placed one is not paid for:
  // exactly record_order paid: false, nothing is cancelled on the grocery app. A paid order is cancelled there, by the person.
  write("/api/orders/:id/cancel", (_b, by, c) => {
    const o = find(c.req.param("id"));
    if (!o) return notFound(c.req.param("id"));
    if (o.status === "paid") return conflict(`a paid order can't be cancelled here; cancel it in ${appName(o)}`);
    if (o.status === "not_paid") return conflict("this order was not paid: its items already moved to the next order");
    if (o.status === "cancelled") return conflict("this order is already cancelled");
    const rolled = commitOrders(db, emit, (tx, changes) => {
      if (o.status === "placed") return rollUnpaid(tx, o, now(), by, changes);
      tx.update(orders).set({ status: "cancelled", updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
      changes.push(["orders", o.id, "update", by]);
      return undefined;
    });
    return { body: { order: orderView(db, o.id), ...(rolled === undefined ? {} : { rolled_into: rolled ? orderView(db, rolled) : null }) } };
  });

  return {
    mealHooks: { onFinal: (weekStart) => buildOrdersForWeek(db, weekStart, now(), emit), onChanged: changed },
    regularHooks: { onChanged: changed },
  };
}
