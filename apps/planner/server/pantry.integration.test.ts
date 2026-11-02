// The kitchen (kitchenItems / pantryCheckDue) and the Pantry endpoints against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import * as schema from "./db/schema";
import { kitchenItems, pantryCheckDue, PANTRY_CHECK_MAX, stockFromInStockRows } from "./stock";
import { ensureMealGroceries } from "./mealGroceries";
import { mountPantryRoutes } from "./pantryRoutes";
import { bootKit, defaultSettings } from "./stock.testkit";

const now = new Date(2026, 9, 28, 9, 0);   // Wed Oct 28, 2026 09:00
const at = (local: string) => new Date(local).toISOString();

async function boot() {
  const t = await bootKit();
  mountPantryRoutes(t.hono, t.kit.db, defaultSettings(), undefined, () => now);
  t.family();
  const item = (items: any[], name: string) => items.find((i) => i.name === name);
  const pantry = async () => (await t.call("GET", "/api/pantry")).body;
  const flat = (view: any) => view.groups.flatMap((g: any) => g.items);
  return { ...t, item, pantry, flat };
}

describe("kitchenItems", () => {
  it("bought fresh food, assumed long-shelf-life food the plan uses, and nothing for fresh food nobody has", async () => {
    const t = await boot();
    const paneer = t.ingredient("Paneer", "dairy", { default_unit: "g", shelf_life_days: 4 });
    const dal = t.ingredient("Toor dal", "pulses", { default_unit: "g" });
    const coriander = t.ingredient("Coriander", "leafy_greens");
    const r = t.recipe("Dal", [[dal.id, 60, "g", "pulses"], [coriander.id, 10, "g", "leafy_greens"]]);
    t.meal("2026-10-29", "Dinner", r.id);
    t.insert(schema.stock, { ingredient_id: paneer.id, item: "Paneer", qty: 200, unit: "g", bought_at: at("2026-10-27T18:00"), source: "order" });

    const items = kitchenItems(t.kit.db, now, defaultSettings());
    expect(t.item(items, "Paneer")).toMatchObject({ status: "bought", since: "2026-10-27" });
    expect(t.item(items, "Toor dal")).toMatchObject({ status: "assumed", since: null, for_meals: [{ dish: "Dinner 2026-10-29", slot: "Dinner" }] });
    expect(t.item(items, "Coriander")).toBeUndefined();
  });

  it("a lot the cooked meals used up, or one past its use-by, is no longer in the kitchen", async () => {
    const t = await boot();
    const curd = t.ingredient("Curd", "dairy", { default_unit: "g", shelf_life_days: 4 });
    const milk = t.ingredient("Milk", "dairy", { default_unit: "ml", shelf_life_days: 2 });
    const r = t.recipe("Raita", [[curd.id, 200, "g", "dairy"]]);
    t.meal("2026-10-27", "Lunch", r.id, { outcome: "cooked", outcome_source: "owner" });
    t.insert(schema.stock, { ingredient_id: curd.id, item: "Curd", qty: 200, unit: "g", bought_at: at("2026-10-26T18:00"), source: "order" });
    t.insert(schema.stock, { ingredient_id: milk.id, item: "Milk", qty: 1, unit: "l", bought_at: at("2026-10-24T07:00"), source: "order" });

    const items = kitchenItems(t.kit.db, now, defaultSettings());
    expect(items.map((i) => i.name)).toEqual([]);
  });
});

describe("pantryCheckDue", () => {
  it("items the coming meals use first (soonest meal first), then the rest by staleness, capped small", async () => {
    const t = await boot();
    const r1 = t.recipe("Rajma", [[t.ingredient("Rajma", "pulses").id, 80, "g", "pulses"]]);
    const r2 = t.recipe("Poha", [[t.ingredient("Poha", "grains").id, 60, "g", "grains"]]);
    t.meal("2026-10-30", "Dinner", r1.id);
    t.meal("2026-10-29", "Breakfast", r2.id);
    for (const name of ["Hing", "Haldi", "Jeera", "Rai", "Ajwain"]) {
      t.ingredient(name, "spices");
      t.insert(schema.staples, { item: name, category: "spices" });
    }

    const due = pantryCheckDue(t.kit.db, now);
    expect(due).toHaveLength(PANTRY_CHECK_MAX);
    expect(due.slice(0, 2).map((d) => [d.name, d.for_meals])).toEqual([["Poha", ["Breakfast 2026-10-29 (Thu breakfast)"]], ["Rajma", ["Dinner 2026-10-30 (Fri dinner)"]]]);
  });

  it("an item checked recently waits for its cadence; a fresh purchase is due after a few days", async () => {
    const t = await boot();
    t.ingredient("Hing", "spices", { last_checked_at: at("2026-10-20T10:00"), level: "plenty" });
    t.insert(schema.staples, { item: "Hing", category: "spices" });
    const tomato = t.ingredient("Tomato", "vegetables", { shelf_life_days: 6 });
    t.insert(schema.stock, { ingredient_id: tomato.id, item: "Tomato", qty: 1, unit: "kg", bought_at: at("2026-10-27T10:00"), source: "order" });
    expect(pantryCheckDue(t.kit.db, now)).toEqual([]);

    const later = new Date(2026, 9, 30, 9, 0);
    expect(pantryCheckDue(t.kit.db, later).map((d) => d.name)).toEqual(["Tomato"]);
  });
});

