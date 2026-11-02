// GET /api/today?date=YYYY-MM-DD: the day's numbers against their targets (default today), for agents and the page alike.
// GET /api/days?until=YYYY-MM-DD&days=7: the same for each finished day up to `until` (default yesterday), newest first.
import { Hono } from "hono";
import type { Kit } from "@flock/app-kit";
import { DAILY_GOALS, FOCUS_SETTING } from "../db/constants";
import { localDate, localDateTime } from "../time/dates";
import { availableGoals, dayGoals, hasTrackerData, recentLabels, type GoalEvent, type GoalLine, type GoalReading, type WaterLog } from "./goals";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 60;   // how far back a tracked number still counts as tracked
const MAX_DAYS = 31;
export const shiftDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isDate = (day: string) => DATE.test(day) && !Number.isNaN(Date.parse(day));

/** A stored time as its local day: a bare "2026-10-21T07:05" is already local; one with Z or an offset is converted. */
export function dayOf(at: string): string {
  const zoned = at.length > 10 && /[zZ]$|[+-]\d\d:?\d\d$/.test(at.slice(10));
  return zoned ? localDateTime(at)?.slice(0, 10) ?? at.slice(0, 10) : at.slice(0, 10);
}

/** The `count` days ending on `until`, newest first. */
export const daysUntil = (until: string, count: number) => Array.from({ length: count }, (_, i) => shiftDays(until, -i));

export function todayRoutes(kit: Kit) {
  const targets = DAILY_GOALS.map((g) => g.target);
  // Prepared on first use, not at start: a build is first tried against the previous database, before its new columns exist.
  const readingsQuery = () => kit.sqlite.query(
    `SELECT label, value, created_at FROM metrics WHERE created_at < ?1 AND (created_at >= ?2 OR label IN (${targets.map(() => "?").join(", ")}))`,
  );
  const eventsQuery = () => kit.sqlite.query(`SELECT title, at, kcal, protein_g, fiber_g FROM events WHERE at >= ?1 AND at < ?2`);
  const waterQuery = () => kit.sqlite.query(`SELECT at, ml FROM water_logs WHERE at >= ?1 AND at < ?2`);
  const focus = () => kit.settings.get<string[]>(FOCUS_SETTING);

  /** Each of `days` against its targets, read in one pass. Stored times are UTC or local: a day either side, then keep the local day. */
  const goalsFor = (days: string[]) => {
    const first = days.reduce((a, d) => (d < a ? d : a)), last = days.reduce((a, d) => (d > a ? d : a));
    const until = shiftDays(last, 2);
    const readings = readingsQuery().all(until, shiftDays(first, -HISTORY_DAYS), ...targets) as GoalReading[];
    const events = eventsQuery().all(shiftDays(first, -1), until) as GoalEvent[];
    const water = waterQuery().all(shiftDays(first, -1), until) as WaterLog[];
    const inFocus = focus();
    const recent = recentLabels(readings, last, dayOf);
    const available = availableGoals(recent);
    const list = days.map((day): { date: string; goals: GoalLine[] } => ({ date: day, goals: dayGoals({ day, readings, events, water, dayOf, focus: inFocus, available }) }));
    return { list, available, trackerData: hasTrackerData(recent) };
  };

  const routes = new Hono();
  routes.get("/today", (c) => {
    const day = c.req.query("date") ?? localDate(new Date());
    if (!isDate(day)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    const { list, available, trackerData } = goalsFor([day]);
    // available: the goals that can show now; trackerData false: no tracker numbers lately, the page hints to connect one
    return c.json({ ...list[0], focus: focus().filter((g) => available.includes(g)), available, trackerData });
  });
  routes.get("/days", (c) => {
    const until = c.req.query("until") ?? shiftDays(localDate(new Date()), -1);
    const count = Number(c.req.query("days") ?? 7);
    if (!isDate(until) || !Number.isInteger(count) || count < 1 || count > MAX_DAYS) return c.json({ error: `until must be YYYY-MM-DD and days 1 to ${MAX_DAYS}` }, 400);
    return c.json({ days: goalsFor(daysUntil(until, count)).list });
  });
  return routes;
}
