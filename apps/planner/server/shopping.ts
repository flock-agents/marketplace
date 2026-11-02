// The shopping flow's app side (docs/V3-FLOW-SPEC.md): the plan recompute every read starts from, the windows (slots =
// drafts and recent orders) with the meals each one spans, letting a draft go, recording an order, and per-meal
// readiness. Draft edits, quotes and the yes live in server/draft.ts; the message budget in server/messages.ts.
import { inferMealOutcomes } from "./mealOutcomes";
import { stockFromInStockRows } from "./stock";
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, groceries, ingredients, meals, staples } from "./db/schema";
import { ensureMealGroceries, ingredientInput, loadIngredients, type IngredientRow } from "./mealGroceries";
import { effectivePrefs, formatRange, mergeCartLines, parseJson, type CartLine, type LineResolver, type LineSourceRow, type ShoppingPrefs } from "./quantity";
import { addDaysStr, addMinutes, cookTimeFor, dateTime, recalcTimeline, stapleKeyResolver, timelineSettingsFrom, todayStr, type ChangeEmitter, type SettingsReader } from "./timeline";
import { refreshOrderPatterns } from "./orderPatterns";
import { parseQuotes, type Quote } from "./quotes";
import { logChoice } from "./choices";
import { queueFindPatterns } from "./patterns";

type Db = BunSQLiteDatabase<any>;
type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;
type CartRow = typeof carts.$inferSelect;

