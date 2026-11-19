// The plan: a week of meals, each made of dishes with their ingredients, as the agent writes it (plan_week, set_meal, set_dish).
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { boot } from "./testkit";
import { mountMealRoutes } from "./meals";

const MON = "2026-11-23";
const lunch = { date: MON, slot: "Lunch", dishes: [
  { name: "Rice", ingredients: [{ item: "rice", amount: 400, unit: "g", keeps: "long" }] },
  { name: "Aloo gobi", ingredients: [{ item: "cauliflower", amount: 1, unit: "pc" }, { item: "potato", amount: 500, unit: "g" }] },
  { name: "Sambar" },
  { name: "Boiled eggs", for: ["me", "wife"], portion_note: "4 for me, 1 for wife", ingredients: [{ item: "eggs", amount: 5, unit: "pc" }] } ] };

/** The meal of a week view at a date and slot. */
const mealOf = (week: any, date: string, slot: string) => week.days.find((d: any) => d.date === date).meals.find((m: any) => m.slot === slot);
const dishNames = (meal: any): string[] => meal.dishes.map((d: any) => d.name);

describe("plan_week", () => {
  it("plan_week with meals writes a draft week of meals with ordered dishes", async () => {
    const { op } = await boot();
    const r = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    const m = r.week.days[0].meals[0];
    expect(m.dishes.map((d: any) => d.name)).toEqual(["Rice", "Aloo gobi", "Sambar", "Boiled eggs"]);
    expect(m.dishes[3]).toMatchObject({ for_people: ["me", "wife"], portion_note: "4 for me, 1 for wife" });
    expect(r.week.status).toBe("draft"); expect(r.orders).toBeUndefined();
  });

  it("the week view has all seven days, each dish's ingredients, and everyone as null", async () => {
    const { op } = await boot();
    const { week } = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    expect(week.week_start).toBe(MON);
    expect(week.days.map((d: any) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.days[1].meals).toEqual([]);
    const m = week.days[0].meals[0];
    expect(m).toMatchObject({ slot: "Lunch", ordered_in: false, note: null });
    expect(m.dishes[0]).toMatchObject({ for_people: null, portion_note: null, recipe_id: null, video_url: null });
    expect(m.dishes[0].ingredients).toMatchObject([{ item: "rice", amount: 400, unit: "g", keeps: "long" }]);
    expect(m.dishes[1].ingredients).toMatchObject([{ item: "cauliflower", amount: 1, unit: "pc", keeps: "fresh" }, { item: "potato", amount: 500, unit: "g", keeps: "fresh" }]);
    expect(m.dishes[2].ingredients).toEqual([]);
  });

  it("plan_week final without meals finalises the draft; on an empty week it returns the context", async () => {
    const { op } = await boot();
    expect((await op("plan_week", { week_start: MON, mode: "final" })).context.week_start).toBe(MON);
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    expect((await op("plan_week", { week_start: MON, mode: "final" })).week.status).toBe("final");
  });

  it("without meals it returns the context for a draft call, and for a week already final", async () => {
    const { op, rows } = await boot();
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    const draft = await op("plan_week", { week_start: MON, mode: "draft" });
    expect(draft.context.week_start).toBe(MON); expect(draft.week).toBeUndefined();
    expect(rows("plan_meals")[0].status).toBe("draft");
    await op("plan_week", { week_start: MON, mode: "final" });
    expect((await op("plan_week", { week_start: MON, mode: "final" })).context.week_start).toBe(MON);
    expect(rows("plan_meals")[0].status).toBe("final");
  });

  it("plan_week refuses a week_start that is not a Monday, and an unknown slot", async () => {
    const { op, rows } = await boot();
    expect((await op("plan_week", { week_start: "2026-11-24", mode: "draft", meals: [lunch] })).code).toBe("APP_REFUSED");
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [{ ...lunch, slot: "Brunch" }] })).code).toBe("APP_REFUSED");
    const tiffin = { date: MON, slot: "Agastya's tiffin", dishes: [{ name: "Lemon rice" }] };
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [tiffin] })).code).toBe("APP_REFUSED");
    expect(rows("plan_meals")).toHaveLength(0);
    await op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }] });
    const r = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, { ...tiffin, slot: "agastya's TIFFIN" }] });
    expect(r.week.days[0].meals.map((m: any) => m.slot)).toEqual(["Lunch", "Agastya's tiffin"]);
  });

  it("refuses a week_start or a mode it cannot read", async () => {
    const { op } = await boot();
    for (const week_start of [undefined, "next week", "2026-02-30", "2026-11-23/x", 20261123])
      expect((await op("plan_week", { week_start, mode: "draft" })).code).toBe("APP_REFUSED");
    for (const mode of [undefined, "done", "Final"])
      expect((await op("plan_week", { week_start: MON, mode, meals: [lunch] })).code).toBe("APP_REFUSED");
  });

  it("refuses meals it cannot write, and writes none of the week when one is wrong", async () => {
    const { op, rows } = await boot();
    const refused = async (meals: unknown) => expect((await op("plan_week", { week_start: MON, mode: "draft", meals })).code).toBe("APP_REFUSED");
    await refused([]);
    await refused("rice and dal");
    await refused([lunch, { date: "2026-11-30", slot: "Lunch", dishes: [{ name: "Rice" }] }]);     // the Monday after
    await refused([lunch, { ...lunch, slot: "lunch" }]);                                             // the same meal twice
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "  " }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: "dal" }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", for: "me" }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ amount: 200, unit: "g" }] }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ item: "toor dal", amount: "a cup" }] }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ item: "toor dal", keeps: "forever" }] }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", recipe_id: "no-such-recipe" }] }]);
    await refused([lunch, { date: MON, slot: "Dinner", ordered_in: "yes" }]);
    for (const t of ["plan_meals", "dishes", "dish_items"]) expect(rows(t)).toHaveLength(0);
  });

  it("an ordered-in meal has no dishes: dishes sent with ordered_in are refused", async () => {
    const { op, rows } = await boot();
    const pizza = { date: "2026-11-29", slot: "Dinner", ordered_in: true, note: "pizza night" };
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [{ ...pizza, dishes: [{ name: "Pizza" }] }] })).code).toBe("APP_REFUSED");
    const r = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, { ...pizza, dishes: [] }] });
    expect(mealOf(r.week, "2026-11-29", "Dinner")).toMatchObject({ ordered_in: true, note: "pizza night", dishes: [] });
    expect(rows("dishes")).toHaveLength(4);
  });

  it("with meals it replaces the week: the old meals, dishes and ingredients go, another week's stay", async () => {
    const { op, rows } = await boot();
    await op("plan_week", { week_start: "2026-11-16", mode: "final", meals: [{ date: "2026-11-18", slot: "Dinner", dishes: [{ name: "Khichdi", ingredients: [{ item: "moong dal", amount: 200, unit: "g" }] }] }] });
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, { date: "2026-11-24", slot: "Breakfast", dishes: [{ name: "Idli" }] }] });
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [{ date: "2026-11-25", slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ item: "toor dal", amount: 200, unit: "g", keeps: "long" }] }, { name: "Roti" }] }] });
    expect(r.week.status).toBe("final");
    expect(r.week.days.flatMap((d: any) => d.meals).map((m: any) => `${m.slot}: ${dishNames(m)}`)).toEqual(["Dinner: Dal,Roti"]);
    expect(rows("plan_meals").map((m) => `${m.date} ${m.status}`).sort()).toEqual(["2026-11-18 final", "2026-11-25 final"]);
    expect(rows("dishes").map((d) => d.name).sort()).toEqual(["Dal", "Khichdi", "Roti"]);
    expect(rows("dish_items").map((i) => i.item).sort()).toEqual(["moong dal", "toor dal"]);
  });

  it("stamps what the agent planned as the agent's", async () => {
    const { op, rows } = await boot();
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    for (const t of ["plan_meals", "dishes", "dish_items"]) expect(rows(t).every((r) => r.updated_by === "agent:meal-agent")).toBe(true);
    await op("plan_week", { week_start: MON, mode: "final" });
    expect(rows("plan_meals")[0]).toMatchObject({ status: "final", updated_by: "agent:meal-agent" });
  });

  it("a final write runs the orders hook and answers with its orders; a draft write does not", async () => {
    const finals: string[] = []; let changed = 0;
    const { op } = await boot({ mealHooks: { onFinal: (w) => { finals.push(w); return [{ id: "o1", covers_from: w }]; }, onChanged: () => { changed++; } } });
    expect((await op("plan_week", { week_start: MON, mode: "draft" })).orders).toBeUndefined();
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] })).orders).toBeUndefined();
    expect(finals).toEqual([]); expect(changed).toBe(1);
    expect((await op("plan_week", { week_start: MON, mode: "final" })).orders).toEqual([{ id: "o1", covers_from: MON }]);
    expect((await op("plan_week", { week_start: MON, mode: "final", meals: [lunch] })).orders).toEqual([{ id: "o1", covers_from: MON }]);
    expect(finals).toEqual([MON, MON]); expect(changed).toBe(1);
    await op("plan_week", { week_start: MON, mode: "final" });                                       // already final: the context, no rebuild
    await op("plan_week", { week_start: "2026-11-24", mode: "final", meals: [lunch] });              // refused
    expect(finals).toEqual([MON, MON]);
  });

  it("without the orders hook's answer there is no orders key", async () => {
    const { op } = await boot();
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [lunch] });
    expect(r.week.status).toBe("final"); expect("orders" in r).toBe(false);
  });
});

