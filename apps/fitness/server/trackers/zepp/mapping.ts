// Pure Zepp → dashboard mapping. Each reading carries a deterministic stamp, so a re-run finds the row it wrote before.
import { PAI_LABEL } from "../../db/constants";
import type { Reading } from "../store";
import { localDateTime, stampOn } from "../../time/dates";

export type { Reading };
export interface WorkoutEvent { title: string; at: string; kind: "Milestone" }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A zero from the watch is a missing measurement, not a real zero. */
const positive = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null; };
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

function reading(label: string, value: number | null, unit: string | null, created_at: string): Reading[] {
  return value === null ? [] : [{ label, value, unit, created_at }];
}

/** Each day's totals up to `today`, stamped with the day's last minute. Today's are the running totals so far, filed at
 *  the pass's own time (see `filed`): each pass that finds a new number moves them to its time, and the next morning's
 *  pass leaves the finished day at its last minute. A day the watch recorded nothing (no steps and
 *  no calories) is no data, not zeros. */
export function dayReadings(summary: any, today: string): Reading[] {
  return (summary?.days ?? [])
    .filter((d: any) => typeof d?.date === "string" && d.date <= today)
    .flatMap((day: any) => {
      const steps = positive(day.steps), kcal = positive(day.calories_kcal), metres = positive(day.distance_metres);
      if (steps === null && kcal === null) return [];
      const at = stampOn(day.date, "23:59");
      return [
        ...reading("Steps", steps, "steps", at),
        ...reading("Calories burned", kcal, "kcal", at),
        ...reading("Distance", metres === null ? null : round(metres / 1000, 2), "km", at),
      ];
    });
}

/** Each night in the summary, filed under the morning it ended (a day's sleep block is the night before it).
 *  A night the watch missed (main_sleep_recorded false) gives nothing. */
export function sleepReadings(summary: any): Reading[] {
  return (summary?.days ?? [])
    .filter((d: any) => typeof d?.date === "string" && d.sleep && d.sleep.main_sleep_recorded !== false)
    .flatMap((day: any) => {
      const sleep = day.sleep;
      const staged = [sleep.light_minutes, sleep.deep_minutes, sleep.rem_minutes].map(num);
      const asleep = num(sleep.total_asleep_minutes) ?? (staged.every((m) => m === null) ? null : staged.reduce<number>((s, m) => s + (m ?? 0), 0));
      const at = stampOn(day.date, "06:00");
      return [
        ...reading("Sleep", asleep === null ? null : round(asleep / 60, 1), "hours", at),
        ...reading("Deep sleep", num(sleep.deep_minutes), "min", at),
        ...reading("Sleep score", num(sleep.sleep_score), null, at),
        ...reading("Resting heart rate", num(sleep.resting_heart_rate_bpm), "bpm", at),
      ];
    });
}

/** Zepp's own name for the sport, or plain "Workout" for a code it does not know (it reports those as unknown_sport_<code>). */
function sportLabel(sport: unknown): string {
  const name = typeof sport === "string" && !sport.startsWith("unknown_sport") ? sport.replace(/_/g, " ") : "";
  return name ? `Workout: ${name.charAt(0).toUpperCase()}${name.slice(1)}` : "Workout";
}

/** Workouts that started on or after `from` (Zepp's list ignores its date range), each as an event at its local start
 *  time. Zero values are left out, and a workout with no duration, calories or heart rate at all is skipped. */
export function workoutEvents(list: any, from: string): WorkoutEvent[] {
  return (list?.workouts ?? []).flatMap((w: any) => {
    const at = typeof w?.start_local === "string" ? localDateTime(w.start_local) : null;
    if (!at || at.slice(0, 10) < from) return [];
    const seconds = positive(w.elapsed_seconds), kcal = positive(w.summary?.calorie), hr = positive(w.summary?.avg_heart_rate);
    const minutes = seconds === null ? null : Math.max(1, Math.round(seconds / 60));
    if (minutes === null && kcal === null && hr === null) return [];
    const details = [
      minutes !== null ? `${minutes} min` : null,
      kcal !== null ? `${Math.round(kcal)} kcal` : null,
      hr !== null ? `avg HR ${Math.round(hr)}` : null,
    ].filter(Boolean);
    return [{ title: [sportLabel(w.sport), ...details].join(" · "), at, kind: "Milestone" as const }];
  });
}

/** Every scale reading returned, stamped at the moment it was taken. Body fat only when the scale measured it. */
export function weightReadings(body: any): Reading[] {
  return (body?.readings ?? [])
    .filter((r: any) => typeof r?.date === "string")
    .flatMap((r: any) => {
      const at = new Date(r.date).toISOString();
      return [
        ...reading("Weight", num(r.weight_kg), "kg", at),
        ...reading("Body fat", num(r.body_composition?.body_fat_percent), "%", at),
      ];
    });
}

/** Zepp's PAI, one reading per day, filed at the start of that day (Zepp's own timestamp). The value is the rolling
 *  total the Zepp app shows, rounded as it does; today's grows through the day and is corrected on each pass. */
export function paiReadings(reply: any): Reading[] {
  return (reply?.data?.items ?? []).flatMap((item: any) => {
    const total = Number.parseFloat(item?.value?.totalPai);
    const at = num(item?.timestamp);
    if (!Number.isFinite(total) || at === null) return [];
    return reading(PAI_LABEL, Math.round(total), null, new Date(at).toISOString());
  });
}

/** The newest moment Zepp holds from the watch: the latest PAI upload or workout end. Zepp only gets the watch's numbers
 *  when the phone app syncs, so this is how current the dashboard can be. Null when neither reply says. */
export function newestWatchData(pai: any, workouts: any): string | null {
  const uploads = (pai?.data?.items ?? []).map((item: any) => Number(item?.value?.uploadTimestamp));
  const ends = (workouts?.workouts ?? []).map((w: any) => Date.parse(w?.end_local));
  const newest = Math.max(...[...uploads, ...ends].filter((t) => Number.isFinite(t) && t > 0));
  return Number.isFinite(newest) ? new Date(newest).toISOString() : null;
}

/** How far today's watch data reaches in Zepp: the minute of today's last heart-rate reading, as a UTC stamp. Heart rate
 *  and steps come up from the watch in the same phone upload, so today's totals are as of this moment. Null when Zepp has
 *  no reading from today: the phone has not uploaded today's data yet, or heart-rate monitoring is off on the watch. */
export function watchDataUntil(heart: any, today: string): string | null {
  const last = heart?.status === "ok" && heart.date === today ? num(heart.last_reading_minute) : null;
  if (last === null || !Number.isInteger(last) || last < 0 || last >= 24 * 60) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return stampOn(today, `${pad(Math.floor(last / 60))}:${pad(last % 60)}`);
}
