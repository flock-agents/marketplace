// Plain shopping helpers (docs/V3-FLOW-SPEC.md): meal times, readiness, order status words, spans, quotes, rough ranges
// and cart snapshots. No fetching, no React — the Week and Shopping pages and the chat card read these; shopping.test.ts tests them.
import { addDays, serviceLabel, timeOfDay, weekday, type Cart, type Grocery, type Meal } from "./shared";

/** The v2 columns (additive, all nullable) on top of the v1 row types. */
export type MealV2 = Meal & { time?: string | null };
export type GroceryV2 = Grocery & { ingredient_id?: string | null; meal_id?: string | null; qty_min?: number | null; qty_max?: number | null; qty_unit?: string | null };
export type CartV2 = Cart & { snapshot?: string | null; order_at?: string | null; yes_at?: string | null };

const SLOT_DEFAULT_TIME: Record<string, string> = { Breakfast: "07:30", Lunch: "13:00", Dinner: "19:00" };

/** "HH:MM" the meal is eaten: its own time, else its slot's default. */
export const mealTime = (m: { slot: string; time?: string | null }): string => m.time || SLOT_DEFAULT_TIME[m.slot] || "12:00";
/** "7:30 PM" */
export const mealTimeLabel = (m: { date: string; slot: string; time?: string | null }): string => timeOfDay(`${m.date}T${mealTime(m)}`);
/** "Tue dinner" style label for what an order covers. */
export const mealShort = (m: { date: string; slot: string }, weekday: (d: string) => string): string => `${weekday(m.date)} ${m.slot.toLowerCase()}`;

/** "200–250 g", "2 pc", or the v1 free-text qty when the row has no range. */
export function rangeText(r: Pick<GroceryV2, "qty_min" | "qty_max" | "qty_unit" | "qty">): string | null {
  const unit = r.qty_unit ? ` ${r.qty_unit}` : "";
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  if (r.qty_min != null && r.qty_max != null && r.qty_max > r.qty_min) return `${fmt(r.qty_min)}–${fmt(r.qty_max)}${unit}`;
  const one = r.qty_min ?? r.qty_max;
  if (one != null) return `${fmt(one)}${unit}`;
  return r.qty ?? null;
}

// --- Readiness -------------------------------------------------------------------------------------------------
export type Readiness = "ready" | "ordering" | "missing" | "none";
const ACTIVE_CART = new Set(["draft", "ordered"]);

/** A meal's readiness from its own grocery rows: every need bought or in stock → ready; the rest on an active order →
 *  ordering; anything still open with no order behind it → missing. A meal with no rows reads "none" (nothing to show). */
export function readinessOf(rows: GroceryV2[], carts: Map<string, Cart>, today: string): Readiness {
  if (!rows.length) return "none";
  let ordering = false;
  for (const r of rows) {
    const status = r.status ?? "pending";
    if (status === "ordered" || status === "skipped" || (r.in_stock_until && r.in_stock_until >= today)) continue;
    const cart = r.cart_id ? carts.get(r.cart_id) : undefined;
    if (cart && ACTIVE_CART.has(cart.status)) { ordering = true; continue; }
    return "missing";
  }
  return ordering ? "ordering" : "ready";
}
const MAX_NAMES = 2;
const isOpen = (r: GroceryV2, today: string) => {
  const status = r.status ?? "pending";
  return status !== "ordered" && status !== "skipped" && !(r.in_stock_until && r.in_stock_until >= today);
};
const names = (rows: GroceryV2[]) => {
  const all = [...new Set(rows.map((r) => r.item))];
  return all.length > MAX_NAMES ? `${all.slice(0, MAX_NAMES).join(", ")} +${all.length - MAX_NAMES}` : all.join(", ");
};

/** What a meal's chip says, or null when there is nothing to tell (everything bought or at home, or nothing to buy):
 *  missing → which items still need buying; ordering → which upcoming list they are on (nothing is ordered yet).
 *  `ids`: those grocery rows, for the link to them on Groceries. */
