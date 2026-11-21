// Items: one row per thing the family buys, and what happened to it (item_events). Every purchase goes in through
// recordPurchase, from an order history on any app, an order placed through the app, or one bought outside, and is never
// recorded twice. The item's cached estimate (usual amount, lasts about, run-out) is re-derived from its events by
// recomputeItem with estimate.ts; where the purchases show no cycle yet, the cycle the family stated (set_item) stands in.
// Purchases count for the whole house, whoever's account they came from. Her answers to "still in stock?" snooze an item and teach its pattern. The Pantry and the
// item page read it all, and never name the app an item is bought on.
import type { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { dish_items, dishes, house, item_events, items, order_lines, orders, plan_meals } from "./db/schema";
import { appOf, ESTIMATE, HISTORY_DAYS, ITEM_GROUPS, SHOP_APPS, TAG_TEXT, type GroceryApp } from "./db/constants";
import { addDays, todayStr } from "./dates";
import { getHouse, houseView, isObject, name, readUntil, refuse, words, writeRoutes, type Db, type Emit } from "./family";
import { dateOf, flag } from "./meals";
import { normItem, parsePack, positive, productFor, productId, rememberProduct, toBase, type ProductInput } from "./products";
import { cycleText, pantryStatus, pattern, quantityText, runOut, tagEvents, type DailyState, type Ev, type ItemState } from "./estimate";
import { cartOf, emitAll, lineApp, lineFor, setLine, type Change } from "./cart";

export type ItemRow = typeof items.$inferSelect;
export type EventRow = typeof item_events.$inferSelect;
export type Purchase = { item: string; date: string; app: GroceryApp | "outside"; product?: string; product_id?: string;
  amount: number | null; unit: string | null; count?: number; price?: number; order_ref?: string; order_id?: string; group?: string };

const stamp = (by: string) => ({ updated_at: new Date().toISOString(), updated_by: by });
const DAY_MS = 86_400_000;
const utc = (date: string) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

/** The item by its name however it is written; made (with its group, when one is given) when `create` says so. */
export function itemFor(db: Db, given: string, opts: { group?: string; create?: boolean } = {}): ItemRow | null {
  const had = db.select().from(items).where(eq(items.item, normItem(given))).get();
  if (had || !opts.create) return had ?? null;
  return db.insert(items).values({ item: normItem(given), name: given.trim(), group: opts.group ?? null, updated_by: "app" }).returning().get();
}

/** What the final plan uses of a follows-plan item from `from` on, by date, in the item's unit. */
function planUse(db: Db, it: ItemRow, from: string): { date: string; amount: number }[] {
  const rows = db.select({ date: plan_meals.date, item: dish_items.item, amount: dish_items.amount, unit: dish_items.unit })
    .from(dish_items).innerJoin(dishes, eq(dish_items.dish_id, dishes.id)).innerJoin(plan_meals, eq(dishes.meal_id, plan_meals.id))
    .where(eq(plan_meals.status, "final")).all();
  return rows.flatMap((r) => {
    if (normItem(r.item) !== it.item || r.date < from || r.amount == null) return [];
    const b = toBase(r.amount, r.unit);
    return b && b.unit === it.unit ? [{ date: r.date, amount: b.amount }] : [];
  });
}

/** Re-derive the item's cached estimate from its events that are not void, and write each event's tag and cycle back. */
export function recomputeItem(db: Db, itemId: string, _today: string): ItemRow {
  const it = db.select().from(items).where(eq(items.id, itemId)).get() ?? refuse(`no item ${itemId}`);
  const rows = db.select().from(item_events).where(eq(item_events.item_id, itemId)).all();
  const evs: Ev[] = rows.map((e) => ({ id: e.id, date: e.date, kind: e.kind as Ev["kind"], amount: e.amount, unit: e.amount == null ? null : it.unit,
    product: e.product, app: e.app, days: e.days, void: !!e.void }));
  const tagged = tagEvents(evs, it.unit);
  const byId = new Map(tagged.map((t) => [t.id, t]));
  for (const e of rows) {
    const t = byId.get(e.id);
    const tag = t?.tag ?? null, cycle = t?.cycle_days ?? null;
    if (e.tag !== tag || e.cycle_days !== cycle) db.update(item_events).set({ tag, cycle_days: cycle }).where(eq(item_events.id, e.id)).run();
  }
  const learned = pattern(tagged);
  // Until the purchases show a cycle of their own, what the family stated stands in ("milk every day, 1 litre"): its days,
  // with its amount (so a smaller pack than stated lasts less long); after that, the purchases' own amount and cycle.
  const lasts = learned.lasts_days ?? it.stated_days ?? null;
  const usual = (learned.lasts_days == null ? it.stated_amount : null) ?? learned.usual_amount ?? it.stated_amount ?? null;
  const p = { ...learned, usual_amount: usual, lasts_days: lasts, anchor_amount: learned.anchor_amount ?? (learned.last_bought ? usual : null),
    confident: learned.confident || lasts != null };
  const plan = it.follows_plan && p.last_bought ? planUse(db, it, p.last_bought) : undefined;
  return db.update(items).set({ usual_amount: p.usual_amount, lasts_days: p.lasts_days, product: p.product, app: p.app, last_bought: p.last_bought,
    anchor_amount: p.anchor_amount, run_out: runOut(p, it.wait_factor ?? 1, plan), confident: p.confident ? 1 : 0 })
    .where(eq(items.id, itemId)).returning().get();
}

/** The one door for a purchase. The same purchase twice is told, not recorded: a purchase of the item on the same app, with
 *  the same order_ref; or, when either has no order_ref, the same date and product (see below). A void purchase still counts
 *  as the one recorded (only a late payment brings it back). The amount is put in its base unit; one that has none is kept
 *  with no amount. The caller recomputes the item. */
export function recordPurchase(tx: Db, p: Purchase): { event_id: string } | { duplicate: true } {
  let it = itemFor(tx, p.item, { group: p.group, create: true })!;
  if (p.group && !it.group) it = tx.update(items).set({ group: p.group }).where(eq(items.id, it.id)).returning().get();
  // The same purchase, whichever way it came first: two refs decide alone (different refs are two orders), and so do two
  // orders placed through the app (different order_ids are two orders, even of one product on one day); when either side
  // has neither, the date and the product do (by product_id when both have one, else by the product's name). An order placed
  // through the app with no ref and the app's history copy of it (a ref, no order_id) are one purchase on the same date,
  // whatever each calls the product. A void purchase matches too (a history copy of an unpaid order must not count again),
  // after the live ones, so a ref learned goes to the purchase that counts.
  const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const appOrder = (x: { order_ref?: string | null; order_id?: string | null }) => !!x.order_id && !x.order_ref;
  const historyCopy = (x: { order_ref?: string | null; order_id?: string | null }) => !!x.order_ref && !x.order_id;
  const same = tx.select().from(item_events).where(and(eq(item_events.item_id, it.id), eq(item_events.kind, "purchase"), eq(item_events.app, p.app))).all()
    .sort((x, y) => (x.void ?? 0) - (y.void ?? 0))
    .find((e) => e.order_ref && p.order_ref ? e.order_ref === p.order_ref
      : e.order_id && p.order_id ? e.order_id === p.order_id
      : e.date === p.date && ((appOrder(e) && historyCopy(p)) || (historyCopy(e) && appOrder(p))
        || (e.product_id && p.product_id ? e.product_id === p.product_id : lower(e.product) === lower(p.product))));
  if (same) {
    // A copy with the ref teaches the one recorded without it, so later imports match by ref.
    if (p.order_ref && !same.order_ref) tx.update(item_events).set({ order_ref: p.order_ref }).where(eq(item_events.id, same.id)).run();
    return { duplicate: true };
  }
  let base = p.amount == null ? null : toBase(p.amount, p.unit);
  if (base && !it.unit) it = tx.update(items).set({ unit: base.unit }).where(eq(items.id, it.id)).returning().get();
  // An amount that cannot be put in the item's unit (pieces of an item bought by weight) is kept as text, with no amount.
  const note = base && base.unit !== it.unit ? `${p.amount} ${p.unit}` : null;
  if (note) base = null;
  // A purchase is the item's newest news: the asks it went unanswered no longer count.
  tx.update(items).set({ asks_unanswered: 0 }).where(eq(items.id, it.id)).run();
  const row = tx.insert(item_events).values({ item_id: it.id, date: p.date, kind: "purchase", app: p.app, product: p.product ?? null,
    product_id: p.product_id ?? null, amount: base?.amount ?? null, count: p.count ?? 1, price: p.price ?? null,
    order_ref: p.order_ref ?? null, order_id: p.order_id ?? null, note, updated_by: "app" }).returning().get();
  return { event_id: row.id };
}

/** How many cycles each item's pattern has (its events' cycles as recomputeItem wrote them). */
function cycleCounts(db: Db): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of db.select({ item_id: item_events.item_id, tag: item_events.tag, cycle: item_events.cycle_days, void: item_events.void }).from(item_events).all())
    if (!e.void && e.cycle != null && (e.tag === "counted" || e.tag === "early_buy" || e.tag === "your_answer")) out.set(e.item_id, (out.get(e.item_id) ?? 0) + 1);
  return out;
}

