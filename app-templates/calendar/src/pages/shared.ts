export interface CalEvent { id: string; title: string; start: string; end: string | null; all_day: boolean | null; notes: string | null }
/** What the chat is pointed at: the event the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
// ISO dates are handled as UTC calendar days, as the component library's Calendar does, so no time zone shifts them.
const ms = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y!, m! - 1, d!); };
const fmt = (n: number) => new Date(n).toISOString().slice(0, 10);

/** Today as an ISO date in the viewer's own time zone. */
export const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const addDays = (iso: string, n: number) => fmt(ms(iso) + n * DAY_MS);
/** Monday of the week `iso` falls in (the Calendar's weeks start on Monday). */
export const mondayOf = (iso: string) => addDays(iso, -((new Date(ms(iso)).getUTCDay() + 6) % 7));
export const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export const addMonths = (iso: string, n: number) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}-01`;
};
/** The 6 × 7 days the Calendar's month view shows for the month of `iso`, Monday first (its own monthMatrix). */
export const monthDays = (iso: string): string[][] => {
  const start = mondayOf(firstOfMonth(iso));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!;
const weekdayOf = (iso: string) => WEEKDAYS[(new Date(ms(iso)).getUTCDay() + 6) % 7]!;
/** "Wednesday 15 October". */
export const longDay = (iso: string) => `${weekdayOf(iso)} ${Number(iso.slice(8, 10))} ${monthOf(iso)}`;
/** "15 Oct". */
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${monthOf(iso).slice(0, 3)}`;
/** "13 – 19 Oct 2026" for the week starting `monday`. */
export const weekLabel = (monday: string) => {
  const sun = addDays(monday, 6);
  return `${monday.slice(5, 7) === sun.slice(5, 7) ? Number(monday.slice(8, 10)) : shortDay(monday)} – ${shortDay(sun)} ${sun.slice(0, 4)}`;
};

/** The parts of a stored start or end: "2026-10-15" or "2026-10-15T09:30". */
export const dateOf = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");
export const timeOf = (v: string | null | undefined) => (v && v.length > 10 ? v.slice(11, 16) : "");

/** "9:30", "930" or "9.30" as 24h "09:30"; null for empty; undefined for anything that is not a time. */
export const normaliseTime = (t: unknown): string | null | undefined => {
  const s = String(t ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(s);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1]!.padStart(2, "0")}:${m[2]}` : undefined;
};

/** When the event is, in words: "All day", "All day, until 24 Oct", "09:30 – 10:00", "19:00, until 17 Oct 10:00". */
export const whenText = (e: Pick<CalEvent, "start" | "end" | "all_day">) => {
  const d0 = dateOf(e.start), d1 = dateOf(e.end), t0 = timeOf(e.start), t1 = timeOf(e.end);
  if (e.all_day || !t0) return d1 && d1 > d0 ? `All day, until ${shortDay(d1)}` : "All day";
  if (!e.end) return t0;
  return d1 && d1 !== d0 ? `${t0}, until ${shortDay(d1)}${t1 ? ` ${t1}` : ""}` : t1 ? `${t0} – ${t1}` : t0;
};

export type FieldDef = { type: "text" | "longtext" | "date" | "checkbox"; name: string; label: string; required?: boolean };
export const EVENT_FIELDS: FieldDef[] = [
  { type: "text", name: "title", label: "What", required: true },
  { type: "date", name: "start_date", label: "Date", required: true },
  { type: "checkbox", name: "all_day", label: "All day" },
  { type: "text", name: "start_time", label: "Starts at (24h, like 09:30)" },
  { type: "text", name: "end_time", label: "Ends at" },
  { type: "date", name: "end_date", label: "Ends on (for more than one day)" },
  { type: "longtext", name: "notes", label: "Notes" },
];

/** An event as the form's values. */
export const toForm = (e: Partial<CalEvent>) => ({
  title: e.title ?? "", start_date: dateOf(e.start), all_day: !!e.all_day, start_time: timeOf(e.start),
  end_time: timeOf(e.end), end_date: dateOf(e.end) && dateOf(e.end) !== dateOf(e.start) ? dateOf(e.end) : "", notes: e.notes ?? "",
});

/** The form's values as the row to save. Throws { field, message } (the Form shows it under that field) for a time it cannot read
 *  or an end before the start. No start time means all day. */
export const fromForm = (v: Record<string, any>): Omit<CalEvent, "id"> => {
  const date = dateOf(String(v.start_date ?? ""));
  const t0 = normaliseTime(v.start_time), t1 = normaliseTime(v.end_time);
  if (t0 === undefined) throw { field: "start_time", message: "Use a 24h time, like 09:30" };
  if (t1 === undefined) throw { field: "end_time", message: "Use a 24h time, like 10:30" };
  const allDay = !!v.all_day || !t0;
  const endDate = dateOf(String(v.end_date ?? "")) || date;
  if (endDate < date) throw { field: "end_date", message: "Ends before it starts" };
  const notes = String(v.notes ?? "").trim() || null;
  const title = String(v.title ?? "").trim();
  if (allDay) return { title, all_day: true, start: date, end: endDate > date ? endDate : null, notes };
  const start = `${date}T${t0}`;
  const end = t1 ? `${endDate}T${t1}` : endDate > date ? endDate : null;   // more than one day with no end time: the end day alone
  if (end && end < start) throw { field: "end_time", message: "Ends before it starts" };
  return { title, all_day: false, start, end, notes };
};
