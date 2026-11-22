// The plan: a week of meals, each a date and a slot, made of dishes in the order they are served, each dish with what it
// needs bought and who eats it (`for`: the names, or ["everyone"] for everyone who eats that meal; the agent names them on
// every dish, the family may leave them out for everyone). A meal is planned once, not once per person: one person's variation
// is a note on a dish, and the same dish sent twice in a meal (once per person) is kept as one (mergeSameDishes). The agent writes a whole week with plan_week (a draft the family can change, then final), and changes one meal
// or one dish with set_meal and set_dish. A meal that is ordered in has no dishes, so nothing is bought for it.
import type { Hono } from "hono";
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { dish_items, dishes, house as house_t, items, people, plan_meals, saved_recipes } from "./db/schema";
import { cycleText } from "./estimate";
import { normItem } from "./products";
import { closest } from "./agentOps";
import { SLOTS, STAPLE_DISHES, type GroceryApp } from "./db/constants";
import { addDays, mondayOf, todayStr, weekDates, weekdayOf } from "./dates";
import { introText, weekLink, weekMessage, weekSendText, youtubeThumb } from "./messages";
import { dishKey, type LastTime } from "./dishText";
import { bookOf, familyDishes, knownDishes, lastTime, setVideo, videoOf, type DishVideo } from "./dishBook";
import { breaksText, dinersOf, EVERYONE, forEveryone, isRepeatableSide, namedInOnlyRule, ruleBreaks, ruleBreaksIn, type RuleBreak } from "./rules";
import { getHouse, groceryApp, houseView, isObject, list, name, names, refuse, words, writeRoutes,
  type Db, type Emit, type HouseView, type PersonRow } from "./family";

export type DishInput = { name: string; for?: string[] | null; portion_note?: string | null; recipe_id?: string | null; video_url?: string | null;
  ingredients?: { item: string; amount?: number | null; unit?: string | null }[] };
export type MealInput = { date: string; slot: string; ordered_in?: boolean; note?: string | null; dishes?: DishInput[] };

export type IngredientView = { id: string; item: string; amount: number | null; unit: string | null };
/** `video`: the dish's own video, kept by its name across weeks (dishBook.ts), else the one this planned dish was given;
 *  `last_time`: how it went the last time it was eaten before this meal's day, when the family said. */
export type DishView = { id: string; name: string; for_people: string[] | null; portion_note: string | null; recipe_id: string | null;
  video_url: string | null; video: DishVideo | null; last_time: LastTime | null; ingredients: IngredientView[] };
export type MealView = { id: string; date: string; slot: string; ordered_in: boolean; note: string | null; dishes: DishView[] };
/** A week as the pages and the agent read it. `status` is null while the week has no meals; `planned_at` is when its plan was
 *  written (the first of its meals made, an ISO moment), null with none. */
export type WeekView = { week_start: string; status: "draft" | "final" | null; planned_at: string | null; days: { date: string; meals: MealView[] }[] };
/** What the agent reads before it plans a week. */
/** `bought_often`: what the house buys within about ten days and how often ("milk: 1 l every day"), so a plan can lean on it. */
export type WeekContext = { week_start: string; people: PersonRow[]; house: HouseView; bought_often: { item: string; cycle: string }[];
  last_week: { date: string; slot: string; dishes: string[] }[];
  /** Every dish the family rated or gave a video, the ones that did not work first: plan those rarely, and heed each note. */
  known_dishes: ReturnType<typeof knownDishes>;
  recipes: { id: string; name: string; tags: string[]; for_people: string[] }[]; grocery_app: GroceryApp;
  /** The family's own dishes by meal (the interview: what each person ate over the past week): what the week is planned from. */
  family_dishes: ReturnType<typeof familyDishes>;
  /** How to build the week, step by step, with one day as an example (PLAN_METHOD). */
  how_to_plan: string };

type MealRow = typeof plan_meals.$inferSelect;
type DishRow = typeof dishes.$inferSelect;
type Item = { item: string; amount: number | null; unit: string | null };
/** A dish as it was sent: only the fields in `set` were given. `eaters`: what is wrong with who eats it, as the agent sent it
 *  ("no for"), when something is. */
type Dish = { name: string; set: Partial<Pick<DishRow, "for_people" | "portion_note" | "recipe_id" | "video_url">>; items?: Item[]; eaters?: string };
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
  const book = bookOf(db, dishRows.map((d) => d.name));
  const slots = slotNames(db);
  const rank = (m: MealRow) => { const i = slots.indexOf(m.slot); return i < 0 ? slots.length : i; };
  return [...meals].sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.slot.localeCompare(b.slot)).map((m) => ({
    id: m.id, date: m.date, slot: m.slot, ordered_in: !!m.ordered_in, note: m.note,
    dishes: dishRows.filter((d) => d.meal_id === m.id).map((d) => ({
      id: d.id, name: d.name, for_people: d.for_people ? list<string>(d.for_people) : null, portion_note: d.portion_note, recipe_id: d.recipe_id, video_url: d.video_url,
      video: videoOf(book.get(dishKey(d.name))) ?? (d.video_url && /^https?:\/\//i.test(d.video_url) ? { url: d.video_url, title: null, thumbnail: youtubeThumb(d.video_url) } : null),
      last_time: lastTime(book.get(dishKey(d.name)), m.date),
      ingredients: itemRows.filter((i) => i.dish_id === d.id).map((i) => ({ id: i.id, item: i.item, amount: i.amount, unit: i.unit })),
    })),
  }));
}

export function weekView(db: Db, weekStart: string): WeekView {
  const rows = db.select().from(plan_meals).where(inWeek(weekStart)).all();
  const meals = mealViews(db, rows);
  const planned = rows.map((m) => m.created_at).filter(Boolean).sort()[0] ?? null;
  return { week_start: weekStart, status: weekStatus(rows), planned_at: planned,
    days: weekDates(weekStart).map((date) => ({ date, meals: meals.filter((m) => m.date === date) })) };
}

