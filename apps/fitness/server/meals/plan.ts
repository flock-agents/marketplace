// Plain code, no imports beyond the constants: a day's planned meals as the page and the coach read them, and the message the coach shares.
import { MEAL_SLOT, canonicalKind } from "../db/constants";
import { missingNutrients, pickNutrients, type Nutrients } from "../nutrition/catalog";

export const SLOTS = ["Breakfast", "Lunch", "Snack", "Dinner"] as const;
export type Slot = (typeof SLOTS)[number];
interface Nutrition { kcal: number | null; protein_g: number | null; fiber_g: number | null }
export interface MealPlanRow extends Nutrition, Partial<Nutrients> { id: string; slot: string | null; name: string; done: boolean | number | null; position: number | null }
/** `done`: ticked by hand, or a meal of its slot was logged that day (`loggedAs` names it). */
/** `actual`: the numbers of the meal that was logged for it, beside the planned ones. */
export interface MealPlanItem extends Nutrition, Nutrients { id: string; slot: Slot | null; name: string; done: boolean; loggedAs: string | null; actual: Nutrition | null }
export interface MealPlanInput extends Nutrition, Nutrients { slot: Slot | null; name: string }
export interface LoggedMeal extends Partial<Nutrition> { title: string; kind: string | null }

/** The slot a word or a title starts with ("lunch", "Snacks: fruit"), or null. */
export function slotOf(text: string | null | undefined): Slot | null {
  const word = MEAL_SLOT.exec(text?.trim() ?? "")?.[1].toLowerCase().replace(/s$/, "");
  return SLOTS.find((s) => s.toLowerCase() === word) ?? null;
}

/** A day's planned meals in order. Each logged meal ticks the first planned meal of its slot not yet ticked. */
export function mealPlanItems(rows: MealPlanRow[], logged: LoggedMeal[]): MealPlanItem[] {
  const unclaimed = logged.filter((m) => canonicalKind(m.kind) === "Meal" && slotOf(m.title));
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => {
      const slot = slotOf(r.slot);
      const i = r.done || !slot ? -1 : unclaimed.findIndex((m) => slotOf(m.title) === slot);
      const meal = i < 0 ? null : unclaimed.splice(i, 1)[0];
      const actual = meal ? { kcal: meal.kcal ?? null, protein_g: meal.protein_g ?? null, fiber_g: meal.fiber_g ?? null } : null;
      return { id: r.id, slot, name: r.name, kcal: r.kcal, protein_g: r.protein_g, fiber_g: r.fiber_g, ...pickNutrients({ ...r }), done: !!r.done || !!meal, loggedAs: meal?.title ?? null, actual };
    });
}

/** A planned meal carrying all three numbers and its full breakdown can be logged as eaten as it is; one without them needs the
 *  coach's estimate. */
export const hasNumbers = (n: Nutrition & Partial<Nutrients>) => n.kcal != null && n.protein_g != null && n.fiber_g != null && missingNutrients({ ...n }).length === 0;

const plain = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
/** "450 kcal · 18 g protein · 6 g fiber", as far as the numbers are known; null when none is. */
export function nutritionLine({ kcal, protein_g, fiber_g }: Partial<Nutrition>): string | null {
  const parts = [kcal != null ? `${plain(kcal)} kcal` : null, protein_g != null ? `${plain(protein_g)} g protein` : null, fiber_g != null ? `${plain(fiber_g)} g fiber` : null];
  const known = parts.filter(Boolean);
  return known.length ? known.join(" · ") : null;
}

/** The planned meals' numbers added up; a number no meal carries stays null. */
export function plannedTotals(items: Nutrition[]): Nutrition {
  const sum = (k: keyof Nutrition) => { const v = items.map((i) => i[k]).filter((n): n is number => n != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  return { kcal: sum("kcal"), protein_g: sum("protein_g"), fiber_g: sum("fiber_g") };
}

/** The plan as a chat message: one numbered line per meal, then the day's planned totals. */
export function shareText(day: string, items: MealPlanItem[]): string {
  if (items.length === 0) return `No meal plan set for ${day}.`;
  const lines = items.map((it, i) => {
    const numbers = nutritionLine(it);
    return `${i + 1}. ${it.slot ? `${it.slot}: ` : ""}${it.name}${numbers ? ` — ${numbers}` : ""}${it.done ? " ✓" : ""}`;
  });
  const total = nutritionLine(plannedTotals(items));
  return [`Meal plan for ${day}:`, ...lines, ...(total ? [`Planned: ${total}`] : [])].join("\n");
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const SLOT_PREFIX = new RegExp(`${MEAL_SLOT.source}\\s*[:–—-]\\s*`, "i");
/** A PUT body's items, cleaned: a name is required ("Lunch: dal, rice" is stored as slot Lunch, name "dal, rice"); the slot comes
 *  from `slot` or the name's start; numbers (the headline three and the full breakdown) are optional.
 *  Null when the body is not a list of items. */
export function parseItems(body: unknown): MealPlanInput[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const clean = items.map((it) => {
    const given = String(it?.name ?? "").trim();
    const name = given.replace(SLOT_PREFIX, "").trim();
    return { slot: slotOf(it?.slot) ?? slotOf(given), name, kcal: num(it?.kcal), protein_g: num(it?.protein_g), fiber_g: num(it?.fiber_g), ...pickNutrients(it ?? {}) };
  });
  return clean.every((it) => it.name) ? clean : null;
}
