// The behind-pace check's parameters: one app setting each, so the coach tunes one at a time
// (PATCH /api/_app/settings {"pace.behind_ratio": 0.4}). GET /api/pace shows the values in force and what they decide now.
import type { SettingDecl } from "@flock/app-kit";

/** Day totals that grow through the day from the watch alone: the only numbers a time-of-day pace makes sense for. */
export const PACE_LABELS = ["Steps", "Calories burned", "Distance"] as const;

/** One number the check watches, and the least shortfall (in its own unit) worth waking the coach for. */
export interface PaceMetric { label: string; min_gap: number }
/** Cumulative share of a usual day's total reached by a local time: ["14:00", 0.5] is half the day's total by 2 PM. */
export type CurvePoint = [string, number];

export interface PaceParams {
  enabled: boolean;
  metrics: PaceMetric[];
  behind_ratio: number;
  min_expected_share: number;
  check_from: string;
  check_until: string;
  routine_days: number;
  min_routine_days: number;
  split_weekends: boolean;
  off_day_share: number;
  reference: "usual" | "goal";
  max_data_age_minutes: number;
  max_nudges_per_day: number;
  nudge_gap_hours: number;
  default_curve: CurvePoint[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minuteOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const between = (lo: number, hi: number) => (v: unknown) => (typeof v === "number" && v >= lo && v <= hi ? null : `must be between ${lo} and ${hi}`);
const time = (v: unknown) => (typeof v === "string" && HHMM.test(v) ? null : "must be a time as HH:MM, 24-hour");

function metricsProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return "must be a list of {label, min_gap}";
  for (const m of v as PaceMetric[]) {
    if (!PACE_LABELS.includes(m?.label as (typeof PACE_LABELS)[number])) return `label must be one of ${PACE_LABELS.join(", ")}`;
    if (typeof m.min_gap !== "number" || m.min_gap < 0) return `${m.label}: min_gap must be a number of 0 or more`;
  }
  return new Set(v.map((m: PaceMetric) => m.label)).size === v.length ? null : "names a label twice";
}

function curveProblem(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 2) return "must be a list of at least two [\"HH:MM\", share] points";
  let last: CurvePoint | null = null;
  for (const p of v as CurvePoint[]) {
    if (!Array.isArray(p) || time(p[0]) || typeof p[1] !== "number" || p[1] < 0 || p[1] > 1) return "each point must be [\"HH:MM\", share from 0 to 1]";
    if (last && (minuteOf(p[0]) <= minuteOf(last[0]) || p[1] < last[1])) return "points must go forward in time, with shares that never fall";
    last = p;
  }
  return last![1] === 1 ? null : "the last point must be the whole day (share 1)";
}

/** Every parameter: its default, the rule it must pass, and what it means (the label the coach reads in GET /api/_app). */
const DECLS: { [K in keyof PaceParams]: Omit<SettingDecl, "key"> } = {
  enabled: { type: "boolean", default: true, label: "Pace check on: the hourly sync may wake the coach when the person is well behind their usual pace" },
  metrics: {
    type: "json", check: metricsProblem,
    default: [{ label: "Steps", min_gap: 500 }, { label: "Calories burned", min_gap: 50 }],
    label: "Numbers checked, each with the least shortfall worth a nudge in its own unit (steps, kcal, km)",
  },
  behind_ratio: { type: "number", default: 0.5, check: between(0.05, 0.95), label: "Behind when today's number is below this share of where the person usually is by now (0.5 = under half)" },
  min_expected_share: { type: "number", default: 0.25, check: between(0, 0.9), label: "No check until a usual day would have reached this share of its total (keeps slow mornings quiet)" },
  check_from: { type: "string", default: "10:00", check: time, label: "Earliest time of day a nudge can go" },
  check_until: { type: "string", default: "20:30", check: time, label: "Latest time of day a nudge can go (later there is no day left to act on it)" },
  routine_days: { type: "integer", default: 21, check: between(3, 60), label: "Days of history that make the person's usual routine" },
  min_routine_days: { type: "integer", default: 5, check: between(1, 60), label: "Usual days needed before a personal routine (or a weekday/weekend split) is trusted over the default" },
  split_weekends: { type: "boolean", default: true, label: "Compare weekdays with weekdays and weekends with weekends, once there are enough of each" },
  off_day_share: { type: "number", default: 0.3, check: between(0, 0.9), label: "A past day below this share of a typical day's total (watch off, ill, travelling) is left out of the usual routine" },
  reference: {
    type: "string", default: "usual", check: (v) => (v === "usual" || v === "goal" ? null : "must be usual or goal"),
    label: "What \"on pace\" aims at: the usual day's total, or the day's goal when one is set",
  },
  max_data_age_minutes: {
    type: "integer", default: 90, check: between(15, 240),
    label: "Staleness cutoff: only judge pace when today's tracker data (its newest reading, uploaded with the steps) is at most this many minutes old. Older, or none from today, is a sync gap, not the person: the cycle is skipped silently",
  },
  max_nudges_per_day: { type: "integer", default: 1, check: between(0, 6), label: "Most coach wake-ups a day for being behind" },
  nudge_gap_hours: { type: "number", default: 3, check: between(0.5, 12), label: "Least time between two nudges on the same day" },
  default_curve: {
    type: "json", check: curveProblem,
    default: [["06:00", 0], ["08:00", 0.08], ["10:00", 0.2], ["12:00", 0.35], ["14:00", 0.5], ["16:00", 0.62], ["18:00", 0.75], ["20:00", 0.9], ["22:00", 1]],
    label: "Share of a usual day's total reached by each time, used until the person's own hourly history is long enough",
  },
};

export const PACE_PREFIX = "pace.";
export const paceSettings: SettingDecl[] = Object.entries(DECLS).map(([name, d]) => ({ key: `${PACE_PREFIX}${name}`, ...d }));

/** The parameters in force, from the app's settings. */
export function paceParams(get: <T>(key: string) => T): PaceParams {
  return Object.fromEntries(Object.keys(DECLS).map((name) => [name, get(`${PACE_PREFIX}${name}`)])) as unknown as PaceParams;
}
