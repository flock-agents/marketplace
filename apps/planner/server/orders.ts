// The orders: what is bought, grouped by when it is needed. A final plan gives each pair of days an order: fresh items go
// in the order that covers their day; long-life ones once: in the week's first order when its own days need them (the
// family cooks with them before any other order comes), else in the second, where the family's low-or-out answer can still
// change them. The first order is placed right away, the others the evening before their first day. A placed order nobody
// paid for in a day is closed as not paid; paid after all, it takes back the lines that moved on. Orders not yet placed follow the plan: every change to a meal, a dish or
// an everyday item builds their lines again, keeping what the family added and leaving out what they said they have.
// Nothing about what is at home is stored beyond the order it was said about (skipped_items).
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { _changes } from "@flock/app-kit";
import { dish_items, dishes, order_lines, orders, plan_meals, regulars } from "./db/schema";
import { MORNING_TIME, ORDER_TIME } from "./db/constants";
import { addDays, dayLabel, localStamp, mondayOf, todayStr } from "./dates";
import { groceryApp, list, type Db, type Emit } from "./family";
import { orderingNowText } from "./messages";
import { normItem, packsFor, parsePack, productFor } from "./products";
import { regularNeeds } from "./regulars";

/** How long an order waits for a second try: one handed to the agent and never recorded is handed over again after this
 *  long, and one recorded as not placed is due again this long after. */
export const REWAKE_AFTER_MIN = 60;
/** How long a placed order waits for its payment before the order clock closes it as not paid. */
export const UNPAID_AFTER_HOURS = 24;
/** The note the order clock leaves on an order it closed, for the Shopping page. */
export const UNPAID_NOTE = `not paid within ${UNPAID_AFTER_HOURS} hours`;

/** One thing needed on one day: an ingredient of a dish, or an everyday item. */
export type Need = { date: string; item: string; amount: number | null; unit: string | null; keeps: "fresh" | "long";
  source: "dish" | "regular"; source_id: string; label: string };
/** What a line is for: "Mon 23 Nov lunch: Aloo gobi", "Everyday: milk". */
export type Source = { kind: "dish" | "regular"; id: string; label: string };
export type Grouped = { item: string; unit: string | null; amount: number | null; keeps: "fresh" | "long"; sources: Source[] };
export type OrderRow = typeof orders.$inferSelect;
export type LineRow = typeof order_lines.$inferSelect;
/** An order as the routes answer with it. `total` adds up the lines that have a price; `recorded_total` is what the grocery
 *  app charged, once the agent recorded it. */
export type OrderView = Omit<OrderRow, "total" | "skipped_items"> & { total: number; recorded_total: number | null; skipped_items: string[]; lines: LineRow[] };
type Change = Parameters<Emit>;

// ── Pure: grouping needs into lines, days into orders, and reading the low-or-out answer ──

const lineKey = (item: string, unit: string | null): string => `${normItem(item)}|${(unit ?? "").trim().toLowerCase()}`;

/** Needs added up into lines: one line per item and unit. The same item in two units stays two lines (2 pc and 200 g of
 *  onion are never one number); an amount nobody gave leaves the line's amount unknown. */
export function groupNeeds(needs: Need[]): Grouped[] {
  const lines = new Map<string, Grouped>();
  for (const n of needs) {
    const key = lineKey(n.item, n.unit);
    const g = lines.get(key);
    if (!g) { lines.set(key, { item: n.item.trim(), unit: n.unit, amount: n.amount, keeps: n.keeps, sources: [{ kind: n.source, id: n.source_id, label: n.label }] }); continue; }
    // Rounded to a millionth, so 0.1 + 0.2 is 0.3.
    g.amount = g.amount == null || n.amount == null ? null : Math.round((g.amount + n.amount) * 1e6) / 1e6;
    if (n.keeps === "long") g.keeps = "long";
    if (!g.sources.some((s) => s.kind === n.source && s.id === n.source_id)) g.sources.push({ kind: n.source, id: n.source_id, label: n.label });
  }
  return [...lines.values()];
}

/** An order there already is, by the date it is placed. Paid and not paid count as placed: that date's order has gone out. */
export type LiveOrder = { id: string; date: string; status: "scheduled" | "placed" | "paid" | "not_paid" };
export type PlannedOrder = { days: string[]; place_at: string; merge_into?: string; first: boolean };

