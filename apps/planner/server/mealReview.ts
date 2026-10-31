// The `review_meal` background job (docs/V3-FLOW-SPEC.md "A meal = a set of recipes + an optional note"): the app's
// rough need comes from the meal's recipes; the agent reviews it against the note and the dish and answers with
// per-ingredient adjustments (and, if the recipes don't describe the dish, a corrected recipe set). The app checks
// the answer and stores it on the meal, valid only for the dish/note/recipes it was made for.
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { agent_jobs, ingredients, meals, recipe_ingredients, recipes } from "./db/schema";
import { mealReviewKey, recipeSets, setMealRecipes, type Emit, type MealAdjustment, type MealRecipe } from "./mealRecipes";
import { recipeFitsDish } from "./recipeStubs";
import { parseJson } from "./quantity";
import { queueRecipeFill } from "./recipeFill";

type Db = BunSQLiteDatabase<any>;
type MealRow = { id: string; date: string; slot: string; dish: string; note: string | null; review_for: string | null };
export type JobAnswerResult = { ok: true } | { ok: false; status: 400 | 404 | 409; reason: string };

const MAX_FACTOR = 10;

/** A review is needed when the meal has no recipe yet (the agent links or creates one), there is a note to apply,
 *  or the dish no longer matches any of its recipes. */
export function needsReview(dish: string, note: string | null, recipeNames: string[]): boolean {
  if (!recipeNames.length || note?.trim()) return true;
  return !recipeNames.some((n) => recipeFitsDish(dish, n));
}

function loadMeal(db: Db, mealId: string): MealRow | undefined {
  return db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, note: meals.note, review_for: meals.review_for })
    .from(meals).where(eq(meals.id, mealId)).get() as MealRow | undefined;
}

function reviewFacts(db: Db, meal: MealRow, set: MealRecipe[], key: string) {
  const ids = set.map((r) => r.recipe_id);
  const names = new Map((ids.length ? db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(inArray(recipes.id, ids)).all() as { id: string; name: string }[] : []).map((r) => [r.id, r.name]));
  const lines = ids.length ? db.select({ recipe_id: recipe_ingredients.recipe_id, ingredient_id: recipe_ingredients.ingredient_id, item: recipe_ingredients.item,
    qty_per_adult: recipe_ingredients.qty_per_adult, qty: recipe_ingredients.qty, unit: recipe_ingredients.unit })
    .from(recipe_ingredients).where(inArray(recipe_ingredients.recipe_id, ids)).all() as { recipe_id: string; ingredient_id: string | null; item: string; qty_per_adult: number | null; qty: number | null; unit: string | null }[] : [];
  return {
    meal_id: meal.id, key, date: meal.date, slot: meal.slot, dish: meal.dish, note: meal.note,
    recipes: set.map((r) => ({
      recipe_id: r.recipe_id, name: names.get(r.recipe_id) ?? null, servings: r.servings,
      lines: lines.filter((l) => l.recipe_id === r.recipe_id).map(({ recipe_id: _, qty_per_adult, qty, ...l }) => ({ ...l, qty_per_adult: qty_per_adult ?? qty })),
    })),
  };
}

/** Queue a review for this meal if it needs one and none is open for its current dish/note/recipes. Older open
 *  reviews of the same meal are expired: their facts no longer describe it. Returns the open job's id, if any. */
export function queueMealReview(db: Db, mealId: string, now = new Date()): string | null {
  const meal = loadMeal(db, mealId);
  if (!meal) return null;
  const set = recipeSets(db, [mealId]).get(mealId) ?? [];
  const key = mealReviewKey(meal.dish, meal.note, set);
  const open = db.select().from(agent_jobs).where(and(eq(agent_jobs.kind, "review_meal"), eq(agent_jobs.subject, mealId), eq(agent_jobs.status, "open"))).all() as
    { id: string; facts: string }[];
  const current = open.find((j) => parseJson<{ key?: string }>(j.facts, {}).key === key);
  for (const j of open) if (j !== current) db.update(agent_jobs).set({ status: "expired", updated_by: "app" }).where(eq(agent_jobs.id, j.id)).run();
  if (current) return current.id;
  if (meal.review_for === key) return null;
  const facts = reviewFacts(db, meal, set, key);
  if (!needsReview(meal.dish, meal.note, facts.recipes.map((r) => r.name ?? ""))) return null;
  const row = db.insert(agent_jobs).values({
    kind: "review_meal", subject: mealId, facts: JSON.stringify(facts), status: "open",
    expires_at: `${meal.date}T23:59`, asked_at: null, updated_by: "app",
  }).returning().get() as { id: string };
  return row.id;
}