export function readinessText(status: Readiness, rows: GroceryV2[], carts: Map<string, Cart>, today: string): { text: string; tone: "info" | "warning"; ids: string[] } | null {
  const open = rows.filter((r) => isOpen(r, today));
  if (status === "missing") {
    const uncovered = open.filter((r) => !(r.cart_id && ACTIVE_CART.has(carts.get(r.cart_id)?.status ?? "")));
    const shown = uncovered.length ? uncovered : open;
    return shown.length ? { text: `Need ${names(shown)}`, tone: "warning", ids: shown.map((r) => r.id) } : null;
  }
  if (status !== "ordering") return null;
  const when = open.map((r) => (r.cart_id ? carts.get(r.cart_id) : undefined)).filter((c): c is Cart => !!c)
    .map((c) => (c as Cart & { order_at?: string | null }).order_at ?? c.buy_at).sort()[0];
  return { text: when ? `On ${whenShort(when, today)} list` : "On the shopping list", tone: "info", ids: open.map((r) => r.id) };
}

/** One chip for several dishes in a slot: the worst of their statuses (missing > ordering > ready); "none" if none has any. */
export function combineReadiness(values: Readiness[]): Readiness {
  for (const r of ["missing", "ordering", "ready"] as const) if (values.includes(r)) return r;
  return "none";
}

/** Grocery rows by the meal they are for. */
export function rowsByMeal(rows: GroceryV2[]): Map<string, GroceryV2[]> {
  const by = new Map<string, GroceryV2[]>();
  for (const r of rows) if (r.meal_id) by.set(r.meal_id, [...(by.get(r.meal_id) ?? []), r]);
  return by;
}

// --- Order status ----------------------------------------------------------------------------------------------
export interface OrderStatus { text: string; tone: "neutral" | "info" | "success" | "warning" | "muted"; done: boolean }

const at = (dt: string) => (dt.length > 10 ? dt.slice(0, 16) : `${dt}T00:00`);
/** "today 5:30 PM", "tomorrow 7 AM" or "Sat 5:30 PM", from a local "YYYY-MM-DDTHH:MM". */
export function whenShort(dt: string, today: string): string {
  const d = dt.slice(0, 10);
  const day = d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : d === addDays(today, -1) ? "yesterday" : weekday(d);
  return `${day} ${timeOfDay(at(dt))}`;
}
const rupees = (n: number) => `₹${Math.round(n)}`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The one plain-language line an order shows. A draft: when it orders, or the best service and its total once quoted;
 *  after a yes, that it is being ordered. `nowAt` is the local "YYYY-MM-DDTHH:MM". */
export function orderStatus(cart: CartV2 | null, nowAt: string): OrderStatus {
  const today = nowAt.slice(0, 10);
  if (!cart) return { text: "Not on an order yet", tone: "neutral", done: false };
  const orderAt = cart.order_at ?? cart.buy_at;
  switch (cart.status) {
    case "ordered": {
      const total = cart.grand_total ?? parseSnapshot(cart.snapshot)?.total;
      const eta = cart.delivery_eta ? ` · arriving ${cart.delivery_eta}` : "";
      return { text: `Ordered on ${serviceLabel(cart.chosen_service ?? null)}${total != null ? ` · ${rupees(total)}` : ""}${eta}`, tone: "success", done: true };
    }
    case "let_go": return { text: "Let go", tone: "muted", done: true };
    default: {
      if (cart.yes_at) return { text: `Ordering on ${serviceLabel(cart.chosen_service ?? null)}…`, tone: "info", done: false };
      const best = bestOf(cart);
      const price = best ? `${serviceLabel(best.service)} ${rupees(best.total)} · ` : "";
      // Before the order time the heading already says when; the line only adds the best price once there is one.
      return at(orderAt) > nowAt
        ? { text: best ? `Best: ${serviceLabel(best.service)} ${rupees(best.total)}` : "", tone: "neutral", done: false }
        : { text: `${price}Waiting for a yes`, tone: "info", done: false };
    }
  }
}

/** "Order today 5:30 PM · Thu breakfast → Sat dinner": when, and the meals it spans (`covers` earliest first). */
export function slotTitle(cart: (Cart & { order_at?: string | null }) | null, covers: string[], today: string): string {
  const head = cart ? `Order ${whenShort(cart.order_at ?? cart.buy_at, today)}` : "Not scheduled yet";
  return covers.length ? `${head} · ${spanLabel(covers)}` : head;
}
export const spanLabel = (covers: string[]): string => (covers.length > 1 ? `${covers[0]} → ${covers[covers.length - 1]}` : covers[0] ?? "");

