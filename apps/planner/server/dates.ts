// Dates as the family reads them: "YYYY-MM-DD" strings in local time. Nothing here goes through UTC (no toISOString), so a late
// evening in India never lands on the wrong day.

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
/** A date string as a local Date at noon: far from midnight, so adding days is safe wherever clocks change. */
const parse = (date: string): Date => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const format = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function todayStr(now: Date = new Date()): string { return format(now); }

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return format(d);
}

export function weekdayOf(date: string): Weekday { return WEEKDAYS[(parse(date).getDay() + 6) % 7]; }

/** The Monday strictly after `date`: a Monday gives the next one. */
export function nextMonday(date: string): string { return addDays(date, 7 - WEEKDAYS.indexOf(weekdayOf(date))); }

/** The seven dates of the week starting on `weekStart`. */
export function weekDates(weekStart: string): string[] { return WEEKDAYS.map((_, i) => addDays(weekStart, i)); }

/** Now as "YYYY-MM-DDTHH:MM", local time: what an order's place_at is compared with. */
export function localStamp(now: Date = new Date()): string { return `${format(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`; }

/** "Tue 24 Nov". */
export function dayLabel(date: string): string { const d = parse(date); return `${weekdayOf(date)} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

/** A time of day ("HH:MM") the way the family says it: "3 pm", "7:30 pm", "8 am". Anything else is given back as it is. */
export function clockText(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  return `${h % 12 || 12}${m[2] === "00" ? "" : `:${m[2]}`} ${h < 12 ? "am" : "pm"}`;
}