/** Days that no order covers yet (ascending), made into orders: two days next to each other share one. The first is placed
 *  now, each later one the evening before its first day. One order a date at most: a pair that lands on a date with a
 *  scheduled order joins it; on a date whose order was already placed, it moves to the morning of its first day. */
export function planOrders(i: { days: string[]; now: string; live: LiveOrder[] }): PlannedOrder[] {
  const pairs: string[][] = [];
  for (const day of i.days) {
    const last = pairs[pairs.length - 1];
    if (last && last.length === 1 && addDays(last[0], 1) === day) last.push(day); else pairs.push([day]);
  }
  const on = (date: string, scheduled: boolean) => i.live.find((o) => o.date === date && (o.status === "scheduled") === scheduled);
  return pairs.map((days, k) => {
    let place_at = k === 0 ? i.now : `${addDays(days[0], -1)}T${ORDER_TIME}`;
    let into = on(place_at.slice(0, 10), true);
    if (!into && on(place_at.slice(0, 10), false)) {
      place_at = `${days[0]}T${MORNING_TIME}`;
      into = on(days[0], true);
    }
    return { days, place_at, ...(into ? { merge_into: into.id } : {}), first: k === 0 };
  });
}

/** The words of a low-or-out answer: lowercase, without punctuation or "and". */
function answerWords(answer: string[]): Set<string> {
  const words = answer.flatMap((a) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" "));
  return new Set(words.filter((w) => w && w !== "and"));
}

/** The asked items an answer names. A list names whole items: "toor dal" is toor dal, not every dal. The family's own
 *  words, as one text, name an item when they have one of its words ("dal" names every dal; "ATTA is low" names atta).
 *  A name or a word that is nothing asked is ignored. */
export function namedItems(asked: string[], answer: string | string[]): string[] {
  if (Array.isArray(answer)) { const whole = new Set(answer.map(normItem)); return asked.filter((item) => whole.has(normItem(item))); }
  const words = answerWords([answer]);
  return asked.filter((item) => normItem(item).split(" ").some((w) => words.has(w)));
}

// ── Reading ──

const dates = (from: string, to: string): string[] => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const skips = (o: OrderRow): string[] => list<string>(o.skipped_items).map(normItem);
/** An order made from a plan has a week; one made for an added, rolled or missing item has none, and no days of its own. */
const planned = (o: OrderRow): o is OrderRow & { week_start: string } => !!o.week_start;

/** Everything needed on `days`: the ingredients of the dishes of final meals, and the everyday items due. */
export function collectNeeds(db: Db, days: string[]): Need[] {
  if (!days.length) return [];
  const needs: Need[] = [];
  const meals = db.select().from(plan_meals).where(and(inArray(plan_meals.date, days), eq(plan_meals.status, "final"))).orderBy(asc(plan_meals.date), asc(plan_meals.created_at), sql`rowid`).all();
  for (const m of meals) {
    if (m.ordered_in) continue;
    for (const d of db.select().from(dishes).where(eq(dishes.meal_id, m.id)).orderBy(asc(dishes.position), asc(dishes.created_at)).all()) {
      const label = `${dayLabel(m.date)} ${m.slot.charAt(0).toLowerCase()}${m.slot.slice(1)}: ${d.name}`;
      for (const i of db.select().from(dish_items).where(eq(dish_items.dish_id, d.id)).orderBy(asc(dish_items.created_at), sql`rowid`).all())
        needs.push({ date: m.date, item: i.item, amount: i.amount, unit: i.unit, keeps: i.keeps === "long" ? "long" : "fresh", source: "dish", source_id: d.id, label });
    }
  }
  for (const r of db.select().from(regulars).orderBy(asc(regulars.created_at), sql`rowid`).all())
    for (const n of regularNeeds(r, days))
      needs.push({ date: n.date, item: r.item, amount: n.amount, unit: r.unit, keeps: r.keeps === "long" ? "long" : "fresh", source: "regular", source_id: r.id, label: `Everyday: ${r.item}` });
  return needs;
}

function linesOf(db: Db, orderIds: string[]): LineRow[] {
  return orderIds.length ? db.select().from(order_lines).where(inArray(order_lines.order_id, orderIds)).orderBy(asc(order_lines.created_at), sql`rowid`).all() : [];
}

