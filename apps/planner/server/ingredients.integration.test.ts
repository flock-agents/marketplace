// resolveIngredient / backfillRecipeIngredientCatalog against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { backfillRecipeIngredientCatalog, resolveIngredient } from "./ingredients";

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-ingredients-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { kit, call };
}

describe("resolveIngredient", () => {
  it("creates a new catalog entry for a genuinely new ingredient", async () => {
    const { kit, call } = await boot();
    const id = resolveIngredient(kit.db, "Capsicum", "vegetables", null);
    const row = (await call("GET", `/api/_data/ingredients/${id}`)).body.row;
    expect(row.name).toBe("Capsicum");
  });

  it("reuses an existing entry for a differently-phrased name, never creating a near-duplicate", async () => {
    const { kit, call } = await boot();
    const first = resolveIngredient(kit.db, "Tomatoes", "vegetables", null);
    const second = resolveIngredient(kit.db, "Fresh tomato", "vegetables", null);
    expect(second).toBe(first);
    expect((await call("GET", "/api/_data/ingredients?limit=50")).body.rows).toHaveLength(1);
  });
});

describe("backfillRecipeIngredientCatalog", () => {
  it("links a plain-text recipe_ingredients row to the catalog, matching an existing entry over creating a new one", async () => {
    const { kit, call } = await boot();
    const existing = (await call("POST", "/api/_data/ingredients", { name: "Onion", category: "vegetables" })).body.row;
    const recipe = (await call("POST", "/api/_data/recipes", { name: "Sambar" })).body.row;
    const ri = (await call("POST", "/api/_data/recipe_ingredients", { recipe_id: recipe.id, item: "Onions", qty: 1, unit: "cup", category: "vegetables" })).body.row;
    expect(ri.ingredient_id).toBeNull();

    backfillRecipeIngredientCatalog(kit.db);
    const after = (await call("GET", `/api/_data/recipe_ingredients/${ri.id}`)).body.row;
    expect(after.ingredient_id).toBe(existing.id);
    expect((await call("GET", "/api/_data/ingredients?limit=50")).body.rows).toHaveLength(1);   // no new entry created
  });

  it("creates a catalog entry when nothing matches yet", async () => {
    const { kit, call } = await boot();
    const recipe = (await call("POST", "/api/_data/recipes", { name: "Rajma chawal" })).body.row;
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: recipe.id, item: "Rajma", qty: 1, unit: "cup", category: "pantry" });

    backfillRecipeIngredientCatalog(kit.db);
    const rows = (await call("GET", "/api/_data/ingredients?limit=50")).body.rows;
    expect(rows.some((r: any) => r.name === "Rajma")).toBe(true);
  });

  it("leaves an already-linked row alone", async () => {
    const { kit, call } = await boot();
    const ingredient = (await call("POST", "/api/_data/ingredients", { name: "Onion" })).body.row;
    const recipe = (await call("POST", "/api/_data/recipes", { name: "Sambar" })).body.row;
    const ri = (await call("POST", "/api/_data/recipe_ingredients", { recipe_id: recipe.id, ingredient_id: ingredient.id, item: "Onion", category: "vegetables" })).body.row;

    backfillRecipeIngredientCatalog(kit.db);
    expect((await call("GET", `/api/_data/recipe_ingredients/${ri.id}`)).body.row.ingredient_id).toBe(ingredient.id);
  });
});
