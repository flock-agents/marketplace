// The Pantry: what is in the kitchen (server/stock.ts reads it) and the answers that correct it (docs/V3-FLOW-SPEC.md
// "Pantry = what is in the kitchen"). Nothing here is required input: the agent asks about a few due items in chat
// and posts what the family said (silence = all there); the Pantry page offers the same correction per item.
// "yes" → checked today. "low"/"out" → the stock is written off and the item goes on the shopping list.
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { PANTRY_LEVELS } from "./db/constants";
import { groceries, ingredients, staples } from "./db/schema";
import { logChoice } from "./choices";
import { dueForCheck, kitchenItems, mealLabel, upcomingUses, type KitchenItem, type PantryDue } from "./stock";
import { todayStr, type SettingsReader } from "./timeline";

type Db = BunSQLiteDatabase<any>;
type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;

/** The kinds the Pantry page groups by, in order; a category not listed here is "Other". */
const KINDS: [kind: string, categories: string[]][] = [
  ["Vegetables & fruit", ["vegetables", "leafy_greens", "fruits"]],
  ["Dairy", ["dairy"]],
  ["Bread", ["bakery"]],
  ["Meat & fish", ["meat"]],
  ["Grains & pulses", ["grains", "pulses"]],
  ["Staples", ["pantry", "oils"]],
  ["Spices", ["spices"]],
  ["Snacks", ["snacks"]],
  ["Household", ["household"]],
];
const OTHER = "Other";
const kindOf = (category: string | null): string => KINDS.find(([, cats]) => cats.includes(category ?? ""))?.[0] ?? OTHER;
const AISLE_FOR: Record<string, string> = { vegetables: "Vegetables", leafy_greens: "Vegetables", fruits: "Vegetables", dairy: "Dairy", pantry: "Staples", grains: "Staples", pulses: "Staples", oils: "Staples", spices: "Spices" };

export type PantryItem = Omit<KitchenItem, "for_meals"> & { for_meals: string[] };
export interface PantryView { generated_at: string; groups: { kind: string; items: PantryItem[] }[]; due: PantryDue[] }

/** GET /api/pantry: the kitchen by kind (each item with how sure the app is) and the items due for a check-in. */
export function pantryView(db: Db, settings: SettingsReader, now = new Date()): PantryView {
  const items = kitchenItems(db, now, settings);
  const order = [...KINDS.map(([k]) => k), OTHER];
  const groups = new Map<string, PantryItem[]>();
  for (const i of items) {
    const kind = kindOf(i.category);
    groups.set(kind, [...(groups.get(kind) ?? []), { ...i, for_meals: i.for_meals.map(mealLabel) }]);
  }
  return {
    generated_at: now.toISOString(),
    groups: order.filter((k) => groups.has(k)).map((kind) => ({ kind, items: groups.get(kind)! })),
    due: dueForCheck(items, todayStr(now)),
  };
}

export const PANTRY_HAVE = ["yes", "low", "out"] as const;
export type PantryHave = (typeof PANTRY_HAVE)[number];
export interface PantryAnswer { ingredient_id: string; have?: PantryHave }
export interface AppliedAnswer { ingredient_id: string; name: string; have: PantryHave; grocery_id: string | null }

const LEVEL_FOR: Record<PantryHave, (typeof PANTRY_LEVELS)[number]> = { yes: "plenty", low: "low", out: "out" };

/** The body's problem, or null: `items` is a list of { ingredient_id, have? } with have one of yes | low | out. */
export function answerProblem(body: unknown): string | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return "items must be a list of { ingredient_id, have }";
  for (const i of items as { ingredient_id?: unknown; have?: unknown }[]) {
    if (typeof i?.ingredient_id !== "string" || !i.ingredient_id) return "each item needs an ingredient_id";
    if (i.have !== undefined && !(PANTRY_HAVE as readonly string[]).includes(i.have as string)) return "have must be yes, low or out (leave it out for yes)";
  }
  return null;
}

/** Puts a low/out item on the shopping list (a manual row, due by its first upcoming meal, else the next order),
 *  unless an open row for it is already there. Returns the row id, or null when one was already open. */
function listIt(db: Db, ing: { id: string; name: string; category: string | null }, neededBy: string | null, emit?: Emit): string | null {
  const open = db.select({ id: groceries.id }).from(groceries)
    .where(and(eq(groceries.ingredient_id, ing.id), inArray(groceries.status, ["pending", "confirmed"]))).get();
  if (open) return null;
  const row = db.insert(groceries).values({
    item: ing.name, ingredient_id: ing.id, category: ing.category, aisle: AISLE_FOR[ing.category ?? ""] ?? "Other",
    needed_by: neededBy, source: "manual", status: "pending", updated_by: "app",
  }).returning().get() as { id: string };
  emit?.("groceries", row.id, "insert");
  return row.id;
}

/** Applies what the family said about these items (an item with no `have` is a yes). Unknown ingredient ids are
 *  returned, not applied. Each low/out answer that lists an item is logged as an owner's item_added choice. */
export function answerPantry(db: Db, settings: SettingsReader, answers: PantryAnswer[], now = new Date(), emit?: Emit): { applied: AppliedAnswer[]; unknown: string[] } {
  const ids = [...new Set(answers.map((a) => a.ingredient_id))];
  const found = new Map((ids.length ? db.select({ id: ingredients.id, name: ingredients.name, category: ingredients.category }).from(ingredients)
    .where(inArray(ingredients.id, ids)).all() as { id: string; name: string; category: string | null }[] : []).map((r) => [r.id, r]));
  const uses = upcomingUses(db, now, settings.get<number>("plan.horizon_days") ?? 7);
  const applied: AppliedAnswer[] = [];
  const unknown: string[] = [];
  for (const a of answers) {
    const ing = found.get(a.ingredient_id);
    if (!ing) { unknown.push(a.ingredient_id); continue; }
    const have = a.have ?? "yes";
    db.update(ingredients).set({ level: LEVEL_FOR[have], last_checked_at: now.toISOString(), updated_by: "app" }).where(eq(ingredients.id, ing.id)).run();
    emit?.("ingredients", ing.id, "update");
    const groceryId = have === "yes" ? null : listIt(db, ing, uses.get(ing.id)?.[0]?.date ?? null, emit);
    if (groceryId) logChoice(db, { kind: "item_added", subject: ing.id, detail: { item: ing.name, have, grocery_id: groceryId, via: "pantry" }, source: "owner", at: now });
    applied.push({ ingredient_id: ing.id, name: ing.name, have, grocery_id: groceryId });
  }
  return { applied, unknown };
}
