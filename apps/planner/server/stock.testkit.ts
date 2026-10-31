// Shared setup for the stock / pantry / meal-outcome tests: a real in-memory kit database, an HTTP caller and
// a settings reader holding the declared defaults.
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";

export const defaultSettings = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = { ...Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])), ...over };
  return { get: <T,>(k: string) => values[k] as T };
};

export async function bootKit() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-stock-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const insert = <T extends Record<string, unknown>>(table: any, values: T) => kit.db.insert(table).values(values).returning().get() as T & { id: string };
  const all = (table: any) => kit.db.select().from(table).all() as any[];
  /** One diner, so the family's portion is 1 adult. */
  const family = () => insert(schema.diners, { name: "Family" });
  const ingredient = (name: string, category: string, extra: Record<string, unknown> = {}) => insert(schema.ingredients, { name, category, ...extra });
  /** A recipe with one line per [ingredient id, qty per adult, unit, category]. */
  const recipe = (name: string, lines: [string, number, string | null, string][]) => {
    const r = insert(schema.recipes, { name });
    for (const [ingredient_id, qty, unit, category] of lines) insert(schema.recipe_ingredients, { recipe_id: r.id, ingredient_id, item: name, qty, unit, category });
    return r;
  };
  const meal = (date: string, slot: string, recipeId: string | null, extra: Record<string, unknown> = {}) =>
    insert(schema.meals, { date, slot, dish: `${slot} ${date}`, recipe_id: recipeId, ...extra });
  return { kit, hono, call, insert, all, family, ingredient, recipe, meal };
}
