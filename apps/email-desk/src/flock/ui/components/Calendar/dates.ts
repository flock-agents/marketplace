// ISO dates (YYYY-MM-DD) are handled as UTC calendar days so no timezone can shift them.
const DAY_MS = 86_400_000;
const parse = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function addDays(iso: string, n: number): string { return fmt(parse(iso) + n * DAY_MS); }
/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(iso: string): number { return (new Date(parse(iso)).getUTCDay() + 6) % 7; }
export function mondayOf(iso: string): string { return addDays(iso, -weekdayIndex(iso)); }
export function dayOfMonth(iso: string): number { return Number(iso.slice(8, 10)); }
export function monthIndex(iso: string): number { return Number(iso.slice(5, 7)) - 1; }

/** The 7 ISO dates starting at `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
/** 6 weeks × 7 days covering the month of `anyDayInMonth`, Monday first. */
export function monthMatrix(anyDayInMonth: string): string[][] {
  const first = `${anyDayInMonth.slice(0, 7)}-01`;
  const start = mondayOf(first);
  return Array.from({ length: 6 }, (_, w) => weekDays(addDays(start, w * 7)));
}
