// Turns the upcoming meal plan into grocery rows (source "meal", one per (meal_id, ingredient_id)) via the v2
// quantity engine (server/quantity.ts): every call RECOMPUTES the need from scratch and reconciles the existing
// rows, so nothing accumulates across runs and a moved/deleted meal moves/removes its own open rows.
// Only open meals (no outcome yet) need anything; what is already at home covers the earliest of them
// (server/stock.ts). Held-back categories (pantry, spices, grains…) are never auto-added here: they are assumed at
// home and re-checked by the pantry check-in. `qty` is never written: it stays the owner's/the agent's own
// back-compat field; the engine's rough range lives in qty_min / qty_max / qty_unit (+ suggested_qty, as text).
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, diner_portions, diners, groceries, ingredients, meals, recipe_ingredients } from "./db/schema";
import { DEFAULT_CATEGORY_PREFS } from "./db/constants";
import { familyMultiplier } from "../src/pages/portions";
import { computeMealNeeds, parseJson, reconcileMealRows, type DesiredRow, type ExistingMealRow, type IngredientInput, type RecipeLineInput, type ShoppingPrefs } from "./quantity";
import { addDaysStr, todayStr, type ChangeEmitter } from "./timeline";
import { currentAdjustments, recipeSets } from "./mealRecipes";
import { coveredByStock, settingsOf } from "./stock";

export interface IngredientRow {
  id: string; name: string; category: string | null; default_unit: string | null; unit_conversions: string | null; prefs: string | null;
  aliases: string | null; shelf_life_days: number | null; last_ordered_at: string | null; last_ordered_qty: number | null;
  level: string | null; last_checked_at: string | null;
}

export function ingredientInput(r: IngredientRow): IngredientInput {
  return { id: r.id, name: r.name, category: r.category, default_unit: r.default_unit, conversions: parseJson(r.unit_conversions, {}), prefs: parseJson(r.prefs, {}) };
}

export function loadIngredients(db: BunSQLiteDatabase<any>): Map<string, IngredientRow> {
  return new Map((db.select().from(ingredients).all() as IngredientRow[]).map((r) => [r.id, r]));
}

/** A meal row as the needs computation reads it. */
export interface PlanMeal { id: string; date: string; slot: string; time: string | null; dish: string; note: string | null; review: string | null; review_for: string | null }

/** The horizon's open meals (no outcome yet: a cooked or skipped meal needs nothing more), starting today. */
export function openPlanMeals(db: BunSQLiteDatabase<any>, horizonDays: number, now: Date): PlanMeal[] {
  const today = todayStr(now);
  return db.select().from(meals).where(and(isNull(meals.outcome), gte(meals.date, today), lte(meals.date, addDaysStr(today, horizonDays - 1)))).all() as PlanMeal[];
}

/** The rough needs of these meals: recipes × portions, with the agent's review on top (computeMealNeeds). */
export function needsForMeals(db: BunSQLiteDatabase<any>, rows: PlanMeal[], categoryDefaults: Record<string, ShoppingPrefs>, catalog = loadIngredients(db)): DesiredRow[] {
  const sets = recipeSets(db, rows.map((m) => m.id));
  const mealRows = rows.map((m) => {
    const recipes = sets.get(m.id) ?? [];
    return { id: m.id, date: m.date, slot: m.slot, dish: m.dish, recipes, adjustments: currentAdjustments(m, recipes) };
  });
  const recipeIds = [...new Set(mealRows.flatMap((m) => m.recipes.map((r) => r.recipe_id)))];
  if (!recipeIds.length && !mealRows.some((m) => m.adjustments.length)) return [];
  const lines = db.select().from(recipe_ingredients).where(inArray(recipe_ingredients.recipe_id, recipeIds)).all() as RecipeLineInput[];
  const dinerIds = (db.select({ id: diners.id }).from(diners).all() as { id: string }[]).map((d) => d.id);
  const portions = db.select().from(diner_portions).all() as { diner_id: string; slot: string; multiplier: number }[];
  const inputs = new Map([...catalog.values()].map((r) => [r.id, ingredientInput(r)]));
  return computeMealNeeds(mealRows, lines, inputs, (slot) => familyMultiplier(dinerIds, slot, portions), categoryDefaults);
}