const stateOf = (i: ItemRow, cycles: number): ItemState => ({ id: i.id, name: i.name, group: i.group, subscription: i.subscription, dont_ask: !!i.dont_ask,
  snoozed_until: i.snoozed_until, wait_factor: i.wait_factor ?? 1, run_out: i.run_out, confident: !!i.confident, last_bought: i.last_bought, cycles });

/** Is the item's cycle the one the family stated (the purchases show none of their own yet)? */
export const cycleStated = (i: ItemRow): boolean => i.stated_days != null && i.lasts_days === i.stated_days;
/** An item as the reminder reads it to put a daily one on the cart (estimate.ts dailyDue). */
export const dailyState = (i: ItemRow): DailyState => ({ group: i.group, lasts_days: i.lasts_days, run_out: i.run_out, last_bought: i.last_bought,
  subscription: i.subscription, dont_ask: !!i.dont_ask, snoozed_until: i.snoozed_until, stated: i.stated_days != null });

/** Every item as the estimate reads it. The run-out is the cached one (recomputeItem keeps it current). */
export function itemStates(db: Db, _today: string): ItemState[] {
  const cycles = cycleCounts(db);
  return db.select().from(items).all().map((i) => stateOf(i, cycles.get(i.id) ?? 0));
}

// ── How amounts read ──

