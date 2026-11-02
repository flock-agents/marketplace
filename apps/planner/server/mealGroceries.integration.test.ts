// ensureMealGroceries / mealGroceriesAwaitingQty against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { ensureMealGroceries, mealGroceriesAwaitingQty } from "./mealGroceries";
import { bootKit } from "./stock.testkit";

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-meal-groc-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** A recipe with one structured ingredient, already linked to the catalog — the normal, post-correction shape. */
  const recipeWithIngredient = async (recipeName: string, item: string, category: string, qty: number, unit: string | null) => {
    const recipe = (await call("POST", "/api/_data/recipes", { name: recipeName })).body.row;
    const ingredient = (await call("POST", "/api/_data/ingredients", { name: item, category, default_unit: unit })).body.row;
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: recipe.id, ingredient_id: ingredient.id, item, qty, unit, category });
    return { recipe, ingredient };
  };
  return { kit, call, recipeWithIngredient };
}

const now = new Date(2026, 9, 28, 9, 0);   // Oct 28, 2026

describe("ensureMealGroceries", () => {
  it("creates a dairy/vegetables grocery row, ingredient_id set, qty left null (suggested_qty holds the draft)", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    await call("POST", "/api/_data/diners", { name: "Family" });
    const { recipe, ingredient } = await recipeWithIngredient("Sambar", "Drumsticks", "vegetables", 2, null);
    const meal = (await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id })).body.row;

    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    const row = rows.find((r) => r.item === "Drumsticks");
    expect(row).toBeTruthy();
    expect(row.source).toBe("meal");
    expect(row.ingredient_id).toBe(ingredient.id);
    expect(row.qty).toBeNull();
    expect(row.suggested_qty).toBeTruthy();
    expect(row.for_dish).toBe("Sambar");
    expect(row.needed_by).toBe("2026-10-29");
    expect(row.meal_id).toBe(meal.id);
    expect(row.qty_min).toBe(2);
    expect(row.qty_unit).toBe("pc");
  });

  it("never creates a grocery row for a pantry-category ingredient — that's the pantry check's job", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    const { recipe } = await recipeWithIngredient("Rajma chawal", "Rajma", "pantry", 1, "cup");
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Rajma chawal", recipe_id: recipe.id });

    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows.some((r) => r.item === "Rajma")).toBe(false);
  });

  it("skips a recipe_ingredients row with no ingredient_id yet — nothing to key the dedup or the grocery row on", async () => {
    const { kit, call } = await boot();
    const recipe = (await call("POST", "/api/_data/recipes", { name: "Sambar" })).body.row;
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: recipe.id, item: "Drumsticks", qty: 2, unit: null, category: "vegetables" });   // no ingredient_id
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id });

    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows.some((r) => r.item === "Drumsticks")).toBe(false);
  });

  it("is idempotent: calling it twice never duplicates the same (ingredient_id, needed_by)", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    const { recipe } = await recipeWithIngredient("Sambar", "Drumsticks", "vegetables", 2, null);
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id });

    ensureMealGroceries(kit.db, 7, now);
    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows.filter((r) => r.item === "Drumsticks")).toHaveLength(1);
  });

  it("keys rows by (meal_id, ingredient_id): two dishes phrasing the same ingredient differently get one row each, both on the catalog id", async () => {
    const { kit, call } = await boot();
    const ingredient = (await call("POST", "/api/_data/ingredients", { name: "Onion", category: "vegetables" })).body.row;
    const r1 = (await call("POST", "/api/_data/recipes", { name: "Sambar" })).body.row;
    const r2 = (await call("POST", "/api/_data/recipes", { name: "Bhindi fry" })).body.row;
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: r1.id, ingredient_id: ingredient.id, item: "Onion", qty: 0.5, unit: "cup", category: "vegetables" });
    await call("POST", "/api/_data/recipe_ingredients", { recipe_id: r2.id, ingredient_id: ingredient.id, item: "Onions, chopped", qty: 0.25, unit: "cup", category: "vegetables" });
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: r1.id });
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Dinner", dish: "Bhindi fry", recipe_id: r2.id });

    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    const onionRows = rows.filter((r) => r.ingredient_id === ingredient.id);
    expect(onionRows).toHaveLength(2);
    expect(onionRows.map((r) => r.for_dish).sort()).toEqual(["Bhindi fry", "Sambar"]);
    expect(new Set(onionRows.map((r) => r.meal_id)).size).toBe(2);
  });

  it("skips generating a row when the ingredient's last purchase should still cover its estimated daily draw", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    await call("POST", "/api/_data/diners", { name: "Family" });   // familyMultiplier needs at least one diner to be non-zero
    const { recipe, ingredient } = await recipeWithIngredient("Sambar", "Toor dal", "vegetables", 100, "g");
    await call("PATCH", `/api/_data/ingredients/${ingredient.id}`, { last_ordered_at: "2026-10-27T00:00:00.000Z", last_ordered_qty: 1000 });
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id });

    ensureMealGroceries(kit.db, 7, now);   // 100g over 7 days ≈ 14g/day; 1000g bought yesterday covers ~71 days
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows.some((r) => r.ingredient_id === ingredient.id)).toBe(false);
  });

  it("leaves an existing manual row alone and still adds the meal-driven one alongside it", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Drumsticks", source: "manual", status: "pending" });
    const { recipe } = await recipeWithIngredient("Sambar", "Drumsticks", "vegetables", 2, null);
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id });

    ensureMealGroceries(kit.db, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows.filter((r) => r.item === "Drumsticks")).toHaveLength(2);
    expect(rows.some((r) => r.item === "Drumsticks" && r.source === "manual")).toBe(true);
    expect(rows.some((r) => r.item === "Drumsticks" && r.source === "meal")).toBe(true);
  });
});

