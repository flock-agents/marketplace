// The person's usual day for one number: how big a usual day's total is, and how much of it is usually done by a given
// time. Built from their own recent days; the default curve stands in for the shape until enough days were sampled hourly.
import { minuteOf, type CurvePoint, type PaceParams } from "./params";

/** A running total as one sync saw it: `minute` of the local day, `value` so far. */
export interface Sample { minute: number; value: number }
/** One past day: its final total and the running totals the syncs saw during it. */
export interface PastDay { day: string; total: number; samples: Sample[] }

export interface UsualRoutine {
  total: number;                       // a usual day's total
  share: number;                       // the share of it usually reached by the minute asked about
  source: "personal" | "default";      // where `share` came from: the person's own sampled days, or the default curve
  days: number;                        // the usual days it was built from
  sampledDays: number;                 // of those, the days with syncs either side of the minute
}

const END_OF_DAY = 24 * 60;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Straight lines between the points; flat before the first and after the last. */
function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!, [x0, y0] = points[i - 1]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1]![1];
}

/** The default curve's share of the day by `minute`. */
export const curveShare = (curve: CurvePoint[], minute: number) => interpolate(curve.map(([t, s]) => [minuteOf(t), s]), minute);

/** A past day's running total at `minute`, between the syncs that saw it (from nothing at midnight to its final total). */
export function valueAt(day: PastDay, minute: number): number {
  const points: [number, number][] = [[0, 0], ...[...day.samples].sort((a, b) => a.minute - b.minute).map((s): [number, number] => [s.minute, s.value]), [END_OF_DAY, day.total]];
  return interpolate(points, minute);
}

const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
/** A day the syncs saw on both sides of `minute`: its value then is read between two real observations, not guessed. */
const sampledAround = (day: PastDay, minute: number) => day.samples.some((s) => s.minute <= minute) && day.samples.some((s) => s.minute >= minute);

/** The usual day for `today` at `minute`, or null when the person has no usable history for this number yet. */
export function usualRoutine(past: PastDay[], today: string, minute: number, p: PaceParams): UsualRoutine | null {
  const counted = past.filter((d) => d.total > 0);
  if (!counted.length) return null;
  const typical = median(counted.map((d) => d.total));
  let usual = counted.filter((d) => d.total >= p.off_day_share * typical);   // watch-off, ill and travel days are not routine
  if (p.split_weekends) {
    const sameKind = usual.filter((d) => isWeekend(d.day) === isWeekend(today));
    if (sameKind.length >= p.min_routine_days) usual = sameKind;
  }
  const sampled = usual.filter((d) => sampledAround(d, minute));
  const personal = sampled.length >= p.min_routine_days;
  return {
    total: median(usual.map((d) => d.total)),
    share: personal ? median(sampled.map((d) => valueAt(d, minute) / d.total)) : curveShare(p.default_curve, minute),
    source: personal ? "personal" : "default",
    days: usual.length,
    sampledDays: sampled.length,
  };
}
