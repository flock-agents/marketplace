// The plan: a week of meals, each a date and a slot, made of dishes in the order they are served, each dish with what it
// needs bought. The agent writes a whole week with plan_week (a draft the family can change, then final), and changes one meal
// or one dish with set_meal and set_dish. A meal that is ordered in has no dishes, so nothing is bought for it.
import type { Hono } from "hono";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { dish_items, dishes, people, plan_meals, regulars, saved_recipes } from "./db/schema";
import { KEEPS, SLOTS, type GroceryApp } from "./db/constants";
import { addDays, mondayOf, weekDates, weekdayOf } from "./dates";
import { getHouse, groceryApp, houseView, isObject, list, name, names, refuse, words, writeRoutes,
  type Db, type Emit, type HouseView, type PersonRow } from "./family";

export type DishInput = { name: string; for?: string[] | null; portion_note?: string | null; recipe_id?: string | null; video_url?: string | null;
  ingredients?: { item: string; amount?: number | null; unit?: string | null; keeps?: (typeof KEEPS)[number] }[] };
export type MealInput = { date: string; slot: string; ordered_in?: boolean; note?: string | null; dishes?: DishInput[] };

export type IngredientView = { id: string; item: string; amount: number | null; unit: string | null; keeps: string };
export type DishView = { id: string; name: string; for_people: string[] | null; portion_note: string | null; recipe_id: string | null;
  video_url: string | null; ingredients: IngredientView[] };
export type MealView = { id: string; date: string; slot: string; ordered_in: boolean; note: string | null; dishes: DishView[] };
/** A week as the pages and the agent read it. `status` is null while the week has no meals. */
export type WeekView = { week_start: string; status: "draft" | "final" | null; days: { date: string; meals: MealView[] }[] };
/** What the agent reads before it plans a week. */
export type WeekContext = { week_start: string; people: PersonRow[]; house: HouseView; regulars: (typeof regulars.$inferSelect)[];
  last_week: { date: string; slot: string; dishes: string[] }[];
  recipes: { id: string; name: string; tags: string[]; for_people: string[] }[]; grocery_app: GroceryApp };

/** What the orders do when the plan changes: `onFinal` builds a week's orders once its plan is final and answers with them;
 *  `onChanged` follows any other change to a meal or a dish; `weekHasOrders` says a week already has orders made from its
 *  plan (cancelled ones aside), so a new draft may not take that plan's place. */
export type MealHooks = { onFinal(weekStart: string): unknown; onChanged(): void; weekHasOrders?(weekStart: string): boolean };

type MealRow = typeof plan_meals.$inferSelect;
type DishRow = typeof dishes.$inferSelect;
type Item = { item: string; amount: number | null; unit: string | null; keeps: string };
/** A dish as it was sent: only the fields in `set` were given. */
type Dish = { name: string; set: Partial<Pick<DishRow, "for_people" | "portion_note" | "recipe_id" | "video_url">>; items?: Item[] };
type Meal = { date: string; slot: string; ordered_in?: boolean; note?: string | null; dishes?: Dish[] };
type Change = Parameters<Emit>;

const now = () => new Date().toISOString();
const inWeek = (weekStart: string) => and(gte(plan_meals.date, weekStart), lte(plan_meals.date, addDays(weekStart, 6)));

/** Every slot a meal can have: the three everyday ones, then the house's own. */
function slotNames(db: Db): string[] { return [...SLOTS, ...houseView(getHouse(db)).extra_slots.map((s) => s.name)]; }

function dishesOf(db: Db, mealId: string): DishRow[] {
  return db.select().from(dishes).where(eq(dishes.meal_id, mealId)).orderBy(asc(dishes.position), asc(dishes.created_at)).all();
}