describe("the context", () => {
  it("the context carries last week's dishes for variety", async () => {
    const { op } = await boot();
    await op("plan_week", { week_start: "2026-11-16", mode: "final", meals: [
      { ...lunch, date: "2026-11-17" }, { date: "2026-11-16", slot: "Dinner", dishes: [{ name: "Dal" }, { name: "Roti" }] }, { date: "2026-11-22", slot: "Dinner", ordered_in: true }] });
    await op("plan_week", { week_start: "2026-11-09", mode: "final", meals: [{ date: "2026-11-09", slot: "Dinner", dishes: [{ name: "Pulao" }] }] });
    const { context } = await op("plan_week", { week_start: MON, mode: "draft" });
    expect(context.last_week).toEqual([
      { date: "2026-11-16", slot: "Dinner", dishes: ["Dal", "Roti"] },
      { date: "2026-11-17", slot: "Lunch", dishes: ["Rice", "Aloo gobi", "Sambar", "Boiled eggs"] }]);
  });

  it("carries the family, the house, the everyday items, the recipe book and the grocery app", async () => {
    const { op, kit } = await boot();
    await op("set_person", { name: "Agastya", group: "child", allergies: "peanuts" });
    await op("set_person", { name: "Nani", group: "elder" });
    await op("set_person", { name: "Nani", remove: true });
    await op("set_house_rules", { rules: [{ kind: "veg", days: ["Tue"] }] });
    const now = new Date().toISOString();
    kit.sqlite.query(`INSERT INTO saved_recipes (id, created_at, updated_at, name, tags, for_people, notes) VALUES ('r1', ?, ?, 'Sambar', '["south indian"]', '["Agastya"]', 'long notes')`).run(now, now);
    kit.sqlite.query(`INSERT INTO saved_recipes (id, created_at, updated_at, name) VALUES ('r2', ?, ?, 'Aloo gobi')`).run(now, now);
    kit.sqlite.query(`INSERT INTO regulars (id, created_at, updated_at, item, amount, unit, every, active) VALUES ('g1', ?, ?, 'milk', 1, 'l', 'day', 1), ('g2', ?, ?, 'bread', 1, 'pc', 'day', 0)`).run(now, now, now, now);
    const { context } = await op("plan_week", { week_start: MON, mode: "draft" });
    expect(context.people.map((p: any) => p.name)).toEqual(["Agastya"]);
    expect(context.people[0].allergies).toBe("peanuts");
    expect(context.house.rules).toEqual([{ kind: "veg", days: ["Tue"] }]);
    expect(context.regulars.map((r: any) => r.item)).toEqual(["milk"]);
    expect(context.recipes).toEqual([{ id: "r2", name: "Aloo gobi", tags: [], for_people: [] }, { id: "r1", name: "Sambar", tags: ["south indian"], for_people: ["Agastya"] }]);
    expect(context.grocery_app).toBe("zepto");
    expect(context.last_week).toEqual([]);
  });
});

