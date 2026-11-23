// The week as the pages, the reminders and the messages read it: each slot-day (slotStore.ts) of a week by date and planning
// order, its dishes in order, each with what it needs bought, its video and how it went last time (the library, dishBook.ts).
// A slot-day eaten out or ordered in has no dishes, so nothing is bought for it. The plan itself is written by make_plan
// (makePlan.ts) and, later, the change operations; this file only reads it, and closes a planned week with its message.
//
// The section at the end ("Kept for make_plan") is the old plan's context and checks, which makePlan.ts still compiles
// against until lane C rewrites it: its reads of the removed tables throw LANE_C.
import type { Hono } from "hono";
import { asc, eq, sql } from "drizzle-orm";
import { house as house_t, items, type people } from "./db/schema";
import { DISH_DAYS_MAX, STAPLE_DISHES, type GroceryApp, type Often, type Skip, type SlotDayStatus } from "./db/constants";
import { addDays, weekDates, weekdayOf } from "./dates";
import { introText, weekLink, weekMessage, weekSendText } from "./messages";
import { dishKey, type LastTime } from "./dishText";
import { bookOf, lastTime, videoOf, type DishVideo } from "./dishBook";
import { isRepeatableSide, namedInOnlyRule } from "./rules";
import { getHouse, houseView, refuse, type Db } from "./family";
import { listSlotDays, type SlotDay } from "./slotStore";
import { LANE_C, type KnownDish, type FamilyDish, type LegacyHouse, type OftenMap } from "./legacy";

export type IngredientView = { id: string; item: string; amount: number | null; unit: string | null };
/** A planned dish. `video`: the dish's own (the library's, by its name); `last_time`: how it went the last time it was eaten
 *  before this slot-day, when the family said; `portion_note`: the dish's note for someone ("millet rice for Papa"); `new`: a
 *  new suggestion. A dish is for the slot-day's people: `for_people`, `recipe_id` and `video_url` are always null (kept for
 *  the pages and the messages, which read the old shape). */
export type DishView = { id: string; name: string; for_people: string[] | null; portion_note: string | null; recipe_id: string | null;
  video_url: string | null; video: DishVideo | null; last_time: LastTime | null; ingredients: IngredientView[]; new: boolean };
/** A slot-day as the pages and messages read it: `ordered_in` is true when it is not cooked at home (`skip`). */
export type MealView = { id: string; date: string; slot: string; ordered_in: boolean; skip: Skip | null; note: string | null; people: string[];
  status: SlotDayStatus; dishes: DishView[] };
/** A week as the pages and the agent read it. `status` is null while the week has no slot-days, else "final" (a plan is a
 *  suggestion, never a draft); `planned_at` is when its first slot-day was made, null with none. */
export type WeekView = { week_start: string; status: "draft" | "final" | null; planned_at: string | null; days: { date: string; meals: MealView[] }[] };

const now = () => new Date().toISOString();

function mealViews(db: Db, days: SlotDay[]): MealView[] {
  const book = bookOf(db, days.flatMap((d) => d.dishes.map((x) => x.dish)));
  return days.filter((d) => d.date !== null).map((d) => ({
    id: d.id, date: d.date!, slot: d.slot, ordered_in: d.skip !== null, skip: d.skip, note: d.note, people: d.people, status: d.status,
    dishes: d.dishes.map((x) => ({ id: x.id, name: x.dish, for_people: null, portion_note: x.note, recipe_id: null, video_url: null, new: x.new,
      video: videoOf(book.get(dishKey(x.dish))), last_time: lastTime(book.get(dishKey(x.dish)), d.date!),
      ingredients: x.ingredients.map((i) => ({ id: i.id, item: i.item, amount: i.amount, unit: i.unit })) })),
  }));
}

export function weekView(db: Db, weekStart: string): WeekView {
  const days = listSlotDays(db, { from: weekStart, to: addDays(weekStart, 6) });
  const meals = mealViews(db, days);
  const planned = days.map((d) => d.created_at).filter((x): x is string => !!x).sort()[0] ?? null;
  return { week_start: weekStart, status: days.length ? "final" : null, planned_at: planned,
    days: weekDates(weekStart).map((date) => ({ date, meals: meals.filter((m) => m.date === date) })) };
}

