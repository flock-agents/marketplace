// What the pace check reads and keeps, from the app's own tables: each number's day totals and goal, the hourly samples,
// and the nudges already sent.
import type { Kit } from "@flock/app-kit";
import { DAILY_GOALS } from "../db/constants";
import { pace_nudges, pace_samples } from "../db/schema";
import { stampOn } from "../time/dates";
import { dayOf, shiftDays } from "../today/routes";
import type { MetricInput } from "./check";
import type { PastDay, Sample } from "./routine";

/** Who the pace check's rows are written by, as the kit records it. */
export const PACE_AUTHOR = "app:pace-check";
/** How long hourly samples are kept: past the longest routine a coach can set (60 days). */
const KEEP_SAMPLE_DAYS = 90;

export interface PaceStore {
  /** Each label's today, goal and past `days` days (with their samples), as of `today`. */
  inputs(labels: readonly string[], today: string, days: number): MetricInput[];
  nudgesOn(day: string): string[];
  addSamples(day: string, minute: number, values: { label: string; value: number }[]): Promise<void>;
  addNudge(day: string, at: string, labels: string[], message: string): Promise<void>;
}

interface Reading { label: string; value: number; created_at: string }

/** The newest reading of each label on each local day: "<label>|<day>" → value. */
function dayTotals(readings: Reading[]): Map<string, number> {
  const newest = new Map<string, Reading>();
  for (const r of readings) {
    const key = `${r.label}|${dayOf(r.created_at)}`;
    const seen = newest.get(key);
    if (!seen || r.created_at > seen.created_at) newest.set(key, r);
  }
  return new Map([...newest].map(([k, r]) => [k, r.value]));
}

export function kitPaceStore(kit: Kit): PaceStore {
  // Prepared on first use, not at start: a build is first tried against the previous database, before these tables exist.
  const readingsQuery = () => kit.sqlite.query(`SELECT label, value, created_at FROM metrics WHERE label = ?1 AND created_at >= ?2 AND created_at < ?3`);
  const goalQuery = () => kit.sqlite.query(`SELECT value FROM metrics WHERE label = ?1 AND created_at < ?2 ORDER BY created_at DESC LIMIT 1`);
  const samplesQuery = () => kit.sqlite.query(`SELECT day, minute, value FROM pace_samples WHERE label = ?1 AND day >= ?2 AND day < ?3`);
  const nudgesQuery = () => kit.sqlite.query(`SELECT at FROM pace_nudges WHERE day = ?1 ORDER BY at`);

  function input(label: string, today: string, days: number): MetricInput {
    const first = shiftDays(today, -days), endOfToday = stampOn(shiftDays(today, 1), "00:00");
    // A day either side of the range, then kept by local day: stored times are UTC or local.
    const totals = dayTotals(readingsQuery().all(label, shiftDays(first, -1), shiftDays(today, 2)) as Reading[]);
    const samples = new Map<string, Sample[]>();
    for (const s of samplesQuery().all(label, first, today) as (Sample & { day: string })[]) {
      samples.set(s.day, [...(samples.get(s.day) ?? []), { minute: s.minute, value: s.value }]);
    }
    const past: PastDay[] = Array.from({ length: days }, (_, i) => shiftDays(today, -(i + 1)))
      .flatMap((day) => (totals.has(`${label}|${day}`) ? [{ day, total: totals.get(`${label}|${day}`)!, samples: samples.get(day) ?? [] }] : []));
    const target = DAILY_GOALS.find((g) => g.label === label)?.target;
    const goal = target ? ((goalQuery().get(target, endOfToday) as { value: number } | null)?.value ?? null) : null;
    return { label, today: totals.get(`${label}|${today}`) ?? null, goal, past };
  }

  return {
    inputs: (labels, today, days) => labels.map((label) => input(label, today, days)),
    nudgesOn: (day) => (nudgesQuery().all(day) as { at: string }[]).map((n) => n.at),
    async addSamples(day, minute, values) {
      if (values.length) await kit.db.insert(pace_samples).values(values.map((v) => ({ day, minute, ...v, updated_by: PACE_AUTHOR })));
      kit.sqlite.query(`DELETE FROM pace_samples WHERE day < ?1`).run(shiftDays(day, -KEEP_SAMPLE_DAYS));
    },
    async addNudge(day, at, labels, message) {
      await kit.db.insert(pace_nudges).values({ day, at, labels: labels.join(", "), message, updated_by: PACE_AUTHOR });
    },
  };
}