function mealViews(db: Db, meals: MealRow[]): MealView[] {
  if (!meals.length) return [];
  const dishRows = db.select().from(dishes).where(inArray(dishes.meal_id, meals.map((m) => m.id))).orderBy(asc(dishes.position), asc(dishes.created_at)).all();
  const itemRows = dishRows.length
    ? db.select().from(dish_items).where(inArray(dish_items.dish_id, dishRows.map((d) => d.id))).orderBy(asc(dish_items.created_at), sql`rowid`).all() : [];
  const slots = slotNames(db);
  const rank = (m: MealRow) => { const i = slots.indexOf(m.slot); return i < 0 ? slots.length : i; };
  return [...meals].sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.slot.localeCompare(b.slot)).map((m) => ({
    id: m.id, date: m.date, slot: m.slot, ordered_in: !!m.ordered_in, note: m.note,
    dishes: dishRows.filter((d) => d.meal_id === m.id).map((d) => ({
      id: d.id, name: d.name, for_people: d.for_people ? list<string>(d.for_people) : null, portion_note: d.portion_note, recipe_id: d.recipe_id, video_url: d.video_url,
      ingredients: itemRows.filter((i) => i.dish_id === d.id).map((i) => ({ id: i.id, item: i.item, amount: i.amount, unit: i.unit, keeps: i.keeps ?? "fresh" })),
    })),
  }));
}

export function weekView(db: Db, weekStart: string): WeekView {
  const rows = db.select().from(plan_meals).where(inWeek(weekStart)).all();
  const meals = mealViews(db, rows);
  return { week_start: weekStart, status: weekStatus(rows),
    days: weekDates(weekStart).map((date) => ({ date, meals: meals.filter((m) => m.date === date) })) };
}

/** A week is a draft while any of its meals is one. */
function weekStatus(meals: MealRow[]): WeekView["status"] {
  return !meals.length ? null : meals.some((m) => m.status === "draft") ? "draft" : "final";
}

export function weekContext(db: Db, weekStart: string): WeekContext {
  return {
    week_start: weekStart,
    people: db.select().from(people).where(eq(people.active, 1)).orderBy(asc(people.created_at)).all(),
    house: houseView(getHouse(db)),
    regulars: db.select().from(regulars).where(eq(regulars.active, 1)).orderBy(asc(regulars.created_at)).all(),
    last_week: mealViews(db, db.select().from(plan_meals).where(inWeek(addDays(weekStart, -7))).all())
      .filter((m) => m.dishes.length).map((m) => ({ date: m.date, slot: m.slot, dishes: m.dishes.map((d) => d.name) })),
    recipes: db.select().from(saved_recipes).orderBy(asc(saved_recipes.name)).all()
      .map((r) => ({ id: r.id, name: r.name, tags: list<string>(r.tags), for_people: list<string>(r.for_people) })),
    grocery_app: groceryApp(db),
  };
}

// ── What was sent, checked ──

/** A real calendar date as "YYYY-MM-DD". */
export const dateOf = (v: unknown, what: string): string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v ? v : refuse(`${what} must be a date as YYYY-MM-DD`);
const slotOf = (v: unknown, slots: string[]): string =>
  slots.find((s) => typeof v === "string" && s.toLowerCase() === v.trim().toLowerCase()) ?? refuse(`slot must be one of: ${slots.join(", ")}`);
export const flag = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : refuse(`${what} must be true or false`));

function itemsOf(v: unknown, dish: string): Item[] {
  if (!Array.isArray(v)) return refuse(`${dish}: ingredients must be a list of { item, amount?, unit?, keeps? }`);
  return v.map((i) => {
    if (!isObject(i)) return refuse(`${dish}: ingredients must be a list of { item, amount?, unit?, keeps? }`);
    const item = name(i.item, `${dish}: an ingredient's item`);
    const amount = i.amount == null ? null : typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 ? i.amount
      : refuse(`${dish}: the amount of ${item} must be a number above 0 (put the measure in unit)`);
    const keeps = i.keeps == null ? "fresh" : (KEEPS as readonly unknown[]).includes(i.keeps) ? (i.keeps as string) : refuse(`${dish}: keeps must be one of: ${KEEPS.join(", ")}`);
    return { item, amount, unit: i.unit === undefined ? null : words(i.unit, `${dish}: the unit of ${item}`), keeps };
  });
}

