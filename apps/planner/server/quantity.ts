// The v2 quantity engine (docs/V2-SPEC.md "Quantity engine"). Pure functions, no DB: server/mealGroceries.ts feeds
// them rows and writes back what they return.
//
// Every run RECOMPUTES the whole need from scratch (meals × recipe_ingredients × portions, in a base unit) and
// reconciles it against the existing grocery rows by (meal_id, ingredient_id) — nothing is ever added onto a
// previous run's number, so re-running is idempotent and a moved/deleted meal moves/removes its own open rows.
import { baseKindOf, convertTo, round1, toBase, type Amount, type BaseUnit, type UnitConversions } from "./units";
import type { MealAdjustment, MealRecipe } from "./mealRecipes";

export interface ShoppingPrefs {
  pack_min?: number; pack_max?: number; pack_unit?: string; stock_days?: number;
  price?: "cheapest" | "balanced" | "premium"; brands_preferred?: string[]; brands_avoid?: string[];
  substitutions?: "allowed" | "ask" | "never"; service?: string; never_auto_add?: boolean;
}

/** Long-shelf-life categories assumed already at home: never auto-added from a recipe (the pantry check-in is
 *  their only door). Superset of constants.ts's HELD_BACK_CATEGORIES with the v2 category names. */
export const HELD_BACK = new Set(["pantry", "spices", "grains", "pulses", "oils", "snacks"]);

export interface MealInput { id: string; date: string; slot: string; dish: string; recipes: MealRecipe[]; adjustments?: MealAdjustment[] }
export interface RecipeLineInput {
  recipe_id: string; ingredient_id: string | null; item: string; qty: number | null; qty_per_adult?: number | null;
  unit: string | null; category: string | null; optional?: number | boolean | null;
}
export interface IngredientInput {
  id: string; name: string; category: string | null; default_unit: string | null;
  conversions: UnitConversions; prefs: ShoppingPrefs;
}

export interface DesiredRow {
  meal_id: string; ingredient_id: string; item: string; category: string; needed_by: string; slot: string; dish: string;
  qty_min: number | null; qty_max: number | null; qty_unit: BaseUnit | null;
}

export const parseJson = <T,>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return (JSON.parse(s) ?? fallback) as T; } catch { return fallback; }
};

/** An ingredient's own prefs over its category's defaults. */
export function effectivePrefs(own: ShoppingPrefs, category: string | null, defaults: Record<string, ShoppingPrefs>): ShoppingPrefs {
  return { ...(category ? defaults[category] ?? {} : {}), ...own };
}

/** The upper end of the rough range: `need` rounded up to whole packs of the smallest pack (prefs.pack_min in
 *  pack_unit). Equal to `need` when there's no pack size, or the pack can't be expressed in need's unit. */
export function packRange(need: Amount, prefs: ShoppingPrefs, conv: UnitConversions): number {
  if (!prefs.pack_min || prefs.pack_min <= 0) return round1(need.qty);
  const packRaw = toBase(prefs.pack_min, prefs.pack_unit ?? need.unit, conv, need.unit);
  const pack = convertTo(packRaw, need.unit, conv);
  if (!pack || pack.qty <= 0) return round1(need.qty);
  const packs = Math.max(1, Math.ceil(need.qty / pack.qty - 1e-9));
  return round1(packs * pack.qty);
}

/** One desired row per (meal, ingredient) the plan needs bought, in the ingredient's base unit: every recipe of the
 *  meal × its servings × the family's portion, then the agent's review on top (drop / scale / add). Lines with no
 *  catalog link, optional lines, held-back categories (or prefs.never_auto_add) and uncategorised lines are left
 *  out — the conservative choice: a need is never guessed into the shopping list. A review's "add" is the agent's
 *  explicit call and is kept (as long as the ingredient is in the catalog). */
