// Everyday items ("regulars"): what the house buys again and again whatever is cooked: milk every day, bread twice a week,
// fruit on Mondays. Each says how much and how often; an order adds its amount for the days the order covers. The agent
// writes them with set_regular once the family confirmed them; import_order_history only suggests them from what was bought.
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { regulars } from "./db/schema";
import { EVERY, KEEPS } from "./db/constants";
import { weekdayOf, WEEKDAYS, type Weekday } from "./dates";
import { isObject, list, name, refuse, weekdays, words, writeRoutes, type Db, type Emit } from "./family";
import { dateOf, flag } from "./meals";
import { groceryAppOf, normItem, positive, productFor, productOf, rememberProduct } from "./products";

export type RegularRow = typeof regulars.$inferSelect;
/** A regular as the routes answer with it: its weekdays read. */
export type RegularView = Omit<RegularRow, "weekdays"> & { weekdays: Weekday[] };
export type PastOrder = { date: string; items: { item: string; qty?: number; pack?: string }[] };
export type Suggestion = { item: string; amount: number; unit: string | null; every: "day" | "week"; times_per_week?: number; orders_seen: number };
/** What the orders do when an everyday item changes: the orders not yet placed are built again. */
export type RegularHooks = { onChanged(): void };

/** The days of a week (0 = Monday) an item needed `times` a week falls on, spread evenly: twice is Monday and Thursday. */
export function spreadDays(times: number): number[] {
  return Array.from({ length: times }, (_, i) => Math.floor((i * 7) / times));
}

/** What of a regular is needed on each of `dates`. Nothing while it is not active, nor up to and including `paused_until`. */
export function regularNeeds(r: RegularRow, dates: string[]): { date: string; amount: number }[] {
  if (!r.active) return [];
  const on: (date: string) => boolean =
    r.every === "day" ? () => true
    : r.every === "weekdays" ? ((days) => (date: string) => days.includes(weekdayOf(date)))(list<Weekday>(r.weekdays))
    : r.every === "week" ? ((days) => (date: string) => days.includes(WEEKDAYS.indexOf(weekdayOf(date))))(spreadDays(r.times_per_week ?? 1))
    : () => false;
  return dates.filter((date) => !(r.paused_until && date <= r.paused_until) && on(date)).map((date) => ({ date, amount: r.amount ?? 1 }));
}

const dayNumber = (date: string): number => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };

/** The everyday items a history of orders points to: what was bought on three or more days, at least once a fortnight.
 *  The amount is the usual quantity of one order and the unit its usual pack, both as the grocery app had them. */
