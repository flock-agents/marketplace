// Kitchen stock (docs/V3-FLOW-SPEC.md "Stock" and "Pantry = what is in the kitchen"). What is at home is read, never
// stored as a running count: every purchase still within its use-by (ordered grocery rows, the last purchase stamped
// on the ingredient, `stock` rows the owner or agent add) minus what cooked meals and standing consumption drew
// since. Fresh items are tracked by amount; long-shelf-life ones (HELD_BACK) are assumed present and re-checked now
// and then by shelf life. A "low"/"out" answer writes the ingredient off from that moment until it is bought again.
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, groceries, meals, recipe_ingredients, standing_consumption, staples, stock } from "./db/schema";
import { DEFAULT_SHELF_LIFE_DAYS, UNKNOWN_SHELF_LIFE_DAYS } from "./db/constants";
import { HELD_BACK, parseJson, type DesiredRow, type ShoppingPrefs } from "./quantity";
import { baseKindOf, convertTo, toBase, type BaseUnit, type UnitConversions } from "./units";
import { addDaysStr, cookTimeFor, stapleKeyResolver, timelineSettingsFrom, todayStr, type SettingsReader } from "./timeline";
import { settingsReaderFrom } from "./settings";
import { recipeSets } from "./mealRecipes";
import { loadIngredients, needsForMeals, type IngredientRow, type PlanMeal } from "./mealGroceries";
import { localStamp } from "./mealOutcomes";

type Db = BunSQLiteDatabase<any>;

/** A pantry item due for a re-check (by its home shelf life), with the upcoming meals it matters for. */
export interface PantryDue { ingredient_id: string; name: string; category: string | null; last_checked_at: string | null; for_meals: string[] }

export type LotSource = "order" | "owner" | "inferred";
/** One purchase (or "have it") at home. `qty` null = some, amount unknown: it covers any need until use_by. `unit`
 *  null = in whatever unit the need is (a last purchase stamped on the ingredient). `bought` is a local stamp. */
export interface Lot { ingredient_id: string; qty: number | null; unit: BaseUnit | null; bought: string; use_by: string; source: LotSource }
/** Something at a local time ("YYYY-MM-DDTHH:MM"): a cooked meal or standing consumption drawing on stock, or an
 *  upcoming meal's need (keyed) to cover from it. */
export interface StockEvent { at: string; kind: "draw" | "need"; qty: number | null; unit: BaseUnit | null; key?: string }

const EPS = 1e-6;
/** Check cadence from home shelf life: fresh every few days, staples every week or two, spices every few weeks. */
const CADENCE = { factor: 1.2, minDays: 3, maxDays: 14, maxSpiceDays: 28 };
/** At most this many items in one check-in; the agent picks the few that matter from them. */
export const PANTRY_CHECK_MAX = 5;
/** Lots that expired this long ago still count for the draws cooked meals made from them while they were good. */
const LOOKBACK_DAYS = 7;

export const isHeldBack = (category: string | null | undefined): boolean => HELD_BACK.has(category ?? "");

// --- Pure ------------------------------------------------------------------------------------------------------------

export const shelfLifeDays = (own: number | null | undefined, category: string | null | undefined): number =>
  own ?? DEFAULT_SHELF_LIFE_DAYS[category ?? ""] ?? UNKNOWN_SHELF_LIFE_DAYS;

/** How often an item is worth re-checking, in days. */
export function checkCadenceDays(shelfLife: number, category: string | null | undefined): number {
  const max = category === "spices" ? CADENCE.maxSpiceDays : CADENCE.maxDays;
  return Math.min(max, Math.max(CADENCE.minDays, Math.round(CADENCE.factor * Math.sqrt(shelfLife))));
}

const inUnit = (qty: number, from: BaseUnit | null, to: BaseUnit | null, conv: UnitConversions): number | null =>
  !from || !to || from === to ? qty : convertTo({ qty, unit: from }, to, conv)?.qty ?? null;

const usableFor = (ev: StockEvent) => (l: Lot) => l.qty !== 0 && l.use_by >= ev.at.slice(0, 10) && (ev.kind === "need" || l.bought <= ev.at);

const available = (lots: Lot[], ev: StockEvent, conv: UnitConversions): number =>
  lots.reduce((sum, l) => sum + (inUnit(l.qty!, l.unit, ev.unit, conv) ?? 0), 0);