/** The agent's answer: `{ recipes?: [{recipe_id, servings?}], adjustments: MealAdjustment[] }`. */
export function adjustmentProblem(a: unknown, knownIngredients: Set<string>): string | null {
  if (!a || typeof a !== "object") return "each adjustment is an object";
  const x = a as Record<string, unknown>;
  if (typeof x.ingredient_id !== "string" || !knownIngredients.has(x.ingredient_id)) return `unknown ingredient_id ${String(x.ingredient_id)}: use an id from the catalog (GET /api/search?q=…)`;
  if (typeof x.reason !== "string" || !x.reason.trim()) return "each adjustment needs a one-line reason";
  if (x.action === "drop") return null;
  if (x.action === "scale") return typeof x.factor === "number" && x.factor > 0 && x.factor <= MAX_FACTOR ? null : `scale needs a factor above 0 and at most ${MAX_FACTOR}`;
  if (x.action === "add") return typeof x.qty === "number" && x.qty > 0 && typeof x.unit === "string" && x.unit.trim() ? null : "add needs qty > 0 and a unit";
  return "action must be drop, scale or add";
}

export function answerMealReview(db: Db, job: { id: string; subject: string | null; facts: string }, answer: unknown, emit?: Emit): JobAnswerResult {
  const a = answer as { recipes?: unknown; adjustments?: unknown } | null;
  if (!a || typeof a !== "object" || !Array.isArray(a.adjustments)) return { ok: false, status: 400, reason: "answer needs adjustments: [] (empty when the recipes are right as they are)" };
  const known = new Set((db.select({ id: ingredients.id }).from(ingredients).all() as { id: string }[]).map((r) => r.id));
  for (const adj of a.adjustments) { const p = adjustmentProblem(adj, known); if (p) return { ok: false, status: 400, reason: p }; }
  let set: MealRecipe[] | null = null;
  if (a.recipes !== undefined) {
    if (!Array.isArray(a.recipes) || !a.recipes.length) return { ok: false, status: 400, reason: "recipes, when given, is a non-empty list of {recipe_id, servings?}" };
    const ids = new Set((db.select({ id: recipes.id }).from(recipes).all() as { id: string }[]).map((r) => r.id));
    set = [];
    for (const r of a.recipes as { recipe_id?: unknown; servings?: unknown }[]) {
      if (typeof r?.recipe_id !== "string" || !ids.has(r.recipe_id)) return { ok: false, status: 400, reason: `unknown recipe_id ${String(r?.recipe_id)}: create the recipe first (POST /api/_data/recipes)` };
      const servings = r.servings === undefined ? 1 : r.servings;
      if (typeof servings !== "number" || servings <= 0 || servings > MAX_FACTOR) return { ok: false, status: 400, reason: `servings is above 0 and at most ${MAX_FACTOR}` };
      set.push({ recipe_id: r.recipe_id, servings });
    }
  }
  const mealId = job.subject ?? "";
  const meal = loadMeal(db, mealId);
  if (!meal) return { ok: false, status: 404, reason: "meal_not_found" };
  const facts = parseJson<{ key?: string }>(job.facts, {});
  const before = recipeSets(db, [mealId]).get(mealId) ?? [];
  if (facts.key !== mealReviewKey(meal.dish, meal.note, before)) {
    db.update(agent_jobs).set({ status: "expired", updated_by: "app" }).where(eq(agent_jobs.id, job.id)).run();
    return { ok: false, status: 409, reason: "the meal changed since this job was asked; answer the newer open job for it" };
  }
  if (!set && !before.length) return { ok: false, status: 400, reason: "this meal has no recipe yet: give recipes — an existing one if it is the same dish under another spelling (search first), else create it (POST /api/_data/recipes, ideally with its lines; a fill_recipe job follows if not) and give its id" };
  if (set) {
    setMealRecipes(db, mealId, set, emit);
    for (const r of set) queueRecipeFill(db, r.recipe_id);   // a linked or new recipe with no lines gets them filled next
  }
  const after = set ?? before;
  db.update(meals).set({ review: JSON.stringify(a.adjustments as MealAdjustment[]), review_for: mealReviewKey(meal.dish, meal.note, after), updated_by: "app" })
    .where(eq(meals.id, mealId)).run();
  emit?.("meals", mealId, "update");
  db.update(agent_jobs).set({ status: "answered", answer: JSON.stringify(a), answered_at: new Date().toISOString(), updated_by: "app" }).where(eq(agent_jobs.id, job.id)).run();
  return { ok: true };
}
