// The reminder: what the 15:00 (tonight's dinner) and 19:00 (tomorrow's meals) messages say and do. Each one is whole on its
// own: the meals it covers and the ingredients to check, tomorrow's everyday items put on the cart, and the items that may be
// running low asked together (at most ESTIMATE.maxAsks, each counted once per reminder; after two unanswered asks an item is
// snoozed instead). With "Order without asking" on, the confident ones go on the cart and every open cart is ordered. A dry
// run (the routine's "anything to say?") answers the same and changes nothing. Lines put on while an app's cart is being
// ordered go to a new open cart of that app (cart.ts setLine).
import type { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { item_events, items, order_lines, orders, regulars } from "./db/schema";
import { APP_NAMES, CART_SYNC, ESTIMATE, type GroceryApp } from "./db/constants";
import { addDays, mondayOf, todayStr } from "./dates";
import { refuse, shoppingApps, writeRoutes, type Db, type Emit } from "./family";
import { weekView, type MealView } from "./meals";
import { regularNeeds } from "./regulars";
import { itemFor, itemStates, recomputeItem } from "./items";
import { isDue, pickAsks } from "./estimate";
import { cartOf, cartsView, emitAll, lineApp, lineFor, setLine, startOrdering, type Change, type LineRow } from "./cart";
import { normItem, packsFor, productFor } from "./products";
import { orderingNowText, reminderText, stockBlock } from "./messages";

export const WHICH = ["afternoon", "evening"] as const;
export type Which = (typeof WHICH)[number];
export type Reminder = { which: Which; date: string /* the meals' date: today (afternoon) or tomorrow (evening) */;
  meals: MealView[]; ask_ingredients: string[]; added: { app: GroceryApp; item: string }[]; cart_items: string[];
  asks: { item: string; days_ago: number }[]; delivery_gap: { app: string; rupees: number } | null;
  ordered: { order_id: string; app: GroceryApp; message: string }[]; empty: boolean;
  text: string /* WhatsApp: numbered */; app_text: string; block: object | null /* flock-ui JSON */;
  carts: { order_id: string; app: GroceryApp; lines: LineRow[]; sync: boolean }[] };

const LOW_NOTE = "might be running low";
const DAY_MS = 86_400_000;
const utc = (date: string) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

/** Thrown inside a dry run's transaction, so everything it wrote is rolled back. */
class DryRun extends Error {}

/** The items (normalised) with a line of qty above 0 on a cart in one of `statuses`; with `forDate`, only lines for that date. */
function onCarts(tx: Db, statuses: string[], forDate?: string): Set<string> {
  const rows = tx.select({ item: order_lines.item, qty: order_lines.qty, for_date: order_lines.for_date }).from(order_lines)
    .innerJoin(orders, eq(order_lines.order_id, orders.id)).where(inArray(orders.status, statuses)).all();
  return new Set(rows.filter((l) => (forDate ? l.for_date === forDate : (l.qty ?? 0) > 0)).map((l) => normItem(l.item)));
}

/** The meals a reminder covers: tonight's dinner when it is cooked (afternoon); every meal of tomorrow (evening). */
function coveredMeals(tx: Db, which: Which, date: string): MealView[] {
  const day = weekView(tx, mondayOf(date)).days.find((d) => d.date === date)?.meals ?? [];
  return which === "afternoon" ? day.filter((m) => m.slot === "Dinner" && !m.ordered_in && m.dishes.length)
    : day.filter((m) => m.ordered_in || m.dishes.length);
}

function build(tx: Db, which: Which, now: Date, by: string, changes: Change[]): Reminder {
  const today = todayStr(now), tomorrow = addDays(today, 1);
  const date = which === "afternoon" ? today : tomorrow, key = `${date}:${which}`;
  const opts = { changes, at: now };
  const shop = shoppingApps(tx);
  const onCart = onCarts(tx, ["open", "ordering"]);
  const active = tx.select().from(regulars).where(eq(regulars.active, 1)).all();

  // The meals, and their ingredients to check: not an everyday item, not monthly, not subscribed, not on a cart already.
  const meals = coveredMeals(tx, which, date);
  const everyday = new Set(active.map((r) => normItem(r.item)));
  const ask_ingredients: string[] = [], seen = new Set<string>();
  for (const m of meals) for (const d of m.dishes) for (const i of d.ingredients) {
    const k = normItem(i.item);
    if (seen.has(k)) continue;
    seen.add(k);
    const it = itemFor(tx, i.item);
    if (everyday.has(k) || it?.group === "monthly" || it?.subscription || onCart.has(k)) continue;
    ask_ingredients.push(i.item.trim());
  }

  // Tomorrow's everyday items, unless a line of the item for tomorrow is already on a cart (her own qty there stands).
  const added: Reminder["added"] = [];
  const forTomorrow = onCarts(tx, ["open", "ordering", "placed", "paid"], tomorrow);
  for (const r of active) {
    if (!regularNeeds(r, [tomorrow]).length || forTomorrow.has(normItem(r.item))) continue;
    const it = itemFor(tx, r.item);
    if (it?.subscription) continue;
    const app = lineApp(tx, it), p = productFor(tx, r.item, app);
    const packs = (p && r.amount != null ? packsFor(r.amount, r.unit, p.pack_amount, p.pack_unit) : null) ?? 1;
    const open = cartOf(tx, app, "open"), had = open ? lineFor(tx, open.id, r.item) : null;
    const row = setLine(tx, { item: r.item, qty: Math.max(packs, had?.qty ?? 0), app, source: "everyday", for_date: tomorrow }, by, opts)!;
    forTomorrow.add(normItem(r.item));
    added.push({ app, item: row.item });
  }

  // Running low: the due items not on a cart.
  const states = itemStates(tx, today).filter((s) => !onCart.has(normItem(s.name)));
  const asks: Reminder["asks"] = [];
  if (shop.order_without_asking) {
    // Confident due items are ordered, not asked.
    for (const s of states.filter((s) => isDue(s, date)).sort((x, y) => x.run_out!.localeCompare(y.run_out!)))
      setLine(tx, { item: s.name, qty: 1, source: "low", for_note: LOW_NOTE }, by, opts);
  } else {
    const done = new Set<string>();
    while (asks.length < ESTIMATE.maxAsks) {
      const next = pickAsks(states.filter((s) => !done.has(s.id)), date)[0];
      if (!next) break;
      done.add(next.id);
      const it = tx.select().from(items).where(eq(items.id, next.id)).get()!;
      // Asked already for this same reminder (an agent retry): asked again, not counted again.
      if (it.last_ask_key !== key) {
        if ((it.asks_unanswered ?? 0) >= ESTIMATE.unansweredLimit) {
          // Two asks went unanswered: snoozed for its group's default, not counted either way, and its waiting line goes.
          const days = ESTIMATE.snoozeDays[it.group as keyof typeof ESTIMATE.snoozeDays] ?? 1;
          tx.update(items).set({ snoozed_until: addDays(today, days), asks_unanswered: 0, updated_at: now.toISOString(), updated_by: by }).where(eq(items.id, it.id)).run();
          const ev = tx.insert(item_events).values({ item_id: it.id, date: today, kind: "unanswered", updated_by: by }).returning().get();
          changes.push(["item_events", ev.id, "insert", by]);
          for (const o of tx.select().from(orders).where(eq(orders.status, "open")).all()) {
            const l = lineFor(tx, o.id, it.name);
            if (l && l.source === "low" && !l.qty) { tx.delete(order_lines).where(eq(order_lines.id, l.id)).run(); changes.push(["order_lines", l.id, "delete", by]); }
          }
          recomputeItem(tx, it.id, today);
          changes.push(["items", it.id, "update", by]);
          continue;
        }
        tx.update(items).set({ asks_unanswered: (it.asks_unanswered ?? 0) + 1, last_ask_key: key, updated_at: now.toISOString(), updated_by: by }).where(eq(items.id, it.id)).run();
        const ev = tx.insert(item_events).values({ item_id: it.id, date: today, kind: "ask", updated_by: by }).returning().get();
        changes.push(["item_events", ev.id, "insert", by]);
        recomputeItem(tx, it.id, today);
        changes.push(["items", it.id, "update", by]);
      }
      asks.push({ item: it.name, days_ago: daysBetween(it.last_bought ?? today, today) });
      // On its app's open cart at 0 (shown, not ordered) until she answers; a retry leaves the line as it is.
      const open = cartOf(tx, lineApp(tx, it), "open");
      if (!(open && lineFor(tx, open.id, it.name))) setLine(tx, { item: it.name, qty: 0, source: "low", for_note: LOW_NOTE }, by, opts);
    }
  }

  // The carts this reminder changed are copied to their apps by the agent.
  const touched = new Set(changes.filter((c) => c[0] === "orders").map((c) => c[1]));
  const ordered: Reminder["ordered"] = [];
  if (shop.order_without_asking) {
    for (const c of cartsView(tx).carts) {
      const lines = c.lines.filter((l) => (l.qty ?? 0) > 0);
      if (c.status !== "open" || !lines.length) continue;
      startOrdering(tx, tx.select().from(orders).where(eq(orders.id, c.order_id)).get()!, by, opts);
      ordered.push({ order_id: c.order_id, app: c.app as GroceryApp, message: orderingNowText({ app: c.app, lines }) });
    }
  }

  const all = cartsView(tx).carts;
  const open = all.filter((c) => c.status === "open" && c.lines.some((l) => (l.qty ?? 0) > 0));
  const cart_items = [...new Set(open.flatMap((c) => c.lines.filter((l) => (l.qty ?? 0) > 0).map((l) => l.item)))];
  const short = open.find((c) => (c.delivery_gap ?? 0) > 0);
  const carts = all.map((c) => ({ order_id: c.order_id, app: c.app as GroceryApp, lines: c.lines,
    sync: c.status === "open" && CART_SYNC[c.app as GroceryApp] && touched.has(c.order_id) }));
  const r: Reminder = { which, date, meals, ask_ingredients, added, cart_items, asks,
    delivery_gap: short ? { app: APP_NAMES[short.app as GroceryApp] ?? short.app, rupees: short.delivery_gap! } : null, ordered,
    empty: !meals.length && !cart_items.length && !asks.length && !ordered.length, text: "", app_text: "", block: null, carts };
  r.text = reminderText(r);
  r.app_text = reminderText(r, { app: true });
  r.block = stockBlock(asks, `stock-${date}-${which}`);
  return r;
}

/** The reminder `which` at `now`. With `dryRun` nothing is kept (everything is rolled back) and the answer is the same; else
 *  the changes are told to `emit` once they are committed. */
export function buildReminder(db: Db, which: Which, now: Date, opts: { dryRun: boolean; by?: string; emit?: Emit }): Reminder {
  const changes: Change[] = [];
  let out = null as Reminder | null;
  try {
    db.transaction((tx) => {
      out = build(tx as unknown as Db, which, now, opts.by ?? "app", changes);
      if (opts.dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  if (!opts.dryRun && opts.emit) emitAll(opts.emit, changes);
  return out!;
}

/** get_reminder { which } → POST /api/reminders/:which: the reminder, for real. A cart it ordered drops a copy to its app still
 *  waiting (checking out makes the app's cart match). */
export function mountReminderRoutes(hono: Hono<any>, db: Db, emit: Emit,
  deps: { now?: () => Date; schedule?: (key: string, run: (() => void) | null, ms: number) => void } = {}) {
  const write = writeRoutes(hono);
  write("/api/reminders/:which", (_b, by, c) => {
    const which = c.req.param("which") ?? "";
    if (!(WHICH as readonly string[]).includes(which)) refuse(`which must be one of: ${WHICH.join(", ")}`);
    const r = buildReminder(db, which as Which, (deps.now ?? (() => new Date()))(), { dryRun: false, by, emit });
    for (const o of r.ordered) deps.schedule?.(`sync:${o.app}`, null, 0);
    return { body: r };
  });
}
