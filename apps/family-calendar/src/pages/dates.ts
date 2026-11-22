// Plain functions, no imports: the pages use them and server/dates.test.ts tests them.
// Dates are ISO "YYYY-MM-DD" and times "HH:MM" (24-hour), all in the family's own time; a local moment is the two joined with a T.

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
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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

/** "4:30 pm", "4 pm" */
export const clock12 = (hhmm: string): string => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "am" : "pm"}`; };

/** The same day `n` years on; a 29 February lands on the 28th in a year without one. */
export const addYears = (s: string, n: number): string => addMonths(s, 12 * n);

// A monthly event by weekday (`monthly_by`, server/db/constants.ts MONTHLY_BY): "weekday" is the same weekday of the month as its
// date (6 Dec 2026 is the 1st Sunday: every 1st Sunday), "last_weekday" the last such weekday of the month. Empty, or "date", is
// the date's day of the month, as every monthly event was before.
type Repeating = { date: string; repeat?: string | null; monthly_by?: string | null };
const daysIn = (y: number, m: number): number => new Date(y, m + 1, 0).getDate();
/** Which of its weekday in the month a date is: 1 for a first Sunday, up to 5 for a fifth. */
export const weekOfMonth = (s: string): number => Math.ceil(parseDate(s).getDate() / 7);
/** The weekday reading of a monthly event, or null when it comes round by date. */
const byWeekday = (e: Repeating): "weekday" | "last_weekday" | null =>
  e.repeat === "monthly" && (e.monthly_by === "weekday" || e.monthly_by === "last_weekday") ? e.monthly_by : null;
/** The day `n` months after the month of `s` that is `s`'s weekday of the month (`weekday`), or the last such weekday
 *  (`last_weekday`); null when that month has none (a 5th Tuesday in a month with four). */
function monthlyOn(s: string, n: number, by: "weekday" | "last_weekday"): string | null {
  const d = parseDate(s), first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const y = first.getFullYear(), m = first.getMonth(), len = daysIn(y, m);
  const firstOn = 1 + ((d.getDay() - first.getDay() + 7) % 7);
  const day = by === "last_weekday" ? firstOn + 7 * Math.floor((len - firstOn) / 7) : firstOn + 7 * (weekOfMonth(s) - 1);
  return day <= len ? isoDate(new Date(y, m, day)) : null;
}
/** Why a monthly event starting on `date` cannot come round as `by` says, or null when it can: a 5th weekday is in few months
 *  (the last one is meant), and a `last_weekday` event starts on a last weekday. */
export function monthlyByProblem(date: string, by: string | null | undefined): string | null {
  const name = WEEKDAY_NAMES[parseDate(date).getDay()];
  if (by === "weekday" && weekOfMonth(date) === 5) return `${date} is the 5th ${name} of its month, and most months have no 5th: for "the last ${name} of every month" use monthly_by "last_weekday"`;
  if (by === "last_weekday") { const last = monthlyOn(date, 0, "last_weekday")!; if (last !== date) return `${date} is not the last ${name} of its month (that is ${last}): give the date of a last ${name}`; }
  return null;
}

/** The dates an event falls on from `from` to `to`, both included: its own date, or for a repeating event every day, every
 *  week on its date's weekday, every month on its date's day (the last day of a shorter month) or on its weekday of the month
 *  (`monthly_by`: the 1st Sunday, the last Friday; a 5th weekday only in the months that have one), or every year on its date
 *  (a 29 February on the 28th in other years), from its date on. */
export function occurrences(e: Repeating, from: string, to: string): string[] {
  const out: string[] = [];
  const start = e.date >= from ? e.date : from;
  switch (e.repeat) {
    case "daily": for (let d = start; d <= to; d = addDays(d, 1)) out.push(d); break;
    case "weekly": for (let d = addDays(start, (parseDate(e.date).getDay() - parseDate(start).getDay() + 7) % 7); d <= to; d = addDays(d, 7)) out.push(d); break;
    case "monthly": {
      const by = byWeekday(e);
      if (by) {
        // Month by month from the first date's month: the weekday of the month in each, until a month begins after `to`.
        const a = parseDate(e.date), b = parseDate(start);
        for (let n = Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()); addMonths(`${e.date.slice(0, 8)}01`, n) <= to; n++) {
          const d = monthlyOn(e.date, n, by);
          if (d && d >= start && d <= to) out.push(d);
        }
        break;
      }
      // Always stepped from the first date, as a monthly reminder is, so the 31st never drifts to the 30th for good.
      const a = parseDate(e.date), b = parseDate(start);
      for (let n = Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()), d = addMonths(e.date, n); d <= to; d = addMonths(e.date, ++n)) if (d >= from) out.push(d);
      break;
    }
    case "yearly": {
      // Stepped from the first date too, so a 29 February comes back to the 29th in a leap year.
      for (let n = Math.max(0, parseDate(start).getFullYear() - parseDate(e.date).getFullYear() - 1), d = addYears(e.date, n); d <= to; d = addYears(e.date, ++n)) if (d >= from) out.push(d);
      break;
    }
    default: if (e.date >= from && e.date <= to) out.push(e.date);
  }
  return out;
}
/** Does the event repeat? */
export const repeats = (e: { repeat?: string | null }): boolean => e.repeat === "daily" || e.repeat === "weekly" || e.repeat === "monthly" || e.repeat === "yearly";
/** The next date an event falls on, on or after `from`; null for a one-off already past. */
export const nextOccurrence = (e: Repeating, from: string): string | null =>
  repeats(e) ? occurrences(e, from, addMonths(from, e.repeat === "yearly" || byWeekday(e) ? 13 : 1))[0] ?? e.date : e.date >= from ? e.date : null;

/** The local moment `minutes` before a date and time, as "YYYY-MM-DDTHH:MM". */
export const minutesBefore = (date: string, time: string, minutes: number): string => {
  const d = parseDate(date), t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, toMin(time) - minutes);
  return `${isoDate(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
/** 2.x's "the evening before" was 19:00 the day before, kept as minutes before the start (midnight for an all-day event). 3.0 has
 *  no such reminder (the 9 pm brief covers tomorrow): the update to 3.0 clears a reminder of exactly this value. */
export const EVENING_BEFORE = "19:00";
export const eveningBeforeMinutes = (start: string | null): number => toMin(start ?? "00:00") + 24 * 60 - toMin(EVENING_BEFORE);

/** An event's reminders that come due after `from` and up to `to` (local moments "YYYY-MM-DDTHH:MM"): for each, the day of the
 *  event it is for and when it is due. An event with no `reminder_minutes` has none. */
export function eventRemindersDue(e: Repeating & { start_time: string | null; reminder_minutes: number | null }, from: string, to: string): { date: string; at: string }[] {
  if (e.reminder_minutes == null) return [];
  // The event may be days after its reminder (a week's notice): look that far past the window.
  const days = occurrences(e, from.slice(0, 10), addDays(to.slice(0, 10), Math.ceil(e.reminder_minutes / 1440) + 1));
  return days.map((date) => ({ date, at: minutesBefore(date, e.start_time ?? "00:00", e.reminder_minutes!) })).filter((r) => r.at > from && r.at <= to);
}

/** A deadline is spoken of a week before its day, at 9 in the morning (the family's own time). */
export const DEADLINE_NOTICE_DAYS = 7;
export const deadlineNoticeAt = (date: string): string => `${addDays(date, -DEADLINE_NOTICE_DAYS)}T09:00`;

/** By date, then all-day events first, then by start time, then by title. */
export const eventOrder = (a: { date: string; start_time: string | null; title: string }, b: typeof a): number =>
  a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.title.localeCompare(b.title);

type EventValues = { title?: unknown; date?: unknown; repeat?: unknown; monthly_by?: unknown; start_time?: unknown; end_time?: unknown; who?: unknown; location?: unknown; notes?: unknown; reminder_minutes?: unknown };
export type EventPatch = { title: string; date: string; repeat: string; monthly_by: string | null; start_time: string | null; end_time: string | null; who: string | null; location: string | null; notes: string | null; reminder_minutes: number | null };
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
  // Once unless the form says how it repeats: an event made before events could repeat has no repeat to send.
  const repeat = str(v.repeat) ?? "none";
  if (!["none", "daily", "weekly", "monthly", "yearly"].includes(repeat)) errors.repeat = "Once, or every day, week, month or year";
  // How a monthly event comes round: read only for a monthly one; by date is kept as empty, as every event before it.
  const by = str(v.monthly_by);
  let monthly_by: string | null = null;
  if (by && !["date", "weekday", "last_weekday"].includes(by)) errors.monthly_by = "By date, by weekday, or by the last weekday";
  else if (repeat === "monthly" && by && by !== "date" && date && !errors.date) {
    const name = WEEKDAY_NAMES[parseDate(date).getDay()];
    if (by === "weekday" && weekOfMonth(date) === 5) errors.monthly_by = `Most months have no 5th ${name}: pick the last ${name}`;
    else if (monthlyByProblem(date, by)) errors.monthly_by = `This is not the last ${name} of its month`;
    else monthly_by = by;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { title: title!, date: date!, repeat, monthly_by, ...times, who: str(v.who), location: str(v.location), notes: str(v.notes), reminder_minutes: typeof minutes === "number" ? minutes : null } };
}

/** "Daily", "Weekly on Mondays", "Monthly on the 1st", "Monthly on the 1st Sunday", "Monthly on the last Friday", "Yearly on
 *  Nov 28", or "Once" for a one-off. */
export const repeatText = (date: string, repeat: string, monthly_by?: string | null): string => {
  const by = byWeekday({ date, repeat, monthly_by }), name = WEEKDAY_NAMES[parseDate(date).getDay()];
  return repeat === "daily" ? "Daily" : repeat === "weekly" ? `Weekly on ${weekdays(date)}`
    : by === "weekday" ? `Monthly on the ${ordinal(weekOfMonth(date))} ${name}` : by === "last_weekday" ? `Monthly on the last ${name}`
    : repeat === "monthly" ? `Monthly on the ${ordinal(parseDate(date).getDate())}` : repeat === "yearly" ? `Yearly on ${shortDate(date)}` : "Once";
};
