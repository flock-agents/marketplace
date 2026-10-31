// A meal's own routes beyond the kit's rows: its recipe set (meal_recipes is a private table, so it is changed here,
// by the set_meal_recipes operation or any caller).
import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { meals, recipes } from "./db/schema";
import { setMealRecipes, type Emit } from "./mealRecipes";

/** `onChanged`: what a meal change sets off (index.ts mealChanged: recipe link, review, recipe fills, recompute). */
export function mountMealRoutes(hono: Hono<any>, db: BunSQLiteDatabase<any>, emit?: Emit, onChanged?: (mealId: string) => void) {
  // { recipes: [{ recipe_id, servings? }] }, in order: replaces the meal's recipe set.
  hono.post("/api/meals/:id/recipes", async (c) => {
    const id = c.req.param("id");
    if (!db.select({ id: meals.id }).from(meals).where(eq(meals.id, id)).get()) return c.json({ ok: false, reason: "meal_not_found" }, 404);
    const b = await c.req.json().catch(() => null) as { recipes?: { recipe_id?: unknown; servings?: unknown }[] } | null;
    if (!b || !Array.isArray(b.recipes) || !b.recipes.length) return c.json({ ok: false, reason: "recipes is a non-empty list of {recipe_id, servings?}" }, 400);
    const known = new Set((db.select({ id: recipes.id }).from(recipes).all() as { id: string }[]).map((r) => r.id));
    const set = b.recipes.map((r) => ({ recipe_id: String(r.recipe_id ?? ""), servings: typeof r.servings === "number" && r.servings > 0 ? r.servings : 1 }));
    const unknown = set.find((r) => !known.has(r.recipe_id));
    if (unknown) return c.json({ ok: false, reason: `unknown recipe_id ${unknown.recipe_id}` }, 400);
    setMealRecipes(db, id, set, emit);
    onChanged?.(id);
    return c.json({ ok: true, recipes: set });
  });
}