const trim = (n: number, places: number) => String(Math.round(n * 10 ** places) / 10 ** places);
export { quantityText };
/** "0.4 kg a day": a day's use, at one decimal in the large unit from 100 g (100 ml) a day. */
function usesText(amount: number | null, days: number | null, unit: string | null): string | null {
  if (amount == null || !days || !unit) return null;
  const r = amount / days;
  if ((unit === "g" || unit === "ml") && r >= 100) return `${trim(r / 1000, 1)} ${unit === "g" ? "kg" : "l"} a day`;
  return `${unit === "pc" ? trim(r, 1) : trim(r, 0)} ${unit} a day`;
}

// ── The Pantry and the item page ──

/** Items on an open or ordering cart as low. */
function lowOnCart(db: Db): Set<string> {
  return new Set(db.select({ item_id: order_lines.item_id }).from(order_lines).innerJoin(orders, eq(order_lines.order_id, orders.id))
    .where(and(eq(order_lines.source, "low"), inArray(orders.status, ["open", "ordering"]))).all().map((r) => r.item_id).filter((x): x is string => !!x));
}

export type PantryStatus = ReturnType<typeof pantryStatus>;
/** `cycle`: what is bought and how often, in plain words ("500 ml every day", "30 pc about once a week"); null with no cycle yet. */
export type PantryRow = { id: string; name: string; quantity: string | null; cycle: string | null; status: PantryStatus };

