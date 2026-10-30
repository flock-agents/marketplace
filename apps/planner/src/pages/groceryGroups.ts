// Plain grouping, sorting and filtering functions for the Groceries page: no fetching, no React.
import type { Cart, Grocery } from "./shared";

export interface TimelineGroup { key: string; cart: Cart | null; rows: Grocery[] }

/** Open rows grouped by the cart (order) they are on, ordered by the cart's buy_at; rows with no cart yet (the
 *  recalc hasn't run since they were added) come last under "Not yet scheduled". */
export function groupByTimeline(rows: Grocery[], carts: Cart[]): TimelineGroup[] {
  const cartsById = new Map(carts.map((c) => [c.id, c]));
  const byCart = new Map<string, Grocery[]>();
  const unscheduled: Grocery[] = [];
  for (const r of rows) {
    if (r.cart_id && cartsById.has(r.cart_id)) { const arr = byCart.get(r.cart_id) ?? []; arr.push(r); byCart.set(r.cart_id, arr); }
    else unscheduled.push(r);
  }
  const groups: TimelineGroup[] = [...byCart.entries()]
    .map(([id, rs]) => ({ key: id, cart: cartsById.get(id)!, rows: rs }))
    .sort((a, b) => (a.cart!.buy_at < b.cart!.buy_at ? -1 : a.cart!.buy_at > b.cart!.buy_at ? 1 : 0));
  if (unscheduled.length) groups.push({ key: "unscheduled", cart: null, rows: unscheduled });
  return groups;
}

/** Needed-by date ascending (earliest first), then item name; an item with no needed-by date sorts last. Used
 *  wherever a leaf list of items is shown, so the order is never arbitrary. */
export function sortItems(rows: Grocery[]): Grocery[] {
  return [...rows].sort((a, b) => {
    const an = a.needed_by, bn = b.needed_by;
    if (an !== bn) { if (!an) return 1; if (!bn) return -1; return an < bn ? -1 : 1; }
    return a.item.localeCompare(b.item);
  });
}

/** One shopping slot: the order (cart) it becomes, its rows, and the meals it covers ("Tue dinner"), earliest first. */
export interface SlotGroup extends TimelineGroup { covers: string[] }

type MealRef = { id: string; date: string; slot: string };
const SLOT_ORDER = ["Breakfast", "Lunch", "Dinner"];

/** Rows grouped by the order they are on (groupByTimeline), each with the meals its rows are for. */
export function groupBySlot<R extends Grocery & { meal_id?: string | null }>(rows: R[], carts: Cart[], meals: MealRef[], label: (m: MealRef) => string): (SlotGroup & { rows: R[] })[] {
  const mealsById = new Map(meals.map((m) => [m.id, m]));
  const rank = (m: MealRef) => `${m.date}|${SLOT_ORDER.indexOf(m.slot)}`;
  return groupByTimeline(rows, carts).map((g) => {
    const covered = new Map<string, MealRef>();
    for (const r of g.rows as R[]) {
      const m = r.meal_id ? mealsById.get(r.meal_id) : undefined;
      if (m) covered.set(`${m.date}|${m.slot}`, m);
    }
    const covers = [...covered.values()].sort((a, b) => (rank(a) < rank(b) ? -1 : 1)).map(label);
    return { ...g, rows: sortItems(g.rows) as R[], covers };
  });
}

/** A rough range to buy, in one unit (a server cart line's, already rounded to whole packs). */
export interface Range { qty_min: number | null; qty_max: number | null; qty_unit: string | null }

/** One ingredient in one order: every per-meal row for it, shown as a single line. `row` is the first row with
 *  the line's range on it (the server's pack-rounded line when known, else the rows' summed need). */
export interface ItemLine<R> { key: string; row: R; rows: R[]; ids: string[]; mealIds: string[] }

type MergeRow = Grocery & { ingredient_id?: string | null; meal_id?: string | null } & Partial<Range>;

/** A draft line's key, the same as the server's (server/draft.ts): the ingredient, else the item name. */
export const draftKeyOf = (r: Pick<MergeRow, "ingredient_id" | "item">): string => r.ingredient_id ?? `item:${r.item.trim().toLowerCase()}`;

/** The merged line a row belongs to: one per ingredient (else item name) and status. */
export const lineKeyOf = (r: MergeRow): string => `${draftKeyOf(r)}|${r.status ?? "pending"}`;

/** Merges a group's rows per ingredient (else per item name), keeping the group's order; `rangeFor` gives the
 *  server's cart line range for a row id when the row is on one. */
export function mergeItems<R extends MergeRow>(rows: R[], rangeFor: (rowId: string) => Range | undefined): ItemLine<R>[] {
  const lines = new Map<string, ItemLine<R>>();
  for (const r of rows) {
    const key = lineKeyOf(r);
    const line = lines.get(key) ?? { key, row: r, rows: [], ids: [], mealIds: [] };
    line.rows.push(r);
    line.ids.push(r.id);
    if (r.meal_id && !line.mealIds.includes(r.meal_id)) line.mealIds.push(r.meal_id);
    lines.set(key, line);
  }
  return [...lines.values()].map((line) => {
    if (line.rows.length === 1 && !rangeFor(line.row.id)) return line;
    return { ...line, row: { ...line.row, ...(rangeFor(line.row.id) ?? summedRange(line.rows)) } };
  });
}

function summedRange(rows: MergeRow[]): Range {
  const unit = rows.find((r) => r.qty_unit)?.qty_unit ?? null;
  const same = rows.filter((r) => r.qty_unit === unit && r.qty_min != null);
  if (!unit || !same.length) return { qty_min: null, qty_max: null, qty_unit: null };
  const min = same.reduce((sum, r) => sum + (r.qty_min ?? 0), 0);
  return { qty_min: min, qty_max: Math.max(min, ...same.map((r) => r.qty_max ?? 0)), qty_unit: unit };
}

export type GroceryFilter = "need" | "not_in_cart" | "in_cart" | "all";

/** The page's one filter: a status, or a category ("cat:dairy", open items of that category only). */
export type ShowFilter = GroceryFilter | `cat:${string}`;
export function applyShow<R extends Grocery>(rows: R[], show: ShowFilter, today: string): R[] {
  if (!show.startsWith("cat:")) return filterGroceries(rows, show as GroceryFilter, today);
  const category = show.slice(4);
  return filterGroceries(rows, "need", today).filter((r) => r.category === category);
}

/** The Groceries page's status filter. "all" is the only one that ever shows an ordered, skipped or in-stock-snoozed
 *  item — the other three are each a non-overlapping slice of what's still open. */
export function filterGroceries<R extends Grocery>(rows: R[], filter: GroceryFilter, today: string): R[] {
  if (filter === "all") return rows;
  const snoozed = (r: R) => !!r.in_stock_until && r.in_stock_until > today;
  const open = rows.filter((r) => !snoozed(r));
  const status = (r: R) => r.status ?? "pending";
  switch (filter) {
    case "not_in_cart": return open.filter((r) => status(r) === "pending");
    case "in_cart": return open.filter((r) => status(r) === "confirmed");
    default: return open.filter((r) => status(r) === "pending" || status(r) === "confirmed");
  }
}