// ── What was sent, checked ──

/** A real calendar date as "YYYY-MM-DD". */
export const dateOf = (v: unknown, what: string): string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v ? v : refuse(`${what} must be a date as YYYY-MM-DD`);
export const flag = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : refuse(`${what} must be true or false`));

/** What a planned week's closing answers: the week, the Sunday `message` (Monday's meals and the Week link), the how-to `intro`
 *  the first time only (then it is marked sent), and how to send them. */
export function closeWeek(db: Db, weekStart: string, basePath: string, unmet: string[] = []): { week: WeekView; message: string; intro?: string; instructions: string } {
  const week = weekView(db, weekStart);
  const house = getHouse(db), view = houseView(house);
  const monday = week.days[0].meals;
  const out: { week: WeekView; message: string; intro?: string; instructions: string } = { week, message: weekMessage({ monday, link: weekLink(basePath, weekStart), unmet }), instructions: "" };
  if (!house.intro_sent_at) {
    // The daily items the cart is filled with as they come due: an item delivered on a subscription (a milkman) never goes in a cart.
    const everyday = db.select().from(items).where(eq(items.group, "daily")).orderBy(asc(items.created_at), sql`rowid`).all()
      .filter((i) => i.lasts_days != null && !i.subscription && !i.dont_ask).map((i) => i.name).slice(0, 2);
    out.intro = introText({ plan: view.plan_time ?? "11:00", afternoon: view.afternoon_time ?? "15:00", evening: view.evening_time ?? "19:00" }, everyday);
    db.update(house_t).set({ intro_sent_at: now() }).where(eq(house_t.id, house.id)).run();
  }
  out.instructions = weekSendText(!!out.intro);
  return out;
}

export function mountMealRoutes(hono: Hono<any>, db: Db, _emit: unknown, _opts: { basePath: string; now?: () => Date }) {
  // The Week page's read: one week, by its Monday.
  hono.get("/api/weeks/:week_start", (c) => {
    const weekStart = c.req.param("week_start");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || addDays(weekStart, 0) !== weekStart) return c.json({ ok: false, reason: "week_start must be a date as YYYY-MM-DD" }, 400);
    if (weekdayOf(weekStart) !== "Mon") return c.json({ ok: false, reason: `week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}` }, 400);
    return c.json(weekView(db, weekStart));
  });
}

// ── Kept for make_plan (makePlan.ts) until lane C rewrites it ──

/** The old plan's context. */
export type WeekContext = { week_start: string; people: (typeof people.$inferSelect)[]; house: LegacyHouse; bought_often: { item: string; cycle: string }[];
  last_week: { date: string; slot: string; dishes: string[] }[]; known_dishes: KnownDish[];
  recipes: { id: string; name: string; tags: string[]; for_people: string[] }[]; grocery_app: GroceryApp;
  family_dishes: Record<string, FamilyDish[]>; how_to_plan: string };

/** The old plan's context read the removed tables: lane C plans from the slot model instead. */
export function weekContext(_db: Db, _weekStart: string): WeekContext { throw new Error(LANE_C); }
/** The old plan's save wrote the removed tables: lane C saves slot-days instead. */
export function saveWeek(_db: Db, _emit: unknown, _weekStart: string, _sent: unknown[], _opts: { keepRest?: boolean; by?: string } = {}): void { throw new Error(LANE_C); }

