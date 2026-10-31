// The pace check in use: after each fresh sync it keeps today's running totals at the minute the watch data reaches (the
// person's routine is built from them), and on the scheduled sync it wakes the coach only when the verdict says the person
// is well behind. No verdict, no model run; stale data skips the cycle without a word to anyone.
import { localDate, localDateTime, spokenTime } from "../time/dates";
import { paceVerdict, type MetricPace, type PaceContext, type PaceVerdict } from "./check";
import { PACE_LABELS, type PaceParams } from "./params";
import type { PaceStore } from "./store";

/** Wakes the coach with a message and its data; resolves to whether the wake went (or was held to go later). */
export type WakeCoach = (message: string, data: unknown) => Promise<{ ok: boolean; reason?: string }>;

/** Steps and kcal as whole numbers, km to one decimal: "2,349", "2.3". */
const number = (n: number) => n.toLocaleString("en", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 });

function line(m: MetricPace, asOf: string): string {
  const usualEnd = m.aimedAt === "goal" ? `the day's goal is ${number(m.aim!)}` : `a usual day ends near ${number(m.aim!)}`;
  return `- ${m.label}: ${number(m.today!)} by ${asOf}; a usual day is at ${number(m.expected!)} by then (${Math.round(m.ratio! * 100)}% of that), and ${usualEnd}.`;
}

export function nudgeMessage(verdict: PaceVerdict, ctx: PaceContext, person = "The person"): string {
  const asOf = spokenTime(ctx.asOf!, ctx.now);
  const behind = verdict.metrics.filter((m) => m.behind).map((m) => line(m, asOf));
  return [`${person} is well behind a usual day (the tracker's data reaches ${asOf}; checked at ${spokenTime(ctx.now.toISOString(), ctx.now)}):`, ...behind].join("\n");
}

/** A moment as a local minute of the day, when it falls on `today`. */
function minuteOn(today: string, at: string | null): number | null {
  const local = at ? localDateTime(at) : null;
  return local?.slice(0, 10) === today ? Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) : null;
}

export function paceService(store: PaceStore, params: () => PaceParams, person: () => string = () => "The person") {
  /** `asOf`: how far today's watch data reaches (the sync's `todayAsOf`). Data stamped after now is read as now. */
  function context(now: Date, asOf: string | null): PaceContext {
    const today = localDate(now);
    const minute = minuteOn(today, now.toISOString())!;
    const asOfMinute = minuteOn(today, asOf);
    return { now, today, minute, asOf, asOfMinute: asOfMinute === null ? null : Math.min(asOfMinute, minute), nudgesToday: store.nudgesOn(today) };
  }
  const fresh = (ctx: PaceContext, p: PaceParams) =>
    ctx.asOfMinute !== null && ctx.now.getTime() - Date.parse(ctx.asOf!) <= p.max_data_age_minutes * 60_000;

  function verdict(asOf: string | null, now = new Date()) {
    const p = params(), ctx = context(now, asOf);
    return { ctx, params: p, verdict: paceVerdict(store.inputs(p.metrics.map((m) => m.label), ctx.today, p.routine_days), ctx, p) };
  }

  return {
    verdict,
    /** After a sync: keep today's running totals at the minute the watch data reaches, only when that is fresh. */
    async sample(asOf: string | null, now = new Date()): Promise<void> {
      const p = params(), ctx = context(now, asOf);
      if (!fresh(ctx, p)) return;
      const values = store.inputs(PACE_LABELS, ctx.today, 0).flatMap((i) => (i.today === null ? [] : [{ label: i.label, value: i.today }]));
      await store.addSamples(ctx.today, ctx.asOfMinute!, values);
    },
    /** The scheduled check: wake the coach when the person is well behind, and keep a note of it. Returns the verdict. */
    async check(asOf: string | null, wake: WakeCoach, now = new Date()): Promise<PaceVerdict> {
      const { ctx, verdict: v } = verdict(asOf, now);
      if (!v.nudge) return v;
      const message = nudgeMessage(v, ctx, person());
      const woken = await wake(message, { date: ctx.today, metrics: v.metrics });
      if (!woken.ok) throw new Error(`could not wake the coach: ${woken.reason ?? "unknown"}`);
      await store.addNudge(ctx.today, now.toISOString(), v.metrics.filter((m) => m.behind).map((m) => m.label), message);
      return v;
    },
  };
}

export type PaceService = ReturnType<typeof paceService>;
