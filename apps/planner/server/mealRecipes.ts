// A meal is a SET of recipes plus an optional note (docs/V3-FLOW-SPEC.md "A meal = a set of recipes + an optional
// note"). The recipes give the rough shopping need (server/quantity.ts); the agent reviews it against the note and
// the dish in a background job (server/mealReview.ts), and the adjustments it returns are stored on the meal, valid
// only while the meal's dish, note and recipes are what they were reviewed for.
import { asc, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { meal_recipes, meals } from "./db/schema";
import { parseJson } from "./quantity";

type Db = BunSQLiteDatabase<any>;
export type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;

export interface MealRecipe { recipe_id: string; servings: number }

/** The agent's review of one ingredient of one meal: leave it out, scale it, or add one the recipes don't list. */
export type MealAdjustment =
  | { ingredient_id: string; action: "drop"; reason: string }
  | { ingredient_id: string; action: "scale"; factor: number; reason: string }
  | { ingredient_id: string; action: "add"; qty: number; unit: string; reason: string };

/** Each meal's recipes, in order. A meal with no meal_recipes rows yet falls back to its recipe_id. */
export function recipeSets(db: Db, mealIds: string[]): Map<string, MealRecipe[]> {
  const out = new Map<string, MealRecipe[]>();
  if (!mealIds.length) return out;
  const rows = db.select().from(meal_recipes).where(inArray(meal_recipes.meal_id, mealIds)).orderBy(asc(meal_recipes.position)).all() as
    { meal_id: string; recipe_id: string; servings: number }[];
  for (const r of rows) {
    const arr = out.get(r.meal_id) ?? [];
    arr.push({ recipe_id: r.recipe_id, servings: r.servings ?? 1 });
    out.set(r.meal_id, arr);
  }
  const legacy = db.select({ id: meals.id, recipe_id: meals.recipe_id }).from(meals).where(inArray(meals.id, mealIds)).all() as { id: string; recipe_id: string | null }[];
  for (const m of legacy) if (!out.has(m.id) && m.recipe_id) out.set(m.id, [{ recipe_id: m.recipe_id, servings: 1 }]);
  return out;
}

/** Keep meal_recipes and meals.recipe_id agreeing after either was written:
 *  - a recipe_id not in the set replaces the set's first recipe (a single-recipe write, e.g. the Week editor);
 *  - otherwise recipe_id is set to the set's first recipe. */
export function syncMealRecipes(db: Db, mealId: string, emit?: Emit): void {
  const meal = db.select({ recipe_id: meals.recipe_id }).from(meals).where(eq(meals.id, mealId)).get() as { recipe_id: string | null } | undefined;
  if (!meal) return;
  const rows = db.select().from(meal_recipes).where(eq(meal_recipes.meal_id, mealId)).orderBy(asc(meal_recipes.position)).all() as
    { id: string; recipe_id: string }[];
  if (meal.recipe_id && !rows.some((r) => r.recipe_id === meal.recipe_id)) {
    if (rows[0]) {
      db.update(meal_recipes).set({ recipe_id: meal.recipe_id, updated_by: "app" }).where(eq(meal_recipes.id, rows[0].id)).run();
      emit?.("meal_recipes", rows[0].id, "update");
    } else {
      const row = db.insert(meal_recipes).values({ meal_id: mealId, recipe_id: meal.recipe_id, position: 0, updated_by: "app" }).returning().get() as { id: string };
      emit?.("meal_recipes", row.id, "insert");
    }
    return;
  }
  const first = rows[0]?.recipe_id ?? null;
  if (first !== meal.recipe_id && first) {
    db.update(meals).set({ recipe_id: first, updated_by: "app" }).where(eq(meals.id, mealId)).run();
    emit?.("meals", mealId, "update");
  }
}

/** Replace a meal's recipe set (the review's correction, or the editor's multi-recipe save). */
export function setMealRecipes(db: Db, mealId: string, set: MealRecipe[], emit?: Emit): void {
  for (const r of db.select({ id: meal_recipes.id }).from(meal_recipes).where(eq(meal_recipes.meal_id, mealId)).all() as { id: string }[]) {
    db.delete(meal_recipes).where(eq(meal_recipes.id, r.id)).run();
    emit?.("meal_recipes", r.id, "delete");
  }
  set.forEach((r, position) => {
    const row = db.insert(meal_recipes).values({ meal_id: mealId, recipe_id: r.recipe_id, servings: r.servings, position, updated_by: "app" }).returning().get() as { id: string };
    emit?.("meal_recipes", row.id, "insert");
  });
  db.update(meals).set({ recipe_id: set[0]?.recipe_id ?? null, updated_by: "app" }).where(eq(meals.id, mealId)).run();
  emit?.("meals", mealId, "update");
}

/** What a review is valid for: the dish, the note and the recipe set. Any change makes the stored review stale. */
export function mealReviewKey(dish: string, note: string | null, set: MealRecipe[]): string {
  return JSON.stringify([dish.trim(), (note ?? "").trim(), set.map((r) => [r.recipe_id, r.servings])]);
}

/** The meal's stored adjustments, or none when they were made for a different dish/note/recipes. */
export function currentAdjustments(meal: { dish: string; note: string | null; review: string | null; review_for: string | null }, set: MealRecipe[]): MealAdjustment[] {
  if (!meal.review || meal.review_for !== mealReviewKey(meal.dish, meal.note, set)) return [];
  return parseJson<MealAdjustment[]>(meal.review, []);
}
