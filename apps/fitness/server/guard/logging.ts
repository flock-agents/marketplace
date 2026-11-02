// Refuses a write the dashboard would take but never count, so whoever sent it gets an error instead of a silent "Nothing yet":
// a meal without its numbers (a new one without its full nutrient breakdown too), a workout without its minutes, a reading under a near-miss of a counted label, water with no amount.
import type { MiddlewareHandler } from "hono";
import { DAILY_GOALS, WORKOUT_MINUTES, WORKOUT_TITLE, canonicalKind } from "../db/constants";
import { missingNutrients } from "../nutrition/catalog";

type Row = Record<string, unknown>;
export interface Problem { error: "not_counted"; field: string; message: string }

const MEAL_TITLE = /^(breakfast|lunch|dinner|snacks?|meal)\b/i;
const MEAL_EXAMPLE = `{"title": "Lunch: 2 roti, dal, sabzi", "kind": "Meal", "kcal": 450, "protein_g": 18, "fiber_g": 9}`;
/** Every label a Today line reads, matched exactly: "calories in" or "Protein Target" would be stored and never counted. */
const COUNTED_LABELS = [...new Set(DAILY_GOALS.flatMap((g) => [g.label, g.target]))];

const problem = (field: string, message: string): Problem => ({ error: "not_counted", field, message });
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** `created`: a new row. Only a new meal must carry the full breakdown; an older meal logged before it existed can still be edited. */
export function eventProblem(row: Row, created = true): Problem | null {
  const title = String(row.title ?? "").trim();
  const meal = canonicalKind((row.kind as string | null) ?? null) === "Meal";
  if (!meal && MEAL_TITLE.test(title)) return problem("kind", `A meal goes in as kind "Meal" with its kcal and protein_g, e.g. ${MEAL_EXAMPLE}.`);
  if (meal && !isNumber(row.kcal)) return problem("kcal", `A meal needs its calories in kcal (a rough estimate is fine), e.g. ${MEAL_EXAMPLE}.`);
  if (meal && !isNumber(row.protein_g)) return problem("protein_g", `A meal needs its protein in protein_g, grams (a rough estimate is fine), e.g. ${MEAL_EXAMPLE}.`);
  if (meal && !isNumber(row.fiber_g)) return problem("fiber_g", `A meal needs its fiber in fiber_g, grams (a rough estimate is fine), e.g. ${MEAL_EXAMPLE}.`);
  const missing = meal && created ? missingNutrients(row) : [];
  if (missing.length) return problem(missing[0], `A meal needs its full nutrient estimate too (a rough estimate is fine, 0 when there is none): missing ${missing.join(", ")}. Every key with its unit: GET /api/nutrients.`);
  if (WORKOUT_TITLE.test(title) && !WORKOUT_MINUTES.test(title)) return problem("title", `A workout's title carries its minutes, e.g. "Workout: Elliptical intervals · 20 min".`);
  return null;
}

export function metricProblem(row: Row): Problem | null {
  const label = String(row.label ?? "").trim();
  const counted = COUNTED_LABELS.find((l) => l.toLowerCase() === label.toLowerCase());
  return counted && counted !== row.label ? problem("label", `Use the label "${counted}" exactly; "${row.label}" is not counted.`) : null;
}

export function waterProblem(row: Row): Problem | null {
  return isNumber(row.ml) && (row.ml as number) > 0 ? null : problem("ml", `Water goes in as millilitres, e.g. {"at": "2026-10-21T10:30", "ml": 250}.`);
}

const CHECKS: Record<string, (row: Row, created: boolean) => Problem | null> = { events: eventProblem, metrics: metricProblem, water_logs: waterProblem };

/** Checks POST /api/_data/<table> and PATCH /api/_data/<table>/<id> before the kit stores them; a PATCH is checked as the row it
 *  would leave behind (`current` reads the stored row). Register it before the kit's data routes. */
export function loggingGuard(current: (table: string, id: string) => Row | null): MiddlewareHandler {
  return async (c, next) => {
    const [table, id] = c.req.path.replace(/^.*\/_data\//, "").split("/");
    const check = CHECKS[table];
    const write = (c.req.method === "POST" && !id) || (c.req.method === "PATCH" && !!id);
    if (!check || !write) return next();
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return next();   // the kit answers a bad body itself
    const found = check(id ? { ...(current(table, id) ?? {}), ...body } : body, !id);
    return found ? c.json(found, 400) : next();
  };
}