export function orderView(db: Db, id: string): OrderView | null {
  const o = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!o) return null;
  const lines = linesOf(db, [id]);
  const total = lines.reduce((sum, l) => sum + (l.price == null ? 0 : (l.qty ?? 1) * l.price), 0);
  return { ...o, total, recorded_total: o.total, skipped_items: list<string>(o.skipped_items), lines };
}

/** A week's orders that were not cancelled, in the order they are placed. */
export function weekOrders(db: Db, weekStart: string): OrderView[] {
  return db.select({ id: orders.id }).from(orders).where(and(eq(orders.week_start, weekStart), ne(orders.status, "cancelled"))).orderBy(asc(orders.place_at), sql`rowid`).all()
    .map((o) => orderView(db, o.id)!);
}

/** The scheduled order placed soonest that can still be changed: of one week, or of all of them. An order the agent was
 *  woken to place (place_order) is being placed as it was read: nothing is added to it or taken off it until it is recorded. */
export function nextScheduled(db: Db, weekStart?: string): OrderRow | null {
  return db.select().from(orders).where(and(eq(orders.status, "scheduled"), isNull(orders.wake_sent_at), ...(weekStart ? [eq(orders.week_start, weekStart)] : [])))
    .orderBy(asc(orders.place_at), sql`rowid`).limit(1).get() ?? null;
}

/** Does the week have orders made from its plan (cancelled ones aside)? */
export function weekHasOrders(db: Db, weekStart: string): boolean {
  return !!db.select({ id: orders.id }).from(orders).where(and(eq(orders.week_start, weekStart), ne(orders.status, "cancelled"))).limit(1).get();
}

// ── Building ──

/** Where a week's long-life items not yet bought go. `first` is the week's first order while it can still be changed: it
 *  takes the ones its own days need. `carrier` takes the rest: the soonest scheduled order after the first (the first
 *  goes out at once, before the family is asked what is low or out). The first is the one for the week's earliest days,
 *  cancelled or not: a first order that was cancelled does not make the second one the first. When no later order can
 *  take them (a week of one order, or every later one placed), the soonest scheduled order is the carrier. Both are null
 *  when no order of the week can still be changed. */
export function longHomes(db: Db, weekStart: string): { first: OrderRow | null; carrier: OrderRow | null } {
  const week = db.select().from(orders).where(eq(orders.week_start, weekStart)).orderBy(asc(orders.place_at), sql`rowid`).all();
  const firstDay = week.map((o) => o.covers_from).sort()[0];
  const open = week.filter((o) => o.status === "scheduled" && !o.wake_sent_at);
  return { first: open.find((o) => o.covers_from === firstDay) ?? null, carrier: open.find((o) => o.covers_from > firstDay) ?? open[0] ?? null };
}

/** A week's long-life side: the orders made for it, the long-life needs of the days they cover, and the scheduled orders
 *  that take what is not yet bought (longHomes). A day before the week counts only when its own week has no
 *  orders: an order taken over from last week does not buy last week's rice again. */
function weekLong(db: Db, weekStart: string) {
  const live = db.select().from(orders).where(ne(orders.status, "cancelled")).all().filter(planned);
  const mine = live.filter((o) => o.week_start === weekStart);
  const otherWeeks = new Set(live.map((o) => o.week_start));
  const days = [...new Set(mine.flatMap((o) => dates(o.covers_from, o.covers_to)))].sort().filter((d) => d >= weekStart || !otherWeeks.has(mondayOf(d)));
  const needs = collectNeeds(db, days).filter((n) => n.keeps === "long"), homes = longHomes(db, weekStart), first = homes.first;
  // An item the first order's days need is bought with it, the whole week's worth at once; one first needed later waits.
  const early = new Set(first ? needs.filter((n) => n.date >= first.covers_from && n.date <= first.covers_to).map((n) => normItem(n.item)) : []);
  /** The order an item not yet bought goes on, and the one a low-or-out answer is about: the first while it holds any. */
  const homeOf = (item: string): OrderRow | null => (early.has(normItem(item)) ? first : homes.carrier);
  return { mine, lines: linesOf(db, mine.map((o) => o.id)), needs, ...homes, homeOf, asked: early.size ? first : homes.carrier };
}