describe("mealGroceriesAwaitingQty", () => {
  it("lists a meal-driven row still waiting on a reviewed qty, and stops once one is set", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    const { recipe } = await recipeWithIngredient("Sambar", "Drumsticks", "vegetables", 2, null);
    await call("POST", "/api/_data/meals", { date: "2026-10-29", slot: "Lunch", dish: "Sambar", recipe_id: recipe.id });
    ensureMealGroceries(kit.db, 7, now);

    const before = mealGroceriesAwaitingQty(kit.db);
    expect(before).toHaveLength(1);
    expect(before[0].item).toBe("Drumsticks");

    await call("PATCH", `/api/_data/groceries/${before[0].id}`, { qty: "250 g" });
    expect(mealGroceriesAwaitingQty(kit.db)).toHaveLength(0);
  });
});

describe("purchases recorded as ordered grocery rows", () => {
  it("an onion bought yesterday (an ordered row, nothing stamped on the ingredient) still covers this week's meals", async () => {
    const { kit, call, recipeWithIngredient } = await boot();
    await call("POST", "/api/_data/diners", { name: "Family" });
    const { recipe, ingredient } = await recipeWithIngredient("Poha", "Onion", "vegetables", 50, "g");
    for (const date of ["2026-10-28", "2026-10-29", "2026-10-30"]) await call("POST", "/api/_data/meals", { date, slot: "Breakfast", dish: "Poha", recipe_id: recipe.id });
    const items = () => (kit.db.select().from(schema.groceries).all() as { source: string; status: string }[]).filter((g) => g.source === "meal" && g.status === "pending");
    ensureMealGroceries(kit.db, 3, now);
    expect(items().length).toBeGreaterThan(0);
    await call("POST", "/api/_data/groceries", { item: "Onion", ingredient_id: ingredient.id, qty: "570 g", status: "ordered", source: "manual" });
    ensureMealGroceries(kit.db, 3, now);
    expect(items()).toHaveLength(0);
  });
});

