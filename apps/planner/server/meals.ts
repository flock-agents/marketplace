// The week as the pages, the reminders and the messages read it: each slot-day (slotStore.ts) of a week by date and planning
// order, its dishes in order, each with what it needs bought, its video and how it went last time (the library, dishBook.ts).
// A slot-day eaten out or ordered in has no dishes, so nothing is bought for it. The plan itself is written by make_plan
// (makePlan.ts) and, later, the change operations; this file only reads it, and closes a planned week with its message.
import type { Hono } from "hono";
import { asc, eq, sql } from "drizzle-orm";
import { house as house_t, items } from "./db/schema";
import { type Skip, type SlotDayStatus } from "./db/constants";
import { addDays, weekDates, weekdayOf } from "./dates";
import { introText, weekLink, weekMessage, weekSendText } from "./messages";
import { dishKey, type LastTime } from "./dishText";
import { bookOf, lastTime, videoOf, type DishVideo } from "./dishBook";
import { getHouse, houseView, refuse, type Db } from "./family";
import { listSlotDays, type SlotDay } from "./slotStore";

export type IngredientView = { id: string; item: string; amount: number | null; unit: string | null };
/** A planned dish. `video`: the dish's own (the library's, by its name); `last_time`: how it went the last time it was eaten
 *  before this slot-day, when the family said; `portion_note`: the dish's note for someone ("millet rice for Papa"); `new`: a
 *  new suggestion. A dish is for the slot-day's people: `for_people`, `recipe_id` and `video_url` are always null (kept for
 *  the pages and the messages, which read the old shape). */
export type DishView = { id: string; name: string; for_people: string[] | null; portion_note: string | null; recipe_id: string | null;
  video_url: string | null; video: DishVideo | null; last_time: LastTime | null; ingredients: IngredientView[]; new: boolean;
  /** The people at the slot-day a hard rule keeps this dish from (none: everyone eats it). */ not_for?: string[] };
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
    dishes: d.dishes.map((x) => ({ id: x.id, name: x.dish, for_people: null, portion_note: x.note, recipe_id: null, video_url: null, new: x.new, not_for: x.not_for,
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
export function closeWeek(db: Db, weekStart: string, basePath: string, unmet: string[] = [], opts: { holdIntro?: boolean } = {}): { week: WeekView; message: string; intro?: string; instructions: string } {
  const week = weekView(db, weekStart);
  const house = getHouse(db), view = houseView(house);
  const monday = week.days[0].meals;
  const out: { week: WeekView; message: string; intro?: string; instructions: string } = { week, message: weekMessage({ monday, link: weekLink(basePath, weekStart), unmet }), instructions: "" };
  // The setup's plans hold the how-to back (rerun b, 27 Nov: too long for WhatsApp): it comes once the setup is done.
  if (!house.intro_sent_at && !opts.holdIntro) {
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