/** How the agent built a week in the old plan. */
export const PLAN_METHOD = `Build the week from family_dishes, the family's own food: choose and rotate, do not invent.
1. Each person first: read their rules (house.rules) and notes. Who has an only, avoid or swap rule needs their own dish or a portion_note.
2. Each meal of each day: take that meal's dishes from family_dishes and spread them over the week, so each main dish
   is on two days at most, a person's own dish too (roti, rice and sides such as chutney, curd, plain dal come back freely;
   sambar and rasam are mains). A dish listed with often comes as often as the family has it (usually: up to 5 days;
   sometimes: 2; rarely: 1), with per_week on that many days, with days only on those days.
   A rule with a number of times a week ("2–3 times a week") is kept at that many meals, not at every meal.
   Prefer dishes not on last_week; a dish rated didnt_work rarely. A dish listed with for is that person's: theirs only.
   A tiffin from the child's own list. Where the list runs short, add a dish like theirs that every rule allows (a new one
   only when the cook takes new recipes).
3. A person who cannot eat the shared dish gets their own, and the shared one is for: ["everyone"], except: [them].
4. Read the week through once: every person fed at every meal they eat at home, every rule kept, no dish more often than allowed.
5. A refusal names what is wrong: change only those meals, and keep every other meal exactly as you sent it.
One day, done right (Kabir eats only plain idli or dosa at breakfast and has a tiffin; Nani has millet for rice):
  Breakfast: Plain idli for ["Kabir"]; Rava idli for ["everyone"] except ["Kabir"]; Coconut chutney for ["everyone"]
  Kabir's tiffin: Vegetable poha for ["Kabir"]
  Lunch: Rajma for ["everyone"]; Steamed rice for ["everyone"], portion_note "millet in place of rice for Nani"; Curd for ["everyone"]
  Dinner: Paneer butter masala for ["everyone"]; Phulka for ["everyone"]`;

/** A main dish came back on at most this many days of the old weekly plan. */
export const MAIN_DAYS_MAX = 2;
const STAPLES = new Set<string>(STAPLE_DISHES);
const STAPLE_GRAINS = new Set(["jowar", "bajra", "ragi", "nachni", "makki", "millet", "multigrain", "wheat", "brown", "red", "kambu"]);
/** The old fixed staple list (roti, rice, curd...): the slot model derives a slot's staples from its history (slotStore.ts staples). */
export const isStaple = (name: string): boolean => {
  const key = dishKey(name), w = key.split(" ");
  return STAPLES.has(key) || (w.length === 2 && STAPLE_GRAINS.has(w[0]) && STAPLES.has(w[1]));
};

/** How many days of the week a dish may be on in the old plan, and on which. */
export function dishLimit(f: { often?: Often; per_week?: number; days?: string[] } | undefined): { max: number; days?: string[]; why: string } {
  const days = f?.days?.length ? f.days : undefined;
  const max = Math.min(f?.per_week ?? (days ? days.length : f?.often ? DISH_DAYS_MAX[f.often] : MAIN_DAYS_MAX), days?.length ?? 7);
  const n = max === 1 ? "once" : max === 2 ? "twice" : `${max} days`;
  const why = f?.per_week != null ? `the family has it ${n} a week${days ? ` (${days.join(", ")})` : ""}`
    : days ? `the family has it on ${days.join(", ")} only`
    : f?.often ? `the family has it ${f.often}: ${max === 1 ? "once a week" : `${max} days a week`} at most`
    : `a main dish is on ${MAIN_DAYS_MAX} days at most`;
  return { max, ...(days ? { days } : {}), why };
}

export type Repeat = { name: string; dates: string[]; over: string[]; max: number; why: string };
/** The dishes the old plan had more often than the family does. */
export function repeatedDays(week: WeekView, house: Pick<LegacyHouse, "rules">, often: OftenMap = new Map()): Repeat[] {
  const days = new Map<string, { name: string; days: Set<string> }>();
  for (const m of week.days.flatMap((d) => d.meals)) for (const d of m.dishes) {
    const k = dishKey(d.name), f = often.get(k);
    const counted = f?.per_week != null || !!f?.days?.length;
    if (!counted && (isStaple(d.name) || isRepeatableSide(d.name) || namedInOnlyRule(d.name, house.rules))) continue;
    const seen = days.get(k) ?? { name: d.name, days: new Set<string>() };
    seen.days.add(m.date); days.set(k, seen);
  }
  const out: Repeat[] = [];
  for (const [k, d] of days) {
    const lim = dishLimit(often.get(k)), dates = [...d.days].sort();
    const off = lim.days ? dates.filter((x) => !lim.days!.includes(weekdayOf(x))) : [];
    const on = dates.filter((x) => !off.includes(x));
    const over = [...off, ...on.slice(lim.max)].sort();
    if (over.length) out.push({ name: d.name, dates, over, max: lim.max, why: lim.why });
  }
  return out;
}