describe("chronological stock coverage", () => {
  const rowsFor = (kit: any, ingredientId: string) =>
    (kit.db.select().from(schema.groceries).all() as any[]).filter((g) => g.ingredient_id === ingredientId && g.source === "meal").map((g) => g.needed_by).sort();

  it("stock covers the earliest meals in turn; the first meal it can't cover, and every later one, keep their rows", async () => {
    const t = await bootKit();
    t.family();
    const paneer = t.ingredient("Paneer", "dairy", { default_unit: "g", shelf_life_days: 7 });
    const r = t.recipe("Paneer bhurji", [[paneer.id, 200, "g", "dairy"]]);
    for (const date of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) t.meal(date, "Dinner", r.id);
    t.insert(schema.stock, { ingredient_id: paneer.id, item: "Paneer", qty: 500, unit: "g", bought_at: "2026-10-27T12:00:00.000Z", source: "owner" });

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, paneer.id)).toEqual(["2026-10-30", "2026-10-31"]);   // 500 g: Wed + Thu (400 g); Fri's 200 g isn't there
  });

  it("a purchase past its use-by on a meal's day covers nothing from then on", async () => {
    const t = await bootKit();
    t.family();
    const spinach = t.ingredient("Spinach", "vegetables", { default_unit: "g", shelf_life_days: 2 });
    const r = t.recipe("Palak dal", [[spinach.id, 100, "g", "vegetables"]]);
    t.meal("2026-10-28", "Dinner", r.id);
    t.meal("2026-11-01", "Dinner", r.id);
    t.insert(schema.groceries, { item: "Spinach", ingredient_id: spinach.id, qty: "1 kg", status: "ordered", source: "manual", updated_at: now.toISOString() });

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, spinach.id)).toEqual(["2026-11-01"]);
  });

  it("what a cooked meal drew is gone: the rest covers less", async () => {
    const t = await bootKit();
    t.family();
    const curd = t.ingredient("Curd", "dairy", { default_unit: "g", shelf_life_days: 5 });
    const r = t.recipe("Raita", [[curd.id, 200, "g", "dairy"]]);
    t.meal("2026-10-27", "Dinner", r.id, { outcome: "cooked", outcome_source: "inferred" });
    t.meal("2026-10-28", "Dinner", r.id);
    t.insert(schema.stock, { ingredient_id: curd.id, item: "Curd", qty: 300, unit: "g", bought_at: "2026-10-27T03:00:00.000Z", source: "order" });

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, curd.id)).toEqual(["2026-10-28"]);   // 300 g − Tue's 200 g leaves 100 g for Wed's 200 g
  });

  it("standing consumption draws every day too", async () => {
    const t = await bootKit();
    const kid = t.family();
    const milk = t.ingredient("Milk", "dairy", { default_unit: "ml", shelf_life_days: 4 });
    const r = t.recipe("Kheer", [[milk.id, 100, "ml", "dairy"]]);
    t.meal("2026-10-28", "Dinner", r.id);
    t.meal("2026-10-30", "Dinner", r.id);
    t.insert(schema.standing_consumption, { diner_id: kid.id, ingredient_id: milk.id, qty: 2, unit: "glass", times_per_week: 7 });
    t.insert(schema.stock, { ingredient_id: milk.id, item: "Milk", qty: 1, unit: "l", bought_at: "2026-10-28T01:00:00.000Z", source: "order" });

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, milk.id)).toEqual(["2026-10-30"]);   // 1 l − Wed 100 ml − Thu 500 ml − Fri 500 ml: Fri's kheer isn't covered
  });

  it("an 'out' answer after the purchase writes the stock off", async () => {
    const t = await bootKit();
    t.family();
    const onion = t.ingredient("Onion", "vegetables", { default_unit: "g", shelf_life_days: 21 });
    const r = t.recipe("Poha", [[onion.id, 50, "g", "vegetables"]]);
    t.meal("2026-10-29", "Breakfast", r.id);
    t.insert(schema.stock, { ingredient_id: onion.id, item: "Onion", qty: 1000, unit: "g", bought_at: "2026-10-26T03:00:00.000Z", source: "order" });
    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, onion.id)).toEqual([]);

    t.kit.db.update(schema.ingredients).set({ level: "out", last_checked_at: "2026-10-28T02:00:00.000Z" }).run();
    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, onion.id)).toEqual(["2026-10-29"]);
  });

  it("'have it' with no amount covers every meal until its use-by", async () => {
    const t = await bootKit();
    t.family();
    const tomato = t.ingredient("Tomato", "vegetables", { default_unit: "g", shelf_life_days: 4 });
    const r = t.recipe("Sambar", [[tomato.id, 100, "g", "vegetables"]]);
    t.meal("2026-10-29", "Lunch", r.id);
    t.meal("2026-11-03", "Lunch", r.id);
    t.insert(schema.stock, { ingredient_id: tomato.id, item: "Tomato", bought_at: "2026-10-28T02:00:00.000Z", source: "owner" });

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, tomato.id)).toEqual(["2026-11-03"]);
  });

  it("a meal with an outcome (cooked or skipped) needs nothing more", async () => {
    const t = await bootKit();
    t.family();
    const okra = t.ingredient("Okra", "vegetables", { default_unit: "g" });
    const r = t.recipe("Bhindi fry", [[okra.id, 150, "g", "vegetables"]]);
    t.meal("2026-10-28", "Dinner", r.id, { outcome: "skipped", outcome_source: "owner" });
    t.meal("2026-10-29", "Lunch", r.id, { outcome: "cooked", outcome_source: "owner" });
    t.meal("2026-10-30", "Lunch", r.id);

    ensureMealGroceries(t.kit.db, 7, now);
    expect(rowsFor(t.kit, okra.id)).toEqual(["2026-10-30"]);
  });
});