// --- Quotes (server/quotes.ts) ----------------------------------------------------------------------------------
type QuoteLine = Omit<SnapshotLine, "qty"> & { qty?: number | null };
export interface Quote { service: string; total: number; fees?: number | Record<string, number> | null; lines?: QuoteLine[] | null; screenshot_url?: string | null }

export function parseQuotes(raw: string | null | undefined): Quote[] {
  let v: unknown = [];
  try { v = JSON.parse(raw ?? "[]"); } catch { return []; }
  return Array.isArray(v) ? v.filter((q): q is Quote => !!q && typeof q.service === "string" && typeof q.total === "number") : [];
}

/** The quote the app picked (the draft's chosen_service), or null before any quote is in. */
export function bestOf(cart: CartV2): Quote | null {
  const quotes = parseQuotes(cart.quotes);
  return quotes.find((q) => q.service === cart.chosen_service) ?? null;
}

/** The other services' totals, cheapest first: "BigBasket ₹240 · Blinkit ₹255". */
export const otherQuotes = (cart: CartV2): string =>
  parseQuotes(cart.quotes).filter((q) => q.service !== cart.chosen_service).sort((a, b) => a.total - b.total)
    .map((q) => `${serviceLabel(q.service)} ${rupees(q.total)}`).join(" · ");

/** A quote drawn as a cart snapshot (its lines, fees, total and screenshot). */
export const quoteSnapshot = (q: Quote): CartSnapshot =>
  ({ service: q.service, lines: (q.lines ?? []).map((l) => ({ ...l, qty: num(l.qty) ?? 1, price: num(l.price) })), fees: q.fees ?? null, total: q.total, screenshot_url: q.screenshot_url ?? null });

// --- Usual ordering times (server/orderPatterns.ts) -------------------------------------------------------------
export interface OrderWindow { days: number[]; from: string; to: string; source: "learned" | "pinned"; confidence: number; sample_count: number }
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every day 6 PM" or "Mon, Wed 10 AM", plus how sure the app is ("seen 5 times") for a learned one. */
export function windowLabel(w: OrderWindow): string {
  const days = w.days.length === 7 ? "Every day" : [...w.days].sort().map((d) => DAY_SHORT[d]).join(", ");
  const when = `${days} ${timeOfDay(`2000-01-01T${w.from}`)}`;
  return w.source === "pinned" ? `${when} · pinned` : `${when} · seen ${w.sample_count} times`;
}

/** The pinned list after pinning (a learned window becomes pinned) or unpinning one window. */
export function togglePin(all: OrderWindow[], w: OrderWindow): OrderWindow[] {
  const pinned = all.filter((x) => x.source === "pinned");
  const same = (x: OrderWindow) => x.from === w.from && x.to === w.to && x.days.join() === w.days.join();
  return w.source === "pinned" ? pinned.filter((x) => !same(x)) : [...pinned, { ...w, source: "pinned" }];
}

// --- Cart snapshot ---------------------------------------------------------------------------------------------
export interface SnapshotLine { name: string; pack?: string | null; qty: number; price?: number | null; matched_ingredient_id?: string | null; substituted?: boolean | string | null }
export interface CartSnapshot { cart_id?: string; service?: string | null; lines: SnapshotLine[]; fees?: number | Record<string, number> | null; total?: number | null; screenshot_url?: string | null }

/** A snapshot from its JSON text (a cart's `snapshot` column or a chat block), or null when it is not one. */
export function parseSnapshot(raw: unknown): CartSnapshot | null {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  if (!v || typeof v !== "object" || !Array.isArray((v as CartSnapshot).lines)) return null;
  const s = v as CartSnapshot;
  const lines = s.lines.filter((l): l is SnapshotLine => !!l && typeof l.name === "string")
    .map((l) => ({ ...l, qty: num(l.qty) ?? 1, price: num(l.price) }));
  return { ...s, lines, total: num(s.total) };
}

/** The fees as one number (a map of named fees sums). */
export const feesTotal = (fees: CartSnapshot["fees"]): number =>
  typeof fees === "number" ? fees : fees ? Object.values(fees).reduce((a, b) => a + (num(b) ?? 0), 0) : 0;
