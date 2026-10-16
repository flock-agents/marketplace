import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";

async function boot(importFile?: unknown) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-schema-"));
  if (importFile) { mkdirSync(join(dataDir, ".flock"), { recursive: true }); writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(importFile)); }
  await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, seed, dbFile: ":memory:", appName: "T" });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { call };
}
const columns = (s: any, table: string) => (s.tables[table].columns as { name: string }[]).map((c) => c.name);

describe("planner data, as agents see it", () => {
  it("lists meals, recipes and groceries in /_schema; a meal is a dish only, linked to a recipe", async () => {
    const { call } = await boot();
    const s = (await call("GET", "/api/_data/_schema")).body;
    expect(Object.keys(s.tables).sort()).toEqual(["groceries", "meals", "recipes"]);
    expect(columns(s, "meals")).toEqual(expect.arrayContaining(["date", "slot", "dish", "recipe_id"]));
    for (const gone of ["tags", "cook", "note"]) expect(columns(s, "meals")).not.toContain(gone);
    expect(columns(s, "recipes")).toEqual(expect.arrayContaining(["name", "ingredients", "method", "notes"]));
    const req = (s.tables.recipes.columns as { name: string; required: boolean }[]).filter((c) => c.required).map((c) => c.name);
    expect(req).toEqual(["name"]);
  });
  it("seeds recipes and links the seed meals to them by id", async () => {
    const { call } = await boot();
    const recipes = (await call("GET", "/api/_data/recipes?limit=50")).body.rows as { id: string; name: string }[];
    const meals = (await call("GET", "/api/_data/meals?limit=500")).body.rows as { dish: string; recipe_id: string | null }[];
    expect(recipes.length).toBeGreaterThanOrEqual(4);
    const linked = meals.filter((m) => m.recipe_id);
    expect(linked.length).toBeGreaterThan(0);
    for (const m of linked) expect(recipes.find((r) => r.id === m.recipe_id)?.name).toBe(m.dish);
    for (const r of recipes) expect(linked.some((m) => m.recipe_id === r.id), r.name).toBe(true);
  });
  it("lets an agent add a recipe with just a name, and refuses one without", async () => {
    const { call } = await boot();
    const ok = await call("POST", "/api/_data/recipes", { name: "Masala dosa" });
    expect(ok.status).toBe(201);
    expect(ok.body.row).toMatchObject({ name: "Masala dosa", ingredients: null, method: null, notes: null });
    expect((await call("POST", "/api/_data/recipes", { ingredients: "Rice" })).status).toBe(400);
  });
  it("Clear samples keeps a sample recipe that one of the owner's meals is planned from", async () => {
    const { call } = await boot();
    const recipes = (await call("GET", "/api/_data/recipes?limit=50")).body.rows as { id: string; name: string }[];
    const used = recipes[0];
    const meal = await call("POST", "/api/_data/meals", { date: "2026-10-12", slot: "Dinner", dish: used.name, recipe_id: used.id });
    expect(meal.status).toBe(201);
    const res = await call("POST", "/api/_data/_samples/clear");
    expect(res.status).toBe(200);
    expect(res.body.kept).toEqual([{ table: "recipes", count: 1, reason: "used by meals" }]);
    const after = (await call("GET", "/api/_data/recipes?limit=50")).body.rows as { id: string }[];
    expect(after.map((r) => r.id)).toEqual([used.id]);
  });
  it("an import can link a new meal to a new recipe with $ref", async () => {
    const { call } = await boot({ importId: "imp-1", by: "agent", rows: {
      recipes: [{ $key: "rajma", name: "Grandma's rajma" }],
      meals: [{ $key: "mon", date: "2026-10-12", slot: "Dinner", dish: "Grandma's rajma", recipe_id: { $ref: "recipes/rajma" } }],
    } });
    const recipes = (await call("GET", "/api/_data/recipes?limit=50")).body.rows as { id: string; name: string }[];
    const meals = (await call("GET", "/api/_data/meals?limit=50")).body.rows as { recipe_id: string }[];
    expect(recipes.map((r) => r.name)).toEqual(["Grandma's rajma"]);
    expect(meals.map((m) => m.recipe_id)).toEqual([recipes[0].id]);
  });
});
