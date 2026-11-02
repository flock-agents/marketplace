// GET /api/meal-plan?date=: the day's planned meals (the coach syncs them from the family meal plan), each beside what was eaten for it.
// PUT /api/meal-plan sets the whole day. POST /api/meal-plan/eaten logs a planned meal as eaten, with its numbers.
import { Hono } from "hono";
import { localDate, localDateTime } from "../time/dates";
import { ESTIMATE_WAIT_MS, SLOT_TIMES } from "./config";
import { pickNutrients } from "../nutrition/catalog";
import { hasNumbers, mealPlanItems, parseItems, plannedTotals, shareText, type MealPlanItem } from "./plan";
import type { MealPlanStore } from "./store";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_EXAMPLE = `{"date": "2026-10-22", "items": [{"slot": "Breakfast", "name": "Besan chilla + curd", "kcal": 330, "protein_g": 18, "fiber_g": 6}]}`;

export interface PlannedMeal { date: string; slot: string | null; name: string; at: string }
/** Wakes the coach to estimate a planned meal's numbers and log it. */
export type AskCoach = (meal: PlannedMeal) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The moment a meal eaten on `day` is filed: now for today, the slot's usual time for an earlier day. */
export function eatenAt(day: string, slot: string | null, now: Date): string {
  return day === localDate(now) ? localDateTime(now.toISOString())! : `${day}T${SLOT_TIMES[slot ?? ""] ?? "13:00"}`;
}

export function mealPlanRoutes(store: MealPlanStore, askCoach: AskCoach, clock: () => Date = () => new Date()) {
  const asked = new Map<string, number>();   // planned meal id → when the coach was last woken for it
  const view = (day: string) => {
    const items = mealPlanItems(store.rows(day), store.logged(day));
    return { date: day, items, planned: plannedTotals(items), share: shareText(day, items) };
  };
  const eat = async (day: string, item: MealPlanItem) => {
    const at = eatenAt(day, item.slot, clock());
    const title = `${item.slot ? `${item.slot}: ` : ""}${item.name}`;
    if (hasNumbers(item)) return { logged: await store.logMeal({ title, at, kcal: item.kcal!, protein_g: item.protein_g!, fiber_g: item.fiber_g!, ...pickNutrients({ ...item }) }) };
    const last = asked.get(item.id);
    if (last && clock().getTime() - last < ESTIMATE_WAIT_MS) return { asked: true };
    const woken = await askCoach({ date: day, slot: item.slot, name: item.name, at });
    if (!woken.ok) return { error: woken.reason };
    asked.set(item.id, clock().getTime());
    return { asked: true };
  };

  const routes = new Hono();
  routes.get("/meal-plan", async (c) => {
    const day = c.req.query("date") ?? localDate(clock());
    return DATE.test(day) ? c.json(view(day)) : c.json({ error: "date must be YYYY-MM-DD" }, 400);
  });
  routes.put("/meal-plan", async (c) => {
    const body = await c.req.json().catch(() => null);
    const day = (body?.date as string | undefined) ?? localDate(clock());
    const items = parseItems(body);
    if (!DATE.test(day) || !items) return c.json({ error: `Send the day's whole meal plan, e.g. ${PLAN_EXAMPLE}` }, 400);
    await store.replace(day, items);
    return c.json(view(day));
  });
  routes.post("/meal-plan/eaten", async (c) => {
    const body = await c.req.json().catch(() => null);
    const day = (body?.date as string | undefined) ?? localDate(clock());
    if (!DATE.test(day) || typeof body?.id !== "string") return c.json({ error: `Send the planned meal, e.g. {"date": "2026-10-22", "id": "<item id>"}` }, 400);
    if (day > localDate(clock())) return c.json({ error: "A meal can only be eaten today or earlier" }, 400);
    const item = view(day).items.find((i) => i.id === body.id);
    if (!item) return c.json({ error: "No such planned meal that day" }, 404);
    if (item.done) return c.json({ error: "Already eaten" }, 409);
    const result = await eat(day, item);
    if ("error" in result) return c.json(result, 502);
    return c.json(result, "logged" in result ? 201 : 202);
  });
  return routes;
}