export function computeMealNeeds(
  meals: MealInput[], lines: RecipeLineInput[], ingredientsById: Map<string, IngredientInput>,
  multiplierFor: (slot: string) => number, categoryDefaults: Record<string, ShoppingPrefs>,
): DesiredRow[] {
  const byRecipe = new Map<string, RecipeLineInput[]>();
  for (const l of lines) { const arr = byRecipe.get(l.recipe_id) ?? []; arr.push(l); byRecipe.set(l.recipe_id, arr); }

  const out = new Map<string, DesiredRow>();
  const rowFor = (m: MealInput, ingredientId: string, item: string, category: string): DesiredRow => out.get(`${m.id}|${ingredientId}`) ?? {
    meal_id: m.id, ingredient_id: ingredientId, item, category, needed_by: m.date, slot: m.slot, dish: m.dish,
    qty_min: null, qty_max: null, qty_unit: null,
  };
  const addAmount = (row: DesiredRow, qty: number, unit: string | null, ing: IngredientInput | undefined) => {
    const conv = ing?.conversions ?? {};
    const amount = toBase(qty, unit, conv, baseKindOf(ing?.default_unit ?? unit, conv));
    const merged = row.qty_unit ? convertTo(amount, row.qty_unit, conv) : amount;
    if (merged) { row.qty_min = round1((row.qty_min ?? 0) + merged.qty); row.qty_unit = merged.unit; }
  };
  for (const m of meals) {
    const family = multiplierFor(m.slot);
    for (const { recipe_id, servings } of m.recipes) {
      for (const l of byRecipe.get(recipe_id) ?? []) {
        if (!l.ingredient_id || l.optional) continue;
        const ing = ingredientsById.get(l.ingredient_id);
        const category = ing?.category ?? l.category;
        if (!category || HELD_BACK.has(category)) continue;
        if (effectivePrefs(ing?.prefs ?? {}, category, categoryDefaults).never_auto_add) continue;
        const row = rowFor(m, l.ingredient_id, ing?.name ?? l.item, category);
        const perAdult = l.qty_per_adult ?? l.qty;
        if (perAdult != null && family > 0) addAmount(row, perAdult * family * servings, l.unit, ing);
        out.set(`${m.id}|${l.ingredient_id}`, row);
      }
    }
    for (const a of m.adjustments ?? []) {
      const key = `${m.id}|${a.ingredient_id}`;
      if (a.action === "drop") { out.delete(key); continue; }
      if (a.action === "scale") {
        const row = out.get(key);
        if (row?.qty_min != null) row.qty_min = round1(row.qty_min * a.factor);
        continue;
      }
      const ing = ingredientsById.get(a.ingredient_id);
      if (!ing?.category) continue;
      const row = rowFor(m, a.ingredient_id, ing.name, ing.category);
      addAmount(row, a.qty, a.unit, ing);
      out.set(key, row);
    }
  }
  for (const row of out.values()) {
    if (row.qty_min == null || !row.qty_unit) continue;
    const ing = ingredientsById.get(row.ingredient_id);
    row.qty_max = packRange({ qty: row.qty_min, unit: row.qty_unit }, effectivePrefs(ing?.prefs ?? {}, row.category, categoryDefaults), ing?.conversions ?? {});
  }
  return [...out.values()];
}

export const formatRange = (min: number | null, max: number | null, unit: string | null): string | null => {
  if (min == null) return null;
  const u = unit ? ` ${unit}` : "";
  return max != null && max > min ? `${min}–${max}${u}` : `${min}${u}`;
};

// --- Reconciliation --------------------------------------------------------------------------------------------------
export interface ExistingMealRow {
  id: string; meal_id: string | null; ingredient_id: string | null; status: string | null; done?: boolean | null;
  cart_id: string | null; needed_by: string | null; qty_min: number | null; qty_max: number | null; qty_unit: string | null;
  item: string; category: string | null; for_dish: string | null;
}
export interface RowValues {
  item: string; category: string; needed_by: string; for_dish: string;
  qty_min: number | null; qty_max: number | null; qty_unit: string | null; suggested_qty: string | null;
}
export interface Reconciliation {
  inserts: (RowValues & { meal_id: string; ingredient_id: string })[];
  updates: { id: string; set: Partial<RowValues> & { status?: string; cart_id?: null; buy_at?: null } }[];
  deletes: string[];
}

const OPEN = new Set(["pending", "confirmed"]);
const BOUGHT = new Set(["ordered", "have_stock"]);
/** A cart that owns its rows' amounts. v3 drafts stay live until the yes (docs/V3-FLOW-SPEC.md), so only an order does. */
const CART_LOCKED = new Set(["ordered"]);

const valuesOf = (d: DesiredRow): RowValues => ({
  item: d.item, category: d.category, needed_by: d.needed_by, for_dish: d.dish,
  qty_min: d.qty_min, qty_max: d.qty_max, qty_unit: d.qty_unit, suggested_qty: formatRange(d.qty_min, d.qty_max, d.qty_unit),
});

function changedFields(row: ExistingMealRow, v: RowValues): Partial<RowValues> {
  const diff: Partial<RowValues> = {};
  for (const k of ["item", "category", "needed_by", "for_dish", "qty_min", "qty_max", "qty_unit"] as const) {
    if ((row[k] ?? null) !== (v[k] ?? null)) (diff as Record<string, unknown>)[k] = v[k];
  }
  if (Object.keys(diff).length) diff.suggested_qty = v.suggested_qty;
  return diff;
}

/** What to write so the source:"meal" rows match `desired` exactly, keyed by (meal_id, ingredient_id):
 *  - bought (ordered / have_stock / done, or in an ordered cart): left alone, and it satisfies its key;
 *  - held by a cart past "upcoming" but not ordered: left alone while its meal still needs it, else deleted;
 *  - open and still needed: updated in place when anything changed (a new date also frees it from its cart);
 *  - skipped: stays skipped while the meal is unchanged, re-opens when the meal's date or amount changed;
 *  - open/skipped and no longer needed (meal moved away or deleted), duplicates, and legacy rows with no meal_id: deleted;
 *  - a legacy (no meal_id) open row held by a not-yet-ordered cart: deleted once the plan needs that ingredient
 *    (its per-meal rows now carry the need, this same run). Ordered carts are never touched. */