/** How many packs of a product cover an amount, from the pack's size (or its text, when plain: "500 ml"); null when the
 *  amount is not known or the two cannot be compared. */
export function productPacks(p: { pack_amount: number | null; pack_unit: string | null; pack: string | null }, amount: number | null, unit: string | null): number | null {
  const pack = p.pack_amount != null ? { amount: p.pack_amount, unit: p.pack_unit } : parsePack(p.pack);
  return amount == null || !pack ? null : packsFor(amount, unit, pack.amount, pack.unit);
}

/** The product and the number of packs for a line: the product remembered for the item, with as many packs as cover the
 *  amount. When the packs cannot be worked out the line keeps the number it had (1 when new), marked for the agent to set. */
function stocked(db: Db, app: string, g: Grouped, line?: LineRow) {
  const p = productFor(db, g.item, app);
  const qty = p ? productPacks(p, g.amount, g.unit) : productPacks({ pack_amount: null, pack_unit: null, pack: line?.pack ?? null }, g.amount, g.unit);
  return { ...(p ? { product_id: p.product_id, name_on_app: p.name_on_app, pack: p.pack, price: p.price, image: p.image } : {}),
    qty: qty ?? line?.qty ?? 1, qty_checked: qty == null ? 0 : 1 };
}

/** Make an order's dish and everyday lines the ones `wanted`. A line whose amount did not change is left as it is (the
 *  packs the family or the agent set stay), so building twice from the same plan changes nothing. */
function syncLines(db: Db, o: OrderRow, wanted: Grouped[], had: LineRow[], changes: Change[]) {
  const left = new Map<string, LineRow>();
  const drop = (l: LineRow) => { db.delete(order_lines).where(eq(order_lines.id, l.id)).run(); changes.push(["order_lines", l.id, "delete", "app"]); };
  for (const l of had) { const key = lineKey(l.item, l.unit); if (left.has(key)) drop(l); else left.set(key, l); }
  for (const g of wanted) {
    const key = lineKey(g.item, g.unit), line = left.get(key);
    const source = g.sources.some((s) => s.kind === "dish") ? "dish" : "regular", sources = JSON.stringify(g.sources);
    if (!line) {
      const row = db.insert(order_lines).values({ ...stocked(db, o.app, g), order_id: o.id, item: g.item, amount: g.amount, unit: g.unit, source, sources, updated_by: "app" }).returning().get();
      changes.push(["order_lines", row.id, "insert", "app"]);
      continue;
    }
    left.delete(key);
    const restock = line.amount !== g.amount || (!line.product_id && !!productFor(db, g.item, o.app));
    if (!restock && line.source === source && line.sources === sources) continue;
    db.update(order_lines).set({ ...(restock ? { ...stocked(db, o.app, g, line), amount: g.amount } : {}), source, sources, updated_at: new Date().toISOString() }).where(eq(order_lines.id, line.id)).run();
    changes.push(["order_lines", line.id, "update", "app"]);
  }
  for (const l of left.values()) drop(l);
}

/** Give every scheduled order of a plan the lines its days need now. Fresh items go to the order covering their day;
 *  long-life ones to the week's first order when its days need them, else to the second (longHomes), unless an order already placed has them, a line rolled over from
 *  an unpaid order has them, or the family said they have them. Lines the family added are not touched, and neither is an
 *  order the agent was woken to place: it is caught up by the next rebuild if it comes back not placed. */
export function fillOrders(db: Db, changes: Change[]) {
  const scheduled = db.select().from(orders).where(and(eq(orders.status, "scheduled"), isNull(orders.wake_sent_at))).orderBy(asc(orders.place_at), sql`rowid`).all().filter(planned);
  for (const weekStart of new Set(scheduled.map((o) => o.week_start))) {
    const w = weekLong(db, weekStart);
    const bought = new Set(w.mine.filter((o) => o.status === "placed" || o.status === "paid" || (o.status === "scheduled" && o.wake_sent_at)).map((o) => o.id));
    const have = new Set(w.lines.filter((l) => bought.has(l.order_id) || (l.source === "added" && l.sources)).map((l) => normItem(l.item)));
    const atHome = new Set(w.mine.flatMap(skips));
    const long = w.needs.filter((n) => !have.has(normItem(n.item)) && !atHome.has(normItem(n.item)));
    const longFor = (o: OrderRow) => long.filter((n) => w.homeOf(n.item)?.id === o.id);
    for (const o of scheduled.filter((s) => s.week_start === weekStart)) {
      const own = new Set(skips(o));
      const fresh = collectNeeds(db, dates(o.covers_from, o.covers_to)).filter((n) => n.keeps !== "long" && !own.has(normItem(n.item)));
      syncLines(db, o, groupNeeds([...fresh, ...longFor(o)]), w.lines.filter((l) => l.order_id === o.id && l.source !== "added"), changes);
    }
  }
}