describe("set_meal", () => {
  it("set_meal ordered_in clears the dishes; set_dish edits one dish's ingredients", async () => {
    const { op, rows } = await boot();
    const { week } = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, { date: MON, slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ item: "toor dal", amount: 200, unit: "g" }] }, { name: "Roti" }] }] });
    const aloo = mealOf(week, MON, "Lunch").dishes[1];
    const d = await op("set_dish", { dish_id: aloo.id, ingredients: [{ item: "cauliflower", amount: 2, unit: "pc" }, { item: "peas", amount: 100, unit: "g" }] });
    expect(d.dish).toMatchObject({ id: aloo.id, name: "Aloo gobi" });
    expect(d.dish.ingredients).toMatchObject([{ item: "cauliflower", amount: 2, unit: "pc" }, { item: "peas", amount: 100, unit: "g" }]);
    expect(rows("dish_items").map((i) => i.item).sort()).toEqual(["cauliflower", "eggs", "peas", "rice", "toor dal"]);

    const m = await op("set_meal", { date: MON, slot: "Dinner", ordered_in: true, note: "biryani from Meghana's" });
    expect(m.meal).toMatchObject({ slot: "Dinner", ordered_in: true, note: "biryani from Meghana's", dishes: [] });
    expect(rows("dishes")).toHaveLength(4);
    expect(rows("dish_items").map((i) => i.item).sort()).toEqual(["cauliflower", "eggs", "peas", "rice"]);
    expect(rows("plan_meals")).toHaveLength(2);
  });

  it("upserts by date and slot, with the week's status; given dishes it replaces them, a note alone leaves them", async () => {
    const { op, rows } = await boot();
    const first = await op("set_meal", { date: "2026-11-25", slot: "dinner", dishes: [{ name: "Dal" }, { name: "Roti" }] });
    expect(first.meal).toMatchObject({ date: "2026-11-25", slot: "Dinner", ordered_in: false });
    expect(rows("plan_meals")[0]).toMatchObject({ status: "draft", updated_by: "agent:meal-agent" });
    const noted = await op("set_meal", { date: "2026-11-25", slot: "Dinner", note: "guests tonight" });
    expect(noted.meal.id).toBe(first.meal.id);
    expect(noted.meal).toMatchObject({ note: "guests tonight" }); expect(dishNames(noted.meal)).toEqual(["Dal", "Roti"]);
    const swapped = await op("set_meal", { date: "2026-11-25", slot: "Dinner", dishes: [{ name: "Pulao", ingredients: [{ item: "rice", amount: 300, unit: "g", keeps: "long" }] }] });
    expect(dishNames(swapped.meal)).toEqual(["Pulao"]); expect(swapped.meal.note).toBe("guests tonight");
    expect(rows("plan_meals")).toHaveLength(1); expect(rows("dishes")).toHaveLength(1);

    await op("plan_week", { week_start: MON, mode: "final" });
    await op("set_meal", { date: "2026-11-26", slot: "Breakfast", dishes: [{ name: "Poha" }] });
    expect(rows("plan_meals").find((m) => m.date === "2026-11-26").status).toBe("final");
  });

  it("finds a meal by meal_id; an unknown one is a 404", async () => {
    const { op } = await boot();
    const { meal } = await op("set_meal", { date: MON, slot: "Lunch", dishes: [{ name: "Rice" }] });
    expect((await op("set_meal", { meal_id: meal.id, note: "early lunch" })).meal).toMatchObject({ id: meal.id, date: MON, slot: "Lunch", note: "early lunch" });
    expect((await op("set_meal", { meal_id: "nope", note: "x" })).status).toBe(404);
    expect((await op("set_meal", { meal_id: meal.id, date: "2026-11-24", slot: "Lunch" })).code).toBe("APP_REFUSED");
  });

  it("refuses dishes with ordered_in, dishes for a meal that is ordered in, a bad date and an unknown slot", async () => {
    const { op, rows } = await boot();
    expect((await op("set_meal", { date: MON, slot: "Dinner", ordered_in: true, dishes: [{ name: "Pizza" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_meal", { date: "23 Nov", slot: "Dinner" })).code).toBe("APP_REFUSED");
    expect((await op("set_meal", { slot: "Dinner" })).code).toBe("APP_REFUSED");
    expect((await op("set_meal", { date: MON, slot: "Supper" })).code).toBe("APP_REFUSED");
    expect((await op("set_meal", { date: MON, slot: "Dinner", ordered_in: 1 })).code).toBe("APP_REFUSED");
    expect(rows("plan_meals")).toHaveLength(0);
    await op("set_meal", { date: MON, slot: "Dinner", ordered_in: true });
    expect((await op("set_meal", { date: MON, slot: "Dinner", dishes: [{ name: "Dal" }] })).code).toBe("APP_REFUSED");
    const cooked = await op("set_meal", { date: MON, slot: "Dinner", ordered_in: false, dishes: [{ name: "Dal" }] });
    expect(cooked.meal).toMatchObject({ ordered_in: false }); expect(dishNames(cooked.meal)).toEqual(["Dal"]);
  });

  it("tells the orders hook after a meal or a dish changes, not after a refusal", async () => {
    let changed = 0; const finals: string[] = [];
    const { op } = await boot({ mealHooks: { onFinal: (w) => { finals.push(w); }, onChanged: () => { changed++; } } });
    await op("set_meal", { date: MON, slot: "Dinner", dishes: [{ name: "Dal" }] });
    expect(changed).toBe(1);
    await op("set_dish", { date: MON, slot: "Dinner", name: "Roti" });
    expect(changed).toBe(2);
    await op("set_meal", { date: MON, slot: "Supper" });
    await op("set_dish", { dish_id: "nope", name: "x" });
    expect(changed).toBe(2); expect(finals).toEqual([]);
  });
});

describe("set_dish", () => {
  it("adds a dish to a meal by date and slot, making the meal when it is not there; position 0 is first", async () => {
    const { op, rows } = await boot();
    const a = await op("set_dish", { date: MON, slot: "Dinner", name: "Dal", ingredients: [{ item: "toor dal", amount: 200, unit: "g", keeps: "long" }] });
    expect(a.dish).toMatchObject({ name: "Dal", for_people: null });
    expect(a.meal).toMatchObject({ date: MON, slot: "Dinner" }); expect(dishNames(a.meal)).toEqual(["Dal"]);
    expect(rows("plan_meals")[0]).toMatchObject({ status: "draft" });
    await op("set_dish", { meal_id: a.meal.id, name: "Roti" });
    const c = await op("set_dish", { date: MON, slot: "dinner", name: "Salad", position: 0, for: ["Meera"], portion_note: "a big bowl", video_url: "https://youtu.be/x" });
    expect(dishNames(c.meal)).toEqual(["Salad", "Dal", "Roti"]);
    expect(c.dish).toMatchObject({ for_people: ["Meera"], portion_note: "a big bowl", video_url: "https://youtu.be/x" });
    expect(rows("dishes").sort((x, y) => x.position - y.position).map((d) => `${d.position} ${d.name}`)).toEqual(["0 Salad", "1 Dal", "2 Roti"]);
    expect(rows("plan_meals")).toHaveLength(1);
  });

  it("changes only the fields sent; in a meal, a dish of the same name is the one changed", async () => {
    const { op, rows } = await boot();
    const { week } = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    const eggs = mealOf(week, MON, "Lunch").dishes[3];
    const renamed = await op("set_dish", { dish_id: eggs.id, name: "Egg curry" });
    expect(renamed.dish).toMatchObject({ id: eggs.id, name: "Egg curry", for_people: ["me", "wife"], portion_note: "4 for me, 1 for wife" });
    expect(renamed.dish.ingredients).toMatchObject([{ item: "eggs", amount: 5 }]);
    const everyone = await op("set_dish", { dish_id: eggs.id, for: null, portion_note: null, ingredients: [] });
    expect(everyone.dish).toMatchObject({ for_people: null, portion_note: null, ingredients: [] });
    const same = await op("set_dish", { date: MON, slot: "Lunch", name: "sambar", portion_note: "extra for Dad" });
    expect(same.dish).toMatchObject({ name: "Sambar", portion_note: "extra for Dad" });
    expect(rows("dishes")).toHaveLength(4);
    const moved = await op("set_dish", { dish_id: eggs.id, position: 1 });
    expect(dishNames(moved.meal)).toEqual(["Rice", "Egg curry", "Aloo gobi", "Sambar"]);
    expect(rows("dishes").find((d) => d.id === eggs.id).updated_by).toBe("agent:meal-agent");
  });

  it("remove takes a dish and its ingredients away and closes the gap", async () => {
    const { op, rows } = await boot();
    const { week } = await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    const r = await op("set_dish", { dish_id: mealOf(week, MON, "Lunch").dishes[1].id, remove: true });
    expect(dishNames(r.meal)).toEqual(["Rice", "Sambar", "Boiled eggs"]); expect(r.dish).toBeUndefined();
    expect(rows("dishes").sort((x, y) => x.position - y.position).map((d) => d.position)).toEqual([0, 1, 2]);
    expect(rows("dish_items").map((i) => i.item).sort()).toEqual(["eggs", "rice"]);
    expect(dishNames((await op("set_dish", { date: MON, slot: "Lunch", name: "boiled EGGS", remove: true })).meal)).toEqual(["Rice", "Sambar"]);
    expect((await op("set_dish", { date: MON, slot: "Lunch", name: "Papad", remove: true })).status).toBe(404);
  });

  it("links a dish to a saved recipe that exists", async () => {
    const { op, kit } = await boot();
    const now = new Date().toISOString();
    kit.sqlite.query(`INSERT INTO saved_recipes (id, created_at, updated_at, name) VALUES ('r1', ?, ?, 'Sambar')`).run(now, now);
    expect((await op("set_dish", { date: MON, slot: "Lunch", name: "Sambar", recipe_id: "r1" })).dish.recipe_id).toBe("r1");
    expect((await op("set_dish", { date: MON, slot: "Lunch", name: "Sambar", recipe_id: "r9" })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { date: MON, slot: "Lunch", name: "Sambar", recipe_id: null })).dish.recipe_id).toBeNull();
  });

  it("refuses what it cannot place: no dish or meal named, a new dish with no name, a dish for a meal ordered in; unknown ids are 404s", async () => {
    const { op, rows } = await boot();
    expect((await op("set_dish", { name: "Dal" })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { date: MON, slot: "Dinner" })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { date: MON, slot: "Supper", name: "Dal" })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { date: MON, slot: "Dinner", name: "Dal", position: -1 })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { date: MON, slot: "Dinner", name: "Dal", ingredients: [{ item: "" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_dish", { dish_id: "nope", name: "Dal" })).status).toBe(404);
    expect((await op("set_dish", { meal_id: "nope", name: "Dal" })).status).toBe(404);
    expect(rows("plan_meals")).toHaveLength(0);
    await op("set_meal", { date: MON, slot: "Dinner", ordered_in: true });
    expect((await op("set_dish", { date: MON, slot: "Dinner", name: "Dal" })).code).toBe("APP_REFUSED");
    expect(rows("dishes")).toHaveLength(0);
  });
});

describe("GET /api/weeks/:week_start", () => {
  it("reads a week for the Week page: seven days, its meals with their dishes, and whether it is a draft", async () => {
    const { op, owner } = await boot();
    const empty = await owner("GET", `/api/weeks/${MON}`);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ week_start: MON, status: null });
    expect(empty.body.days.map((d: any) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, { date: "2026-11-29", slot: "Dinner", ordered_in: true }] });
    const { body } = await owner("GET", `/api/weeks/${MON}`);
    expect(body.status).toBe("draft");
    expect(dishNames(mealOf(body, MON, "Lunch"))).toEqual(["Rice", "Aloo gobi", "Sambar", "Boiled eggs"]);
    expect(mealOf(body, MON, "Lunch").dishes[1].ingredients.map((i: any) => i.item)).toEqual(["cauliflower", "potato"]);
    expect(mealOf(body, "2026-11-29", "Dinner")).toMatchObject({ ordered_in: true, dishes: [] });
    // Another week is another read.
    expect((await owner("GET", "/api/weeks/2026-11-30")).body.status).toBeNull();
  });

  it("refuses a week it cannot read", async () => {
    const { owner } = await boot();
    const bad = await owner("GET", "/api/weeks/next");
    expect(bad.status).toBe(400); expect(bad.body.reason).toContain("YYYY-MM-DD");
    const tue = await owner("GET", "/api/weeks/2026-11-24");
    expect(tue.status).toBe(400); expect(tue.body.reason).toContain("Monday");
  });
});

describe("live pages", () => {
  it("are told of every row once the write is in: the writer's rows as the writer's, what follows from them as the app's", async () => {
    const { kit } = await boot();
    const hono = new Hono(); const told: string[] = [];
    mountMealRoutes(hono, kit.db, (table, _id, op, by) => { told.push(`${table} ${op} ${by}`); }, { onFinal: () => undefined, onChanged: () => {} });
    const post = async (path: string, body: unknown) => {
      told.length = 0;
      const r = await hono.request(path, { method: "POST", headers: { "Content-Type": "application/json", "x-flock-user": "meera" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const dinner = { date: MON, slot: "Dinner", dishes: [{ name: "Dal", ingredients: [{ item: "toor dal", amount: 200, unit: "g" }] }, { name: "Roti" }] };
    await post(`/api/weeks/${MON}/plan`, { mode: "draft", meals: [dinner] });
    expect(told).toEqual(["plan_meals insert user:meera", "dishes insert user:meera", "dish_items insert user:meera", "dishes insert user:meera"]);
    await post(`/api/weeks/${MON}/plan`, { mode: "final" });
    expect(told).toEqual(["plan_meals update user:meera"]);
    await post("/api/dishes", { date: MON, slot: "Dinner", name: "Salad", position: 0 });
    expect(told).toEqual(["dishes insert user:meera", "dishes update app", "dishes update app"]);
    await post("/api/meals", { date: MON, slot: "Dinner", ordered_in: true });
    expect(told).toEqual(["plan_meals update user:meera", "dishes delete app", "dish_items delete app", "dishes delete app", "dishes delete app"]);
    await post("/api/dishes", { date: MON, slot: "Lunch", name: "Curd rice" });
    expect(told).toEqual(["plan_meals insert app", "dishes insert user:meera"]);
    expect((await post(`/api/weeks/${MON}/plan`, { mode: "final", meals: [dinner, { date: MON, slot: "Lunch", dishes: [{ name: "" }] }] })).status).toBe(400);
    expect(told).toEqual([]);
  });
});