/** Takes ev's amount from the lots, soonest use-by first. A lot of unknown amount absorbs whatever reaches it. */
function take(lots: Lot[], ev: StockEvent, conv: UnitConversions): void {
  let left = ev.qty ?? 0;
  for (const lot of lots) {
    if (left <= EPS || lot.qty === null) return;
    const want = inUnit(left, ev.unit, lot.unit, conv);
    if (want == null || want <= 0) continue;
    const used = Math.min(lot.qty, want);
    lot.qty -= used;
    left *= 1 - used / want;
  }
}

const byAt = (a: StockEvent, b: StockEvent) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === b.kind ? 0 : a.kind === "draw" ? -1 : 1);

/** Walks one ingredient's events in time order over its lots. Draws always drain (soonest use-by first, only lots
 *  bought by then and still good). Needs are covered while the stock still good on their day holds their whole
 *  amount; from the first need it can't (or whose amount is unknown), that need and every later one stay uncovered
 *  — a need is dropped only when sure. Returns the lots left and the keys of the needs covered. */
export function walkStock(lots: Lot[], events: StockEvent[], conv: UnitConversions = {}): { remaining: Lot[]; covered: Set<string> } {
  const left = lots.map((l) => ({ ...l })).sort((a, b) => (a.use_by < b.use_by ? -1 : a.use_by > b.use_by ? 1 : 0));
  const covered = new Set<string>();
  let short = false;
  for (const ev of [...events].sort(byAt)) {
    const usable = left.filter(usableFor(ev));
    if (ev.kind === "draw") { take(usable, ev, conv); continue; }
    if (short) continue;
    if (usable.some((l) => l.qty === null)) { covered.add(ev.key!); continue; }
    if (ev.qty == null || available(usable, ev, conv) + EPS < ev.qty) { short = true; continue; }
    take(usable, ev, conv);
    covered.add(ev.key!);
  }
  return { remaining: left.filter((l) => l.qty === null || l.qty > EPS), covered };
}

/** "570 g" / "1 pc" / "2" → amount and unit; null when there's no leading number. */
export function parseQtyText(text: string | null): { qty: number; unit: string | null } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/.exec(text ?? "");
  return m ? { qty: Number(m[1]), unit: m[2]?.toLowerCase() ?? null } : null;
}

// --- Reading the database --------------------------------------------------------------------------------------------

/** The kit keeps settings in the same sqlite file; a caller with no settings reader in hand reads them here. */
export const settingsOf = (db: Db): SettingsReader => settingsReaderFrom((db as unknown as { $client: Database }).$client);

const conversionsOf = (ing: IngredientRow | undefined): UnitConversions => parseJson(ing?.unit_conversions, {});
const isoToLocal = (iso: string): string => localStamp(new Date(iso));
const writtenOffAt = (ing: IngredientRow | undefined): string | null =>
  ing?.last_checked_at && (ing.level === "low" || ing.level === "out") ? isoToLocal(ing.last_checked_at) : null;

interface RawLot { ingredient_id: string; qty: number | null; unit: string | null; at: string; use_by?: string | null; source: LotSource }

function orderedLots(db: Db, catalog: Map<string, IngredientRow>): { lots: RawLot[]; orderedCarts: Set<string> } {
  const rows = db.select({ ingredient_id: groceries.ingredient_id, qty: groceries.qty, qty_max: groceries.qty_max, qty_unit: groceries.qty_unit,
    updated_at: groceries.updated_at, cart_id: groceries.cart_id, ordered_at: carts.ordered_at })
    .from(groceries).leftJoin(carts, eq(carts.id, groceries.cart_id)).where(eq(groceries.status, "ordered")).all() as
    { ingredient_id: string | null; qty: string | null; qty_max: number | null; qty_unit: string | null; updated_at: string; cart_id: string | null; ordered_at: string | null }[];
  const lots: RawLot[] = [];
  const latest = new Map<string, string>();
  const orderedCarts = new Set<string>();
  for (const r of rows) {
    if (!r.ingredient_id) continue;
    const amount = parseQtyText(r.qty) ?? (r.qty_max != null ? { qty: r.qty_max, unit: r.qty_unit } : null);
    if (!amount) continue;
    const at = r.ordered_at ?? r.updated_at;
    lots.push({ ingredient_id: r.ingredient_id, ...amount, at, source: "order" });
    if ((latest.get(r.ingredient_id) ?? "") < at) latest.set(r.ingredient_id, at);
    if (r.cart_id) orderedCarts.add(`${r.cart_id}|${r.ingredient_id}`);
  }
  // The ordered endpoint stamps the ingredient with the same purchase its rows carry: only a newer stamp is another one.
  for (const [id, ing] of catalog) {
    if (ing.last_ordered_at && ing.last_ordered_qty != null && (latest.get(id) ?? "") < ing.last_ordered_at) {
      lots.push({ ingredient_id: id, qty: ing.last_ordered_qty, unit: null, at: ing.last_ordered_at, source: "order" });
    }
  }
  return { lots, orderedCarts };
}