describe("GET /api/pantry", () => {
  it("groups the kitchen by kind and lists what is due", async () => {
    const t = await boot();
    const paneer = t.ingredient("Paneer", "dairy", { default_unit: "g", shelf_life_days: 4 });
    t.insert(schema.stock, { ingredient_id: paneer.id, item: "Paneer", qty: 200, unit: "g", bought_at: at("2026-10-27T18:00"), source: "owner" });
    t.ingredient("Hing", "spices");
    t.insert(schema.staples, { item: "Hing", category: "spices" });

    const view = await t.pantry();
    expect(view.groups.map((g: any) => g.kind)).toEqual(["Dairy", "Spices"]);
    expect(view.groups[0].items[0]).toMatchObject({ name: "Paneer", status: "have", since: "2026-10-27" });
    expect(view.due.map((d: any) => d.name)).toEqual(["Hing"]);
  });

  it("first infers that meals surely over were cooked, so their share is drawn", async () => {
    const t = await boot();
    const curd = t.ingredient("Curd", "dairy", { default_unit: "g", shelf_life_days: 4 });
    const r = t.recipe("Raita", [[curd.id, 200, "g", "dairy"]]);
    const yesterday = t.meal("2026-10-27", "Dinner", r.id);
    t.insert(schema.stock, { ingredient_id: curd.id, item: "Curd", qty: 200, unit: "g", bought_at: at("2026-10-27T08:00"), source: "order" });

    expect(t.flat(await t.pantry())).toEqual([]);
    expect(t.all(schema.meals).find((m) => m.id === yesterday.id)).toMatchObject({ outcome: "cooked", outcome_source: "inferred" });
  });
});

describe("POST /api/pantry/answer", () => {
  const setup = async () => {
    const t = await boot();
    const hing = t.ingredient("Hing", "spices");
    const dal = t.ingredient("Toor dal", "pulses");
    const r = t.recipe("Dal tadka", [[dal.id, 60, "g", "pulses"], [hing.id, 1, "g", "spices"]]);
    t.meal("2026-10-30", "Dinner", r.id);
    return { ...t, hing, dal };
  };

  it("yes (or no answer) → checked today, nothing listed, no longer due", async () => {
    const t = await setup();
    const res = await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: t.dal.id, have: "yes" }, { ingredient_id: t.hing.id }] });
    expect(res.status).toBe(200);
    expect(res.body.applied.map((a: any) => [a.name, a.have, a.grocery_id])).toEqual([["Toor dal", "yes", null], ["Hing", "yes", null]]);
    expect(t.all(schema.ingredients).find((i) => i.id === t.dal.id)).toMatchObject({ level: "plenty", last_checked_at: now.toISOString() });
    expect(t.item(t.flat(res.body.pantry), "Toor dal")).toMatchObject({ status: "checked", since: "2026-10-28" });
    expect(res.body.pantry.due).toEqual([]);
    expect(t.all(schema.groceries)).toEqual([]);
  });

  it("out → a manual row on the shopping list (by the first meal that needs it), logged as the owner's add, never twice", async () => {
    const t = await setup();
    const res = await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: t.hing.id, have: "out" }] });
    const rows = t.all(schema.groceries).filter((g) => g.ingredient_id === t.hing.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item: "Hing", source: "manual", status: "pending", category: "spices", aisle: "Spices", needed_by: "2026-10-30" });
    expect(res.body.applied[0].grocery_id).toBe(rows[0].id);
    expect(t.item(t.flat(res.body.pantry), "Hing")).toMatchObject({ status: "out", since: "2026-10-28" });
    expect(t.all(schema.choice_log).map((c) => [c.kind, c.subject, c.source])).toEqual([["item_added", t.hing.id, "owner"]]);

    await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: t.hing.id, have: "low" }] });
    expect(t.all(schema.groceries).filter((g) => g.ingredient_id === t.hing.id)).toHaveLength(1);
    expect(t.all(schema.choice_log)).toHaveLength(1);
  });

  it("low on an item no meal needs goes on the next order (no date of its own)", async () => {
    const t = await setup();
    const atta = t.ingredient("Atta", "grains");
    await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: atta.id, have: "low" }] });
    expect(t.all(schema.groceries).find((g) => g.ingredient_id === atta.id)).toMatchObject({ needed_by: null, status: "pending" });
  });

  it("returns unknown ids and rejects a malformed body", async () => {
    const t = await setup();
    const res = await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: "nope", have: "yes" }] });
    expect(res.body).toMatchObject({ ok: true, applied: [], unknown: ["nope"] });
    expect((await t.call("POST", "/api/pantry/answer", { items: [{ ingredient_id: t.hing.id, have: "maybe" }] })).status).toBe(400);
    expect((await t.call("POST", "/api/pantry/answer", { nope: true })).status).toBe(400);
  });
});

describe("stockFromInStockRows", () => {
  it("'already have it until' on one row covers that ingredient for every meal until the date, and survives the row", async () => {
    const { kit, insert, all, family, ingredient, recipe, meal } = await bootKit();
    family();
    const coriander = ingredient("Coriander", "vegetables", { default_unit: "g" });
    const chutney = recipe("Chutney", [[coriander.id, 10, "g", "vegetables"]]);
    for (const d of ["2026-10-30", "2026-11-02", "2026-11-03"]) meal(d, "Breakfast", chutney.id);
    const now = new Date(2026, 9, 30, 8, 0);
    const open = () => all(schema.groceries).filter((g) => g.status === "pending" && !g.in_stock_until).length;
    ensureMealGroceries(kit.db, 7, now);
    expect(open()).toBe(3);
    insert(schema.groceries, { item: "Coriander", ingredient_id: coriander.id, status: "pending", source: "manual", in_stock_until: "2026-11-12" });
    expect(stockFromInStockRows(kit.db, now)).toBe(1);
    expect(stockFromInStockRows(kit.db, now)).toBe(0);                                     // idempotent
    ensureMealGroceries(kit.db, 7, now);
    expect(open()).toBe(0);
  });
});