/** Run a write on the orders in one transaction; the pages hear of its changes only once it is committed. */
export function commitOrders<T>(db: Db, emit: Emit, run: (tx: Db, changes: Change[]) => T): T {
  const changes: Change[] = [];
  const out = db.transaction((tx) => run(tx as unknown as Db, changes));
  for (const c of changes) emit(...c);
  return out;
}

/** After the plan, a dish or an everyday item changed: every order not yet placed gets the lines its days need now. */
export function rebuildScheduledOrders(db: Db, emit: Emit): void { commitOrders(db, emit, fillOrders); }

/** What the agent needs to place an order: the order, the message to send the family first, and the lines that still need a
 *  product or a number of packs. */
export type PlacePayload = { order: OrderView; message: string; needs_product: LineRow[]; needs_qty: LineRow[] };

/** The agent is about to place a scheduled order, called by it (place_order) or woken by the order clock: the order is
 *  brought up to the plan as it stands now, then marked as being placed, so nothing changes under the agent. Null when it
 *  has nothing on it: such an order is not placed, and not marked. */
export function startPlacing(db: Db, emit: Emit, id: string, now: Date, by: string): PlacePayload | null {
  rebuildScheduledOrders(db, emit);
  if (!orderView(db, id)?.lines.length) return null;
  db.update(orders).set({ wake_sent_at: localStamp(now), updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, id)).run();
  emit("orders", id, "update", by);
  const order = orderView(db, id)!;
  return { order, message: orderingNowText(order), needs_product: order.lines.filter((l) => !l.product_id), needs_qty: order.lines.filter((l) => !l.qty_checked) };
}

/** A scheduled order with no days of its own, placed now: for an item added when no order is waiting, or a long-life item
 *  that turned out to be missing. */
export function extraOrder(db: Db, app: string, now: Date, by: string, changes: Change[]): OrderRow {
  const row = db.insert(orders).values({ place_at: localStamp(now), covers_from: todayStr(now), covers_to: todayStr(now), week_start: null, app, status: "scheduled", updated_by: by }).returning().get();
  changes.push(["orders", row.id, "insert", by]);
  return row;
}

/** Once a week's plan is final: an order for every day from tomorrow to the week's Sunday that no order covers yet (a
 *  cancelled order covers nothing), then the lines of every scheduled order. All of it in one transaction: a failure
 *  leaves the orders as they were. Answers with the week's orders. */
export function buildOrdersForWeek(db: Db, weekStart: string, now: Date, emit: Emit): OrderView[] {
  commitOrders(db, emit, (tx, changes) => {
    const live = tx.select().from(orders).where(ne(orders.status, "cancelled")).all();
    const covered = new Set(live.filter(planned).flatMap((o) => dates(o.covers_from, o.covers_to)));
    const days = dates(addDays(todayStr(now), 1), addDays(weekStart, 6)).filter((d) => !covered.has(d));
    const app = groceryApp(tx);
    // An order the agent was already woken to place is as good as placed: nothing joins it now.
    const there: LiveOrder[] = live.map((o) => ({ id: o.id, date: o.place_at.slice(0, 10), status: o.status === "scheduled" && !o.wake_sent_at ? "scheduled" : "placed" }));
    for (const p of planOrders({ days, now: localStamp(now), live: there })) {
      const from = p.days[0], to = p.days[p.days.length - 1];
      const into = p.merge_into ? live.find((o) => o.id === p.merge_into) : undefined;
      if (into) {
        const own = planned(into);
        tx.update(orders).set({ covers_from: own && into.covers_from < from ? into.covers_from : from, covers_to: own && into.covers_to > to ? into.covers_to : to,
          week_start: weekStart, updated_at: new Date().toISOString() }).where(eq(orders.id, into.id)).run();
        changes.push(["orders", into.id, "update", "app"]);
      } else {
        const row = tx.insert(orders).values({ place_at: p.place_at, covers_from: from, covers_to: to, week_start: weekStart, app, status: "scheduled", updated_by: "app" }).returning().get();
        changes.push(["orders", row.id, "insert", "app"]);
      }
    }
    fillOrders(tx, changes);
  });
  return weekOrders(db, weekStart);
}