/** `stock` rows the owner or agent added; an order's own rows are skipped when its grocery rows already count. */
function addedLots(db: Db, orderedCarts: Set<string>): RawLot[] {
  const rows = db.select().from(stock).all() as
    { ingredient_id: string | null; qty: number | null; unit: string | null; bought_at: string | null; use_by: string | null; source: string; cart_id: string | null; created_at: string }[];
  return rows.filter((s) => s.ingredient_id && !(s.cart_id && orderedCarts.has(`${s.cart_id}|${s.ingredient_id}`))).map((s) => ({
    ingredient_id: s.ingredient_id!, qty: s.qty, unit: s.unit, at: s.bought_at ?? s.created_at, use_by: s.use_by,
    source: (["order", "owner", "inferred"].includes(s.source) ? s.source : "owner") as LotSource,
  }));
}

/** "Already have it until <date>" on a list row (the Shopping page, or the agent PATCHing in_stock_until) becomes a
 *  `stock` row for that ingredient, so it covers every meal that needs it until then — not just that one row, which
 *  the next recompute may remove. Idempotent: one owner row per (ingredient, date). */
export function stockFromInStockRows(db: Db, now: Date, emit?: (table: string, id: string, op: "insert") => void): number {
  const today = localStamp(now).slice(0, 10);
  const marked = db.select({ ingredient_id: groceries.ingredient_id, item: groceries.item, until: groceries.in_stock_until, at: groceries.updated_at })
    .from(groceries).where(and(isNotNull(groceries.ingredient_id), gte(groceries.in_stock_until, today))).all() as
    { ingredient_id: string; item: string; until: string; at: string }[];
  if (!marked.length) return 0;
  const have = new Set((db.select({ ingredient_id: stock.ingredient_id, use_by: stock.use_by }).from(stock).where(eq(stock.source, "owner")).all() as
    { ingredient_id: string | null; use_by: string | null }[]).map((r) => `${r.ingredient_id}|${r.use_by}`));
  let added = 0;
  for (const m of marked) {
    const key = `${m.ingredient_id}|${m.until}`;
    if (have.has(key)) continue;
    have.add(key);
    const row = db.insert(stock).values({ ingredient_id: m.ingredient_id, item: m.item, bought_at: m.at, use_by: m.until, source: "owner", updated_by: "app" }).returning().get() as { id: string };
    emit?.("stock", row.id, "insert");
    added++;
  }
  return added;
}

/** Every purchase that could still be at home on or after `since` (a date), per ingredient, in its base unit. */
export function readLots(db: Db, catalog: Map<string, IngredientRow>, since: string): Map<string, Lot[]> {
  const { lots, orderedCarts } = orderedLots(db, catalog);
  const out = new Map<string, Lot[]>();
  for (const r of [...lots, ...addedLots(db, orderedCarts)]) {
    const ing = catalog.get(r.ingredient_id);
    const bought = isoToLocal(r.at);
    const off = writtenOffAt(ing);
    if (off && bought <= off) continue;
    const use_by = r.use_by ?? addDaysStr(bought.slice(0, 10), shelfLifeDays(ing?.shelf_life_days, ing?.category));
    if (use_by < since) continue;
    const conv = conversionsOf(ing);
    const base = r.qty == null || r.unit == null ? null : toBase(r.qty, r.unit, conv, baseKindOf(ing?.default_unit, conv));
    const lot: Lot = { ingredient_id: r.ingredient_id, qty: base ? base.qty : r.qty, unit: base ? base.unit : null, bought, use_by, source: r.source };
    out.set(lot.ingredient_id, [...(out.get(lot.ingredient_id) ?? []), lot]);
  }
  return out;
}

