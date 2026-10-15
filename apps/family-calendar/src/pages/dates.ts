// Plain functions, no imports: the pages use them and server/dates.test.ts tests them.
// Dates are ISO "YYYY-MM-DD", times "HH:MM" (24-hour) and a reminder's `due` is the two joined with a T, all in the family's own time.

export const pad = (n: number): string => String(n).padStart(2, "0");
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s: string): Date => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number): string => { const d = parseDate(s); return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
/** The same day `n` months on; a 31st lands on the last day of a shorter month. */
export const addMonths = (s: string, n: number): string => {
  const d = parseDate(s);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoDate(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last)));
};
/** The Monday on or before an ISO date. */
export const mondayOf = (s: string): string => { const d = parseDate(s); return addDays(s, -((d.getDay() + 6) % 7)); };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** "Oct 16" */
export const shortDate = (s: string): string => `${MONTHS[parseDate(s).getMonth()]} ${parseDate(s).getDate()}`;
/** "Thu" */
export const weekday = (s: string): string => WEEKDAYS[parseDate(s).getDay()];
/** "Thursdays" */
export const weekdays = (s: string): string => WEEKDAYS_LONG[parseDate(s).getDay()];
/** "1st", "22nd", "31st" */
export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** "16:30" from what someone types: "16:30", "4:30 pm", "4pm", "16.30", "0930"; null when it is not a time. */
export function parseClock(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? "0"); const half = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (half) { if (h < 1 || h > 12) return null; h = (h % 12) + (half === "p" ? 12 : 0); }
  else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}
export const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** By date, then all-day events first, then by start time, then by title. */
export const eventOrder = (a: { date: string; start_time: string | null; title: string }, b: typeof a): number =>
  a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.title.localeCompare(b.title);

type EventValues = { title?: unknown; date?: unknown; start_time?: unknown; end_time?: unknown; who?: unknown; location?: unknown; notes?: unknown; reminder_minutes?: unknown };
export type EventPatch = { title: string; date: string; start_time: string | null; end_time: string | null; who: string | null; location: string | null; notes: string | null; reminder_minutes: number | null };
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What the event form submitted, as the row to write: times normalised to HH:MM, blanks as null; or the field errors to show. */
export function normaliseEvent(v: EventValues): { ok: true; row: EventPatch } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = str(v.title), date = str(v.date);
  if (!title) errors.title = "Required";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Required";
  const times: Record<"start_time" | "end_time", string | null> = { start_time: null, end_time: null };
  for (const k of ["start_time", "end_time"] as const) {
    const raw = str(v[k]);
    if (!raw) continue;
    const t = parseClock(raw);
    if (t) times[k] = t; else errors[k] = "Use a time like 16:30 or 4:30 pm";
  }
  if (times.end_time && !times.start_time) errors.start_time = "Needed when there is an end time";
  if (times.start_time && times.end_time && toMin(times.end_time) <= toMin(times.start_time)) errors.end_time = "Must be after the start";
  const minutes = v.reminder_minutes;
  if (minutes !== null && minutes !== undefined && minutes !== "" && !(typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0)) errors.reminder_minutes = "Whole minutes, 0 or more";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { title: title!, date: date!, ...times, who: str(v.who), location: str(v.location), notes: str(v.notes), reminder_minutes: typeof minutes === "number" ? minutes : null } };
}

type ReminderValues = { title?: unknown; date?: unknown; time?: unknown; repeat?: unknown; who?: unknown };
export type ReminderPatch = { title: string; due: string; repeat: string; who: string | null };

/** What the reminder form submitted (a date and a time) as the row to write (`due` joined), or the field errors. */
export function normaliseReminder(v: ReminderValues, repeats: readonly string[]): { ok: true; row: ReminderPatch } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = str(v.title), date = str(v.date), time = parseClock(str(v.time));
  if (!title) errors.title = "Required";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Required";
  if (!time) errors.time = str(v.time) ? "Use a time like 08:00 or 8 am" : "Required";
  const repeat = str(v.repeat) ?? repeats[0];
  if (!repeats.includes(repeat)) errors.repeat = `One of ${repeats.join(", ")}`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { title: title!, due: `${date}T${time}`, repeat, who: str(v.who) } };
}

/** A reminder's `due` as the form's date and time. */
export const splitDue = (due: string): { date: string; time: string } => ({ date: due.slice(0, 10), time: due.slice(11, 16) });

/** When a reminder next comes round, on or after `now` (a local "YYYY-MM-DDTHH:MM"); null for a one-off already past. */
export function nextDue(r: { due: string; repeat: string }, now: string): string | null {
  if (r.due >= now) return r.due;
  const { date, time } = splitDue(r.due);
  const nowDate = now.slice(0, 10);
  const at = (d: string) => `${d}T${time}`;
  // Always stepped from the first due date, so a monthly on the 31st never drifts to the 30th for good.
  const bump = (d: string, step: (s: string, n: number) => string, n: number) => { const c = step(d, n); return at(c) >= now ? c : step(d, n + 1); };
  switch (r.repeat) {
    case "daily": return at(bump(date, addDays, Math.max(0, Math.round((parseDate(nowDate).getTime() - parseDate(date).getTime()) / 86400000))));
    case "weekly": return at(bump(date, (s, n) => addDays(s, n * 7), Math.max(0, Math.floor(Math.round((parseDate(nowDate).getTime() - parseDate(date).getTime()) / 86400000) / 7))));
    case "monthly": {
      const a = parseDate(date), b = parseDate(nowDate);
      return at(bump(date, addMonths, Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth())));
    }
    default: return null;
  }
}

/** "Daily", "Weekly on Mondays", "Monthly on the 1st", or "Once" for a one-off. */
export const repeatText = (r: { due: string; repeat: string }): string => {
  const d = splitDue(r.due).date;
  return r.repeat === "daily" ? "Daily" : r.repeat === "weekly" ? `Weekly on ${weekdays(d)}` : r.repeat === "monthly" ? `Monthly on the ${ordinal(parseDate(d).getDate())}` : "Once";
};