/** The fields of a dish that were sent. `for` empty or null means everyone. */
function dishOf(db: Db, d: Record<string, unknown>, dishName: string): Dish {
  const set: Dish["set"] = {};
  if (d.for !== undefined) { const who = d.for === null ? [] : names(d.for, `${dishName}: for`); set.for_people = who.length ? JSON.stringify(who) : null; }
  if (d.portion_note !== undefined) set.portion_note = words(d.portion_note, `${dishName}: portion_note`);
  if (d.video_url !== undefined) set.video_url = words(d.video_url, `${dishName}: video_url`);
  if (d.recipe_id !== undefined) {
    set.recipe_id = d.recipe_id === null ? null
      : typeof d.recipe_id === "string" && db.select({ id: saved_recipes.id }).from(saved_recipes).where(eq(saved_recipes.id, d.recipe_id)).get() ? d.recipe_id
      : refuse(`${dishName}: no saved recipe has the id ${JSON.stringify(d.recipe_id)}`);
  }
  return { name: dishName, set, ...(d.ingredients !== undefined ? { items: itemsOf(d.ingredients, dishName) } : {}) };
}

function dishesSent(db: Db, v: unknown, meal: string): Dish[] {
  if (!Array.isArray(v)) return refuse(`${meal}: dishes must be a list of { name, for?, portion_note?, recipe_id?, video_url?, ingredients? }`);
  return v.map((d) => (isObject(d) ? dishOf(db, d, name(d.name, `${meal}: a dish's name`)) : refuse(`${meal}: each dish is { name, ... }`)));
}

const NO_DISHES_WITH_ORDER_IN = "a meal that is ordered in has no dishes: leave dishes out, or send ordered_in: false";

/** One meal of a plan_week list. */
function mealOf(db: Db, v: unknown, slots: string[]): Meal {
  if (!isObject(v)) return refuse("meals must be a list of { date, slot, ordered_in?, note?, dishes? }");
  const date = dateOf(v.date, "a meal's date"), slot = slotOf(v.slot, slots), label = `${date} ${slot}`;
  const meal: Meal = { date, slot };
  if (v.ordered_in !== undefined) meal.ordered_in = flag(v.ordered_in, `${label}: ordered_in`);
  if (v.note !== undefined) meal.note = words(v.note, `${label}: note`);
  if (v.dishes !== undefined) meal.dishes = dishesSent(db, v.dishes, label);
  if (meal.ordered_in && meal.dishes?.length) refuse(`${label}: ${NO_DISHES_WITH_ORDER_IN}`);
  return meal;
}

// ── Writes: each runs inside a transaction and lists what changed, told to the pages once it is committed ──

function addItems(tx: Db, dishId: string, items: Item[], by: string, changes: Change[]) {
  for (const i of items) changes.push(["dish_items", tx.insert(dish_items).values({ ...i, dish_id: dishId, updated_by: by }).returning().get().id, "insert", by]);
}

function removeItems(tx: Db, dishId: string, changes: Change[]) {
  for (const i of tx.delete(dish_items).where(eq(dish_items.dish_id, dishId)).returning().all()) changes.push(["dish_items", i.id, "delete", "app"]);
}

function addDish(tx: Db, mealId: string, position: number, d: Dish, by: string, changes: Change[]): DishRow {
  const row = tx.insert(dishes).values({ ...d.set, name: d.name, meal_id: mealId, position, updated_by: by }).returning().get();
  changes.push(["dishes", row.id, "insert", by]);
  addItems(tx, row.id, d.items ?? [], by, changes);
  return row;
}

function removeDish(tx: Db, dishId: string, changes: Change[]) {
  removeItems(tx, dishId, changes);
  tx.delete(dishes).where(eq(dishes.id, dishId)).run();
  changes.push(["dishes", dishId, "delete", "app"]);
}

