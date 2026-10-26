// GET /api/exercises: the exercise library with links and pictures.
// GET /api/plan?date=: the day's workout plan, linked to the library, with a message to share. PUT /api/plan sets the whole day.
import { Hono } from "hono";
import { localDate } from "../time/dates";
import { appUrl } from "../profile/app-url";
import { library, parseItems, planItems, shareText } from "./plan";
import type { PlanStore } from "./store";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_EXAMPLE = `{"date": "2026-10-22", "items": [{"name": "Elliptical", "dose": "20 min"}, {"name": "Goblet squat", "dose": "3x12"}]}`;

export function exerciseRoutes(store: PlanStore) {
  const routes = new Hono();
  const view = (day: string, base: string) => {
    const items = planItems(store.rows(day), base);
    return { date: day, items, share: shareText(day, items) };
  };
  const base = (c: { req: { url: string; header(name: string): string | undefined } }) => appUrl({ get: (n) => c.req.header(n) }, c.req.url);
  routes.get("/exercises", (c) => c.json({ exercises: library(base(c)) }));
  routes.get("/plan", (c) => {
    const day = c.req.query("date") ?? localDate(new Date());
    return DATE.test(day) ? c.json(view(day, base(c))) : c.json({ error: "date must be YYYY-MM-DD" }, 400);
  });
  routes.put("/plan", async (c) => {
    const body = await c.req.json().catch(() => null);
    const day = (body?.date as string | undefined) ?? localDate(new Date());
    const items = parseItems(body);
    if (!DATE.test(day) || !items) return c.json({ error: `Send the day's whole plan, e.g. ${PLAN_EXAMPLE}` }, 400);
    await store.replace(day, items);
    return c.json(view(day, base(c)));
  });
  return routes;
}
