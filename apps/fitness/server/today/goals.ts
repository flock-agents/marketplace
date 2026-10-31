// Plain code, no imports beyond the constants: both the server's /api/today and the page's Today section read it.
import { AVAILABILITY_DAYS, DAILY_GOALS, WORKOUT_MINUTES, WORKOUT_TITLE, type DailyGoal, type GoalAim, type GoalGroup, type MealField } from "../db/constants";

export interface GoalReading { label: string; value: number; created_at: string }
export interface GoalEvent { title: string; at: string; kcal?: number | null; protein_g?: number | null; fiber_g?: number | null }
export interface WaterLog { at: string; ml: number }
export type GoalStatus = "done" | "on_track" | "to_go" | "over" | "not_logged" | "no_target";
/** `focus`: the goal is one the Today page shows. */
export interface GoalLine { label: string; group: GoalGroup; focus: boolean; unit: string; aim: GoalAim; current: number | null; target: number | null; status: GoalStatus; remaining: number | null }

export interface DayInput {
  day: string;                           // YYYY-MM-DD
  readings: GoalReading[];               // any order; enough history to hold the targets in force
  events: GoalEvent[];                   // at least the day's events
  water?: WaterLog[];                    // at least the day's water logs
  dayOf: (at: string) => string;         // a stored time as its local YYYY-MM-DD
  focus?: readonly string[];             // the goals in focus: each shows even before anything is logged
  available?: readonly string[];         // the goals that can show (availableGoals); every goal when absent
}

/** The labels with a reading in the AVAILABILITY_DAYS days up to `day` (synced or entered by hand). */
export function recentLabels(readings: GoalReading[], day: string, dayOf: DayInput["dayOf"]): Set<string> {
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - AVAILABILITY_DAYS * 86_400_000).toISOString().slice(0, 10);
  return new Set(readings.filter((r) => { const d = dayOf(r.created_at); return d > from && d <= day; }).map((r) => r.label));
}

/** The goals that can show: one needing no tracker metric always, else once a metric it requires has recent data. */
export function availableGoals(recent: ReadonlySet<string>, goals: readonly DailyGoal[] = DAILY_GOALS): string[] {
  return goals.filter((g) => !g.requires || g.requires.some((m) => recent.has(m))).map((g) => g.label);
}

/** Whether any tracker-only metric (one a goal requires) has recent data: without it the page hints to connect a tracker.
 *  A hand-entered weight does not count: it needs no tracker. */
export const hasTrackerData = (recent: ReadonlySet<string>, goals: readonly DailyGoal[] = DAILY_GOALS) =>
  goals.some((g) => g.requires?.some((m) => recent.has(m)));

/** The newest reading of `label` whose day passes `onDay`. */
function newest(readings: GoalReading[], label: string, onDay: (d: string) => boolean, dayOf: DayInput["dayOf"]): GoalReading | null {
  return readings
    .filter((r) => r.label === label && onDay(dayOf(r.created_at)))
    .reduce<GoalReading | null>((best, r) => (!best || r.created_at > best.created_at ? r : best), null);
}

/** Minutes of the day's workouts, or null when none was logged. */
export function workoutMinutes(events: GoalEvent[], day: string, dayOf: DayInput["dayOf"]): number | null {
  const minutes = events
    .filter((e) => WORKOUT_TITLE.test(e.title) && dayOf(e.at) === day)
    .map((e) => WORKOUT_MINUTES.exec(e.title))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]));
  return minutes.length ? minutes.reduce((a, b) => a + b, 0) : null;
}

/** The day's meals' `field` added up, or null when no meal that day carries it. */
export function mealTotal(events: GoalEvent[], field: MealField, day: string, dayOf: DayInput["dayOf"]): number | null {
  const values = events.filter((e) => dayOf(e.at) === day).map((e) => e[field]).filter((v): v is number => typeof v === "number");
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10 : null;
}

/** Litres of water logged that day, or null when none was. */
export function waterLitres(water: WaterLog[], day: string, dayOf: DayInput["dayOf"]): number | null {
  const ml = water.filter((w) => dayOf(w.at) === day).map((w) => w.ml);
  return ml.length ? Math.round(ml.reduce((a, b) => a + b, 0) / 10) / 100 : null;
}

/** The day's number of a goal: its workouts, its water, its meals (else its reading), or its reading. */
function currentOf(goal: DailyGoal, { day, readings, events, water = [], dayOf }: DayInput): number | null {
  if (goal.fromWorkouts) return workoutMinutes(events, day, dayOf);
  if (goal.fromWater) return waterLitres(water, day, dayOf);
  const reading = () => newest(readings, goal.label, (d) => d === day, dayOf)?.value ?? null;
  return goal.fromMeals ? mealTotal(events, goal.fromMeals, day, dayOf) ?? reading() : reading();
}

export function statusOf(aim: GoalAim, current: number | null, target: number | null): Pick<GoalLine, "status" | "remaining"> {
  if (target === null) return { status: "no_target", remaining: null };
  if (current === null) return { status: "not_logged", remaining: target };
  if (aim === "under") return current > target ? { status: "over", remaining: current - target } : { status: "on_track", remaining: target - current };
  return current >= target ? { status: "done", remaining: 0 } : { status: "to_go", remaining: target - current };
}

/** One goal's line, or null when there is nothing to show (not in focus, no target, nothing that day, never tracked). */
function lineFor(goal: DailyGoal, input: DayInput): GoalLine | null {
  const { day, readings, dayOf } = input;
  if (input.available && !input.available.includes(goal.label)) return null;
  const focus = input.focus?.includes(goal.label) ?? false;
  const target = newest(readings, goal.target, (d) => d <= day, dayOf)?.value ?? goal.defaultTarget ?? null;
  const current = currentOf(goal, input);
  const tracked = focus || goal.fromWorkouts || readings.some((r) => r.label === goal.label);   // workouts always count: a day without one says so
  if (target === null && current === null && !tracked) return null;
  return { label: goal.label, group: goal.group, focus, unit: goal.unit, aim: goal.aim, current, target, ...statusOf(goal.aim, current, target) };
}

/** The day's numbers against their targets, in DAILY_GOALS order. A target holds from the day it was set until it is changed. */
export function dayGoals(input: DayInput, goals: readonly DailyGoal[] = DAILY_GOALS): GoalLine[] {
  return goals.map((g) => lineFor(g, input)).filter((l): l is GoalLine => l !== null);
}
