// ensureRecipeForMeal / relinkLegacyMeals against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { ensureRecipeForMeal, relinkLegacyMeals } from "./recipeStubs";

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-recipes-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { kit, call };
}

describe("ensureRecipeForMeal", () => {
  it("never creates a recipe: a dish with no same-named recipe stays unlinked for the agent", async () => {
    const { kit, call } = await boot();
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Dinner", dish: "Paneer bhurji" })).body.row;
    ensureRecipeForMeal(kit.db, meal.id);
    const after = (await call("GET", `/api/_data/meals/${meal.id}`)).body.row;
    expect(after.recipe_id).toBeNull();
    expect(after.recipe_dish).toBe("Paneer bhurji");
    expect((await call("GET", "/api/_data/recipes?limit=50")).body.rows).toHaveLength(0);
  });

  it("links to an existing recipe of the same name (case-insensitive) rather than making a new one", async () => {
    const { kit, call } = await boot();
    const existing = (await call("POST", "/api/_data/recipes", { name: "Rajma chawal" })).body.row;
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "rajma chawal" })).body.row;
    ensureRecipeForMeal(kit.db, meal.id);
    const after = (await call("GET", `/api/_data/meals/${meal.id}`)).body.row;
    expect(after.recipe_id).toBe(existing.id);
    const recipes = (await call("GET", "/api/_data/recipes?limit=50")).body.rows;
    expect(recipes).toHaveLength(1);
  });

  it("leaves a meal already linked to a recipe alone, even to a differently-named one", async () => {
    const { kit, call } = await boot();
    const other = (await call("POST", "/api/_data/recipes", { name: "Something else" })).body.row;
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar" })).body.row;
    await call("PATCH", `/api/_data/meals/${meal.id}`, { recipe_id: other.id });
    ensureRecipeForMeal(kit.db, meal.id);
    const after = (await call("GET", `/api/_data/meals/${meal.id}`)).body.row;
    expect(after.recipe_id).toBe(other.id);
  });

  it("re-links when the dish is edited to something its recipe doesn't describe (Kaddu sabzi → Poori aloo sabzi)", async () => {
    const { kit, call } = await boot();
    const poori = (await call("POST", "/api/_data/recipes", { name: "Poori aloo sabzi" })).body.row;
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Kaddu sabzi" })).body.row;
    ensureRecipeForMeal(kit.db, meal.id);
    await call("PATCH", `/api/_data/meals/${meal.id}`, { dish: "Poori aloo sabzi" });
    ensureRecipeForMeal(kit.db, meal.id);
    expect((await call("GET", `/api/_data/meals/${meal.id}`)).body.row.recipe_id).toBe(poori.id);
  });

  it("keeps the link through a cosmetic dish edit (emoji, '+ chutney')", async () => {
    const { kit, call } = await boot();
    const idli = (await call("POST", "/api/_data/recipes", { name: "Idli" })).body.row;
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-11-01", slot: "Breakfast", dish: "Idli" })).body.row;
    ensureRecipeForMeal(kit.db, meal.id);
    await call("PATCH", `/api/_data/meals/${meal.id}`, { dish: "Idli + chutney 🫓" });
    ensureRecipeForMeal(kit.db, meal.id);
    expect((await call("GET", `/api/_data/meals/${meal.id}`)).body.row.recipe_id).toBe(idli.id);
    expect((await call("GET", "/api/_data/recipes?limit=50")).body.rows).toHaveLength(1);
  });

  it("boot unlinks an upcoming legacy row whose recipe doesn't fit its dish, stamps the rest, skips past meals", async () => {
    const { kit, call } = await boot();
    const kaddu = (await call("POST", "/api/_data/recipes", { name: "Kaddu sabzi" })).body.row;
    const dosa = (await call("POST", "/api/_data/recipes", { name: "Dosa" })).body.row;
    const stale = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Lunch", dish: "Rajma chawal", recipe_id: kaddu.id })).body.row;
    const fine = (await call("POST", "/api/_data/meals", { date: "2026-11-02", slot: "Breakfast", dish: "Dosa 🫓", recipe_id: dosa.id })).body.row;
    const past = (await call("POST", "/api/_data/meals", { date: "2026-10-01", slot: "Lunch", dish: "Old dish" })).body.row;
    relinkLegacyMeals(kit.db, "2026-10-29");
    expect((await call("GET", `/api/_data/meals/${stale.id}`)).body.row.recipe_id).toBeNull();     // left for the agent
    expect((await call("GET", `/api/_data/meals/${past.id}`)).body.row.recipe_dish).toBeNull();    // history: untouched
    expect((await call("GET", "/api/_data/recipes?limit=50")).body.rows).toHaveLength(2);
    const f = (await call("GET", `/api/_data/meals/${fine.id}`)).body.row;
    expect(f.recipe_id).toBe(dosa.id);
    expect(f.recipe_dish).toBe("Dosa 🫓");
  });

  it("is a no-op for a meal id that doesn't exist", async () => {
    const { kit, call } = await boot();
    ensureRecipeForMeal(kit.db, "not-a-real-id");
    expect((await call("GET", "/api/_data/recipes?limit=50")).body.rows).toHaveLength(0);
  });
});

describe("the kit event subscription (index.ts's own wiring)", () => {
  it("fires on a plain /api/_data/meals write, with no direct call needed", async () => {
    const { kit, call } = await boot();
    kit.ctx.events.subscribe((e) => {
      if (e.table === "meals" && (e.op === "insert" || e.op === "update")) ensureRecipeForMeal(kit.db, e.id, (table, id, op) => kit.emitChange(table, id, op, "app"));
    });
    const pesarattu = (await call("POST", "/api/_data/recipes", { name: "Pesarattu" })).body.row;
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Breakfast", dish: "pesarattu" })).body.row;
    const after = (await call("GET", `/api/_data/meals/${meal.id}`)).body.row;
    expect(after.recipe_id).toBe(pesarattu.id);
  });
});
