// Plain functions, no imports: the pages use them and server/recipes.test.ts tests them.

/** A recipe's ingredients, one per line; blank lines and leading bullets are dropped. */
export const ingredientLines = (text: string | null | undefined): string[] =>
  (text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);

/** "Rajma, 1 cup (soaked)" and "rajma (soaked overnight)" are the same grocery: the name before a comma or bracket. */
const itemKey = (s: string): string => s.split(/[,(]/)[0].trim().toLowerCase();

/**
 * What "Add ingredients to groceries" does with a recipe's lines against the list: add what is missing, skip what is
 * already there and not bought, and put back (`reopen`, by grocery id) an item that was bought before.
 */
export function groceryChanges(lines: string[], list: { id: string; item: string; done: boolean | null }[]) {
  const add: string[] = [], reopen: string[] = [], skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = itemKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const there = list.filter((g) => itemKey(g.item) === key);
    if (there.some((g) => !g.done)) skipped.push(line);
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

/**
 * "Add all for this meal": groceryChanges for each recipe in turn, so an item two dishes share goes on the list once
 * (for the first dish). `bare` names the recipes with no ingredients yet.
 */
export function mealGroceryChanges(recipes: { name: string; ingredients: string | null }[], list: { id: string; item: string; done: boolean | null }[]) {
  const add: { item: string; for_dish: string }[] = [], reopen: { id: string; for_dish: string }[] = [], bare: string[] = [];
  let skipped = 0;
  const now = list.map((g) => ({ ...g }));
  for (const r of recipes) {
    const lines = ingredientLines(r.ingredients);
    if (!lines.length) { bare.push(r.name); continue; }
    const c = groceryChanges(lines, now);
    skipped += c.skipped.length;
    for (const item of c.add) { add.push({ item, for_dish: r.name }); now.push({ id: "", item, done: false }); }
    for (const id of c.reopen) { reopen.push({ id, for_dish: r.name }); for (const g of now) if (g.id === id) g.done = false; }
  }
  return { add, reopen, skipped, bare };
}
