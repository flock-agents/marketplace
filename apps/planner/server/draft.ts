// The next draft as the agent and the Shopping page see it, and every change to a draft (docs/V3-FLOW-SPEC.md "Agent
// surface"): its lines with the meals it spans, the lines the family removed, service quotes and the best one, the
// family's yes, moving its window, and which message the window sends next. The app is the source of truth: every
// list the agent shares is this view, and every chat edit goes through these functions.
import { eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, groceries } from "./db/schema";
import { formatRange, type CartLine } from "./quantity";
import { loadIngredients } from "./mealGroceries";
import { addMinutes, stapleKeyResolver, timelineSettingsFrom, type SettingsReader } from "./timeline";
import { getSlot, orderAtOf, rowsOfCart, stamp, type CoveredMeal, type Span } from "./shopping";
import { bestQuote, parseQuotes, upsertQuote, type BestQuote, type Quote, type QuoteInput, type ServiceRule } from "./quotes";
import { messagesFor, nextSlot, windowSettings, windowTimes, type LoggedMessage, type SlotPlan, type WindowTimes } from "./messages";
import { logChoice } from "./choices";
import { learnedRule } from "./patterns";

type Db = BunSQLiteDatabase<any>;
type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;
type CartRow = typeof carts.$inferSelect;
type Fail = { ok: false; status: 400 | 404 | 409; reason: string };

export interface DraftLine extends CartLine { range: string | null }
export interface DraftView {
  id: string; order_at: string; span: Span | null; covers: CoveredMeal[]; lines: DraftLine[]; removed: { key: string; ingredient_id: string | null; item: string }[];
  quotes: (Quote & { stale: boolean })[]; best: BestQuote | null; yes: { by: string | null; at: string } | null; moved: boolean;
  times: WindowTimes; next_message: SlotPlan | null; messages: LoggedMessage[];
}

/** What the draft's lines are, as one string: a quote taken for other lines is stale. */
export const linesKey = (lines: CartLine[]): string => lines.map((l) => `${l.key}:${l.qty_max ?? l.qty ?? ""}`).sort().join("|");

const serviceRule = (db: Db) => learnedRule<ServiceRule>(db, "service");

/** The next draft to order: the soonest draft with anything on it. */
export function nextDraftId(db: Db): string | null {
  const drafts = (db.select().from(carts).where(eq(carts.status, "draft")).all() as CartRow[]).sort((a, b) => orderAtOf(a).localeCompare(orderAtOf(b)));
  const open = drafts.find((c) => rowsOfCart(db, c.id, ["pending", "confirmed"]).length > 0);
  return open?.id ?? null;
}

export function draftView(db: Db, settings: SettingsReader, cartId: string, now: Date): DraftView | null {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart || cart.status !== "draft") return null;
  const slot = getSlot(db, settings, cartId)!;
  const key = linesKey(slot.lines);
  const quotes = slot.quotes.map((q) => ({ ...q, stale: q.lines_key !== key }));
  const ws = windowSettings(db, settings);
  const times = windowTimes(slot.order_at, ws);
  const messages = messagesFor(db, cartId);
  return {
    id: slot.id, order_at: slot.order_at, span: slot.span, covers: slot.covers,
    lines: slot.lines.map((l) => ({ ...l, range: formatRange(l.qty_min, l.qty_max, l.qty_unit) ?? l.qty })),
    removed: removedLines(db, cartId), quotes, best: bestQuote(quotes.filter((q) => !q.stale), serviceRule(db)),
    yes: cart.yes_at ? { by: cart.confirmed_by, at: cart.yes_at } : null, moved: !!cart.moved_at,
    times, next_message: nextSlot(times, new Set(messages.map((m) => m.slot)), stamp(now), ws, stamp(new Date(cart.created_at))), messages,
  };
}

function removedLines(db: Db, cartId: string) {
  const out = new Map<string, { key: string; ingredient_id: string | null; item: string }>();
  for (const r of rowsOfCart(db, cartId, ["skipped"])) {
    const key = lineKeyOf(r);
    if (!out.has(key)) out.set(key, { key, ingredient_id: r.ingredient_id, item: r.item });
  }
  return [...out.values()];
}

const lineKeyOf = (r: { ingredient_id: string | null; item: string }) => r.ingredient_id ?? `item:${r.item.trim().toLowerCase()}`;

/** A draft the family can still change: a draft with no yes yet. */
function editableDraft(db: Db, cartId: string): CartRow | Fail {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return { ok: false, status: 404, reason: "cart_not_found" };
  if (cart.status !== "draft") return { ok: false, status: 409, reason: `cart_${cart.status}` };
  if (cart.yes_at) return { ok: false, status: 409, reason: "yes_given" };
  return cart;
}
const failed = (v: CartRow | Fail): v is Fail => (v as Fail).ok === false;