export function suggestRegulars(orders: PastOrder[]): Suggestion[] {
  const seen = new Map<string, { qty: Map<string, number>; packs: Map<string, number> }>();
  for (const o of orders) for (const i of o.items) {
    const key = normItem(i.item);
    const s = seen.get(key) ?? { qty: new Map(), packs: new Map() };
    seen.set(key, s);
    s.qty.set(o.date, (s.qty.get(o.date) ?? 0) + (i.qty ?? 1));
    if (i.pack?.trim()) s.packs.set(i.pack.trim(), (s.packs.get(i.pack.trim()) ?? 0) + 1);
  }
  const out: Suggestion[] = [];
  for (const [item, s] of seen) {
    const dates = [...s.qty.keys()].sort(), n = dates.length;
    if (n < 3) continue;
    const interval = (dayNumber(dates[n - 1]) - dayNumber(dates[0])) / (n - 1);
    if (interval > 14) continue;
    const qtys = [...s.qty.values()].sort((a, b) => a - b);
    const unit = [...s.packs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({ item, amount: qtys[Math.floor((n - 1) / 2)], unit,
      ...(interval <= 1.5 ? { every: "day" as const } : { every: "week" as const, times_per_week: Math.min(6, Math.max(1, Math.round(7 / interval))) }),
      orders_seen: n });
  }
  return out.sort((a, b) => b.orders_seen - a.orders_seen || a.item.localeCompare(b.item));
}

export function regularView(r: RegularRow): RegularView { return { ...r, weekdays: list<Weekday>(r.weekdays) }; }

// ── What was sent, checked ──

const HISTORY_SHAPE = "orders must be a list of { date, items: [{ item, qty?, pack?, product_id?, name_on_app?, price?, image? }] }";

export function mountRegularRoutes(hono: Hono<any>, db: Db, emit: Emit, hooks: RegularHooks) {
  const write = writeRoutes(hono);

  // set_regular { item, amount, unit, every: day | week | weekdays, times_per_week?, weekdays?, for_whom?, keeps?, active?,
  // paused_until?, remove? }: one everyday item, found by its name and whom it is for (the same item for the house and for one
  // person are two). Only the fields given change. `remove` deletes it; `active: false` keeps it without ordering it.
  write("/api/regulars", (b, by) => {
    const given = name(b.item, "item");
    const whom = b.for_whom == null ? null : words(b.for_whom, "for_whom");
    const existing = db.select().from(regulars).all()
      .find((r) => normItem(r.item) === normItem(given) && (r.for_whom ?? "").trim().toLowerCase() === (whom ?? "").toLowerCase());
    if (b.remove === true) {
      if (!existing) return { status: 404, body: { reason: `${given}${whom ? ` for ${whom}` : ""} is not an everyday item` } };
      db.delete(regulars).where(eq(regulars.id, existing.id)).run();
      emit("regulars", existing.id, "delete", by);
      hooks.onChanged();
      return { body: { removed: regularView(existing) } };
    }
    const set: Partial<typeof regulars.$inferInsert> = {};
    if (b.amount != null) set.amount = positive(b.amount, "amount");
    else if (!existing) refuse("amount is required: how much is needed each time, as a number (put the measure in unit)");
    if (b.unit != null) set.unit = name(b.unit, "unit");
    else if (!existing) refuse('unit is required: the measure of the amount, like "l", "g", "pc" or "pack"');
    if (b.every != null) set.every = (EVERY as readonly unknown[]).includes(b.every) ? (b.every as string) : refuse(`every must be one of: ${EVERY.join(", ")}`);
    else if (!existing) refuse(`every is required: one of ${EVERY.join(", ")}`);
    if (b.times_per_week !== undefined) set.times_per_week = b.times_per_week === null ? null
      : typeof b.times_per_week === "number" && Number.isInteger(b.times_per_week) && b.times_per_week >= 1 && b.times_per_week <= 7 ? b.times_per_week
      : refuse("times_per_week must be a whole number from 1 to 7");
    if (b.weekdays !== undefined) set.weekdays = b.weekdays === null ? null : JSON.stringify(weekdays(b.weekdays, "weekdays"));
    if (b.keeps != null) set.keeps = (KEEPS as readonly unknown[]).includes(b.keeps) ? (b.keeps as string) : refuse(`keeps must be one of: ${KEEPS.join(", ")}`);
    if (b.active !== undefined) set.active = flag(b.active, "active") ? 1 : 0;
    if (b.paused_until !== undefined) set.paused_until = b.paused_until === null ? null : dateOf(b.paused_until, "paused_until");
    if ((set.every ?? existing?.every) === "weekdays" && !list(set.weekdays !== undefined ? set.weekdays : existing?.weekdays ?? null).length)
      refuse(`weekdays is required when every is weekdays: a list from ${WEEKDAYS.join(", ")}`);
    const row = existing
      ? db.update(regulars).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(regulars.id, existing.id)).returning().get()
      : db.insert(regulars).values({ ...set, item: given, every: set.every!, for_whom: whom, updated_by: by }).returning().get();
    emit("regulars", row.id, existing ? "update" : "insert", by);
    hooks.onChanged();
    return { body: { regular: regularView(row) } };
  });

  // import_order_history { app, orders: [{ date, items: [{ item, qty?, pack?, product_id?, ... }] }] }: what the family bought on
  // a grocery app. Every item that came with its product_id is remembered as that item's product there. The answer suggests
  // the everyday items the history points to; none is made here: the family confirms each, and the agent sets it (set_regular).
  write("/api/order-history", (b, by) => {
    const app = groceryAppOf(b.app);
    if (!Array.isArray(b.orders)) refuse(HISTORY_SHAPE);
    const found: { date: string; product: ReturnType<typeof productOf> }[] = [];
    const orders: PastOrder[] = (b.orders as unknown[]).map((o) => {
      if (!isObject(o) || !Array.isArray(o.items)) return refuse(HISTORY_SHAPE);
      const date = dateOf(o.date, "an order's date");
      return { date, items: o.items.map((i: unknown) => {
        if (!isObject(i)) return refuse(HISTORY_SHAPE);
        const item = name(i.item, `${date}: an item's name (item)`);
        const qty = i.qty == null ? undefined : positive(i.qty, `${date}: the qty of ${item}`)!;
        const pack = i.pack == null ? undefined : words(i.pack, `${date}: the pack of ${item}`) ?? undefined;
        // In a history the item is the product's own name on the app, unless it came with another.
        if (i.product_id != null) found.push({ date, product: productOf({ ...i, name_on_app: i.name_on_app ?? item }, app, `${date}: ${item}: `) });
        return { item, qty, pack };
      }) };
    });
    // Oldest first, so the product of the newest order is the one kept for an item. A row written twice is told once.
    found.sort((x, y) => x.date.localeCompare(y.date));
    const changes = new Map<string, Parameters<Emit>>();
    db.transaction((tx) => {
      for (const { product } of found) {
        const had = productFor(tx as unknown as Db, product.item, app);
        const row = rememberProduct(tx as unknown as Db, product, by);
        if (!changes.has(row.id)) changes.set(row.id, ["products", row.id, had ? "update" : "insert", by]);
      }
    });
    for (const c of changes.values()) emit(...c);
    return { body: { suggestions: suggestRegulars(orders) } };
  });
}