export interface StockContext { now: Date; settings: SettingsReader; catalog: Map<string, IngredientRow>; defaults: Record<string, ShoppingPrefs> }

/** Meal needs as events per ingredient, at each meal's cook time. */
function mealEvents(rows: DesiredRow[], mealRows: { id: string; time: string | null }[], kind: StockEvent["kind"], settings: SettingsReader): Map<string, StockEvent[]> {
  const cook = timelineSettingsFrom(settings);
  const timeOf = new Map(mealRows.map((m) => [m.id, m.time]));
  const out = new Map<string, StockEvent[]>();
  for (const d of rows) {
    const at = `${d.needed_by}T${cookTimeFor(d.slot, timeOf.get(d.meal_id), cook) ?? "00:00"}`;
    out.set(d.ingredient_id, [...(out.get(d.ingredient_id) ?? []), { at, kind, qty: d.qty_min, unit: d.qty_unit, key: `${d.meal_id}|${d.ingredient_id}` }]);
  }
  return out;
}

/** What cooked meals between two dates drew: their rough needs. */
function cookedDraws(db: Db, from: string, to: string, ctx: StockContext): Map<string, StockEvent[]> {
  const cooked = db.select().from(meals).where(and(eq(meals.outcome, "cooked"), gte(meals.date, from), lte(meals.date, to))).all() as PlanMeal[];
  return mealEvents(needsForMeals(db, cooked, ctx.defaults, ctx.catalog), cooked, "draw", ctx.settings);
}

/** Standing consumption ("2 glasses of milk daily") as one draw at the start of each day from `from` to `to`. */
function standingDraws(db: Db, ingredientIds: string[], from: string, to: string, catalog: Map<string, IngredientRow>): Map<string, StockEvent[]> {
  const out = new Map<string, StockEvent[]>();
  if (!ingredientIds.length) return out;
  const rows = db.select().from(standing_consumption).where(inArray(standing_consumption.ingredient_id, ingredientIds)).all() as
    { ingredient_id: string; qty: number; unit: string | null; times_per_week: number; active: boolean | null }[];
  for (const r of rows) {
    if (r.active === false) continue;
    const ing = catalog.get(r.ingredient_id);
    const conv = conversionsOf(ing);
    const daily = toBase(r.qty * (r.times_per_week / 7), r.unit, conv, baseKindOf(ing?.default_unit ?? r.unit, conv));
    const evs = out.get(r.ingredient_id) ?? [];
    for (let d = from; d <= to; d = addDaysStr(d, 1)) evs.push({ at: `${d}T00:00`, kind: "draw", qty: daily.qty, unit: daily.unit });
    out.set(r.ingredient_id, evs);
  }
  return out;
}

/** Each ingredient's lots and every draw on them from the oldest lot's purchase through `until` (a date). */
function stockTimeline(db: Db, ctx: StockContext, until: string): { lots: Map<string, Lot[]>; draws: Map<string, StockEvent[]> } {
  const today = todayStr(ctx.now);
  const lots = readLots(db, ctx.catalog, addDaysStr(today, -LOOKBACK_DAYS));
  const draws = new Map<string, StockEvent[]>();
  if (!lots.size) return { lots, draws };
  const from = [...lots.values()].flat().reduce((min, l) => (l.bought < min ? l.bought : min), `${today}T23:59`).slice(0, 10);
  for (const part of [cookedDraws(db, from, today, ctx), standingDraws(db, [...lots.keys()], from, until, ctx.catalog)]) {
    for (const [id, evs] of part) draws.set(id, [...(draws.get(id) ?? []), ...evs]);
  }
  return { lots, draws };
}

/** What is at home right now, per ingredient: the lots still good today, less everything drawn on them so far. */
export function stockNow(db: Db, ctx: StockContext): Map<string, Lot[]> {
  const today = todayStr(ctx.now);
  const nowStamp = localStamp(ctx.now);
  const { lots, draws } = stockTimeline(db, ctx, today);
  const out = new Map<string, Lot[]>();
  for (const [id, own] of lots) {
    const past = (draws.get(id) ?? []).filter((e) => e.at <= nowStamp);
    const left = walkStock(own, past, conversionsOf(ctx.catalog.get(id))).remaining.filter((l) => l.use_by >= today);
    if (left.length) out.set(id, left);
  }
  return out;
}

