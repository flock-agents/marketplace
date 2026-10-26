// The behind-pace verdict: is the person well behind where they usually are at this point of the day, by enough to be worth
// a coach's model run? Pure: the routine handler and GET /api/pace hand it what the app knows and act on its answer.
//
// Stale data must never read as a person falling behind. Today's totals are only as current as the watch's last upload,
// so the check (1) trusts only how far TODAY's own watch data reaches (`asOf`, today's last heart-rate reading, which comes
// up with the steps), never PAI or workout upload times; (2) compares today's totals with a usual day AT THAT MOMENT, not at
// the time of the check, so an upload gap cannot make the numbers look low; (3) skips the cycle quietly when there is no
// data from today, when it is older than max_data_age_minutes, or when today has no total yet. A skipped cycle sends nothing.
import { minuteOf, type PaceParams } from "./params";
import { usualRoutine, type PastDay, type UsualRoutine } from "./routine";

export interface MetricInput { label: string; today: number | null; goal: number | null; past: PastDay[] }

export interface MetricPace {
  label: string;
  today: number | null;               // today's total as of `asOf`; null when Zepp has none yet
  expected: number | null;            // where a usual day is at the same point, aimed at `aim`
  aim: number | null;                 // the day's total "on pace" aims at: the usual day's, or the goal
  aimedAt: "usual" | "goal";
  ratio: number | null;               // today / expected
  routine: UsualRoutine | null;
  behind: boolean;
  why: string;                        // in plain words, for the coach and GET /api/pace
}

export interface PaceContext {
  now: Date;
  today: string;                      // local YYYY-MM-DD
  minute: number;                     // local minute of the day now
  asOf: string | null;                // how far today's watch data reaches in Zepp (ISO); null when nothing from today
  asOfMinute: number | null;          // the same as a local minute of today, never after `minute`
  nudgesToday: string[];              // when the coach was already woken today (ISO)
}

export interface PaceVerdict { nudge: boolean; why: string; metrics: MetricPace[] }

const round = (n: number) => Math.round(n * 100) / 100;
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** One number at `minute`: today's total then against a usual day's at the same minute. */
export function metricPace(input: MetricInput, minGap: number, minute: number, today: string, p: PaceParams): MetricPace {
  const routine = usualRoutine(input.past, today, minute, p);
  const aimedAt = p.reference === "goal" && input.goal ? "goal" : "usual";
  const aim = aimedAt === "goal" ? input.goal : routine?.total ?? null;
  const base = { label: input.label, today: input.today, aim, aimedAt, routine } as const;
  if (!routine || !aim) return { ...base, expected: null, ratio: null, behind: false, why: "no usual routine yet" };
  const expected = Math.round(routine.share * aim);
  if (input.today === null) return { ...base, expected, ratio: null, behind: false, why: "the tracker has no total for today yet" };
  const ratio = expected > 0 ? round(input.today / expected) : null;
  const result = { ...base, expected, ratio };
  if (routine.share < p.min_expected_share) return { ...result, behind: false, why: "too early in a usual day to judge" };
  if (ratio === null || ratio >= p.behind_ratio) return { ...result, behind: false, why: "on pace" };
  if (expected - input.today < minGap) return { ...result, behind: false, why: "behind, but by too little to matter" };
  return { ...result, behind: true, why: `at ${Math.round(ratio * 100)}% of where a usual day is at ${clock(minute)}` };
}

/** Whether to wake the coach now, and why (not). */
export function paceVerdict(inputs: MetricInput[], ctx: PaceContext, p: PaceParams): PaceVerdict {
  const gaps = new Map(p.metrics.map((m) => [m.label, m.min_gap]));
  const at = ctx.asOfMinute ?? ctx.minute;   // judged where the data reaches; with none, shown for now but never acted on
  const metrics = inputs.filter((i) => gaps.has(i.label)).map((i) => metricPace(i, gaps.get(i.label)!, at, ctx.today, p));
  const quiet = (why: string): PaceVerdict => ({ nudge: false, why, metrics });

  if (!p.enabled) return quiet("the pace check is off");
  if (ctx.minute < minuteOf(p.check_from) || ctx.minute > minuteOf(p.check_until)) return quiet("outside the hours a nudge can go");
  if (!ctx.asOf || ctx.asOfMinute === null) return quiet("the tracker has no data from today yet: a sync gap, not the person");
  const ageMinutes = Math.round((ctx.now.getTime() - Date.parse(ctx.asOf)) / 60_000);
  if (ageMinutes > p.max_data_age_minutes) return quiet(`the tracker's data only reaches ${clock(ctx.asOfMinute)}, ${ageMinutes} minutes ago: a sync gap, not the person`);
  if (ctx.nudgesToday.length >= p.max_nudges_per_day) return quiet("today's nudges are used up");
  const lastNudge = Math.max(0, ...ctx.nudgesToday.map((t) => Date.parse(t)));
  if (ctx.now.getTime() - lastNudge < p.nudge_gap_hours * 3_600_000) return quiet("nudged too recently");
  const behind = metrics.filter((m) => m.behind);
  return behind.length ? { nudge: true, why: `well behind on ${behind.map((m) => m.label).join(" and ")}`, metrics } : quiet("on pace");
}