function removeDishes(tx: Db, mealId: string, changes: Change[]) {
  for (const d of dishesOf(tx, mealId)) removeDish(tx, d.id, changes);
}

/** Number a meal's dishes 0, 1, 2… as they stand, with one of them put at `place.at` when given. */
function orderDishes(tx: Db, mealId: string, changes: Change[], place?: { id: string; at: number }) {
  let ids = dishesOf(tx, mealId).map((d) => ({ id: d.id, was: d.position }));
  if (place) {
    const moved = ids.find((d) => d.id === place.id)!;
    ids = ids.filter((d) => d !== moved);
    ids.splice(Math.min(place.at, ids.length), 0, moved);
  }
  ids.forEach((d, position) => {
    if (d.was === position) return;
    tx.update(dishes).set({ position }).where(eq(dishes.id, d.id)).run();
    if (d.id !== place?.id) changes.push(["dishes", d.id, "update", "app"]);
  });
}

export function mountMealRoutes(hono: Hono<any>, db: Db, emit: Emit, hooks: MealHooks) {
  const write = writeRoutes(hono);
  /** Run a write in one transaction; the pages hear of its changes only once it is committed. */
  const commit = <T>(run: (tx: Db, changes: Change[]) => T): T => {
    const changes: Change[] = [];
    const out = db.transaction((tx) => run(tx as unknown as Db, changes));
    for (const c of changes) emit(...c);
    return out;
  };
  const mealView = (id: string): MealView => mealViews(db, db.select().from(plan_meals).where(eq(plan_meals.id, id)).all())[0];
  /** The status a meal added to a week takes: the week's, a draft when the week is empty. */
  const statusFor = (date: string) => weekStatus(db.select().from(plan_meals).where(inWeek(mondayOf(date))).all()) ?? "draft";
  const notFound = (reason: string) => ({ status: 404 as const, body: { reason } });

  // The Week page's read: one week, by its Monday.
  hono.get("/api/weeks/:week_start", (c) => {
    const weekStart = c.req.param("week_start");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || addDays(weekStart, 0) !== weekStart) return c.json({ ok: false, reason: "week_start must be a date as YYYY-MM-DD" }, 400);
    if (weekdayOf(weekStart) !== "Mon") return c.json({ ok: false, reason: `week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}` }, 400);
    return c.json(weekView(db, weekStart));
  });

  // plan_week { week_start, mode: draft | final, meals? }. With meals: they become the week's plan, in place of what was there.
  // Without: a week of drafts is made final when mode is final; anything else answers with what the agent plans from.
  write("/api/weeks/:week_start/plan", async (b, by, c) => {
    const weekStart = dateOf(c.req.param("week_start"), "week_start");
    if (weekdayOf(weekStart) !== "Mon") refuse(`week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}`);
    const mode = b.mode === "draft" || b.mode === "final" ? b.mode : refuse("mode must be draft or final");
    if (b.meals === undefined) {
      const drafts = mode === "final" ? db.select().from(plan_meals).where(and(inWeek(weekStart), eq(plan_meals.status, "draft"))).all() : [];
      if (!drafts.length) return { body: { context: weekContext(db, weekStart) } };
      commit((tx, changes) => {
        for (const m of drafts) {
          tx.update(plan_meals).set({ status: "final", updated_at: now(), updated_by: by }).where(eq(plan_meals.id, m.id)).run();
          changes.push(["plan_meals", m.id, "update", by]);
        }
      });
    } else {
      if (!Array.isArray(b.meals) || !b.meals.length) refuse("meals must be a list of the week's meals: { date, slot, ordered_in?, note?, dishes? }; leave it out to read the context");
      // The orders are built from final meals: a draft in their place would take every dish off the orders not yet placed.
      if (mode === "draft" && hooks.weekHasOrders?.(weekStart))
        refuse("this week is already planned and has orders: change a meal with set_meal or set_dish, or send plan_week with mode final and the new meals");
      const slots = slotNames(db);
      const meals = (b.meals as unknown[]).map((m) => mealOf(db, m, slots));
      const seen = new Set<string>();
      for (const m of meals) {
        if (mondayOf(m.date) !== weekStart) refuse(`${m.date} ${m.slot} is not in the week of ${weekStart}`);
        if (seen.has(`${m.date} ${m.slot}`)) refuse(`${m.date} ${m.slot} is in meals twice`);
        seen.add(`${m.date} ${m.slot}`);
      }
      commit((tx, changes) => {
        for (const old of tx.select().from(plan_meals).where(inWeek(weekStart)).all()) {
          removeDishes(tx, old.id, changes);
          tx.delete(plan_meals).where(eq(plan_meals.id, old.id)).run();
          changes.push(["plan_meals", old.id, "delete", "app"]);
        }
        for (const m of meals) {
          const row = tx.insert(plan_meals).values({ date: m.date, slot: m.slot, ordered_in: m.ordered_in ? 1 : 0, note: m.note ?? null, status: mode, updated_by: by }).returning().get();
          changes.push(["plan_meals", row.id, "insert", by]);
          (m.dishes ?? []).forEach((d, position) => addDish(tx, row.id, position, d, by, changes));
        }
      });
    }
    // A final plan is what the orders are built from; a draft that took a week's place is one more change to follow.
    const orders = mode === "final" ? await hooks.onFinal(weekStart) : void hooks.onChanged();
    return { body: { week: weekView(db, weekStart), ...(orders === undefined ? {} : { orders }) } };
  });

  // set_meal { date, slot | meal_id, ordered_in?, note?, dishes? }: one meal, found by its date and slot or by its id, made when
  // it is not there. Only what is sent changes; dishes sent replace the meal's dishes; ordered_in: true takes them away.
  write("/api/meals", (b, by) => {
    let meal: MealRow | undefined, at: { date: string; slot: string } | undefined;
    if (b.meal_id != null) {
      meal = db.select().from(plan_meals).where(eq(plan_meals.id, String(b.meal_id))).get();
      if (!meal) return notFound(`no meal has the id ${JSON.stringify(b.meal_id)}`);
      const moved = (b.date !== undefined && b.date !== meal.date) || (b.slot !== undefined && String(b.slot).trim().toLowerCase() !== meal.slot.toLowerCase());
      if (moved) refuse(`that meal is ${meal.date} ${meal.slot}: a meal keeps its date and slot`);
    } else {
      at = { date: dateOf(b.date, "date"), slot: slotOf(b.slot, slotNames(db)) };
      meal = db.select().from(plan_meals).where(and(eq(plan_meals.date, at.date), eq(plan_meals.slot, at.slot))).get();
    }
    const label = meal ? `${meal.date} ${meal.slot}` : `${at!.date} ${at!.slot}`;
    const set: Partial<typeof plan_meals.$inferInsert> = {};
    if (b.ordered_in !== undefined) set.ordered_in = flag(b.ordered_in, "ordered_in") ? 1 : 0;
    if (b.note !== undefined) set.note = words(b.note, "note");
    const sent = b.dishes === undefined ? undefined : dishesSent(db, b.dishes, label);
    const orderedIn = !!(set.ordered_in ?? meal?.ordered_in);
    if (orderedIn && sent?.length) refuse(`${label}: ${NO_DISHES_WITH_ORDER_IN}`);
    const id = commit((tx, changes) => {
      const row = meal
        ? tx.update(plan_meals).set({ ...set, updated_at: now(), updated_by: by }).where(eq(plan_meals.id, meal.id)).returning().get()
        : tx.insert(plan_meals).values({ ...set, ...at!, status: statusFor(at!.date), updated_by: by }).returning().get();
      changes.push(["plan_meals", row.id, meal ? "update" : "insert", by]);
      if (orderedIn || sent) removeDishes(tx, row.id, changes);
      (sent ?? []).forEach((d, position) => addDish(tx, row.id, position, d, by, changes));
      return row.id;
    });
    hooks.onChanged();
    return { body: { meal: mealView(id) } };
  });

  // set_dish { dish_id | meal_id | (date, slot), name?, for?, portion_note?, recipe_id?, video_url?, ingredients?, position?, remove? }:
  // one dish. By dish_id it is that dish; in a meal it is the dish of that name, added at the end when the meal has none (and
  // the meal made when it is not there). Only what is sent changes; ingredients sent replace the dish's; position 0 is first.
  write("/api/dishes", (b, by) => {
    const position = b.position === undefined ? undefined
      : typeof b.position === "number" && Number.isInteger(b.position) && b.position >= 0 ? b.position : refuse("position must be a whole number, 0 for first");
    let meal: MealRow | undefined, dish: DishRow | undefined, at: { date: string; slot: string } | undefined;
    if (b.dish_id != null) {
      dish = db.select().from(dishes).where(eq(dishes.id, String(b.dish_id))).get();
      if (!dish) return notFound(`no dish has the id ${JSON.stringify(b.dish_id)}`);
      meal = db.select().from(plan_meals).where(eq(plan_meals.id, dish.meal_id)).get();
    } else {
      if (b.meal_id != null) {
        meal = db.select().from(plan_meals).where(eq(plan_meals.id, String(b.meal_id))).get();
        if (!meal) return notFound(`no meal has the id ${JSON.stringify(b.meal_id)}`);
      } else if (b.date !== undefined || b.slot !== undefined) {
        at = { date: dateOf(b.date, "date"), slot: slotOf(b.slot, slotNames(db)) };
        meal = db.select().from(plan_meals).where(and(eq(plan_meals.date, at.date), eq(plan_meals.slot, at.slot))).get();
      } else refuse("say which dish (dish_id) or which meal it is in (meal_id, or date and slot)");
      const given = name(b.name, "name").toLowerCase();
      dish = meal && dishesOf(db, meal.id).find((d) => d.name.trim().toLowerCase() === given);
    }
    const label = dish?.name ?? name(b.name, "name");
    if (b.remove === true) {
      if (!dish || !meal) return notFound(`${label} is not a dish of that meal`);
      commit((tx, changes) => { removeDish(tx, dish.id, changes); orderDishes(tx, meal.id, changes); });
      hooks.onChanged();
      return { body: { meal: mealView(meal.id) } };
    }
    const sent = dishOf(db, b, label);
    if (!dish && meal?.ordered_in) refuse(`${meal.date} ${meal.slot} is ordered in, so it has no dishes: set_meal it with ordered_in: false first`);
    const ids = commit((tx, changes) => {
      // A meal made for the dish is the app's own row; the dish is the writer's.
      const mealRow = meal ?? tx.insert(plan_meals).values({ ...at!, status: statusFor(at!.date), updated_by: "app" }).returning().get();
      if (!meal) changes.push(["plan_meals", mealRow.id, "insert", "app"]);
      let row = dish;
      if (row) {
        // By dish_id a name sent renames the dish; found by its name, it keeps the name as it is written.
        const rename = b.dish_id != null && b.name !== undefined ? { name: name(b.name, "name") } : {};
        tx.update(dishes).set({ ...sent.set, ...rename, updated_at: now(), updated_by: by }).where(eq(dishes.id, row.id)).run();
        changes.push(["dishes", row.id, "update", by]);
        if (sent.items) { removeItems(tx, row.id, changes); addItems(tx, row.id, sent.items, by, changes); }
      } else row = addDish(tx, mealRow.id, dishesOf(tx, mealRow.id).length, sent, by, changes);
      orderDishes(tx, mealRow.id, changes, position === undefined ? undefined : { id: row.id, at: position });
      return { meal: mealRow.id, dish: row.id };
    });
    hooks.onChanged();
    const view = mealView(ids.meal);
    return { body: { dish: view.dishes.find((d) => d.id === ids.dish), meal: view } };
  });
}