/** The upcoming meal needs (keys "meal_id|ingredient_id") stock already covers, walked chronologically per
 *  ingredient: what was cooked so far and standing consumption are drawn as they happen, each meal in turn. */
export function coveredByStock(db: Db, desired: DesiredRow[], mealRows: { id: string; time: string | null }[], ctx: StockContext): Set<string> {
  const until = desired.reduce((max, d) => (d.needed_by > max ? d.needed_by : max), todayStr(ctx.now));
  const { lots, draws } = stockTimeline(db, ctx, until);
  const needs = mealEvents(desired.filter((d) => lots.has(d.ingredient_id)), mealRows, "need", ctx.settings);
  const covered = new Set<string>();
  for (const [id, evs] of needs) {
    for (const key of walkStock(lots.get(id)!, [...(draws.get(id) ?? []), ...evs], conversionsOf(ctx.catalog.get(id))).covered) covered.add(key);
  }
  return covered;
}

// --- The kitchen (Pantry page, check-ins) ----------------------------------------------------------------------------

/** How sure the app is that an item is at home: bought (an order), have (someone said so), checked (a check-in
 *  answer), assumed (long shelf life, never said otherwise), low / out (a check-in said so; it is on the list). */
export type KitchenStatus = "bought" | "have" | "checked" | "assumed" | "low" | "out";
export interface MealUse { meal_id: string; date: string; slot: string; dish: string }
export interface KitchenItem {
  ingredient_id: string; name: string; category: string | null; status: KitchenStatus;
  since: string | null;                 // local date the status rests on (the purchase, the answer); null when assumed
  last_checked_at: string | null; shelf_life_days: number; for_meals: MealUse[];
}

