// The `fill_recipe` background job (docs/V3-FLOW-SPEC.md "A meal = a set of recipes + an optional note"): a recipe
// that joins the meal plan with no ingredient lines buys nothing, so the moment it does the app asks the agent to
// write its lines from its own knowledge of the dish. The agent writes them through the data API; its answer only
// says it is done, and the app checks the recipe really has complete lines before closing the job.
import { and, eq, gte, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { agent_jobs, ingredients, meals, recipe_ingredients, recipes } from "./db/schema";
import { recipeSets } from "./mealRecipes";
import type { JobAnswerResult } from "./mealReview";
import { addDaysStr, todayStr } from "./timeline";

type Db = BunSQLiteDatabase<any>;
type Line = { item: string; ingredient_id: string | null; qty: number | null; qty_per_adult: number | null };

/** An unanswered fill expires after this many days; the next sweep asks again while the recipe is still on the plan. */
const FILL_EXPIRY_DAYS = 2;

const recipeLines = (db: Db, recipeId: string): Line[] =>
  db.select({ item: recipe_ingredients.item, ingredient_id: recipe_ingredients.ingredient_id, qty: recipe_ingredients.qty, qty_per_adult: recipe_ingredients.qty_per_adult })
    .from(recipe_ingredients).where(eq(recipe_ingredients.recipe_id, recipeId)).all() as Line[];

const openFillJob = (db: Db, recipeId: string) =>
  db.select({ id: agent_jobs.id }).from(agent_jobs)
    .where(and(eq(agent_jobs.kind, "fill_recipe"), eq(agent_jobs.subject, recipeId), eq(agent_jobs.status, "open"))).get() as { id: string } | undefined;

/** Upcoming meals and the recipes each is made of. */
function upcomingSets(db: Db, today: string) {
  const rows = db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, note: meals.note })
    .from(meals).where(gte(meals.date, today)).all() as { id: string; date: string; slot: string; dish: string; note: string | null }[];
  const sets = recipeSets(db, rows.map((m) => m.id));
  return rows.map((m) => ({ meal: m, set: sets.get(m.id) ?? [] }));
}

function fillFacts(db: Db, recipe: { id: string; name: string; ingredients: string | null; method: string | null }, today: string) {
  const usedBy = upcomingSets(db, today).flatMap(({ meal, set }) => set.filter((r) => r.recipe_id === recipe.id)
    .map((r) => ({ meal_id: meal.id, date: meal.date, slot: meal.slot, dish: meal.dish, note: meal.note, servings: r.servings })));
  return {
    recipe_id: recipe.id, name: recipe.name, ingredients_text: recipe.ingredients, method: recipe.method, meals: usedBy,
    catalog_search: "GET /api/search?q=<ingredient> (kind \"ingredient\"): reuse that id; POST /api/_data/ingredients only for a genuinely new one",
    write: "POST /api/_data/recipe_ingredients {recipe_id, ingredient_id, item, qty_per_adult, unit, category} per line, for ONE regular adult portion",
  };
}

/** Ask for this recipe's lines if it has none and no fill is open for it. Returns the open job's id, if any. */
export function queueRecipeFill(db: Db, recipeId: string, now = new Date()): string | null {
  const recipe = db.select({ id: recipes.id, name: recipes.name, ingredients: recipes.ingredients, method: recipes.method })
    .from(recipes).where(eq(recipes.id, recipeId)).get() as { id: string; name: string; ingredients: string | null; method: string | null } | undefined;
  if (!recipe || recipeLines(db, recipeId).length) return null;
  const open = openFillJob(db, recipeId);
  if (open) return open.id;
  const today = todayStr(now);
  const row = db.insert(agent_jobs).values({
    kind: "fill_recipe", subject: recipeId, facts: JSON.stringify(fillFacts(db, recipe, today)), status: "open",
    expires_at: `${addDaysStr(today, FILL_EXPIRY_DAYS)}T23:59`, asked_at: null, updated_by: "app",
  }).returning().get() as { id: string };
  return row.id;
}

/** Every recipe of this meal that has no lines yet (the meal-changed hook). Past meals are history: nothing asked. */
export function queueRecipeFillsForMeal(db: Db, mealId: string, now = new Date()): string[] {
  const meal = db.select({ date: meals.date }).from(meals).where(eq(meals.id, mealId)).get() as { date: string } | undefined;
  if (!meal || meal.date < todayStr(now)) return [];
  return queueRecipeFills(db, (recipeSets(db, [mealId]).get(mealId) ?? []).map((r) => r.recipe_id), now);
}

/** The sweep: every recipe an upcoming meal uses that still has no lines. */
export function queueUpcomingRecipeFills(db: Db, now = new Date()): string[] {
  return queueRecipeFills(db, upcomingSets(db, todayStr(now)).flatMap(({ set }) => set.map((r) => r.recipe_id)), now);
}

function queueRecipeFills(db: Db, recipeIds: string[], now: Date): string[] {
  return [...new Set(recipeIds)].map((id) => queueRecipeFill(db, id, now)).filter((id): id is string => !!id);
}

const lineProblem = (l: Line, known: Set<string>): string | null => {
  if (!l.ingredient_id || !known.has(l.ingredient_id)) return `${l.item}: no catalog ingredient_id`;
  const qty = l.qty_per_adult ?? l.qty;
  return typeof qty === "number" && qty > 0 ? null : `${l.item}: no qty_per_adult`;
};

/** The answer (any JSON object, e.g. `{}`) only says "done": the recipe itself must now have complete lines. */
export function answerRecipeFill(db: Db, job: { id: string; subject: string | null }): JobAnswerResult {
  const recipeId = job.subject ?? "";
  if (!db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId)).get()) {
    db.update(agent_jobs).set({ status: "expired", updated_by: "app" }).where(eq(agent_jobs.id, job.id)).run();
    return { ok: false, status: 404, reason: "recipe_not_found" };
  }
  const lines = recipeLines(db, recipeId);
  if (!lines.length) return { ok: false, status: 400, reason: "the recipe has no lines yet: POST /api/_data/recipe_ingredients for each, then answer again" };
  const ids = [...new Set(lines.map((l) => l.ingredient_id).filter((id): id is string => !!id))];
  const known = new Set(ids.length ? (db.select({ id: ingredients.id }).from(ingredients).where(inArray(ingredients.id, ids)).all() as { id: string }[]).map((r) => r.id) : []);
  const problems = lines.map((l) => lineProblem(l, known)).filter((p): p is string => !!p);
  if (problems.length) return { ok: false, status: 400, reason: `incomplete lines — PATCH them, then answer again: ${problems.join("; ")}` };
  db.update(agent_jobs).set({ status: "answered", answer: JSON.stringify({ lines: lines.length }), answered_at: new Date().toISOString(), updated_by: "app" })
    .where(eq(agent_jobs.id, job.id)).run();
  return { ok: true };
}