const OPEN = ["pending", "confirmed"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (d: Date) => `${todayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const orderAtOf = (c: { buy_at: string; order_at?: string | null }) => c.order_at ?? c.buy_at;

const categoryDefaults = (settings: SettingsReader) => (settings.get<Record<string, ShoppingPrefs>>("prefs.category_defaults") ?? {});
const horizonOf = (settings: SettingsReader) => settings.get<number>("plan.horizon_days") ?? 7;

/** v2 cart states → v3 (draft → ordered | let_go). Idempotent: run on every boot. */
export function migrateCartStatuses(db: Db): void {
  db.update(carts).set({ status: "draft", updated_by: "app" }).where(inArray(carts.status, ["upcoming", "discussed", "building", "awaiting_yes"])).run();
  db.update(carts).set({ status: "let_go", updated_by: "app" }).where(inArray(carts.status, ["skipped", "missed"])).run();
}

/** Let go drafts whose yes wait is over, recompute meal needs, reschedule the timeline — the one entry point every
 *  route and the routine use. */
export function refreshShopping(db: Db, settings: SettingsReader, now = new Date(), emit?: Emit): void {
  const e = emit as ChangeEmitter | undefined;
  inferMealOutcomes(db, settings, now, emit);   // meals surely over count as cooked before anything is computed
  stockFromInStockRows(db, now, emit);          // "already have it until …" covers the ingredient, not one row
  letGoExpired(db, settings, now, emit);
  ensureMealGroceries(db, horizonOf(settings), now, e, categoryDefaults(settings));
  recalcTimeline(db, settings, horizonOf(settings), now, e);
}

export function lineResolver(catalog: Map<string, IngredientRow>, defaults: Record<string, ShoppingPrefs>): LineResolver {
  return {
    prefsFor: (id, category) => { const r = catalog.get(id); return effectivePrefs(r ? ingredientInput(r).prefs : {}, r?.category ?? category, defaults); },
    conversionsFor: (id) => { const r = catalog.get(id); return r ? ingredientInput(r).conversions : {}; },
  };
}

interface GroceryRow extends LineSourceRow { status: string | null; cart_id: string | null; source: string | null; done: boolean | null; in_stock_until?: string | null }
interface MealRow { id: string; date: string; slot: string; dish: string; time: string | null }

export interface CoveredMeal { meal_id: string; date: string; slot: string; dish: string; time: string }
/** The meals a draft covers, earliest to latest: "Thu breakfast → Sat dinner" (one meal: "Thu breakfast"). */
export interface Span { from: { date: string; slot: string }; to: { date: string; slot: string }; label: string }
export interface Slot {
  id: string; status: string; order_by: string; order_at: string; deadline: string | null; categories: string[];
  covers: CoveredMeal[]; span: Span | null; lines: CartLine[]; estimate: number | null; quotes: Quote[];
  chosen_service: string | null; grand_total: number | null; order_ref: string | null; delivery_eta: string | null; snapshot: unknown;
  yes_at: string | null; confirmed_by: string | null; moved_at: string | null;
}

const weekdayOf = (date: string) => { const [y, m, d] = date.split("-").map(Number); return DAY_SHORT[new Date(y, m - 1, d).getDay()]; };
const mealLabel = (m: { date: string; slot: string }) => `${weekdayOf(m.date)} ${m.slot.toLowerCase()}`;

/** `covers` must be sorted earliest first (buildSlot's order). */
export function spanOf(covers: { date: string; slot: string }[]): Span | null {
  if (!covers.length) return null;
  const first = covers[0], last = covers[covers.length - 1];
  const from = { date: first.date, slot: first.slot }, to = { date: last.date, slot: last.slot };
  const same = from.date === to.date && from.slot === to.slot;
  return { from, to, label: same ? mealLabel(first) : `${mealLabel(first)} → ${mealLabel(last)}` };
}

function mealTime(m: MealRow, settings: SettingsReader): string {
  if (m.time) return m.time;
  if (m.slot === "Lunch") return settings.get<string>("cook.lunch") ?? "13:00";
  return m.slot === "Dinner" ? settings.get<string>("cook.evening") : settings.get<string>("cook.morning");
}

/** The latest moment an order can still arrive in time for the earliest meal it covers (cook time − delivery lead). */
function hardDeadline(rows: GroceryRow[], mealsById: Map<string, MealRow>, settings: SettingsReader): string | null {
  const s = timelineSettingsFrom(settings);
  const deadlines = rows.filter((r) => r.needed_by).map((r) => {
    const m = r.meal_id ? mealsById.get(r.meal_id) : undefined;
    return addMinutes(dateTime(r.needed_by!, cookTimeFor(m?.slot, m?.time, s)), -s.deliveryLeadMin);
  });
  return deadlines.length ? deadlines.sort()[0] : null;
}

function buildSlot(cart: CartRow, rows: GroceryRow[], mealsById: Map<string, MealRow>, resolver: LineResolver, settings: SettingsReader): Slot {
  const covered = new Map<string, CoveredMeal>();
  for (const r of rows) {
    const m = r.meal_id ? mealsById.get(r.meal_id) : undefined;
    if (m) covered.set(m.id, { meal_id: m.id, date: m.date, slot: m.slot, dish: m.dish, time: mealTime(m, settings) });
  }
  const covers = [...covered.values()].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return {
    id: cart.id, status: cart.status, order_by: cart.buy_at, order_at: orderAtOf(cart), deadline: hardDeadline(rows, mealsById, settings),
    categories: parseJson<string[]>(cart.categories, []), covers, span: spanOf(covers),
    lines: mergeCartLines(rows, resolver), estimate: cart.estimate, quotes: parseQuotes(cart.quotes),
    chosen_service: cart.chosen_service, grand_total: cart.grand_total, order_ref: cart.order_ref, delivery_eta: cart.delivery_eta,
    snapshot: parseJson<unknown>(cart.snapshot, null), yes_at: cart.yes_at, confirmed_by: cart.confirmed_by, moved_at: cart.moved_at,
  };
}

function slotContext(db: Db, settings: SettingsReader) {
  const mealsById = new Map((db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, time: meals.time }).from(meals).all() as MealRow[]).map((m) => [m.id, m]));
  return { mealsById, resolver: lineResolver(loadIngredients(db), categoryDefaults(settings)) };
}

export const rowsOfCart = (db: Db, cartId: string, statuses: string[]) =>
  db.select().from(groceries).where(and(eq(groceries.cart_id, cartId), inArray(groceries.status, statuses))).all() as GroceryRow[];

const rowStatusesOf = (cart: { status: string }) => (cart.status === "ordered" ? ["ordered"] : OPEN);

/** Every draft, plus orders from yesterday on (so the page can show what's on its way), soonest first. */
export function listSlots(db: Db, settings: SettingsReader, now = new Date()): Slot[] {
  const { mealsById, resolver } = slotContext(db, settings);
  const since = addDaysStr(todayStr(now), -1);
  const visible = (db.select().from(carts).all() as CartRow[])
    .filter((c) => c.status === "draft" || (c.status === "ordered" && orderAtOf(c).slice(0, 10) >= since));
  return visible
    .sort((a, b) => orderAtOf(a).localeCompare(orderAtOf(b)))
    .map((c) => buildSlot(c, rowsOfCart(db, c.id, rowStatusesOf(c)), mealsById, resolver, settings));
}

export function getSlot(db: Db, settings: SettingsReader, cartId: string): Slot | null {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return null;
  const { mealsById, resolver } = slotContext(db, settings);
  return buildSlot(cart, rowsOfCart(db, cart.id, rowStatusesOf(cart)), mealsById, resolver, settings);
}

// --- Let go -----------------------------------------------------------------------------------------------------------
export type LetGoResult = { ok: true; rows_released: number; rows_dropped: number } | { ok: false; status: 404 | 409; reason: string };

/** A draft is let go: nothing is ordered, its open items are released and roll into the next draft on the next
 *  recompute. `source` owner = the owner's "Let it go"; inferred = no yes in time. A window closing asks for a pattern run. */
/** The next draft's order time after `orderAt`, or null when none is planned yet. */
function nextOrderAt(db: Db, cartId: string, orderAt: string): string | null {
  const drafts = db.select().from(carts).where(eq(carts.status, "draft")).all() as CartRow[];
  return drafts.filter((c) => c.id !== cartId).map(orderAtOf).filter((t) => t > orderAt).sort()[0] ?? null;
}

/** A skipped draft's meal items only move on while a meal they're for is still ahead of the next order's arrival;
 *  the rest are skipped (they stay skipped unless their meal changes). The family's own items always move on. */
export function splitOnLetGo(rows: GroceryRow[], mealsById: Map<string, MealRow>, nextAt: string | null, settings: SettingsReader): { move: GroceryRow[]; drop: GroceryRow[] } {
  if (!nextAt) return { move: rows, drop: [] };
  const s = timelineSettingsFrom(settings);
  const arrives = addMinutes(nextAt, s.deliveryLeadMin);
  const tooLate = (r: GroceryRow) => {
    const m = r.meal_id ? mealsById.get(r.meal_id) : undefined;
    return !!m && !!r.needed_by && dateTime(r.needed_by, cookTimeFor(m.slot, m.time, s)) < arrives;
  };
  return { move: rows.filter((r) => !tooLate(r)), drop: rows.filter(tooLate) };
}

export function letGo(db: Db, settings: SettingsReader, cartId: string, now: Date, source: "owner" | "inferred", emit?: Emit): LetGoResult {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return { ok: false, status: 404, reason: "cart_not_found" };
  if (cart.status !== "draft") return { ok: false, status: 409, reason: `cart_${cart.status}` };
  const rows = rowsOfCart(db, cartId, OPEN);
  db.update(carts).set({ status: "let_go", let_go_at: now.toISOString(), updated_by: "app" }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
  const mealIds = [...new Set(rows.map((r) => r.meal_id).filter((x): x is string => !!x))];
  const mealsById = new Map(mealIds.length ? (db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, time: meals.time })
    .from(meals).where(inArray(meals.id, mealIds)).all() as MealRow[]).map((m) => [m.id, m]) : []);
  const { move, drop } = splitOnLetGo(rows, mealsById, nextOrderAt(db, cartId, orderAtOf(cart)), settings);
  const release = (list: GroceryRow[], set: Record<string, unknown>) => {
    if (!list.length) return;
    db.update(groceries).set({ cart_id: null, buy_at: null, ...set, updated_by: "app" }).where(inArray(groceries.id, list.map((r) => r.id))).run();
    for (const r of list) emit?.("groceries", r.id, "update");
  };
  release(move, {});
  release(drop, { status: "skipped" });
  logChoice(db, { kind: "draft_let_go", subject: cartId, source, at: now,
    detail: { order_at: orderAtOf(cart), items: [...new Set(move.map((r) => r.item))], dropped: [...new Set(drop.map((r) => r.item))], quotes: parseQuotes(cart.quotes).map((q) => ({ service: q.service, total: q.total })) } });
  queueFindPatterns(db, now);
  return { ok: true, rows_released: move.length, rows_dropped: drop.length };
}

/** When a draft with no yes is let go: shop.yes_wait_h after its order time — or after the yes, when a yes came but no
 *  order followed (the agent couldn't place it). */
export function letGoDue(cart: { order_at: string; yes_at: string | null }, yesWaitH: number, now: Date): boolean {
  const waitMin = Math.round(yesWaitH * 60);
  if (addMinutes(cart.order_at, waitMin) > stamp(now)) return false;
  return !cart.yes_at || now.getTime() - new Date(cart.yes_at).getTime() >= waitMin * 60_000;
}

export function letGoExpired(db: Db, settings: SettingsReader, now: Date, emit?: Emit): string[] {
  const wait = settings.get<number>("shop.yes_wait_h") ?? 3;
  const drafts = db.select().from(carts).where(eq(carts.status, "draft")).all() as CartRow[];
  const due = drafts.filter((c) => letGoDue({ order_at: orderAtOf(c), yes_at: c.yes_at }, wait, now)).map((c) => c.id);
  for (const id of due) letGo(db, settings, id, now, "inferred", emit);
  return due;
}

// --- Ordered ----------------------------------------------------------------------------------------------------------
export interface OrderedBody { service: string; total?: number | null; order_ref?: string | null; delivery_eta?: string | null }
export type OrderedResult = { ok: true; rows_ordered: number } | { ok: false; status: 404 | 409; reason: string };

/** The frozen copy of the order: what was bought (the service's own lines when its quote had them), the meals it
 *  spans, and every quote it was compared against. */
function orderSnapshot(slot: Slot, body: OrderedBody) {
  const quote = slot.quotes.find((q) => q.service.trim().toLowerCase() === body.service.trim().toLowerCase());
  const lines = quote?.lines?.length ? quote.lines : slot.lines.map((l) => ({ name: l.item, pack: formatRange(l.qty_min, l.qty_max, l.qty_unit) ?? l.qty, qty: 1, price: null }));
  return { service: body.service, total: body.total ?? quote?.total ?? null, fees: quote?.fees ?? null, screenshot_url: quote?.screenshot_url ?? null, lines,
    span: slot.span, quotes: slot.quotes.map((q) => ({ service: q.service, total: q.total })) };
}

/** Records a placed order: draft → ordered with a frozen snapshot, its open rows → ordered, ingredients' and staples'
 *  last purchase stamped now, the pick logged (service_picked), then the plan recomputes. Re-posting an order updates
 *  it. A let-go draft can't be ordered: its items already moved to the next draft. */
export function markOrdered(db: Db, settings: SettingsReader, cartId: string, body: OrderedBody, now = new Date(), emit?: Emit): OrderedResult {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return { ok: false, status: 404, reason: "cart_not_found" };
  if (cart.status === "let_go") return { ok: false, status: 409, reason: "cart_let_go" };
  const wasDraft = cart.status === "draft";
  const slot = getSlot(db, settings, cartId)!;
  const nowIso = now.toISOString();
  db.update(carts).set({
    status: "ordered", ordered_at: wasDraft ? nowIso : cart.ordered_at, chosen_service: body.service, grand_total: body.total ?? null,
    order_ref: body.order_ref ?? null, delivery_eta: body.delivery_eta ?? null, snapshot: JSON.stringify(orderSnapshot(slot, body)), updated_by: "app",
  }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
  if (!wasDraft) return { ok: true, rows_ordered: 0 };

  const rows = rowsOfCart(db, cartId, OPEN);
  if (rows.length) {
    db.update(groceries).set({ status: "ordered", service: body.service, updated_by: "app" }).where(inArray(groceries.id, rows.map((r) => r.id))).run();
    for (const r of rows) emit?.("groceries", r.id, "update");
  }
  stampPurchases(db, rows, nowIso, emit);
  logChoice(db, { kind: "service_picked", subject: body.service, source: "owner", at: now,
    detail: { cart_id: cartId, total: body.total ?? null, best: cart.chosen_service, quotes: slot.quotes.map((q) => ({ service: q.service, total: q.total })) } });
  queueFindPatterns(db, now);
  refreshOrderPatterns(db, now);   // a new order may confirm (or shift) a learned window
  refreshShopping(db, settings, now, emit);
  return { ok: true, rows_ordered: rows.length };
}

/** Bought today: each ingredient's and staple's last purchase, so stock and staple cadence see it. */
function stampPurchases(db: Db, rows: GroceryRow[], nowIso: string, emit?: Emit) {
  const bought = new Map<string, number>();
  for (const r of rows) if (r.ingredient_id) bought.set(r.ingredient_id, (bought.get(r.ingredient_id) ?? 0) + (r.qty_max ?? r.qty_min ?? 0));
  for (const [id, qty] of bought) {
    db.update(ingredients).set({ last_ordered_at: nowIso, last_ordered_qty: qty || null, updated_by: "app" }).where(eq(ingredients.id, id)).run();
    emit?.("ingredients", id, "update");
  }
  const keyOf = stapleKeyResolver(db);
  const stapleKeys = new Set(rows.filter((r) => r.source === "staple").map((r) => keyOf(r.item)));
  for (const s of db.select({ id: staples.id, item: staples.item }).from(staples).all() as { id: string; item: string }[]) {
    if (!stapleKeys.has(keyOf(s.item))) continue;
    db.update(staples).set({ last_ordered_at: nowIso, updated_by: "app" }).where(eq(staples.id, s.id)).run();
    emit?.("staples", s.id, "update");
  }
}

// --- Readiness --------------------------------------------------------------------------------------------------------
export type Readiness = "ready" | "ordering" | "missing";
export interface ReadinessItem {
  grocery_id: string; ingredient_id: string | null; item: string; qty_min: number | null; qty_max: number | null; qty_unit: string | null;
  status: string | null; cart_id: string | null; cart_status: string | null; readiness: Readiness;
}

/** Per-row: bought → ready; on a draft whose deadline is still ahead → ordering; anything else → missing. */
export function rowReadiness(status: string | null, done: boolean | null, cartStatus: string | null, deadline: string | null, nowStamp: string): Readiness {
  if (done || status === "ordered" || status === "have_stock" || cartStatus === "ordered") return "ready";
  if (status === "skipped") return "missing";
  if (cartStatus === "draft" && (!deadline || deadline >= nowStamp)) return "ordering";
  return "missing";
}

interface MealCart { id: string; status: string; buy_at: string; order_at: string | null; chosen_service: string | null }
export interface MealReadiness {
  meal_id: string; dish: string; date: string; slot: string; time: string; deadline: string | null; status: Readiness; items: ReadinessItem[];
  ingredients: { name: string; need: string | null; in_stock: boolean; status: Readiness }[]; cart: MealCart | null;
}

export function mealReadiness(db: Db, settings: SettingsReader, mealId: string, now = new Date()): MealReadiness | null {
  const meal = db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, time: meals.time }).from(meals).where(eq(meals.id, mealId)).get() as MealRow | undefined;
  if (!meal) return null;
  const rows = db.select().from(groceries).where(eq(groceries.meal_id, mealId)).all() as GroceryRow[];
  const deadline = hardDeadline(rows.length ? rows : [{ needed_by: meal.date, meal_id: meal.id } as GroceryRow], new Map([[meal.id, meal]]), settings);
  const cartIds = [...new Set(rows.map((r) => r.cart_id).filter((x): x is string => !!x))];
  const cartStatus = new Map(cartIds.length ? (db.select({ id: carts.id, status: carts.status }).from(carts).where(inArray(carts.id, cartIds)).all() as { id: string; status: string }[]).map((c) => [c.id, c.status]) : []);
  const nowStamp = stamp(now);
  // "Already have it" until a date counts as in stock while that date lasts, same as the Shopping page reads it.
  const statusOf = (r: GroceryRow) => (r.in_stock_until && r.in_stock_until >= nowStamp.slice(0, 10) ? "have_stock" : r.status);
  const items = rows.map((r): ReadinessItem => {
    const cs = r.cart_id ? cartStatus.get(r.cart_id) ?? null : null;
    return { grocery_id: r.id, ingredient_id: r.ingredient_id, item: r.item, qty_min: r.qty_min, qty_max: r.qty_max, qty_unit: r.qty_unit, status: r.status, cart_id: r.cart_id, cart_status: cs, readiness: rowReadiness(statusOf(r), r.done, cs, deadline, nowStamp) };
  });
  const status: Readiness = items.some((i) => i.readiness === "missing") ? "missing" : items.some((i) => i.readiness === "ordering") ? "ordering" : "ready";
  // The Week page's compact shape: one entry per ingredient, and the cart covering the meal (the open draft first).
  const ingredientsView = rows.map((r) => ({ name: r.item, need: formatRange(r.qty_min, r.qty_max, r.qty_unit) ?? r.qty, in_stock: statusOf(r) === "have_stock" || !!r.done, status: rowReadiness(statusOf(r), r.done, r.cart_id ? cartStatus.get(r.cart_id) ?? null : null, deadline, nowStamp) }));
  const coveringId = [...cartIds].sort((a, b) => Number(cartStatus.get(a) === "ordered") - Number(cartStatus.get(b) === "ordered"))[0];
  const cart = coveringId ? db.select({ id: carts.id, status: carts.status, buy_at: carts.buy_at, order_at: carts.order_at, chosen_service: carts.chosen_service }).from(carts).where(eq(carts.id, coveringId)).get() as MealCart : null;
  return { meal_id: meal.id, dish: meal.dish, date: meal.date, slot: meal.slot, time: mealTime(meal, settings), deadline, status, items, ingredients: ingredientsView, cart };
}

/** Many meals' readiness at once (the Week page's chips): the same per-meal rule as mealReadiness, "none" for a meal
 *  with no grocery rows, unknown ids left out. */
export function mealReadinessMap(db: Db, settings: SettingsReader, mealIds: string[], now = new Date()): Record<string, Readiness | "none"> {
  const out: Record<string, Readiness | "none"> = {};
  for (const id of mealIds) {
    const r = mealReadiness(db, settings, id, now);
    if (r) out[id] = r.items.length ? r.status : "none";
  }
  return out;
}