const SLOT_ORDER: Record<string, number> = { Breakfast: 0, Lunch: 1, Dinner: 2 };
const mealKey = (u: MealUse) => `${u.date}${SLOT_ORDER[u.slot] ?? 3}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The open meals of the horizon that use each ingredient (any category, held-back ones too), soonest first. */
export function upcomingUses(db: Db, now: Date, horizonDays: number): Map<string, MealUse[]> {
  const today = todayStr(now);
  const rows = db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish }).from(meals)
    .where(and(isNull(meals.outcome), gte(meals.date, today), lte(meals.date, addDaysStr(today, horizonDays - 1)))).all() as { id: string; date: string; slot: string; dish: string }[];
  const sets = recipeSets(db, rows.map((m) => m.id));
  const recipeIds = [...new Set([...sets.values()].flat().map((r) => r.recipe_id))];
  const out = new Map<string, MealUse[]>();
  if (!recipeIds.length) return out;
  const lines = db.select({ recipe_id: recipe_ingredients.recipe_id, ingredient_id: recipe_ingredients.ingredient_id, optional: recipe_ingredients.optional })
    .from(recipe_ingredients).where(inArray(recipe_ingredients.recipe_id, recipeIds)).all() as { recipe_id: string; ingredient_id: string | null; optional: number | null }[];
  for (const m of rows) {
    const mine = new Set((sets.get(m.id) ?? []).map((r) => r.recipe_id));
    for (const l of lines) {
      if (!l.ingredient_id || l.optional || !mine.has(l.recipe_id)) continue;
      const uses = out.get(l.ingredient_id) ?? [];
      if (!uses.some((u) => u.meal_id === m.id)) uses.push({ meal_id: m.id, date: m.date, slot: m.slot, dish: m.dish });
      out.set(l.ingredient_id, uses);
    }
  }
  for (const uses of out.values()) uses.sort((a, b) => cmp(mealKey(a), mealKey(b)));
  return out;
}

/** Long-shelf-life staples the household tracks, as catalog ingredient ids. */
function heldBackStapleIds(db: Db, catalog: Map<string, IngredientRow>): Set<string> {
  const keyOf = stapleKeyResolver(db);
  const rows = db.select({ item: staples.item, active: staples.active }).from(staples).all() as { item: string; active: boolean | null }[];
  return new Set(rows.filter((s) => s.active !== false).map((s) => keyOf(s.item)).filter((id) => isHeldBack(catalog.get(id)?.category)));
}

/** One ingredient's place in the kitchen, from its lots at home now and its last check-in answer; null = not at
 *  home as far as anyone knows. `tracked`: an upcoming meal or a staple uses it (a held-back item is assumed then). */
export function kitchenStatus(ing: IngredientRow, lots: Lot[], tracked: boolean, today: string): { status: KitchenStatus; since: string | null } | null {
  const checked = ing.last_checked_at ? isoToLocal(ing.last_checked_at) : null;
  const newest = lots.reduce<Lot | null>((n, l) => (!n || l.bought > n.bought ? l : n), null);
  if (checked && (ing.level === "low" || ing.level === "out") && (!newest || newest.bought <= checked)) return { status: ing.level, since: checked.slice(0, 10) };
  if (newest && !(checked && checked > newest.bought)) return { status: newest.source === "owner" ? "have" : "bought", since: newest.bought.slice(0, 10) };
  const keeps = (since: string) => addDaysStr(since, shelfLifeDays(ing.shelf_life_days, ing.category)) >= today;
  if (checked && (newest || isHeldBack(ing.category) || keeps(checked.slice(0, 10)))) return { status: "checked", since: checked.slice(0, 10) };
  if (isHeldBack(ing.category) && tracked) return { status: "assumed", since: null };
  return null;
}

/** Everything the app believes is in the kitchen, with how sure it is, by name. */
export function kitchenItems(db: Db, now = new Date(), settings: SettingsReader = settingsOf(db)): KitchenItem[] {
  const catalog = loadIngredients(db);
  const ctx: StockContext = { now, settings, catalog, defaults: settings.get<Record<string, ShoppingPrefs>>("prefs.category_defaults") ?? {} };
  const today = todayStr(now);
  const atHome = stockNow(db, ctx);
  const uses = upcomingUses(db, now, settings.get<number>("plan.horizon_days") ?? 7);
  const stapleIds = heldBackStapleIds(db, catalog);
  const out: KitchenItem[] = [];
  for (const ing of catalog.values()) {
    const s = kitchenStatus(ing, atHome.get(ing.id) ?? [], uses.has(ing.id) || stapleIds.has(ing.id), today);
    if (!s) continue;
    out.push({ ingredient_id: ing.id, name: ing.name, category: ing.category, ...s, last_checked_at: ing.last_checked_at,
      shelf_life_days: shelfLifeDays(ing.shelf_life_days, ing.category), for_meals: uses.get(ing.id) ?? [] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (date: string) => { const [y, m, d] = date.split("-").map(Number); return WEEKDAYS[new Date(y, m - 1, d).getDay()]; };
export const mealLabel = (u: MealUse): string => `${u.dish} (${weekday(u.date)} ${u.slot.toLowerCase()})`;

/** Whether an item's last known state (purchase or answer) is older than its check cadence. Low/out items are
 *  already on the list: nothing to ask. */
export function isCheckDue(item: Pick<KitchenItem, "status" | "since" | "shelf_life_days" | "category">, today: string): boolean {
  if (item.status === "low" || item.status === "out") return false;
  return !item.since || addDaysStr(item.since, checkCadenceDays(item.shelf_life_days, item.category)) <= today;
}

/** The kitchen items due for a check-in, most relevant to the coming meals first, at most PANTRY_CHECK_MAX. */
export function dueForCheck(items: KitchenItem[], today: string): PantryDue[] {
  const firstUse = (i: KitchenItem) => (i.for_meals[0] ? mealKey(i.for_meals[0]) : "~");
  return items
    .filter((i) => isCheckDue(i, today))
    .sort((a, b) => cmp(firstUse(a), firstUse(b)) || cmp(a.since ?? "", b.since ?? ""))
    .slice(0, PANTRY_CHECK_MAX)
    .map((i) => ({ ingredient_id: i.ingredient_id, name: i.name, category: i.category, last_checked_at: i.last_checked_at, for_meals: i.for_meals.map(mealLabel) }));
}

/** Items due for a check-in now, most relevant to the coming meals first. The reminder message carries them. */
export function pantryCheckDue(db: BunSQLiteDatabase<any>, now: Date): PantryDue[] {
  return dueForCheck(kitchenItems(db, now), todayStr(now));
}
