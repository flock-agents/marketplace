// Plain functions, no imports: the pages use them and server/recipes.test.ts tests them.

/** A recipe's ingredients, one per line; blank lines and leading bullets are dropped. */
export const ingredientLines = (text: string | null | undefined): string[] =>
  (text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);

/** "Rajma, 1 cup (soaked)" and "rajma (soaked overnight)" are the same grocery: the name before a comma or bracket. */
const itemKey = (s: string): string => s.split(/[,(]/)[0].trim().toLowerCase();

/** A grocery row still needs buying — the one place that question is answered, so nothing else has to keep its
 *  own separate "is this done" flag in sync with `status` by hand. */
export const isOpen = (status: string | null | undefined): boolean => status !== "ordered" && status !== "skipped";

/**
 * What "Add ingredients to groceries" does with a recipe's lines against the list: add what is missing, skip what is
 * already there and not bought, and put back (`reopen`, by grocery id) an item that was bought before.
 */
export function groceryChanges(lines: string[], list: { id: string; item: string; status: string | null }[]) {
  const add: string[] = [], reopen: string[] = [], skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = itemKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const there = list.filter((g) => itemKey(g.item) === key);
    if (there.some((g) => isOpen(g.status))) skipped.push(line);
    else if (there.length) reopen.push(there[0].id);
    else add.push(line);
  }
  return { add, reopen, skipped };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const dayNo = (iso: string): number => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };

/** A recipe's nearest plan, for its label: `had` for a day before today ("Had Oct 6"), else on the plan ("On the plan Oct 13"). */
export type Said = { had: boolean; date: string } | null;

/**
 * Recipes to offer for a meal on `day`: matching what is typed, never-planned first, then by how far their nearest plan is
 * from `day`, furthest first (a typed dish with a recipe's name counts as planning it). Ties go to the name.
 */
export function suggestRecipes<R extends { id: string; name: string }>(
  recipes: R[], meals: { date: string; dish: string; recipe_id: string | null }[], typed: string, day: string, today: string, limit = 6,
): { recipe: R; said: Said }[] {
  const q = typed.trim().toLowerCase(), at = dayNo(day);
  return recipes
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .map((recipe) => {
      let near: string | null = null, gap = Infinity;
      for (const m of meals) {
        if (m.recipe_id !== recipe.id && !same(m.dish, recipe.name)) continue;
        const g = Math.abs(dayNo(m.date) - at);
        if (g < gap || (g === gap && near !== null && m.date < near)) { gap = g; near = m.date; }
      }
      return { recipe, gap, said: near ? { had: near < today, date: near } : null };
    })
    .sort((a, b) => b.gap - a.gap || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(({ recipe, said }) => ({ recipe, said }));
}

/** The recipe a meal's dish links to: one named the same, else the meal's own link while its dish is unchanged. */
export function linkFor(dish: string, recipes: { id: string; name: string }[], before?: { dish: string; recipe_id: string | null }): string | null {
  const named = recipes.find((r) => same(r.name, dish));
  if (named) return named.id;
  // A recipe deleted since keeps no hold on the meal, so "Save as a recipe" is offered again.
  return before && same(before.dish, dish) && recipes.some((r) => r.id === before.recipe_id) ? before.recipe_id : null;
}

/** A structured ingredient line (recipe_ingredients). `qty_per_adult` is the v2 column; older rows only carry `qty`, also per adult. */
export interface IngredientRow {
  id: string; recipe_id: string; ingredient_id: string | null; item: string;
  qty?: number | null; qty_per_adult?: number | null; unit: string | null; category: string | null;
  optional?: number | null; substitutes?: string | null;
}
export const perAdult = (r: Pick<IngredientRow, "qty" | "qty_per_adult">): number | null => r.qty_per_adult ?? r.qty ?? null;

/** Quantities rounded for reading: 1.5, 250, 0.25 — never 0.3333333. */
export const roundQty = (n: number): number => (n >= 10 ? Math.round(n) : Math.round(n * 100) / 100);

/** "500 g" for one line at `servings` adult portions; "to taste" when no quantity is written. */
export function scaledText(r: Pick<IngredientRow, "qty" | "qty_per_adult" | "unit">, servings: number): string {
  const q = perAdult(r);
  if (q === null) return "to taste";
  return `${roundQty(q * servings)}${r.unit ? ` ${r.unit}` : ""}`;
}

/** "Prep 15 min · Cook 40 min · Start 8h ahead", leaving out what isn't written. */
export function timesText(prepMin: number | null | undefined, cookMin: number | null | undefined, leadHours: number | null | undefined): string {
  return [prepMin ? `Prep ${prepMin} min` : null, cookMin ? `Cook ${cookMin} min` : null, leadHours ? `Start ${leadHours}h ahead` : null]
    .filter(Boolean).join(" · ");
}

/** Meals a recipe is used in, split at today: upcoming soonest first, past latest first. */
export function usedInMeals<M extends { date: string; dish: string; recipe_id: string | null }>(
  recipe: { id: string; name: string }, meals: M[], today: string,
): { upcoming: M[]; past: M[] } {
  const mine = meals.filter((m) => m.recipe_id === recipe.id || m.dish.trim().toLowerCase() === recipe.name.trim().toLowerCase());
  return {
    upcoming: mine.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    past: mine.filter((m) => m.date < today).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** The chat message "Import" sends: the agent reads the pasted text or link and fills the structured fields. */
export function importMessage(recipe: { id: string; name: string }, pasted: string): string {
  const text = pasted.trim();
  const isLink = /^https?:\/\/\S+$/i.test(text);
  return [
    `Please fill in the recipe "${recipe.name}" (recipes id ${recipe.id}) from this ${isLink ? "link" : "pasted text"}:`,
    "", text, "",
    "Set servings, prep_min, cook_min, prep_steps, tags, cuisine" + (isLink ? ", source_url" : "") + " and the method on the recipe,",
    "and write one recipe_ingredients row per ingredient (ingredient_id from the ingredients catalog, qty_per_adult, unit, optional, substitutes).",
    "Match existing ingredients (including aliases) before adding new ones.",
  ].join("\n");
}

const SLOT_TIME_FALLBACK: Record<string, string> = { Breakfast: "08:00", Lunch: "13:00", Dinner: "20:00" };

/** A meal's default time from its slot: settings cook.morning / cook.evening, lunch 13:00. */
export function slotDefaultTime(slot: string | null | undefined, settings: Record<string, unknown>): string | null {
  if (!slot) return null;
  const pick = (key: string) => (typeof settings[key] === "string" && /^\d{1,2}:\d{2}$/.test(settings[key] as string) ? settings[key] as string : null);
  if (slot === "Breakfast") return pick("cook.morning") ?? SLOT_TIME_FALLBACK.Breakfast;
  if (slot === "Dinner") return pick("cook.evening") ?? SLOT_TIME_FALLBACK.Dinner;
  return SLOT_TIME_FALLBACK[slot] ?? null;
}

/** "7:5" or "0730" → "07:30"-style HH:MM, or null for anything that isn't a time of day. */
export function normalizeTime(text: string | null | undefined): string | null {
  const m = (text ?? "").trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

/** The v2 recipe columns (docs/V2-SPEC.md) on top of the original ones. */
export interface RecipeV2 {
  id: string; name: string; ingredients: string | null; method: string | null; notes: string | null;
  prep_steps: string | null; prep_lead_hours: number | null;
  servings?: number | null; prep_min?: number | null; cook_min?: number | null; tags?: string | null; cuisine?: string | null; source_url?: string | null;
}
