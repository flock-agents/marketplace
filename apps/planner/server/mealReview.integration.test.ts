// A meal = a set of recipes + a note: the review job end to end against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { ensureMealGroceries } from "./mealGroceries";
import { setMealRecipes, syncMealRecipes, recipeSets } from "./mealRecipes";
import { queueMealReview } from "./mealReview";
import { mountJobRoutes } from "./jobRoutes";

const now = new Date(2026, 9, 29, 18, 0);   // Oct 29, 2026, evening

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-review-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  mountJobRoutes(hono, kit.db, undefined, undefined, () => now);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  await call("POST", "/api/_data/diners", { name: "Family" });
  const pumpkin = (await call("POST", "/api/_data/ingredients", { name: "Pumpkin", category: "vegetables", default_unit: "g" })).body.row;
  const potato = (await call("POST", "/api/_data/ingredients", { name: "Potato", category: "vegetables", default_unit: "g" })).body.row;
  const recipe = async (name: string, ingredientId: string, item: string) => {
    const r = (await call("POST", "/api/_data/recipes", { name })).body.row;
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: r.id, ingredient_id: ingredientId, item, qty: 150, unit: "g", category: "vegetables" });
    return r;
  };
  const kaddu = await recipe("Kaddu sabzi", pumpkin.id, "Pumpkin");
  const aloo = await recipe("Puri aloo sabzi", potato.id, "Potato");
  const items = () => (kit.db.select().from(schema.groceries).all() as { item: string; source: string }[]).filter((g) => g.source === "meal").map((g) => g.item).sort();
  return { kit, call, kaddu, aloo, pumpkin, potato, items };
}

describe("meal recipe sets", () => {
  it("backfills the set from recipe_id, and a single-recipe write replaces the first recipe", async () => {
    const { kit, call, kaddu, aloo } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Kaddu sabzi", recipe_id: kaddu.id })).body.row;
    syncMealRecipes(kit.db, meal.id);
    expect(recipeSets(kit.db, [meal.id]).get(meal.id)).toEqual([{ recipe_id: kaddu.id, servings: 1 }]);
    await call("PATCH", `/api/_data/meals/${meal.id}`, { recipe_id: aloo.id });
    syncMealRecipes(kit.db, meal.id);
    expect(recipeSets(kit.db, [meal.id]).get(meal.id)).toEqual([{ recipe_id: aloo.id, servings: 1 }]);
  });
});

describe("review_meal", () => {
  it("a meal with no recipe asks the agent to link or create one; the answer must give recipes", async () => {
    const { kit, call, aloo, items } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Poori aloo sabzi" })).body.row;
    const jobId = queueMealReview(kit.db, meal.id, now)!;
    expect(jobId).toBeTruthy();
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { adjustments: [] })).status).toBe(400);
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { recipes: [{ recipe_id: aloo.id }], adjustments: [] })).status).toBe(200);
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual(["Potato"]);
  });

  it("is not queued for a plain meal whose recipe fits its dish", async () => {
    const { kit, call, kaddu } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Kaddu sabzi", recipe_id: kaddu.id })).body.row;
    syncMealRecipes(kit.db, meal.id);
    expect(queueMealReview(kit.db, meal.id, now)).toBeNull();
  });

  it("a note queues one review; the answer drops items and the shopping list follows", async () => {
    const { kit, call, aloo, potato, items } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Puri aloo sabzi", recipe_id: aloo.id, note: "leftovers from tonight" })).body.row;
    syncMealRecipes(kit.db, meal.id);
    const jobId = queueMealReview(kit.db, meal.id, now)!;
    expect(queueMealReview(kit.db, meal.id, now)).toBe(jobId);          // one open job per meal state
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual(["Potato"]);                                   // the rough list until the review lands

    const open = (await call("GET", "/api/jobs")).body.jobs;
    expect(open).toHaveLength(1);
    expect(open[0].facts).toMatchObject({ dish: "Puri aloo sabzi", note: "leftovers from tonight" });
    expect(open[0].facts.recipes[0].lines[0]).toMatchObject({ ingredient_id: potato.id, qty_per_adult: 150 });

    const res = await call("POST", `/api/jobs/${jobId}/answer`, { adjustments: [{ ingredient_id: potato.id, action: "drop", reason: "already cooked: leftovers" }] });
    expect(res.status).toBe(200);
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual([]);
    expect(queueMealReview(kit.db, meal.id, now)).toBeNull();             // reviewed for this exact state
  });

  it("a dish that no longer fits its recipe queues a review; the answer can correct the recipe set", async () => {
    const { kit, call, kaddu, aloo, items } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Kaddu sabzi", recipe_id: kaddu.id })).body.row;
    syncMealRecipes(kit.db, meal.id);
    kit.db.update(schema.meals).set({ dish: "Aloo puri" }).run();          // an edit the recipe-link guard didn't catch
    const jobId = queueMealReview(kit.db, meal.id, now)!;
    expect(jobId).toBeTruthy();
    const res = await call("POST", `/api/jobs/${jobId}/answer`, { recipes: [{ recipe_id: aloo.id }], adjustments: [] });
    expect(res.status).toBe(200);
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual(["Potato"]);
  });

  it("refuses unknown ingredients, a stale job, and keeps the rough list when the meal changed after the review", async () => {
    const { kit, call, kaddu, aloo, pumpkin, items } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Kaddu sabzi", recipe_id: kaddu.id, note: "half portion" })).body.row;
    syncMealRecipes(kit.db, meal.id);
    const jobId = queueMealReview(kit.db, meal.id, now)!;
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { adjustments: [{ ingredient_id: "nope", action: "drop", reason: "x" }] })).status).toBe(400);
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { adjustments: [{ ingredient_id: pumpkin.id, action: "scale", factor: 0.5 }] })).status).toBe(400);   // no reason

    setMealRecipes(kit.db, meal.id, [{ recipe_id: aloo.id, servings: 1 }]);                       // changed while the job was open
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { adjustments: [] })).status).toBe(409);
    const next = queueMealReview(kit.db, meal.id, now)!;
    expect(next).not.toBe(jobId);
    expect((await call("POST", `/api/jobs/${next}/answer`, { adjustments: [{ ingredient_id: pumpkin.id, action: "add", qty: 100, unit: "g", reason: "the note asks for some kaddu too" }] })).status).toBe(200);
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual(["Potato", "Pumpkin"]);

    await call("PATCH", `/api/_data/meals/${meal.id}`, { note: "full portion after all" });         // review now stale → rough list
    ensureMealGroceries(kit.db, 7, now);
    expect(items()).toEqual(["Potato"]);
  });
});