/** Recomputes and reconciles every source:"meal" grocery row against the open meals of the plan, less the needs
 *  stock already covers (server/quantity.ts's reconcileMealRows). Idempotent. Never touches manual/staple rows,
 *  bought rows, or rows a cart past "upcoming" holds. */
export function ensureMealGroceries(db: BunSQLiteDatabase<any>, horizonDays: number, now = new Date(), emit?: ChangeEmitter, categoryDefaults: Record<string, ShoppingPrefs> = DEFAULT_CATEGORY_PREFS as Record<string, ShoppingPrefs>): void {
  const catalog = loadIngredients(db);
  const plan = openPlanMeals(db, horizonDays, now);
  const all = needsForMeals(db, plan, categoryDefaults, catalog);
  const covered = coveredByStock(db, all, plan, { now, settings: settingsOf(db), catalog, defaults: categoryDefaults });
  const desired = all.filter((d) => !covered.has(`${d.meal_id}|${d.ingredient_id}`));

  const today = todayStr(now);
  // Only rows inside the recomputed window are reconciled: a past meal's row is history, not a need.
  const existing = (db.select().from(groceries).where(eq(groceries.source, "meal")).all() as (ExistingMealRow & { needed_by: string | null })[])
    .filter((r) => !r.needed_by || r.needed_by >= today);
  const cartStatus = new Map((db.select({ id: carts.id, status: carts.status }).from(carts).all() as { id: string; status: string }[]).map((c) => [c.id, c.status]));
  const changes = reconcileMealRows(desired, existing, cartStatus);

  for (const id of changes.deletes) { db.delete(groceries).where(eq(groceries.id, id)).run(); emit?.("groceries", id, "delete"); }
  for (const u of changes.updates) { db.update(groceries).set({ ...u.set, updated_by: "app" }).where(eq(groceries.id, u.id)).run(); emit?.("groceries", u.id, "update"); }
  for (const v of changes.inserts) {
    const row = db.insert(groceries).values({ ...v, aisle: "Other", qty: null, source: "meal", status: "pending", updated_by: "app" }).returning().get() as { id: string };
    emit?.("groceries", row.id, "insert");
  }
}

/** A recipe_ingredients row with no ingredient_id yet — the agent needs to match or create a catalog entry for
 *  it before the meal plan can generate anything from this line. */
export function recipeIngredientsMissingCatalogLink(db: BunSQLiteDatabase<any>): { recipe_id: string; item: string }[] {
  return db.select({ recipe_id: recipe_ingredients.recipe_id, item: recipe_ingredients.item })
    .from(recipe_ingredients).where(isNull(recipe_ingredients.ingredient_id)).all() as { recipe_id: string; item: string }[];
}

export interface GroceryAwaitingQty { id: string; item: string; suggested_qty: string | null; for_dish: string | null; needed_by: string | null }

/** Every open meal-driven row still waiting on the agent to review its suggested_qty and set a real qty — the
 *  nightly wake's batch, rather than asking about each one as it's created. */
export function mealGroceriesAwaitingQty(db: BunSQLiteDatabase<any>): GroceryAwaitingQty[] {
  return db.select({ id: groceries.id, item: groceries.item, suggested_qty: groceries.suggested_qty, for_dish: groceries.for_dish, needed_by: groceries.needed_by })
    .from(groceries).where(and(eq(groceries.source, "meal"), isNull(groceries.qty), inArray(groceries.status, ["pending", "confirmed"]))).all() as GroceryAwaitingQty[];
}