// --- Lines: add / remove / restore -------------------------------------------------------------------------------------
/** A line named by its key, ingredient id or item name (any case), or {ingredient_id} / {item}. */
export type LineRef = string | { ingredient_id?: string; item?: string };
export interface AddItem { ingredient_id?: string; item?: string; qty?: string | number | null }
export interface ItemsBody { cart_id?: string; add?: AddItem[]; remove?: LineRef[]; restore?: LineRef[] }
export interface ItemsResult { ok: true; cart_id: string; added: string[]; removed: string[]; restored: string[]; unknown: string[] }

export function itemsProblem(b: unknown): string | null {
  const x = b as ItemsBody | null;
  if (!x || typeof x !== "object") return "body must be a JSON object";
  for (const k of ["add", "remove", "restore"] as const) if (x[k] != null && !Array.isArray(x[k])) return `${k} must be a list`;
  if (!(x.add?.length || x.remove?.length || x.restore?.length)) return "nothing to change: give add, remove or restore";
  if (x.add?.some((a) => !a || typeof a !== "object" || !(typeof a.ingredient_id === "string" || (typeof a.item === "string" && a.item.trim())))) return "each add needs ingredient_id or item";
  return null;
}

const refText = (ref: LineRef) => (typeof ref === "string" ? ref : ref.ingredient_id ?? ref.item ?? "");
function matches(ref: LineRef, r: { ingredient_id: string | null; item: string }): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  if (typeof ref !== "string") return (!!ref.ingredient_id && ref.ingredient_id === r.ingredient_id) || (!!ref.item && norm(ref.item) === norm(r.item));
  return ref === lineKeyOf(r) || ref === r.ingredient_id || norm(ref) === norm(r.item);
}

/** Applies the family's edits to a draft: remove = that line is skipped for this draft only (its rows stay skipped
 *  while their meals are unchanged); restore = back on; add = a free-text or catalog item on this draft (an item that
 *  was removed is restored instead). Every change is a logged choice. */
export function editDraftItems(db: Db, cartId: string, body: ItemsBody, now: Date, by: string | null, emit?: Emit): ItemsResult | Fail {
  const cart = editableDraft(db, cartId);
  if (failed(cart)) return cart;
  const result: ItemsResult = { ok: true, cart_id: cartId, added: [], removed: [], restored: [], unknown: [] };
  const setStatus = (rows: { id: string }[], status: string) => {
    db.update(groceries).set({ status, updated_by: "app" }).where(inArray(groceries.id, rows.map((r) => r.id))).run();
    for (const r of rows) emit?.("groceries", r.id, "update");
  };
  const log = (kind: "item_dropped" | "item_added" | "item_restored", r: { ingredient_id: string | null; item: string }, extra?: object) =>
    logChoice(db, { kind, subject: r.ingredient_id ?? r.item, source: "owner", at: now, detail: { cart_id: cartId, item: r.item, ...extra } });
  const restore = (ref: LineRef): boolean => {
    const rows = rowsOfCart(db, cartId, ["skipped"]).filter((r) => matches(ref, r));
    if (!rows.length) return false;
    setStatus(rows, "pending");
    result.restored.push(rows[0].item);
    log("item_restored", rows[0]);
    return true;
  };

  for (const ref of body.remove ?? []) {
    const rows = rowsOfCart(db, cartId, ["pending", "confirmed"]).filter((r) => matches(ref, r));
    if (!rows.length) { result.unknown.push(refText(ref)); continue; }
    setStatus(rows, "skipped");
    result.removed.push(rows[0].item);
    log("item_dropped", rows[0]);
  }
  for (const ref of body.restore ?? []) if (!restore(ref)) result.unknown.push(refText(ref));
  for (const a of body.add ?? []) {
    const ref: LineRef = a.ingredient_id ? { ingredient_id: a.ingredient_id } : { item: a.item! };
    if (restore(ref)) continue;
    if (rowsOfCart(db, cartId, ["pending", "confirmed"]).some((r) => matches(ref, r))) continue;   // already on the draft
    const added = addRow(db, cart, a, by, emit);
    if (!added) { result.unknown.push(refText(ref)); continue; }
    result.added.push(added.item);
    log("item_added", added, { qty: a.qty ?? null });
  }
  return result;
}

/** A manual row on this draft. No due date: it stays on the draft it was added to (recalcTimeline). An item name that
 *  is a catalog ingredient (or one of its aliases) is linked to it; an unknown ingredient_id is refused. */