/** A week is a draft while any of its meals is one. */
function weekStatus(meals: MealRow[]): WeekView["status"] {
  return !meals.length ? null : meals.some((m) => m.status === "draft") ? "draft" : "final";
}

/** What counts as bought often for a plan's context: a cycle of ten days or less; at most this many items are listed. */
const OFTEN_DAYS = 10, OFTEN_MAX = 30;

export function weekContext(db: Db, weekStart: string): WeekContext {
  return {
    week_start: weekStart,
    people: db.select().from(people).where(eq(people.active, 1)).orderBy(asc(people.created_at)).all(),
    house: houseView(getHouse(db)),
    bought_often: db.select().from(items).orderBy(asc(items.name)).all()
      .filter((i) => i.lasts_days != null && i.lasts_days <= OFTEN_DAYS && !i.subscription)
      .map((i) => ({ item: i.name, cycle: cycleText(i, i.stated_days != null && i.lasts_days === i.stated_days)! })).slice(0, OFTEN_MAX),
    last_week: mealViews(db, db.select().from(plan_meals).where(inWeek(addDays(weekStart, -7))).all())
      .filter((m) => m.dishes.length).map((m) => ({ date: m.date, slot: m.slot, dishes: m.dishes.map((d) => d.name) })),
    known_dishes: knownDishes(db),
    recipes: db.select().from(saved_recipes).orderBy(asc(saved_recipes.name)).all()
      .map((r) => ({ id: r.id, name: r.name, tags: list<string>(r.tags), for_people: list<string>(r.for_people) })),
    grocery_app: groceryApp(db),
    family_dishes: familyDishes(db),
    how_to_plan: PLAN_METHOD,
  };
}

/** How the agent builds a week (owner 2026-11-22: "A good prompt can always fix failures that needs a higher model. The
 *  interview gives us enough data to populate a good week"). Given with the context, where the week is planned. */
export const PLAN_METHOD = `Build the week from family_dishes, the family's own food: choose and rotate, do not invent.
1. Each person first: read their rules (house.rules) and notes. Who has an only, avoid or swap rule needs their own dish or a portion_note.
2. Each meal of each cooking day: take that meal's dishes from family_dishes and spread them over the week, so each main dish
   is on two days at most (roti, rice and sides such as chutney, curd, plain dal come back freely; sambar and rasam are mains).
   Prefer dishes not on last_week; a dish rated didnt_work rarely. A dish listed with for is that person's: theirs only.
   A tiffin from the child's own list. Where the list runs short, add a dish like theirs that every rule allows (a new one
   only when the cook takes new recipes).
3. A person who cannot eat the shared dish gets their own, and the shared one is for: ["everyone"], except: [them].
4. Read the week through once: every person fed at every meal they eat at home, every rule kept, no main on three days.
5. A refusal names what is wrong: change only those meals, and keep every other meal exactly as you sent it.
One day, done right (Meera eats only plain idli or dosa at breakfast; Agastya has a tiffin; Lakshmi has millet for rice):
  Breakfast: Plain idli for ["Meera"]; Rava idli for ["everyone"] except ["Meera"]; Coconut chutney for ["everyone"]
  Agastya's tiffin: Vegetable poha for ["Agastya"]
  Lunch: Rajma for ["everyone"]; Steamed rice for ["everyone"], portion_note "millet in place of rice for Lakshmi"; Curd for ["everyone"]
  Dinner: Paneer butter masala for ["everyone"]; Phulka for ["everyone"]`;

// ── What was sent, checked ──

/** A real calendar date as "YYYY-MM-DD". */
export const dateOf = (v: unknown, what: string): string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v ? v : refuse(`${what} must be a date as YYYY-MM-DD`);
/** A slot by its name, whatever its capitals. One that is none of them is refused with the list, and with the name that was
 *  probably meant when it is near one ("Diner"; "tiffin" for "Agastya's tiffin"), as a field is (agentOps.ts checkFields).
 *  A meal sent with no slot is told so, not that its slot is wrong. */
const slotOf = (v: unknown, slots: string[]): string => {
  const given = typeof v === "string" ? v.trim() : "";
  if (!given) return refuse(`slot is required: one of ${slots.join(", ")}`);
  const hit = slots.find((s) => s.toLowerCase() === given.toLowerCase());
  if (hit) return hit;
  // Part of one slot's name only ("tiffin") is that slot; else the closest spelling.
  const within = slots.filter((s) => s.toLowerCase().includes(given.toLowerCase()));
  const near = within.length === 1 ? within[0] : closest(given, slots);
  return refuse(`slot must be one of: ${slots.join(", ")}${near ? ` (did you mean ${near}?)` : ""}`);
};
export const flag = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : refuse(`${what} must be true or false`));

function itemsOf(v: unknown, dish: string): Item[] {
  if (!Array.isArray(v)) return refuse(`${dish}: ingredients must be a list of { item, amount?, unit? }`);
  return v.map((i) => {
    if (!isObject(i)) return refuse(`${dish}: ingredients must be a list of { item, amount?, unit? }`);
    const item = name(i.item, `${dish}: an ingredient's item`);
    const amount = i.amount == null ? null : typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 ? i.amount
      : refuse(`${dish}: the amount of ${item} must be a number above 0 (put the measure in unit)`);
    return { item, amount, unit: i.unit === undefined ? null : words(i.unit, `${dish}: the unit of ${item}`) };
  });
}

const NO_EATERS = "no for";

/** Who eats a dish, as the agent sent it: `["everyone"]` alone, or names on the Family page (`people`), each written as there.
 *  Answers the list, or what is wrong with it. */
