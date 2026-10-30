// The ingredient catalog: resolving a name against it (find-or-create, never a near-duplicate when app code is
// the one creating a reference), and flagging the near-duplicates that slip in anyway — a recipe_ingredients row
// written directly (by the agent, through the generic API, not through resolveIngredient here) can still phrase
// the same thing differently than an existing entry.
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { groceries, ingredients, recipe_ingredients } from "./db/schema";

const FILLER_WORDS = /\b(fresh|whole|chopped|sliced|grated|boiled|raw|ripe|large|small|medium|organic)\b/g;

/** Lowercase, trimmed, filler words and a trailing plural dropped — "Fresh Tomatoes" and "tomato" both become
 *  "tomato". Naive (not real NLP), good enough to catch the common phrasing differences a recipe introduces. */
export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase().replace(FILLER_WORDS, "").replace(/\s+/g, " ").trim().replace(/(es|s)$/, "");
}

/** The existing catalog entry this name already means, if any. */
export function findIngredientMatch<C extends { id: string; name: string }>(catalog: C[], name: string): C | undefined {
  const key = normalizeIngredientName(name);
  return catalog.find((c) => normalizeIngredientName(c.name) === key);
}

/** Finds the catalog entry this name already means, or creates one. The only place app code should create an
 *  ingredients row — the agent resolves its own matches when it fills in recipe_ingredients (reading the catalog
 *  through the ordinary API), so this is for the app's own deterministic writes (today: the legacy-row backfill). */
export function resolveIngredient(
  db: BunSQLiteDatabase<any>, name: string, category: string | null, defaultUnit: string | null,
  emit?: (table: "ingredients", id: string, op: "insert" | "update" | "delete") => void,
): string {
  const catalog = db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).all() as { id: string; name: string }[];
  const match = findIngredientMatch(catalog, name);
  if (match) return match.id;
  const row = db.insert(ingredients).values({ name: name.trim(), category, default_unit: defaultUnit, updated_by: "app" }).returning().get() as { id: string };
  emit?.("ingredients", row.id, "insert");
  return row.id;
}

/** Any recipe_ingredients row written with a plain item string but no ingredient_id yet — resolved against the
 *  catalog (matching an existing entry before ever creating a new one) and linked. Idempotent: a row already
 *  linked is left alone. */
export function backfillRecipeIngredientCatalog(
  db: BunSQLiteDatabase<any>,
  emit?: (table: "ingredients" | "recipe_ingredients", id: string, op: "insert" | "update" | "delete") => void,
): void {
  const unlinked = db.select().from(recipe_ingredients).where(isNull(recipe_ingredients.ingredient_id)).all() as
    { id: string; item: string; category: string | null; unit: string | null }[];
  for (const row of unlinked) {
    const ingredientId = resolveIngredient(db, row.item, row.category, row.unit, emit as any);
    db.update(recipe_ingredients).set({ ingredient_id: ingredientId, updated_by: "app" }).where(eq(recipe_ingredients.id, row.id)).run();
    emit?.("recipe_ingredients", row.id, "update");
  }
}

/** Levenshtein edit distance, small-string case (ingredient names are short; no need for anything fancier). */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface DuplicatePair { a: { id: string; name: string }; b: { id: string; name: string } }

/** Catalog entries that look like the same ingredient under two different names — close enough (a short edit
 *  distance, or one name contains the other) that it's worth the agent's eyes, but not so close that
 *  findIngredientMatch would already have caught it (those genuinely can't coexist unless something bypassed
 *  resolveIngredient). Flags, never merges — only a confirmed the agent action re-points rows and retires one. */
export function likelyDuplicateIngredients(catalog: { id: string; name: string }[]): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (let i = 0; i < catalog.length; i++) {
    for (let j = i + 1; j < catalog.length; j++) {
      const a = catalog[i], b = catalog[j];
      const ka = normalizeIngredientName(a.name), kb = normalizeIngredientName(b.name);
      if (ka === kb) continue;   // findIngredientMatch already treats these as the same entry
      const close = ka.includes(kb) || kb.includes(ka) || editDistance(ka, kb) <= 2;
      if (close) out.push({ a, b });
    }
  }
  return out;
}

/** At most this many shelf-life guesses are asked for in one night. */
const SHELF_LIFE_BATCH = 15;

/** Ingredients on the shopping list whose shelf life is still the generic default (or unknown), not the agent's
 *  informed guess for this home. */
export function ingredientsNeedingShelfLife(db: BunSQLiteDatabase<any>): { id: string; name: string; category: string | null; shelf_life_days: number | null }[] {
  const onList = (db.select({ id: groceries.ingredient_id }).from(groceries)
    .where(and(isNotNull(groceries.ingredient_id), inArray(groceries.status, ["pending", "confirmed", "ordered"]))).all() as { id: string }[]).map((r) => r.id);
  if (!onList.length) return [];
  return db.select({ id: ingredients.id, name: ingredients.name, category: ingredients.category, shelf_life_days: ingredients.shelf_life_days })
    .from(ingredients)
    .where(and(inArray(ingredients.id, [...new Set(onList)]), or(isNull(ingredients.shelf_life_source), ne(ingredients.shelf_life_source, "agent"))))
    .limit(SHELF_LIFE_BATCH).all() as { id: string; name: string; category: string | null; shelf_life_days: number | null }[];
}
