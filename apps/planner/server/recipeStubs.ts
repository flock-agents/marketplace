// Every meal needs a recipe behind it — so the grocery-generation logic (server/portions.ts) always has
// somewhere to read ingredient quantities from, even before anyone has entered them. This runs off the kit's own
// write event for the `meals` table (wired up in index.ts), so it fires in the meal-write path itself, whichever
// wrote the meal: the agent's own API calls, a routine, or the manual editor.
import { and, eq, gte, isNull } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { meal_recipes, meals, recipes } from "./db/schema";

export type Emit = (table: "meals" | "recipes" | "meal_recipes", id: string, op: "insert" | "update" | "delete") => void;

/** A dish/recipe name reduced to its words: "Uttapam + chutney 🫓" → "uttapam chutney"; "(leftovers from tonight)" dropped. */
export const dishKey = (name: string): string =>
  name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The recipe still describes the dish: one name contains the other ("Idli 🫓" ↔ "Idli"). */
export const recipeFitsDish = (dish: string, recipeName: string): boolean => {
  const d = dishKey(dish), r = dishKey(recipeName);
  return !!d && !!r && (d.includes(r) || r.includes(d));
};

type MealLink = { id: string; date: string; dish: string; recipe_id: string | null; recipe_dish: string | null };

/** A meal row just written: keep its recipe link true to its dish. The app never creates a recipe — deciding whether
 *  "Poori aloo sabzi" is the existing "Puri aloo sabzi" and writing a new one's ingredient lines is the agent's job
 *  (the review_meal job a recipe-less meal gets, server/mealReview.ts).
 *  - linked, and the link was made for this dish (or is a fresh link nobody stamped yet): stamped and kept, so a
 *    deliberate link to a differently-named recipe stands;
 *  - linked, but the dish changed since and the recipe no longer fits it, or unlinked: linked to an existing recipe of
 *    exactly the same name, else left without a recipe for the agent.
 *  `legacy` (boot only): an unstamped link is checked against its dish too — rows from before recipe_dish existed. */
export function ensureRecipeForMeal(db: BunSQLiteDatabase<any>, mealId: string, emit?: Emit, legacy = false): void {
  const meal = db.select({ id: meals.id, date: meals.date, dish: meals.dish, recipe_id: meals.recipe_id, recipe_dish: meals.recipe_dish })
    .from(meals).where(eq(meals.id, mealId)).get() as MealLink | undefined;
  if (!meal || !meal.dish?.trim() || meal.recipe_dish === meal.dish) return;
  const link = (recipe_id: string | null) => {
    if (recipe_id === null) for (const r of db.select({ id: meal_recipes.id }).from(meal_recipes).where(eq(meal_recipes.meal_id, mealId)).all() as { id: string }[]) {
      db.delete(meal_recipes).where(eq(meal_recipes.id, r.id)).run();
      emit?.("meal_recipes", r.id, "delete");
    }
    db.update(meals).set({ recipe_id, recipe_dish: meal.dish, updated_by: "app" }).where(eq(meals.id, mealId)).run();
    emit?.("meals", mealId, "update");
  };
  const all = db.select({ id: recipes.id, name: recipes.name }).from(recipes).all() as { id: string; name: string }[];
  const linked = meal.recipe_id ? all.find((r) => r.id === meal.recipe_id) : undefined;
  const checkLink = meal.recipe_dish !== null || legacy;
  if (linked && (!checkLink || recipeFitsDish(meal.dish, linked.name))) return link(linked.id);
  const key = dishKey(meal.dish);
  link(all.find((r) => dishKey(r.name) === key)?.id ?? null);
}

/** Boot: stamp every upcoming meal's link, re-linking the ones whose dish was edited before links were stamped.
 *  Past meals are history: left as they are. */
export function relinkLegacyMeals(db: BunSQLiteDatabase<any>, today: string, emit?: Emit): void {
  const rows = db.select({ id: meals.id }).from(meals).where(and(isNull(meals.recipe_dish), gte(meals.date, today))).all() as { id: string }[];
  for (const r of rows) ensureRecipeForMeal(db, r.id, emit, true);
}