// ── Low or out ──

/** What ask_low_or_out asks about: the long-life items on the week's orders that are scheduled, placed or paid. */
export function lowOrOutQuestion(db: Db, weekStart: string): { order_id: string | null; items: string[]; question: string | null } {
  const w = weekLong(db, weekStart);
  const long = new Set(w.needs.map((n) => normItem(n.item)));
  const live = new Set(w.mine.filter((o) => o.status !== "not_paid").map((o) => o.id));
  const items = new Map<string, string>();
  for (const l of w.lines) if (live.has(l.order_id) && long.has(normItem(l.item)) && !items.has(normItem(l.item))) items.set(normItem(l.item), l.item.trim());
  const names = [...items.keys()].sort().map((k) => items.get(k)!);
  const text = names.join(", ");
  return { order_id: w.asked?.id ?? null, items: names, question: text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}: any low or out?` : null };
}

/** The family's answer, applied to the orders the week's long-life items still wait on (longHomes: the first while it can
 *  be changed, for what its days need; the second for the rest). What was asked is every long-life item on a live order
 *  or said to be at home earlier. One the answer does not name is at home: its lines leave that order and it is skipped
 *  there. One it names is ordered: it comes back to that order when no live order has it; with no scheduled order left, a
 *  new order placed now takes it. Orders already placed are not touched. Answers with the order changed or made, or null. */
export function applyLowOrOut(db: Db, weekStart: string, answer: string | string[], now: Date, by: string, emit: Emit): OrderView | null {
  const id = commitOrders(db, emit, (tx, changes) => {
    const w = weekLong(tx, weekStart);
    const long = new Set(w.needs.map((n) => normItem(n.item)));
    const live = new Set(w.mine.filter((o) => o.status !== "not_paid").map((o) => o.id));
    const onLive = new Set(w.lines.filter((l) => live.has(l.order_id)).map((l) => normItem(l.item)).filter((i) => long.has(i)));
    const asked = [...new Set([...onLive, ...w.mine.flatMap(skips).filter((i) => long.has(i))])].sort();
    const named = new Set(namedItems(asked, answer));
    const atHome = asked.filter((i) => !named.has(i));
    for (const o of w.mine) {
      const was = skips(o);
      const next = was.filter((i) => !named.has(i));
      for (const i of atHome) if (w.homeOf(i)?.id === o.id && !next.includes(i)) next.push(i);
      if (next.length === was.length && next.every((i, k) => i === was[k])) continue;
      tx.update(orders).set({ skipped_items: JSON.stringify(next), updated_at: new Date().toISOString() }).where(eq(orders.id, o.id)).run();
      changes.push(["orders", o.id, "update", by]);
    }
    if (w.carrier) {
      for (const l of w.lines.filter((x) => (x.order_id === w.carrier!.id || x.order_id === w.first?.id) && atHome.includes(normItem(x.item)))) {
        tx.delete(order_lines).where(eq(order_lines.id, l.id)).run();
        changes.push(["order_lines", l.id, "delete", "app"]);
      }
      fillOrders(tx, changes);
      return (w.asked ?? w.carrier).id;
    }
    const missing = groupNeeds(w.needs.filter((n) => named.has(normItem(n.item)) && !onLive.has(normItem(n.item))));
    if (!missing.length) return null;
    const extra = extraOrder(tx, groceryApp(tx), now, by, changes);
    for (const g of missing) {
      const row = tx.insert(order_lines).values({ ...stocked(tx, extra.app, g), order_id: extra.id, item: g.item, amount: g.amount, unit: g.unit, source: "added", sources: JSON.stringify(g.sources), updated_by: by }).returning().get();
      changes.push(["order_lines", row.id, "insert", by]);
    }
    return extra.id;
  });
  return id ? orderView(db, id) : null;
}

// ── Not paid ──

/** An order that was placed and not paid: its lines move to the next scheduled order, of its own week when there is one,
 *  as added lines, each still saying what it is for. With no scheduled order waiting nothing moves and no order is made
 *  (one made now would be placed at once, and ask for the same payment again): the lines stay on the unpaid order. The
 *  unpaid order keeps its days, so nothing is built for them again. Answers with the id of the order the lines went to,
 *  or null when they went nowhere. */
export function rollUnpaid(db: Db, o: OrderRow, by: string, changes: Change[]): string | null {
  db.update(orders).set({ status: "not_paid", updated_at: new Date().toISOString(), updated_by: by }).where(eq(orders.id, o.id)).run();
  changes.push(["orders", o.id, "update", by]);
  // The same week's next order first: its items are for that week's days.
  const target = (o.week_start ? nextScheduled(db, o.week_start) : null) ?? nextScheduled(db);
  if (!target) return null;
  for (const l of linesOf(db, [o.id])) {
    db.update(order_lines).set({ order_id: target.id, source: "added", rolled_from: o.id, updated_at: new Date().toISOString(), updated_by: by }).where(eq(order_lines.id, l.id)).run();
    changes.push(["order_lines", l.id, "update", by]);
  }
  return target.id;
}

/** An order closed as not paid was paid after all: the lines that moved on come back to it, each what it was, from an order
 *  that can still be changed. One already placed, or being placed, keeps them (they may be bought twice): `left_on` names
 *  it. The orders the lines came off are then brought up to the plan again. */
export function takeBackRolled(db: Db, o: OrderRow, by: string, changes: Change[]): { taken_back: number; left_on: string | null } {
  let taken_back = 0, left_on: string | null = null;
  for (const l of db.select().from(order_lines).where(eq(order_lines.rolled_from, o.id)).orderBy(asc(order_lines.created_at), sql`rowid`).all()) {
    const home = db.select().from(orders).where(eq(orders.id, l.order_id)).get();
    if (!home || home.status !== "scheduled" || home.wake_sent_at) { left_on ??= l.order_id; continue; }
    const kinds = list<Source>(l.sources).map((s) => s.kind);
    const source = kinds.includes("dish") ? "dish" : kinds.includes("regular") ? "regular" : "added";
    db.update(order_lines).set({ order_id: o.id, source, rolled_from: null, updated_at: new Date().toISOString(), updated_by: by }).where(eq(order_lines.id, l.id)).run();
    changes.push(["order_lines", l.id, "update", by]);
    taken_back++;
  }
  if (taken_back) fillOrders(db, changes);
  return { taken_back, left_on };
}

// ── Lines the family removed on the Shopping page ──

/** A dish or everyday line removed from a scheduled order (through the kit's data routes, which keep the row as it was):
 *  the order remembers the item as one the family has, so the next rebuild does not bring it back. */
export function lineRemoved(db: Db, lineId: string, emit: Emit): void {
  const change = db.select().from(_changes).where(and(eq(_changes.table_name, "order_lines"), eq(_changes.row_id, lineId), eq(_changes.op, "delete"))).orderBy(desc(sql`rowid`)).limit(1).get();
  let line: Partial<LineRow> | null = null;
  try { line = change?.before ? JSON.parse(change.before) : null; } catch { /* nothing to read */ }
  if (!line?.item || !line.order_id || line.source === "added") return;
  setSkipped(db, line.order_id, (was) => (was.includes(normItem(line!.item!)) ? was : [...was, normItem(line!.item!)]), emit);
}

/** The line is back (the removal was undone): the item is no longer one the family has. */
export function lineRestored(db: Db, lineId: string, emit: Emit): void {
  const line = db.select().from(order_lines).where(eq(order_lines.id, lineId)).get();
  if (!line || line.source === "added") return;
  setSkipped(db, line.order_id, (was) => was.filter((i) => i !== normItem(line.item)), emit);
}

function setSkipped(db: Db, orderId: string, change: (was: string[]) => string[], emit: Emit) {
  const o = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!o || o.status !== "scheduled") return;
  const was = skips(o), next = change(was);
  if (next.length === was.length) return;
  db.update(orders).set({ skipped_items: JSON.stringify(next), updated_at: new Date().toISOString() }).where(eq(orders.id, o.id)).run();
  emit("orders", o.id, "update", "app");
}