function eatersOf(who: string[], people: string[]): { who: string[] } | { problem: string } {
  if (!who.length) return { problem: NO_EATERS };
  if (who.some((w) => w.toLowerCase() === EVERYONE))
    return who.length === 1 ? { who: [EVERYONE] } : { problem: `for: "everyone" goes alone; otherwise name each person who eats it` };
  const unknown: string[] = [], out: string[] = [];
  for (const w of who) {
    const p = people.find((x) => x.toLowerCase() === w.toLowerCase());
    if (p) { if (!out.includes(p)) out.push(p); continue; }
    const near = closest(w, people);
    unknown.push(`${JSON.stringify(w)} is not on the Family page${near ? ` (did you mean ${near}?)` : ""}`);
  }
  return unknown.length ? { problem: `for: ${unknown.join(", ")}` } : { who: out };
}

/** The fields of a dish that were sent. From the family, `for` empty or null means everyone. From the agent (`people`: the
 *  names on the Family page), `for` is checked as eatersOf says, and what is wrong is kept in `eaters` to be told with the rest. */
function dishOf(db: Db, d: Record<string, unknown>, dishName: string, people: string[] | null = null, slot?: string): Dish {
  const set: Dish["set"] = {};
  let eaters: string | undefined;
  if (d.except != null) {
    // "Everyone except Meera" (Meera has her own dish): kept as the names of everyone else who eats that meal, so no one is
    // left out by a list typed by hand (flock-fast eval 2026-11-22: a child left with no breakfast).
    const out = names(d.except, `${dishName}: except`);
    const who = d.for == null ? [EVERYONE] : names(d.for, `${dishName}: for`);
    const diners = slot ? dinersAt(db, slot) : everyoneAtHome(db);
    const unknown = out.filter((o) => !diners.some((p) => p.toLowerCase() === o.toLowerCase()));
    const rest = diners.filter((p) => !out.some((o) => o.toLowerCase() === p.toLowerCase()));
    if (who.length !== 1 || who[0].toLowerCase() !== EVERYONE) eaters = `except goes with for: ["everyone"]`;
    else if (unknown.length) eaters = `except: ${unknown.map((u) => { const near = closest(u, diners); return `${JSON.stringify(u)} does not eat this meal${near ? ` (did you mean ${near}?)` : ""}`; }).join(", ")}`;
    else if (!rest.length) eaters = `everyone except ${out.join(", ")} leaves no one to eat it`;
    else set.for_people = JSON.stringify(rest);
  } else if (d.for !== undefined) {
    const who = d.for === null ? [] : names(d.for, `${dishName}: for`);
    if (people) {
      const e = eatersOf(who, people);
      if ("problem" in e) eaters = e.problem; else set.for_people = JSON.stringify(e.who);
    } else set.for_people = who.length ? JSON.stringify(who) : null;
  }
  if (d.portion_note !== undefined) set.portion_note = words(d.portion_note, `${dishName}: portion_note`);
  if (d.video_url !== undefined) set.video_url = words(d.video_url, `${dishName}: video_url`);
  if (d.recipe_id !== undefined) {
    set.recipe_id = d.recipe_id === null ? null
      : typeof d.recipe_id === "string" && db.select({ id: saved_recipes.id }).from(saved_recipes).where(eq(saved_recipes.id, d.recipe_id)).get() ? d.recipe_id
      : refuse(`${dishName}: no saved recipe has the id ${JSON.stringify(d.recipe_id)}`);
  }
  return { name: dishName, set, ...(d.ingredients !== undefined ? { items: itemsOf(d.ingredients, dishName) } : {}), ...(eaters ? { eaters } : {}) };
}

