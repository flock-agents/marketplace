// Plain constants and pure helpers, no imports: the server schema, the routes and the browser pages all read these.

/** What a booking can be. Agents must use exactly these. Cancelled bookings free their slot; the others hold it. */
export const STATUSES = ["booked", "done", "no_show", "cancelled"] as const;

/** Today's defaults. The owner's values are the app settings `hours` and `slot_minutes` (GET /api/_app, PATCH /api/_app/settings); always read them through the settings, never these. */
export const SLOT_MINUTES = 30;

/** Opening hours by weekday ("0" = Sunday), as ["HH:MM", "HH:MM"] or null when closed. Local time throughout (IST). */
export type Hours = Record<string, [string, string] | null>;
export const HOURS: Hours = {
  0: ["10:00", "13:00"],
  1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"],
  6: ["09:00", "14:00"],
};

/** What the hour and slot helpers read: the app's current settings. */
export interface BookingSettings { hours: Hours; slot_minutes: number }
export const DEFAULT_SETTINGS: BookingSettings = { hours: HOURS, slot_minutes: SLOT_MINUTES };

export const MIN_SLOT = 5, MAX_SLOT = 240;
const CLOCK_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const clockMin = (t: unknown): number | null => {
  if (typeof t !== "string" || !CLOCK_RE.test(t)) return null;
  const n = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return n <= 24 * 60 ? n : null;
};

/** Why `v` is not usable as `hours`, or null when it is. Every weekday 0 to 6 must be there, and nothing else. */
export function hoursProblem(v: unknown): string | null {
  const shape = 'hours must be an object with a key for each weekday "0" (Sunday) to "6" (Saturday), each ["HH:MM", "HH:MM"] or null when closed';
  if (!v || typeof v !== "object" || Array.isArray(v)) return shape;
  const keys = Object.keys(v);
  for (const k of keys) if (!/^[0-6]$/.test(k)) return `hours has an unknown day "${k}": ${shape}`;
  for (let d = 0; d < 7; d++) {
    if (!keys.includes(String(d))) return `hours is missing day "${d}": ${shape}`;
    const h = (v as Record<string, unknown>)[d];
    if (h === null) continue;
    if (!Array.isArray(h) || h.length !== 2) return `hours "${d}" must be ["HH:MM", "HH:MM"] or null`;
    const [o, c] = h.map(clockMin);
    if (o === null || c === null) return `hours "${d}" must use 24-hour times like "09:00" and "18:00" (up to "24:00")`;
    if (o >= c) return `hours "${d}" opens at ${h[0]}, which is not before it closes at ${h[1]}`;
  }
  return null;
}
/** Why `v` is not usable as `slot_minutes`, or null when it is. */
export const slotProblem = (v: unknown): string | null =>
  typeof v === "number" && Number.isInteger(v) && v >= MIN_SLOT && v <= MAX_SLOT ? null : `slot_minutes must be a whole number from ${MIN_SLOT} to ${MAX_SLOT}`;

/** The settings this template declares (passed to mountKit, and listed in template.json without the checks). Defaults are today's constants.
 *  The kit runs each `check` on PATCH /api/_app/settings (400 naming the field), on the boot import (the import fails) and on read. */
export const SETTINGS = [
  { key: "hours", type: "json" as const, default: HOURS, scope: "owner" as const,
    label: 'Opening hours by weekday, "0" (Sunday) to "6" (Saturday): ["HH:MM", "HH:MM"] for open and close, or null when closed', check: hoursProblem },
  { key: "slot_minutes", type: "integer" as const, default: SLOT_MINUTES, scope: "owner" as const, label: "Minutes between the start times offered (5 to 240)", check: slotProblem },
];

/** The settings as the helpers use them: a stored value that is not usable falls back to its default, so the slot loop always ends. */
export const usableSettings = (raw: { hours?: unknown; slot_minutes?: unknown }): BookingSettings => ({
  hours: hoursProblem(raw.hours) ? HOURS : raw.hours as Hours,
  slot_minutes: slotProblem(raw.slot_minutes) ? SLOT_MINUTES : raw.slot_minutes as number,
});

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A local date-time with no zone: 2026-10-09T10:30. Never convert it through UTC. */
export const START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const pad = (n: number) => String(n).padStart(2, "0");
export const fromMin = (n: number): string => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

/** True for a real calendar date written YYYY-MM-DD. */
export const isRealDate = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** True for a real local date-time, 00:00 to 23:59. */
export const isRealStart = (s: string): boolean => START_RE.test(s) && isRealDate(s.slice(0, 10)) && toMin(s.slice(11)) < 24 * 60 && Number(s.slice(14)) < 60;

/** The weekday (0 = Sunday) of a calendar date, with no time zone involved. */
export const weekdayOf = (date: string): number => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const hoursFor = (s: BookingSettings, date: string): [string, string] | null => s.hours[weekdayOf(date)] ?? null;

/** Minutes on one absolute scale, so two bookings on different days never compare as overlapping. */
export const absMinutes = (start: string): number => { const [y, m, d] = start.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / 60000 + toMin(start.slice(11)); };
/** Half-open ranges: a booking that ends at 10:30 does not clash with one that starts at 10:30. */
export const overlaps = (aStart: string, aMinutes: number, bStart: string, bMinutes: number): boolean => {
  const a = absMinutes(aStart), b = absMinutes(bStart);
  return a < b + bMinutes && b < a + aMinutes;
};
/** Whether a booking of `minutes` starting at `start` lies inside that day's opening hours. */
export const withinHours = (s: BookingSettings, start: string, minutes: number): boolean => {
  const h = hoursFor(s, start.slice(0, 10));
  if (!h) return false;
  const m = toMin(start.slice(11));
  return m >= toMin(h[0]) && m + minutes <= toMin(h[1]);
};

/** The start times worth offering (the settings' hours and slot length) for a booking of `minutes` on `date`: every slot in that day's hours that ends by closing, plus the booking's own current time when it is off the grid. */
export const timesFor = (s: BookingSettings, date: string, minutes: number, current?: string): string[] => {
  const h = hoursFor(s, date);
  const out: string[] = [];
  if (h) for (let m = toMin(h[0]); m + minutes <= toMin(h[1]); m += s.slot_minutes) out.push(fromMin(m));
  if (current && !out.includes(current)) out.push(current);
  return out.sort();
};