function addRow(db: Db, cart: CartRow, a: AddItem, by: string | null, emit?: Emit) {
  const catalog = loadIngredients(db);
  const keyOf = stapleKeyResolver(db);
  const resolved = a.ingredient_id ?? keyOf(a.item!);
  const ing = catalog.get(resolved);
  if (a.ingredient_id && !ing) return null;
  const row = db.insert(groceries).values({
    item: ing?.name ?? a.item!.trim(), ingredient_id: ing?.id ?? null, category: ing?.category ?? null, qty: a.qty == null ? null : String(a.qty),
    source: "manual", status: "pending", added_by: by, cart_id: cart.id, buy_at: cart.buy_at, needed_by: null, aisle: "Other", updated_by: "app",
  }).returning().get() as { id: string; item: string; ingredient_id: string | null };
  emit?.("groceries", row.id, "insert");
  return row;
}

// --- Window -----------------------------------------------------------------------------------------------------------
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** Moves a draft's window ("not Saturday, Sunday"): the timeline keeps it there from now on. `late` = the meals it
 *  covers that an order at the new time can no longer reach in time (cook time − delivery lead). */
export function moveWindow(db: Db, settings: SettingsReader, cartId: string, orderAt: unknown, now: Date, emit?: Emit): { ok: true; late: CoveredMeal[] } | Fail {
  if (typeof orderAt !== "string" || !STAMP_RE.test(orderAt)) return { ok: false, status: 400, reason: "order_at must be a local YYYY-MM-DDTHH:MM" };
  if (orderAt < stamp(now)) return { ok: false, status: 400, reason: "order_at is in the past" };
  const cart = editableDraft(db, cartId);
  if (failed(cart)) return cart;
  db.update(carts).set({ buy_at: orderAt, order_at: orderAt, moved_at: now.toISOString(), updated_by: "app" }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
  const rows = db.select({ id: groceries.id }).from(groceries).where(eq(groceries.cart_id, cartId)).all() as { id: string }[];
  if (rows.length) {
    db.update(groceries).set({ buy_at: orderAt, updated_by: "app" }).where(eq(groceries.cart_id, cartId)).run();
    for (const r of rows) emit?.("groceries", r.id, "update");
  }
  const lead = timelineSettingsFrom(settings).deliveryLeadMin;
  const late = getSlot(db, settings, cartId)!.covers.filter((m) => addMinutes(`${m.date}T${m.time}`, -lead) < orderAt);
  return { ok: true, late };
}

// --- Quotes and the yes -----------------------------------------------------------------------------------------------
/** Stores one service's quote for the draft's current lines (replacing that service's earlier one) and re-picks the
 *  best; the draft's chosen_service / grand_total follow the best quote until the order says otherwise. */
export function saveQuote(db: Db, settings: SettingsReader, cartId: string, q: QuoteInput, now: Date, emit?: Emit): { ok: true; quotes: Quote[]; best: BestQuote } | Fail {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return { ok: false, status: 404, reason: "cart_not_found" };
  if (cart.status !== "draft") return { ok: false, status: 409, reason: `cart_${cart.status}` };
  const slot = getSlot(db, settings, cartId)!;
  const key = linesKey(slot.lines);
  const quote: Quote = { service: q.service.trim(), total: q.total, fees: q.fees ?? null, lines: q.lines ?? null, screenshot_url: q.screenshot_url ?? null,
    delivery: q.delivery ?? null, at: now.toISOString(), lines_key: key };
  const quotes = upsertQuote(parseQuotes(cart.quotes), quote);
  const best = bestQuote(quotes.filter((x) => x.lines_key === key), serviceRule(db))!;
  db.update(carts).set({ quotes: JSON.stringify(quotes), chosen_service: best.service, grand_total: best.total, updated_by: "app" }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
  return { ok: true, quotes, best };
}

/** A family member's explicit yes (in chat, or "Order with …" in the app): the draft freezes for the order and is not
 *  let go while the agent places it. Never inferred. */
export function recordYes(db: Db, cartId: string, service: string | null, by: string | null, now: Date, emit?: Emit): { ok: true; service: string | null } | Fail {
  const cart = db.select().from(carts).where(eq(carts.id, cartId)).get() as CartRow | undefined;
  if (!cart) return { ok: false, status: 404, reason: "cart_not_found" };
  if (cart.status !== "draft") return { ok: false, status: 409, reason: `cart_${cart.status}` };
  const chosen = service?.trim() || cart.chosen_service;
  db.update(carts).set({ yes_at: now.toISOString(), confirmed_by: by, chosen_service: chosen, updated_by: "app" }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
  return { ok: true, service: chosen };
}

/** Takes back a yes that never reached the agent. */
export function clearYes(db: Db, cartId: string, emit?: Emit): void {
  db.update(carts).set({ yes_at: null, confirmed_by: null, updated_by: "app" }).where(eq(carts.id, cartId)).run();
  emit?.("carts", cartId, "update");
}