/** A dish as mergeSameDishes reads it, whether it was sent or is a row. */
export type DishPart = { name: string; for_people: string[] | null; portion_note: string | null; recipe_id: string | null; video_url: string | null; items: Item[] };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One meal's dishes with each dish once. The same dish planned more than once (the same name, once per person) becomes one,
 *  where the first stood, eaten by all of theirs together: with no eaters (the family's "everyone") when any of them had
 *  none; `["everyone"]` when any of them was for everyone, or when together they name everyone who eats the meal (`everyone`);
 *  else the people of all of them. Each one's note is kept, with whose it was ("two eggs for Shiva"); the ingredients are
 *  added up. `from` lists the dishes each one was made of, by their place in `parts`: one place for a dish left as it was. */
export function mergeSameDishes(parts: DishPart[], everyone: string[]): (DishPart & { from: number[] })[] {
  const out: (DishPart & { from: number[] })[] = [];
  parts.forEach((p, n) => {
    const had = out.find((o) => dishKey(o.name) === dishKey(p.name));
    if (!had) { out.push({ ...p, for_people: p.for_people?.length ? [...p.for_people] : null, items: p.items.map((i) => ({ ...i })), from: [n] }); return; }
    const noteOf = (d: DishPart) => {
      const note = d.portion_note?.trim();
      if (!note || !d.for_people || forEveryone(d.for_people) || d.for_people.some((who) => note.toLowerCase().includes(who.trim().toLowerCase()))) return note || null;
      return `${note} for ${d.for_people.join(" and ")}`;
    };
    // The first one's note names its people from the moment a second joins it.
    if (had.from.length === 1) had.portion_note = noteOf(had);
    const note = noteOf(p);
    if (note && !(had.portion_note ?? "").toLowerCase().includes(note.toLowerCase())) had.portion_note = [had.portion_note, note].filter(Boolean).join(", ");
    had.for_people = !had.for_people?.length || !p.for_people?.length ? null
      : forEveryone(had.for_people) || forEveryone(p.for_people) ? [EVERYONE]
      : [...had.for_people, ...p.for_people.filter((who) => !had.for_people!.some((x) => sameName(x, who)))];
    had.recipe_id ??= p.recipe_id; had.video_url ??= p.video_url;
    for (const i of p.items) {
      const same = had.items.find((x) => normItem(x.item) === normItem(i.item) && (x.unit ?? "").trim().toLowerCase() === (i.unit ?? "").trim().toLowerCase());
      if (!same) had.items.push({ ...i });
      else if (same.amount != null && i.amount != null) same.amount = Math.round((same.amount + i.amount) * 1e6) / 1e6;
    }
    had.from.push(n);
  });
  for (const o of out)
    if (o.from.length > 1 && o.for_people && !forEveryone(o.for_people) && everyone.length && everyone.every((who) => o.for_people!.some((x) => sameName(x, who))))
      o.for_people = [EVERYONE];
  return out;
}

/** The names of everyone who eats at home. */
const everyoneAtHome = (db: Db): string[] => db.select({ name: people.name }).from(people).where(eq(people.active, 1)).all().map((p) => p.name);
/** Who eats a meal in this slot: an extra slot's own people (a child's tiffin), else everyone at home (rules.ts dinersOf). */
const dinersAt = (db: Db, slot: string): string[] =>
  dinersOf(slot, everyoneAtHome(db).map((name) => ({ name })), houseView(getHouse(db)).extra_slots);

/** A meal's dishes as sent. `agent`: the agent sent them, so each names who eats it (a dish without `for` is told so). */
function dishesSent(db: Db, v: unknown, meal: string, slot: string, agent: boolean): Dish[] {
  if (!Array.isArray(v)) return refuse(`${meal}: dishes must be a list of { name, for, portion_note?, recipe_id?, video_url?, ingredients? }`);
  const family = agent ? everyoneAtHome(db) : null;
  const sent = v.map((d) => {
    if (!isObject(d)) return refuse(`${meal}: each dish is { name, ... }`);
    const dish = dishOf(db, d, name(d.name, `${meal}: a dish's name`), family, slot);
    return agent && d.for === undefined && d.except == null ? { ...dish, eaters: NO_EATERS } : dish;
  });
  // A meal is planned once: the same dish sent once per person is one dish, eaten by all of theirs.
  const merged = mergeSameDishes(sent.map((d) => ({ name: d.name, for_people: d.set.for_people ? list<string>(d.set.for_people) : null, portion_note: d.set.portion_note ?? null,
    recipe_id: d.set.recipe_id ?? null, video_url: d.set.video_url ?? null, items: d.items ?? [] })), dinersAt(db, slot));
  return merged.map((m) => {
    if (m.from.length === 1) return sent[m.from[0]];
    const eaters = m.from.map((n) => sent[n].eaters).find(Boolean);
    return { name: m.name,
      set: { for_people: m.for_people ? JSON.stringify(m.for_people) : null, portion_note: m.portion_note, recipe_id: m.recipe_id, video_url: m.video_url },
      ...(m.from.some((n) => sent[n].items) ? { items: m.items } : {}), ...(eaters ? { eaters } : {}) };
  });
}

const NO_DISHES_WITH_ORDER_IN = "a meal that is ordered in has no dishes: leave dishes out, or send ordered_in: false";

/** One meal of a plan_week list. */
function mealOf(db: Db, v: unknown, slots: string[], agent: boolean): Meal {
  if (!isObject(v)) return refuse("meals must be a list of { date, slot, ordered_in?, note?, dishes? }");
  const date = dateOf(v.date, "a meal's date"), slot = slotOf(v.slot, slots), label = `${date} ${slot}`;
  const meal: Meal = { date, slot };
  if (v.ordered_in !== undefined) meal.ordered_in = flag(v.ordered_in, `${label}: ordered_in`);
  if (v.note !== undefined) meal.note = words(v.note, `${label}: note`);
  if (v.dishes !== undefined) meal.dishes = dishesSent(db, v.dishes, label, slot, agent);
  if (meal.ordered_in && meal.dishes?.length) refuse(`${label}: ${NO_DISHES_WITH_ORDER_IN}`);
  return meal;
}

/** The meals sent for a week, each on a cooking day of that week and once only. */
function weekMealsSent(db: Db, sent: unknown[], weekStart: string, agent: boolean): { meals: Meal[]; seen: Set<string> } {
  const slots = slotNames(db);
  const meals = sent.map((m) => mealOf(db, m, slots, agent));
  const seen = new Set<string>();
  const cooking = houseView(getHouse(db)).cooking_days;
  for (const m of meals) {
    if (!cooking.includes(weekdayOf(m.date))) refuse(`${m.date} ${m.slot}: ${weekdayOf(m.date)} is not a cooking day (cooking days: ${cooking.join(", ")}); add it with set_cooking_days, or set_meal for one meal`, "NOT_COOKING_DAY");
    if (mondayOf(m.date) !== weekStart) refuse(`${m.date} ${m.slot} is not in the week of ${weekStart}`);
    if (seen.has(`${m.date} ${m.slot}`)) refuse(`${m.date} ${m.slot} is in meals twice`);
    seen.add(`${m.date} ${m.slot}`);
  }
  return { meals, seen };
}

// ── What a planned dish needs, and the checks on a final week ──

const mealLabel = (m: { date: string; slot: string }) => `${weekdayOf(m.date)} ${m.date} ${m.slot}`;
const INGREDIENTS_RULE = "Every planned dish needs its ingredients, with amounts for this family (add up the portions of the people it is for; leave out salt and water)";

/** The agent plans: every dish it sends in a final plan carries its ingredients. Names each dish without them. */
function missingIngredients(meals: Meal[]): string[] {
  return meals.flatMap((m) => (m.dishes ?? []).filter((d) => !d.items?.length).map((d) => `${mealLabel(m)}: ${d.name}`));
}

/** The agent plans: every dish it sends names who eats it. Names each dish that does not, and what is wrong. */
function missingEaters(meals: Meal[]): string[] {
  return meals.flatMap((m) => (m.dishes ?? []).filter((d) => d.eaters).map((d) => `${mealLabel(m)}: ${d.name} (${d.eaters})`));
}

/** What the agent is told when a dish does not say who eats it. `family`: the names on the Family page. */
const eatersSaid = (eaters: string[], family: string[]) =>
  `Every planned dish names who eats it in for: ["everyone"] (everyone who eats that meal) or the names of the people who eat it`
  + `${family.length ? ` (${family.join(", ")})` : ""}. A person's own dish names only them, and the shared dish is for everyone except them: for: ["everyone"], except: [their names].`
  + ` Not so: ${eaters.join("; ")}. Send each with its for.`;

/** The family's rules broken, in one sentence the agent acts on. */
const rulesSaid = (breaks: RuleBreak[]) =>
  `The family's food rules are broken: ${breaksText(breaks)}. Change each of these meals so it keeps the rule, then send it again.`;

/** A write by the agent refused, naming every dish without who eats it, every dish without ingredients and every rule it
 *  breaks together, so one round fixes them all. */
function refuseWrite(tx: Db, missing: string[], breaks: RuleBreak[], eaters: string[] = []): void {
  if (!missing.length && !breaks.length && !eaters.length) return;
  const said: string[] = [];
  if (eaters.length) said.push(eatersSaid(eaters, everyoneAtHome(tx)));
  if (missing.length) said.push(`${INGREDIENTS_RULE}. Without ingredients: ${missing.join("; ")}. Send each with ingredients: [{ item, amount, unit }].`);
  if (breaks.length) said.push(rulesSaid(breaks));
  refuse(said.join(" "), breaks.length ? "RULE_BROKEN" : eaters.length ? "MISSING_EATERS" : "MISSING_INGREDIENTS",
    { missing_ingredients: missing, ...(eaters.length ? { missing_eaters: eaters } : {}), ...(breaks.length ? { rule_breaks: breaks } : {}) });
}

/** The people the rules are checked for: everyone who eats at home. */
const peopleAtHome = (db: Db) => db.select({ name: people.name }).from(people).where(eq(people.active, 1)).all();

/** The rules a write to some meals of a final week breaks (rules.ts ruleBreaksIn): read inside the write, so a refusal undoes it. */
function breaksIn(tx: Db, weekStart: string, meals: { date: string; slot: string }[]): RuleBreak[] {
  return ruleBreaksIn(weekView(tx, weekStart), houseView(getHouse(tx)), peopleAtHome(tx), meals.map(mealLabel));
}

/** After the agent's write to one meal, inside its transaction: refused (and so undone) when a dish does not say who eats it
 *  or is left without ingredients, or when the meal is in a final week and breaks one of the family's rules. The family's
 *  own edits are never checked. */
function guardMeal(tx: Db, meal: MealRow, missing: string[], eaters: string[] = []): void {
  refuseWrite(tx, missing, meal.status === "final" ? breaksIn(tx, mondayOf(meal.date), [meal]) : [], eaters);
}

/** Each extra slot (a child's tiffin) without a meal on one of its days that is a cooking day from today on. */
function slotGaps(week: WeekView, house: HouseView, today: string): string[] {
  const meals = week.days.flatMap((d) => d.meals), gaps: string[] = [];
  for (const slot of house.extra_slots) {
    for (const date of weekDates(week.week_start)) {
      const day = weekdayOf(date);
      if (date < today || !house.cooking_days.includes(day) || (slot.days?.length && !slot.days.includes(day))) continue;
      if (!meals.some((m) => m.date === date && dishKey(m.slot) === dishKey(slot.name))) gaps.push(mealLabel({ date, slot: slot.name }));
    }
  }
  return gaps;
}

/** A cooking day from today on with no meal at all, for the menu, which is the whole week (flock-fast eval 2026-11-22: a
 *  week sent with Sunday empty). One meal, or one ordered in, is enough: a home may skip a meal. A day's meals kept from
 *  the menu stay without ingredients until the day is planned, so the close refuses an unplanned day too. */
function emptyDays(week: WeekView, house: HouseView, today: string): string[] {
  const meals = week.days.flatMap((d) => d.meals);
  return weekDates(week.week_start).filter((date) => date >= today && house.cooking_days.includes(weekdayOf(date)) && !meals.some((m) => m.date === date))
    .map((date) => `${weekdayOf(date)} ${date}: no meal at all`);
}

/** A main dish comes back on at most this many days of the weekly plan (owner 2026-11-22). */
export const MAIN_DAYS_MAX = 2;
const STAPLES = new Set<string>(STAPLE_DISHES);
/** A grain before a staple keeps it a staple: "Jowar roti", "Ragi roti", "Brown rice" come back like roti and rice. */
const STAPLE_GRAINS = new Set(["jowar", "bajra", "ragi", "nachni", "makki", "millet", "multigrain", "wheat", "brown", "red", "kambu"]);
const isStaple = (name: string): boolean => {
  const key = dishKey(name), w = key.split(" ");
  return STAPLES.has(key) || (w.length === 2 && STAPLE_GRAINS.has(w[0]) && STAPLES.has(w[1]));
};

/** The main dishes on more than MAIN_DAYS_MAX days of the week: "Paneer bhurji (Mon, Tue, Thu)". Staples, sides and the
 *  dishes an `only` rule names come back freely. Checked on the weekly plan only (plan_menu, the closing plan_week): never on
 *  set_meal / set_dish, so the family's changes in chat are never refused. */
function overRepeated(week: WeekView, house: HouseView): string[] {
  const days = new Map<string, { name: string; days: Set<string> }>();
  for (const m of week.days.flatMap((d) => d.meals)) for (const d of m.dishes) {
    if (isStaple(d.name) || isRepeatableSide(d.name) || namedInOnlyRule(d.name, house.rules)) continue;
    const k = dishKey(d.name), seen = days.get(k) ?? { name: d.name, days: new Set<string>() };
    seen.days.add(m.date); days.set(k, seen);
  }
  return [...days.values()].filter((d) => d.days.size > MAIN_DAYS_MAX).map((d) => `${d.name} (${[...d.days].sort().map(weekdayOf).join(", ")})`);
}
const repeatsSaid = (repeated: string[]) =>
  `A main dish is on more than ${MAIN_DAYS_MAX} days: ${repeated.join("; ")}: plan something else on the other days (roti, rice, sides and a person's only dishes may come back).`;

/** The checks a week passes before its closing call answers the message: every dish has its ingredients, and every extra slot
 *  (a child's tiffin) has a meal on each of its days that is a cooking day from today on. Refused with every problem named, so
 *  one fix round is enough. A main dish on more than MAIN_DAYS_MAX days is refused too (overRepeated); the family's own changes
 *  once the week is sent never are. */
function checkWeek(week: WeekView, house: HouseView, today: string, breaks: RuleBreak[]): void {
  const meals = week.days.flatMap((d) => d.meals);
  const missing = meals.flatMap((m) => m.dishes.filter((d) => !d.ingredients.length).map((d) => `${mealLabel(m)}: ${d.name}`));
  // A meal from today on with no dish and not ordered in: the week is not planned (sim run seed 15: every meal sent
  // with no dishes, the closing call answered "Monday: nothing planned").
  const empty = meals.filter((m) => !m.ordered_in && !m.dishes.length && m.date >= today).map(mealLabel);
  const gaps = slotGaps(week, house, today);
  const repeated = overRepeated(week, house);
  if (!missing.length && !empty.length && !gaps.length && !breaks.length && !repeated.length) return;
  const said: string[] = breaks.length ? [rulesSaid(breaks)] : [];
  if (empty.length) said.push(`These meals have no dish: ${empty.join("; ")}. Send each with its dishes (plan_week final, keep_rest, that day's meals with dishes), or ordered_in: true with a note when they eat out.`);
  if (missing.length) said.push(`${INGREDIENTS_RULE}. Without ingredients: ${missing.join("; ")}: give each its ingredients with set_dish { dish_id, ingredients }.`);
  if (gaps.length) said.push(`An extra slot has no meal on its day: ${gaps.join("; ")}. Plan it with set_meal { date, slot, dishes }; on a day it is not needed (no school), set_meal { date, slot, ordered_in: true, note }.`);
  if (repeated.length) said.push(`${repeatsSaid(repeated)} Change them with set_dish.`);
  refuse(`The week is not ready to send. ${said.join(" ")}`,
    breaks.length ? "RULE_BROKEN" : empty.length ? "EMPTY_MEALS" : missing.length ? "MISSING_INGREDIENTS" : gaps.length ? "MISSING_SLOTS" : "REPEATED_DISHES",
    { missing_ingredients: missing, missing_slots: gaps, repeated, empty_meals: empty, ...(breaks.length ? { rule_breaks: breaks } : {}) });
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
  keepVideo(tx, d.name, d.set.video_url, by, changes);
  return row;
}

/** A video sent with a planned dish is the dish's own from then on (dishBook.ts): the next week it is planned in shows it. */
function keepVideo(tx: Db, dish: string, url: string | null | undefined, by: string, changes: Change[]) {
  if (url && /^https?:\/\/\S+$/i.test(url)) setVideo(tx, dish, { url }, by, changes);
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

/** At boot: a meal planned before dishes were merged may hold the same dish once per person ("Aloo paratha · Aloo paratha").
 *  Each such meal's rows are made one dish (mergeSameDishes), so the Week page, the messages and an edit all see the one.
 *  Answers how many dishes were folded away; a week with none is left untouched. */
export function mergeDuplicateDishes(db: Db): number {
  const all = db.select().from(dishes).orderBy(asc(dishes.position), asc(dishes.created_at)).all();
  const byMeal = new Map<string, DishRow[]>();
  for (const d of all) byMeal.set(d.meal_id, [...(byMeal.get(d.meal_id) ?? []), d]);
  const twice = [...byMeal.entries()].filter(([, rows]) => new Set(rows.map((d) => dishKey(d.name))).size < rows.length);
  if (!twice.length) return 0;
  const slotOf = new Map(db.select({ id: plan_meals.id, slot: plan_meals.slot }).from(plan_meals).where(inArray(plan_meals.id, twice.map(([id]) => id))).all()
    .map((m) => [m.id, m.slot]));
  let folded = 0;
  db.transaction((txRaw) => {
    const tx = txRaw as unknown as Db, changes: Change[] = [];
    for (const [mealId, rows] of twice) {
      const itemsOf = (id: string) => tx.select().from(dish_items).where(eq(dish_items.dish_id, id)).orderBy(asc(dish_items.created_at), sql`rowid`).all()
        .map((i) => ({ item: i.item, amount: i.amount, unit: i.unit }));
      const merged = mergeSameDishes(rows.map((d) => ({ name: d.name, for_people: d.for_people ? list<string>(d.for_people) : null, portion_note: d.portion_note,
        recipe_id: d.recipe_id, video_url: d.video_url, items: itemsOf(d.id) })), dinersAt(db, slotOf.get(mealId) ?? ""));
      for (const m of merged) {
        if (m.from.length === 1) continue;
        const [keep, ...rest] = m.from.map((n) => rows[n]);
        tx.update(dishes).set({ for_people: m.for_people ? JSON.stringify(m.for_people) : null, portion_note: m.portion_note, recipe_id: m.recipe_id, video_url: m.video_url,
          updated_at: now() }).where(eq(dishes.id, keep.id)).run();
        removeItems(tx, keep.id, changes);
        addItems(tx, keep.id, m.items, keep.updated_by ?? "app", changes);
        for (const d of rest) removeDish(tx, d.id, changes);
        folded += rest.length;
      }
      orderDishes(tx, mealId, changes);
    }
  });
  return folded;
}

export function mountMealRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { basePath: string; now?: () => Date }) {
  const write = writeRoutes(hono);
  const today = () => todayStr((opts.now ?? (() => new Date()))());
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

  // plan_week { week_start, mode: draft | final, meals?, keep_rest? }. With meals: they become the week's plan, in place of
  // what was there; with keep_rest they take the place of the meals at their own date and slot only, so a week is planned in
  // parts (a whole week is more than Flock lets one call carry). Without meals: a week of drafts is made final when mode is
  // final; anything else answers with what the agent plans from.
  write("/api/weeks/:week_start/plan", async (b, by, c) => {
    const weekStart = dateOf(c.req.param("week_start"), "week_start");
    if (weekdayOf(weekStart) !== "Mon") refuse(`week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}`);
    const mode = b.mode === "draft" || b.mode === "final" ? b.mode : refuse("mode must be draft or final");
    if (b.meals === undefined) {
      const drafts = mode === "final" ? db.select().from(plan_meals).where(and(inWeek(weekStart), eq(plan_meals.status, "draft"))).all() : [];
      // A week already final is closed again: the message is answered from it. A week with no meals answers the context.
      const planned = mode === "final" && !drafts.length && !!db.select().from(plan_meals).where(inWeek(weekStart)).limit(1).get();
      if (!drafts.length && !planned) return { body: { context: weekContext(db, weekStart) } };
      if (mode === "final" && by.startsWith("agent:")) {
        const view = weekView(db, weekStart), house = houseView(getHouse(db));
        checkWeek(view, house, today(), ruleBreaks(view, house, peopleAtHome(db)));
      }
      commit((tx, changes) => {
        for (const m of drafts) {
          tx.update(plan_meals).set({ status: "final", updated_at: now(), updated_by: by }).where(eq(plan_meals.id, m.id)).run();
          changes.push(["plan_meals", m.id, "update", by]);
        }
      });
    } else {
      if (!Array.isArray(b.meals) || !b.meals.length) refuse("meals must be a list of the week's meals: { date, slot, ordered_in?, note?, dishes? }; leave it out to read the context");
      const keepRest = b.keep_rest === undefined ? false : flag(b.keep_rest, "keep_rest");
      const agent = by.startsWith("agent:");
      const { meals, seen } = weekMealsSent(db, b.meals as unknown[], weekStart, agent);
      const checked = mode === "final" && agent;
      const missing = checked ? missingIngredients(meals) : [], eaters = agent ? missingEaters(meals) : [];
      commit((tx, changes) => {
        for (const old of tx.select().from(plan_meals).where(inWeek(weekStart)).all()) {
          if (keepRest && !seen.has(`${old.date} ${old.slot}`)) {
            // A meal that stays: with a final part the whole week is final, as when a draft is made final.
            if (mode === "final" && old.status !== "final") {
              tx.update(plan_meals).set({ status: "final", updated_at: now(), updated_by: by }).where(eq(plan_meals.id, old.id)).run();
              changes.push(["plan_meals", old.id, "update", by]);
            }
            continue;
          }
          removeDishes(tx, old.id, changes);
          tx.delete(plan_meals).where(eq(plan_meals.id, old.id)).run();
          changes.push(["plan_meals", old.id, "delete", "app"]);
        }
        for (const m of meals) {
          const row = tx.insert(plan_meals).values({ date: m.date, slot: m.slot, ordered_in: m.ordered_in ? 1 : 0, note: m.note ?? null, status: mode, updated_by: by }).returning().get();
          changes.push(["plan_meals", row.id, "insert", by]);
          (m.dishes ?? []).forEach((d, position) => addDish(tx, row.id, position, d, by, changes));
        }
        // The agent's final plan keeps the family's rules: the meals it sent, and a cap over the week they count towards.
        // Checked on the week as written, so a refusal undoes the whole call.
        if (agent) refuseWrite(tx, missing, checked ? breaksIn(tx, weekStart, meals) : [], eaters);
      });
    }
    const week = weekView(db, weekStart);
    // The message and the intro come only from the closing call (final, no meals), once the week is whole: a week planned in parts
    // by final calls with meals carries neither. A final week is kept whether or not anyone replies.
    if (mode !== "final" || b.meals !== undefined) return { body: { week } };
    const house = getHouse(db), view = houseView(house);
    const monday = view.cooking_days.includes("Mon") ? week.days[0].meals : [];
    const out: Record<string, unknown> = { week, message: weekMessage({ monday, link: weekLink(opts.basePath, weekStart) }) };
    if (!house.intro_sent_at) {
      // The daily items the cart is filled with as they come due: an item delivered on a subscription (a milkman) never goes in a cart.
      const everyday = db.select().from(items).where(eq(items.group, "daily")).orderBy(asc(items.created_at), sql`rowid`).all()
        .filter((i) => i.lasts_days != null && !i.subscription && !i.dont_ask).map((i) => i.name).slice(0, 2);
      out.intro = introText({ plan: view.plan_time ?? "11:00", afternoon: view.afternoon_time ?? "15:00", evening: view.evening_time ?? "19:00" }, everyday);
      db.update(house_t).set({ intro_sent_at: now() }).where(eq(house_t.id, house.id)).run();
    }
    out.instructions = weekSendText(!!out.intro);
    return { body: out };
  });

  // plan_menu { week_start, meals }: the whole week's dishes by name and who eats each, no ingredients, in one
  // call (small enough for one). Checked as a whole before anything is cooked up: who eats each dish, the rules a name shows
  // (Meera's breakfast, a cap, egg on a veg day), each extra slot's days, and no main dish on more than MAIN_DAYS_MAX days.
  // Refused with every problem named; kept as the
  // week's draft when it passes, which the agent then fills a day a call with ingredients (plan_week final, keep_rest). The
  // agent sees the week whole here, so it can vary it as the guide asks (flock-fast eval 2026-11-22).
  write("/api/weeks/:week_start/menu", async (b, by, c) => {
    const weekStart = dateOf(c.req.param("week_start"), "week_start");
    if (weekdayOf(weekStart) !== "Mon") refuse(`week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}`);
    if (!Array.isArray(b.meals) || !b.meals.length) refuse("meals must be the whole week's meals: [{ date, slot, ordered_in?, note?, dishes?: [{ name, for, portion_note? }] }]");
    const agent = by.startsWith("agent:");
    const { meals } = weekMealsSent(db, b.meals as unknown[], weekStart, agent);
    const eaters = agent ? missingEaters(meals) : [];
    commit((tx, changes) => {
      for (const old of tx.select().from(plan_meals).where(inWeek(weekStart)).all()) {
        removeDishes(tx, old.id, changes);
        tx.delete(plan_meals).where(eq(plan_meals.id, old.id)).run();
        changes.push(["plan_meals", old.id, "delete", "app"]);
      }
      for (const m of meals) {
        const row = tx.insert(plan_meals).values({ date: m.date, slot: m.slot, ordered_in: m.ordered_in ? 1 : 0, note: m.note ?? null, status: "draft", updated_by: by }).returning().get();
        changes.push(["plan_meals", row.id, "insert", by]);
        (m.dishes ?? []).forEach((d, position) => addDish(tx, row.id, position, d, by, changes));
      }
      const view = weekView(tx, weekStart), house = houseView(getHouse(tx));
      const breaks = ruleBreaks(view, house, peopleAtHome(tx));
      const gaps = [...emptyDays(view, house, today()), ...slotGaps(view, house, today())];
      const repeated = overRepeated(view, house);
      if (!eaters.length && !breaks.length && !gaps.length && !repeated.length) return;
      const said: string[] = [];
      if (eaters.length) said.push(eatersSaid(eaters, everyoneAtHome(tx)));
      if (breaks.length) said.push(rulesSaid(breaks));
      if (gaps.length) said.push(`An extra slot has no meal on its day: ${gaps.join("; ")}: add it to the menu (ordered_in: true with a note on a day it is not needed).`);
      if (repeated.length) said.push(repeatsSaid(repeated));
      refuse(`The menu is not ready. ${said.join(" ")} Send the whole menu again, fixed.`,
        breaks.length ? "RULE_BROKEN" : eaters.length ? "MISSING_EATERS" : gaps.length ? "MISSING_SLOTS" : "REPEATED_DISHES",
        { ...(breaks.length ? { rule_breaks: breaks } : {}), ...(eaters.length ? { missing_eaters: eaters } : {}), missing_slots: gaps, repeated });
    });
    return { body: { week: weekView(db, weekStart), next: "The menu is kept as next week's draft. Now give each day its ingredients: plan_week { week_start, mode: \"final\", keep_rest: true, meals } one day a call, the menu's dishes with the same names and for, then the closing plan_week { week_start, mode: \"final\" }." } };
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
    const agent = by.startsWith("agent:");
    const sent = b.dishes === undefined ? undefined : dishesSent(db, b.dishes, label, meal?.slot ?? at!.slot, agent);
    const orderedIn = !!(set.ordered_in ?? meal?.ordered_in);
    if (orderedIn && sent?.length) refuse(`${label}: ${NO_DISHES_WITH_ORDER_IN}`);
    const missing = sent && agent ? missingIngredients([{ ...(meal ?? at!), dishes: sent }]) : [];
    const eaters = sent && agent ? missingEaters([{ ...(meal ?? at!), dishes: sent }]) : [];
    const id = commit((tx, changes) => {
      const row = meal
        ? tx.update(plan_meals).set({ ...set, updated_at: now(), updated_by: by }).where(eq(plan_meals.id, meal.id)).returning().get()
        : tx.insert(plan_meals).values({ ...set, ...at!, status: statusFor(at!.date), updated_by: by }).returning().get();
      changes.push(["plan_meals", row.id, meal ? "update" : "insert", by]);
      if (orderedIn || sent) removeDishes(tx, row.id, changes);
      (sent ?? []).forEach((d, position) => addDish(tx, row.id, position, d, by, changes));
      if (agent) guardMeal(tx, row, missing, eaters);
      return row.id;
    });
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
      commit((tx, changes) => {
        removeDish(tx, dish.id, changes); orderDishes(tx, meal.id, changes);
        if (by.startsWith("agent:")) guardMeal(tx, meal, []);
      });
      return { body: { meal: mealView(meal.id) } };
    }
    const agent = by.startsWith("agent:");
    const sent = dishOf(db, b, label, agent ? everyoneAtHome(db) : null, meal?.slot ?? at?.slot);
    if (!dish && meal?.ordered_in) refuse(`${meal.date} ${meal.slot} is ordered in, so it has no dishes: set_meal it with ordered_in: false first`);
    const missing = agent && (sent.items ? !sent.items.length
      : !dish || !db.select({ id: dish_items.id }).from(dish_items).where(eq(dish_items.dish_id, dish.id)).limit(1).get())
      // The agent plans: a dish it adds or changes ends with its ingredients.
      ? missingIngredients([{ ...(meal ?? at!), dishes: [{ ...sent, name: b.dish_id != null && typeof b.name === "string" ? b.name : label }] }]) : [];
    // The agent plans: a dish it adds says who eats it, and a `for` it sends names them as the Family page does. A dish there
    // already keeps its eaters (a family's own dish without any stays for everyone).
    const eaters = agent ? missingEaters([{ ...(meal ?? at!), dishes: [{ ...sent, name: b.dish_id != null && typeof b.name === "string" ? b.name : label,
      eaters: sent.eaters ?? (b.for === undefined && b.except == null && !dish ? NO_EATERS : undefined) }] }]) : [];
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
        keepVideo(tx, rename.name ?? row.name, sent.set.video_url, by, changes);
        if (sent.items) { removeItems(tx, row.id, changes); addItems(tx, row.id, sent.items, by, changes); }
      } else row = addDish(tx, mealRow.id, dishesOf(tx, mealRow.id).length, sent, by, changes);
      orderDishes(tx, mealRow.id, changes, position === undefined ? undefined : { id: row.id, at: position });
      if (agent) guardMeal(tx, mealRow, missing, eaters);
      return { meal: mealRow.id, dish: row.id };
    });
    const view = mealView(ids.meal);
    return { body: { dish: view.dishes.find((d) => d.id === ids.dish), meal: view } };
  });
}