/** The Pantry: every item but the subscribed ones, by name, with its cycle (else the amount usually bought) and its status. */
export function pantryView(db: Db, today: string): { counts: { all: number; in_stock: number; low: number; snoozed: number }; rows: PantryRow[] } {
  const cycles = cycleCounts(db), onCart = lowOnCart(db);
  const rows = db.select().from(items).all().filter((i) => !i.subscription)
    .map((i) => ({ id: i.id, name: i.name, quantity: quantityText(i.usual_amount, i.unit), cycle: cycleText(i, cycleStated(i)), status: pantryStatus(stateOf(i, cycles.get(i.id) ?? 0), today, onCart.has(i.id)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = (s: PantryStatus) => rows.filter((r) => r.status === s).length;
  return { counts: { all: rows.length, in_stock: n("In stock"), low: n("Low"), snoozed: n("Snoozed") }, rows };
}

/** One item's page: its pattern, and the purchases and answers it was learned from, newest first. */
export function itemView(db: Db, id: string, today: string) {
  const i = db.select().from(items).where(eq(items.id, id)).get();
  if (!i) return null;
  const evs = db.select().from(item_events).where(eq(item_events.item_id, id)).all()
    .filter((e) => !e.void && (e.kind === "purchase" || e.kind === "answer"))
    .map((e, n) => ({ e, n })).sort((a, b) => b.e.date.localeCompare(a.e.date) || b.n - a.n).map(({ e }) => e);
  const purchases = evs.filter((e) => e.kind === "purchase");
  const priced = purchases.find((e) => e.price != null && (e.tag === "counted" || e.tag === "early_buy")) ?? purchases.find((e) => e.price != null);
  const state = stateOf(i, cycleCounts(db).get(id) ?? 0);
  return {
    item: { id: i.id, name: i.name, group: i.group, status: pantryStatus(state, today, lowOnCart(db).has(id)), run_out: i.run_out, snoozed_until: i.snoozed_until,
      product: i.product, usual: quantityText(i.usual_amount, i.unit), price: priced?.price ?? null, lasts_days: i.lasts_days,
      uses: usesText(i.usual_amount, i.lasts_days, i.unit), follows_plan: !!i.follows_plan, cycle: cycleText(i, cycleStated(i)), cycle_stated: cycleStated(i) },
    events: evs.map((e) => ({
      what: e.kind === "answer" ? (e.days != null ? `Fine for ${trim(e.days, 1)} more days` : "Still have it")
        : [e.product ?? i.name, quantityText(e.amount, i.unit) ?? e.note, e.app === "outside" ? "bought outside the apps" : null].filter(Boolean).join(", "),
      when: e.date, tag: e.tag ? TAG_TEXT[e.tag as keyof typeof TAG_TEXT] ?? null : null })),
  };
}

// ── What was sent, checked ──

/** Other words an agent sends for a group (live 2026-11-21: eight set_item calls in a row were refused for one). */
const GROUP_WORDS: Record<string, string> = {
  day: "daily", everyday: "daily", every_day: "daily",
  weekly: "few_days", week: "few_days", every_few_days: "few_days", few: "few_days", twice_a_week: "few_days", fresh: "few_days",
  month: "monthly", fortnightly: "monthly", pantry: "monthly", staple: "monthly", staples: "monthly", rarely: "monthly",
  occasional: "monthly", occasionally: "monthly", household: "monthly", other: "monthly", none: "monthly",
};
const GROUP_MEANS = "daily (bought every day or two: milk, curd), few_days (bought within the week: vegetables, fruit, eggs, bread, paneer), monthly (lasts weeks: atta, rice, oil, masalas, and anything for cleaning or personal care)";
const groupOf = (v: unknown, what = "group"): string => {
  const word = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v;
  if ((ITEM_GROUPS as readonly unknown[]).includes(word)) return word as string;
  const known = typeof word === "string" ? GROUP_WORDS[word] : undefined;
  return known ?? refuse(`${what} must be one of: ${GROUP_MEANS}`);
};
const HISTORY_SHAPE = "orders must be a list of { date, order_ref?, items: [{ item, group?, product?, product_id?, pack?, pack_amount?, pack_unit?, count?, price?, image? }] }";

type Line = { item: string; group?: string; product?: string; product_id?: string; amount: number | null; unit: string | null; count: number;
  price?: number; pack?: string; remember?: ProductInput };

/** One item of an order, checked: its amount is pack × count in the base unit, or null when the pack has no size. */
function lineOf(i: unknown, date: string, app: GroceryApp): Line {
  if (!isObject(i)) return refuse(HISTORY_SHAPE);
  const item = name(i.item, `${date}: an item's name (item)`);
  const at = `${date}: ${item}: `;
  const count = i.count == null ? 1 : typeof i.count === "number" && Number.isFinite(i.count) && i.count > 0 ? i.count : refuse(`${at}count must be a number above 0`);
  const pack = i.pack == null ? undefined : words(i.pack, `${at}pack`) ?? undefined;
  const product = i.product == null ? undefined : words(i.product, `${at}product`) ?? undefined;
  const price = i.price == null ? undefined : typeof i.price === "number" && Number.isFinite(i.price) && i.price >= 0 ? i.price : refuse(`${at}price must be a number, 0 or more`);
  let size: { amount: number; unit: string } | null = null;
  if (i.pack_amount != null || i.pack_unit != null) {
    const amount = positive(i.pack_amount, `${at}pack_amount`) ?? refuse(`${at}pack_amount must be a number above 0`);
    const unit = name(i.pack_unit, `${at}pack_unit (with pack_amount)`);
    size = { amount, unit };
  } else size = parsePack(pack);
  const base = size ? toBase(size.amount * count, size.unit) : null;
  const line: Line = { item, count, amount: base?.amount ?? null, unit: base?.unit ?? null, pack, product, price };
  if (i.group != null) line.group = groupOf(i.group, `${at}group`);
  if (i.product_id != null) {
    line.product_id = productId(i.product_id, `${at}product_id`);
    line.remember = { item, app, product_id: line.product_id, name_on_app: product ?? item };
    for (const k of ["pack", "pack_unit", "image"] as const) if (i[k] !== undefined) line.remember[k] = words(i[k], `${at}${k}`);
    if (i.pack_amount !== undefined) line.remember.pack_amount = positive(i.pack_amount, `${at}pack_amount`);
    if (price !== undefined) line.remember.price = price;
  }
  return line;
}

/** One order's lines with each item once: two lines of an item (two packs) are one purchase of both. */
function mergeLines(lines: Line[]): Line[] {
  const by = new Map<string, Line>();
  for (const l of lines) {
    const had = by.get(normItem(l.item));
    if (!had) { by.set(normItem(l.item), { ...l }); continue; }
    had.amount = had.amount != null && l.amount != null && had.unit === l.unit ? had.amount + l.amount : null;
    if (had.amount == null) had.unit = null;
    had.count += l.count;
    had.price = had.price != null && l.price != null ? had.price + l.price : had.price ?? l.price;
    had.group ??= l.group; had.product ??= l.product; had.product_id ??= l.product_id;
  }
  return [...by.values()];
}

export function mountItemRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { now?: () => Date } = {}) {
  const write = writeRoutes(hono);
  const today = () => todayStr((opts.now ?? (() => new Date()))());
  const tdb = (tx: unknown) => tx as Db;
  const bumpHouse = (tx: Db, set: Partial<typeof house.$inferInsert>, by: string) =>
    tx.update(house).set({ ...set, ...stamp(by) }).where(eq(house.id, getHouse(tx).id)).returning().get();
  const itemIds = () => new Set(db.select({ id: items.id }).from(items).all().map((r) => r.id));
  const op = (had: Set<string>, id: string) => (had.has(id) ? "update" : "insert") as "update" | "insert";

  // import_order_history { app, orders: [{ date, order_ref?, items: [...] }] }: each item of each order (3 months back, and not
  // after today) becomes a purchase, never twice; an item with its product_id is remembered as that app's product. The agent
  // sends the oldest orders first, so history_synced (the newest order read, never past today) only moves over what was read.
  // More than one person may order for the house, each on their own account of the same app: every purchase counts towards
  // the one estimate of its item, and history_synced is kept per app and per reader (whoever called: a person's agent), so one
  // person's reading never tells another's agent that its own orders were read.
  write("/api/order-history", (b, by) => {
    const app = appOf(b.app) ?? refuse(`app must be one of: ${SHOP_APPS.join(", ")}`);
    if (!Array.isArray(b.orders)) refuse(HISTORY_SHAPE);
    const day = today(), since = addDays(day, -HISTORY_DAYS);
    const read = (b.orders as unknown[]).map((o) => {
      if (!isObject(o) || !Array.isArray(o.items)) return refuse(HISTORY_SHAPE);
      const date = dateOf(o.date, "an order's date");
      const ref = o.order_ref == null ? undefined : typeof o.order_ref === "number" ? String(o.order_ref) : name(o.order_ref, `${date}: order_ref`);
      return { date, ref, lines: o.items.map((i: unknown) => lineOf(i, date, app)) };
    });
    // An order dated after today is a mistyped date: skipped and counted, so it can never move history_synced past today.
    const future = read.filter((o) => o.date > day).length;
    const kept = read.filter((o) => o.date >= since && o.date <= day).sort((x, y) => x.date.localeCompare(y.date));
    let recorded = 0, duplicates = 0;
    const touched = new Set<string>(), changed = new Map<string, Parameters<Emit>>(), had = itemIds();
    const out = db.transaction((txRaw) => {
      const tx = tdb(txRaw);
      for (const o of kept) for (const l of mergeLines(o.lines)) {
        const r = recordPurchase(tx, { item: l.item, date: o.date, app, product: l.product, product_id: l.product_id, amount: l.amount, unit: l.unit,
          count: l.count, price: l.price, order_ref: o.ref, group: l.group });
        if ("duplicate" in r) duplicates++; else { recorded++; changed.set(r.event_id, ["item_events", r.event_id, "insert", by]); }
        touched.add(itemFor(tx, l.item)!.id);
      }
      // Oldest first, so the newest order's product is the one kept for an item.
      for (const o of kept) for (const l of o.lines) if (l.remember) {
        const had = productFor(tx, l.remember.item, app);
        const row = rememberProduct(tx, l.remember, by);
        if (!changed.has(row.id)) changed.set(row.id, ["products", row.id, had ? "update" : "insert", by]);
      }
      const rows = [...touched].map((id) => recomputeItem(tx, id, day));
      for (const r of rows) changed.set(r.id, ["items", r.id, op(had, r.id), by]);
      if (kept.length) {
        const synced = houseView(getHouse(tx)).history_synced;
        const newest = kept[kept.length - 1].date;
        if (!synced[app]?.[by] || synced[app][by] < newest) {
          const h = bumpHouse(tx, { history_synced: JSON.stringify({ ...synced, [app]: { ...synced[app], [by]: newest } }) }, by);
          changed.set(h.id, ["house", h.id, "update", by]);
        }
      }
      return rows;
    });
    for (const c of changed.values()) emit(...c);
    const probably = out.filter((r) => r.confident && r.run_out && r.run_out <= day && r.group && r.group !== "daily" && !r.subscription && !r.dont_ask && r.last_bought)
      .map((r) => ({ item: r.name, days_ago: daysBetween(r.last_bought!, day) })).sort((x, y) => y.days_ago - x.days_ago);
    return { body: { recorded, duplicates, skipped_old: read.length - kept.length - future, skipped_future: future, needs_group: out.filter((r) => !r.group).map((r) => r.name),
      probably_out: probably, read_until: readUntil(houseView(getHouse(db)).history_synced, app, by) } };
  });

  // record_bought_outside { item, date? }: bought outside the apps ("from the kirana"): a purchase of the usual amount.
  write("/api/items/outside", (b, by) => {
    const given = name(b.item, "item");
    const date = b.date == null ? today() : dateOf(b.date, "date");
    const had = itemIds();
    const res = db.transaction((txRaw) => {
      const tx = tdb(txRaw);
      const it = itemFor(tx, given, { create: true })!;
      const r = recordPurchase(tx, { item: given, date, app: "outside", amount: it.usual_amount, unit: it.unit });
      const row = recomputeItem(tx, it.id, today());
      return { r, row };
    });
    emit("items", res.row.id, op(had, res.row.id), by);
    if ("event_id" in res.r) emit("item_events", res.r.event_id, "insert", by);
    return { body: { ...res.r, item: res.row } };
  });

  // set_item { item, group?, usual_amount?, every_days?, follows_plan?, dont_ask?, snooze_days?, unit? }: one item, made when it is
  // not there. usual_amount (in unit) and every_days are the cycle the family stated ("milk every day, 1 litre"): kept on the
  // item, and what its estimate goes by until its purchases show a cycle of their own.
  write("/api/items", (b, by) => {
    const given = name(b.item, "item");
    const set: Partial<typeof items.$inferInsert> = {};
    if (b.every_days !== undefined) set.stated_days = positive(b.every_days, "every_days (how many days one purchase lasts: 1 for every day, 7 for once a week)");
    if (b.group !== undefined) set.group = b.group === null ? null : groupOf(b.group);
    if (b.follows_plan !== undefined) set.follows_plan = flag(b.follows_plan, "follows_plan") ? 1 : 0;
    if (b.dont_ask !== undefined) set.dont_ask = flag(b.dont_ask, "dont_ask") ? 1 : 0;
    if (b.snooze_days !== undefined) set.snoozed_until = b.snooze_days === null || b.snooze_days === 0 ? null
      : typeof b.snooze_days === "number" && Number.isInteger(b.snooze_days) && b.snooze_days > 0 ? addDays(today(), b.snooze_days) : refuse("snooze_days must be a whole number of days above 0, or null");
    if (b.unit !== undefined) set.unit = (typeof b.unit === "string" && toBase(1, b.unit)?.unit) || refuse("unit must be g, kg, ml, l or pc");
    const was = itemFor(db, given), had = itemIds();
    if (b.usual_amount !== undefined) {
      if (b.usual_amount === null) set.stated_amount = null;
      else {
        const base = toBase(positive(b.usual_amount, "usual_amount")!, typeof b.unit === "string" ? b.unit : was?.unit)
          ?? refuse("usual_amount needs its unit: g, kg, ml, l or pc");
        set.stated_amount = base.amount;
        set.unit = base.unit;
      }
    }
    // Its purchases' amounts are in its unit: an item bought by weight cannot be counted in pieces from now on.
    if (was?.unit && set.unit && set.unit !== was.unit && db.select().from(item_events).where(eq(item_events.item_id, was.id)).all().some((e) => e.amount != null))
      refuse(`${was.name} is already bought in ${was.unit}: its unit stays`);
    const row = db.transaction((txRaw) => {
      const tx = tdb(txRaw);
      const it = itemFor(tx, given, { create: true })!;
      tx.update(items).set({ ...set, ...stamp(by) }).where(eq(items.id, it.id)).run();
      return recomputeItem(tx, it.id, today());
    });
    emit("items", row.id, op(had, row.id), by);
    return { body: { item: row } };
  });

  // set_subscription { item, source, active }: an item delivered outside the apps. On: never in a cart or asked about, and taken
  // off every open cart. Off: an item like any other again.
  write("/api/items/subscription", (b, by) => {
    const given = name(b.item, "item");
    const active = flag(b.active, "active");
    const source = active ? name(b.source, "source (who delivers it, like \"Country Delight\")") : null;
    if (!active && !itemFor(db, given)) return { status: 404, body: { reason: `${given} is not an item the app knows` } };
    const had = itemIds();
    const res = db.transaction((txRaw) => {
      const tx = tdb(txRaw);
      const it = itemFor(tx, given, { group: "daily", create: true })!;
      const row = tx.update(items).set({ subscription: source, ...stamp(by) }).where(eq(items.id, it.id)).returning().get();
      // Its lines on the open carts, by its id or its name (a line may predate the item row).
      const lines = active ? tx.select({ id: order_lines.id, item_id: order_lines.item_id, item: order_lines.item }).from(order_lines)
        .innerJoin(orders, eq(order_lines.order_id, orders.id)).where(eq(orders.status, "open")).all()
        .filter((l) => l.item_id === it.id || normItem(l.item) === it.item).map((l) => l.id) : [];
      if (lines.length) tx.delete(order_lines).where(inArray(order_lines.id, lines)).run();
      return { row, lines };
    });
    emit("items", res.row.id, op(had, res.row.id), by);
    for (const id of res.lines) emit("order_lines", id, "delete", by);
    return { body: { item: res.row } };
  });

  // answer_running_low { answers: [{ item, answer: low | in_stock, days? }] }: her answers to "still in stock?". A low one goes on
  // its app's open cart (the agent copies it to the app in the same turn, so nothing is asked of it here).
  write("/api/items/answers", (b, by) => {
    if (!Array.isArray(b.answers) || !b.answers.length) refuse("answers must be a list of { item, answer: low | in_stock, days? }");
    const day = today();
    const answers = (b.answers as unknown[]).map((a) => {
      if (!isObject(a)) return refuse("answers must be a list of { item, answer: low | in_stock, days? }");
      const given = name(a.item, "an answer's item");
      const it = itemFor(db, given) ?? refuse(`${given} is not an item the app knows`);
      const answer = a.answer === "low" || a.answer === "in_stock" ? a.answer : refuse(`${given}: answer must be low or in_stock`);
      const days = a.days == null ? null : typeof a.days === "number" && Number.isFinite(a.days) && a.days > 0 ? a.days : refuse(`${given}: days must be a number above 0`);
      return { it, answer, days };
    });
    const to_cart: string[] = [];
    const lineChanges: Change[] = [];
    const res = db.transaction((txRaw) => {
      const tx = tdb(txRaw);
      const events: string[] = [], rows: ItemRow[] = [];
      let confirmed = 0, stillHave = 0;
      for (const { it: had, answer, days } of answers) {
        const it = tx.select().from(items).where(eq(items.id, had.id)).get()!;
        const set: Partial<typeof items.$inferInsert> = { asks_unanswered: 0, ...stamp(by) };
        if (answer === "low") {
          Object.assign(set, { misses_in_row: 0, wait_factor: 1 });
          confirmed++;
          to_cart.push(it.name);
          // On its app's open cart at 1, unless it is there with a qty already; never a subscribed item.
          const open = cartOf(tx, lineApp(tx, it), "open");
          if (!it.subscription && !(open && lineFor(tx, open.id, it.name)?.qty))
            setLine(tx, { item: it.name, qty: 1, source: "low" }, by, { changes: lineChanges, at: (opts.now ?? (() => new Date()))() });
        } else {
          stillHave++;
          const snooze = days ?? ESTIMATE.snoozeDays[it.group as keyof typeof ESTIMATE.snoozeDays] ?? 1;
          set.snoozed_until = addDays(day, Math.ceil(snooze));
          if (days != null) set.misses_in_row = 0;
          else {
            const misses = (it.misses_in_row ?? 0) + 1;
            if (misses >= ESTIMATE.missesBeforeWait) Object.assign(set, { misses_in_row: 0, wait_factor: Math.min((it.wait_factor ?? 1) * ESTIMATE.waitStep, ESTIMATE.waitMax) });
            else set.misses_in_row = misses;
          }
          events.push(tx.insert(item_events).values({ item_id: it.id, date: day, kind: "answer", days, updated_by: by }).returning().get().id);
        }
        tx.update(items).set(set).where(eq(items.id, it.id)).run();
        rows.push(recomputeItem(tx, it.id, day));
      }
      const h = getHouse(tx);
      const hrow = bumpHouse(tx, { asks_confirmed: (h.asks_confirmed ?? 0) + confirmed, asks_still_have: (h.asks_still_have ?? 0) + stillHave }, by);
      return { events, rows, house: hrow };
    });
    for (const id of res.events) emit("item_events", id, "insert", by);
    for (const r of res.rows) emit("items", r.id, "update", by);
    emit("house", res.house.id, "update", by);
    emitAll(emit, lineChanges);
    return { body: { to_cart, items: res.rows } };
  });

  hono.get("/api/pantry", (c) => c.json(pantryView(db, today())));
  hono.get("/api/items/:id", (c) => {
    const v = itemView(db, c.req.param("id"), today());
    return v ? c.json(v) : c.json({ ok: false, reason: "no such item" }, 404);
  });
}