export function reconcileMealRows(desired: DesiredRow[], existing: ExistingMealRow[], cartStatus: Map<string, string>): Reconciliation {
  const want = new Map(desired.map((d) => [`${d.meal_id}|${d.ingredient_id}`, d]));
  const result: Reconciliation = { inserts: [], updates: [], deletes: [] };
  const satisfied = new Set<string>();
  const bought = (r: ExistingMealRow) => BOUGHT.has(r.status ?? "") || !!r.done || cartStatus.get(r.cart_id ?? "") === "ordered";
  const held = (r: ExistingMealRow) => !!r.cart_id && CART_LOCKED.has(cartStatus.get(r.cart_id) ?? "");
  const neededIngredients = new Set(desired.map((d) => d.ingredient_id));
  const supersededLegacy = (r: ExistingMealRow) => !r.meal_id && OPEN.has(r.status ?? "pending") && !r.done && !!r.cart_id
    && cartStatus.get(r.cart_id) !== "ordered" && !!r.ingredient_id && neededIngredients.has(r.ingredient_id);

  for (const r of existing) {
    const key = `${r.meal_id}|${r.ingredient_id}`;
    if (supersededLegacy(r)) { result.deletes.push(r.id); continue; }
    if (bought(r)) { if (r.meal_id) satisfied.add(key); continue; }
    // A cart still short of "ordered" keeps its rows' amounts steady, but never a need its meal no longer has.
    if (held(r)) { if (r.meal_id && want.has(key) && !satisfied.has(key)) satisfied.add(key); else result.deletes.push(r.id); continue; }
    const d = r.meal_id ? want.get(key) : undefined;
    if (!d || satisfied.has(key)) { result.deletes.push(r.id); continue; }
    satisfied.add(key);
    const diff = changedFields(r, valuesOf(d));
    if (r.status === "skipped") {
      const mealChanged = "needed_by" in diff || "qty_min" in diff || "qty_unit" in diff;
      if (mealChanged) result.updates.push({ id: r.id, set: { ...diff, status: "pending", cart_id: null, buy_at: null } });
      continue;
    }
    if (!OPEN.has(r.status ?? "pending")) continue;
    if (!Object.keys(diff).length) continue;
    result.updates.push({ id: r.id, set: "needed_by" in diff ? { ...diff, cart_id: null, buy_at: null } : diff });
  }
  for (const [key, d] of want) {
    if (!satisfied.has(key)) result.inserts.push({ ...valuesOf(d), meal_id: d.meal_id, ingredient_id: d.ingredient_id });
  }
  return result;
}

// --- Cart lines ------------------------------------------------------------------------------------------------------
export interface LineSourceRow {
  id: string; ingredient_id: string | null; item: string; meal_id: string | null; for_dish: string | null; needed_by: string | null;
  qty_min: number | null; qty_max: number | null; qty_unit: string | null; qty: string | null; category: string | null;
}
export interface CartLine {
  key: string; ingredient_id: string | null; item: string; category: string | null;
  qty_min: number | null; qty_max: number | null; qty_unit: string | null; qty: string | null;
  row_ids: string[]; meals: { meal_id: string; dish: string | null; needed_by: string | null }[];
}
export interface LineResolver { prefsFor(ingredientId: string, category: string | null): ShoppingPrefs; conversionsFor(ingredientId: string): UnitConversions }

/** One line per ingredient (rows without one: per item name): the summed need across every meal it covers, with
 *  the upper end re-rounded to whole packs on the SUM (two meals' 100 g of onion is one 250 g pack, not two). */
export function mergeCartLines(rows: LineSourceRow[], resolve: LineResolver): CartLine[] {
  const lines = new Map<string, CartLine>();
  for (const r of rows) {
    const key = r.ingredient_id ?? `item:${r.item.trim().toLowerCase()}`;
    const line = lines.get(key) ?? { key, ingredient_id: r.ingredient_id, item: r.item, category: r.category, qty_min: null, qty_max: null, qty_unit: null, qty: null, row_ids: [], meals: [] };
    line.row_ids.push(r.id);
    if (r.meal_id) line.meals.push({ meal_id: r.meal_id, dish: r.for_dish, needed_by: r.needed_by });
    line.qty = line.qty ?? r.qty;
    if (r.qty_min != null && r.qty_unit) {
      const conv = r.ingredient_id ? resolve.conversionsFor(r.ingredient_id) : {};
      const unit = (line.qty_unit ?? r.qty_unit) as BaseUnit;
      const amount = convertTo({ qty: r.qty_min, unit: r.qty_unit as BaseUnit }, unit, conv);
      if (amount) { line.qty_min = round1((line.qty_min ?? 0) + amount.qty); line.qty_unit = unit; }
    }
    lines.set(key, line);
  }
  for (const line of lines.values()) {
    if (line.qty_min == null || !line.qty_unit) continue;
    line.qty_max = line.ingredient_id
      ? packRange({ qty: line.qty_min, unit: line.qty_unit as BaseUnit }, resolve.prefsFor(line.ingredient_id, line.category), resolve.conversionsFor(line.ingredient_id))
      : line.qty_min;
  }
  return [...lines.values()];
}
