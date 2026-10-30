// The suggested-quantity math for a recipe's structured ingredients (recipe_ingredients), scaled to whichever
// diners are actually eating that slot (diner_portions). server/portions.test.ts and the pages that build grocery
// lines from a recipe use these. Diner portions are never shown in any settings/edit UI — background data only.
import { groceryChanges, ingredientLines, isOpen } from "./recipes";

export interface IngredientLine { item: string; qty: number | null; unit: string | null; category: string | null }
export interface DinerPortion { diner_id: string; slot: string; multiplier: number }

/** A diner's own portion of one regular adult serving, for a slot — 1.0 (a regular adult portion) until something
 *  has actually been recorded for them. */
export function portionMultiplier(portions: DinerPortion[], dinerId: string, slot: string): number {
  return portions.find((p) => p.diner_id === dinerId && p.slot === slot)?.multiplier ?? 1;
}

/** The whole family's multiplier for a slot: every diner's own portion of it, summed. */
export function familyMultiplier(dinerIds: string[], slot: string, portions: DinerPortion[]): number {
  return dinerIds.reduce((sum, id) => sum + portionMultiplier(portions, id, slot), 0);
}

/** An amount, one decimal place (JS's own number-to-string already drops a trailing ".0"), with its unit. */
export function formatQty(amount: number, unit: string | null): string {
  const r = Math.round(amount * 10) / 10;
  return unit ? `${r} ${unit}` : String(r);
}

/** A recipe's per-adult ingredient line, scaled to the whole family for one slot: "2 cup" from a 0.5-cup line and
 *  a family multiplier of 4. Null when the recipe never recorded a quantity for this ingredient, or nobody's eating. */
export function scaledQty(line: { qty: number | null; unit: string | null }, familyTotal: number): string | null {
  if (line.qty == null || familyTotal <= 0) return null;
  return formatQty(line.qty * familyTotal, line.unit);
}

/** The most recent time this exact item was actually ordered for this dish — the simplest honest estimate when
 *  there's no recipe_ingredients quantity to scale: what was actually bought last time, not a guess from nothing. */
export function historicalQty(item: string, dish: string, orderedGroceries: { item: string; for_dish: string | null; qty: string | null; status: string | null; created_at?: string }[]): string | null {
  const itemKey = item.trim().toLowerCase(), dishKey = dish.trim().toLowerCase();
  const matches = orderedGroceries.filter((g) =>
    g.status === "ordered" && g.qty && g.for_dish?.trim().toLowerCase() === dishKey && g.item.trim().toLowerCase() === itemKey);
  if (!matches.length) return null;
  return [...matches].sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1))[0].qty ?? null;
}

export interface StructuredAdd { item: string; qty: string | null; category: string | null; for_dish: string }
export interface StructuredChanges { add: StructuredAdd[]; reopen: { id: string; for_dish: string }[]; skipped: string[] }

/** What "Add ingredients to groceries" does with a recipe's STRUCTURED ingredients (recipe_ingredients) against
 *  the list: same add/skip/reopen shape as recipes.ts's groceryChanges for the freeform text, but each added item
 *  carries its suggested quantity (scaledQty, else historyQty) and its category. */
export function structuredGroceryChanges(
  lines: IngredientLine[], familyTotal: number, forDish: string,
  list: { id: string; item: string; status: string | null }[],
  historyQty: (item: string) => string | null = () => null,
): StructuredChanges {
  const add: StructuredAdd[] = [], reopen: { id: string; for_dish: string }[] = [], skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const there = list.filter((g) => g.item.trim().toLowerCase() === key || g.item.split(/[,(]/)[0].trim().toLowerCase() === key);
    if (there.some((g) => isOpen(g.status))) skipped.push(line.item);
    else if (there.length) reopen.push({ id: there[0].id, for_dish: forDish });
    else add.push({ item: line.item, qty: scaledQty(line, familyTotal) ?? historyQty(line.item), category: line.category, for_dish: forDish });
  }
  return { add, reopen, skipped };
}

export interface RecipeForGroceries { id: string; name: string; ingredients: string | null }
export interface CombinedChanges { add: StructuredAdd[]; reopen: { id: string; for_dish: string }[]; skipped: number; bare: string[] }

/** "Add ingredients to groceries" / "Add all for this meal": each recipe in turn, using its STRUCTURED ingredients
 *  (recipe_ingredients) when it has any, else its freeform ingredients text — so a meal mixing an old recipe and a
 *  freshly-structured one still works in one pass. An item two dishes share goes on the list once, for the first
 *  dish that needs it. */
export function buildGroceryChanges(
  recipes: RecipeForGroceries[], structuredByRecipe: Map<string, IngredientLine[]>, familyTotal: number,
  list: { id: string; item: string; for_dish: string | null; qty: string | null; status: string | null }[],
): CombinedChanges {
  const add: StructuredAdd[] = [], reopen: { id: string; for_dish: string }[] = [], bare: string[] = [];
  let skipped = 0;
  let now = list.map((g) => ({ ...g }));
  for (const r of recipes) {
    const structured = structuredByRecipe.get(r.id) ?? [];
    if (structured.length) {
      const c = structuredGroceryChanges(structured, familyTotal, r.name, now, (item) => historicalQty(item, r.name, list));
      skipped += c.skipped.length;
      for (const a of c.add) { add.push(a); now.push({ id: "", item: a.item, for_dish: null, qty: null, status: "pending" }); }
      for (const re of c.reopen) { reopen.push(re); now = now.map((g) => (g.id === re.id ? { ...g, status: "pending" } : g)); }
      continue;
    }
    const lines = ingredientLines(r.ingredients);
    if (!lines.length) { bare.push(r.name); continue; }
    const c = groceryChanges(lines, now);
    skipped += c.skipped.length;
    for (const item of c.add) { add.push({ item, qty: null, category: null, for_dish: r.name }); now.push({ id: "", item, for_dish: null, qty: null, status: "pending" }); }
    for (const id of c.reopen) { reopen.push({ id, for_dish: r.name }); now = now.map((g) => (g.id === id ? { ...g, status: "pending" } : g)); }
  }
  return { add, reopen, skipped, bare };
}
