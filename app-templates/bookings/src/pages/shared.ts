import { useCallback, useEffect, useRef, useState } from "react";
import { KitError, clockLabel, kitFetch, subscribeEvents } from "../flock/ui";
import { DEFAULT_SETTINGS, STATUSES as STATUS_LIST, timesFor, usableSettings, type BookingSettings } from "../../server/db/constants";

export interface Service { id: string; name: string; minutes: number; price: number | null; created_at: string; updated_at: string; updated_by: string | null }
export interface Booking {
  id: string; customer_name: string; phone: string | null; service_id: string; service_name: string; start: string; minutes: number;
  status: string; notes: string | null; created_at: string; updated_at: string; updated_by: string | null;
}
/** What the chat is pointed at: the booking or service the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

export const STATUSES: string[] = [...STATUS_LIST];
export const STATUS_LABEL: Record<string, string> = { booked: "Booked", done: "Done", no_show: "No-show", cancelled: "Cancelled" };
export const STATUS_TONES = { booked: "info", done: "success", no_show: "warning", cancelled: "muted" } as const;

export const pad = (n: number) => String(n).padStart(2, "0");
export const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string): string => { const [y, m, d] = iso.split("-").map(Number); return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`; };
export const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const dateOf = (start: string) => start.slice(0, 10);
export const timeOf = (start: string) => start.slice(11, 16);
/** "10:30 am to 11:00 am" for a booking. */
export const rangeLabel = (b: Pick<Booking, "start" | "minutes">): string => {
  const end = minutesOf(timeOf(b.start)) + b.minutes;
  return `${clockLabel(timeOf(b.start))} to ${clockLabel(`${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`)}`;
};

/** The message a failed save should show, and which form field it belongs to. */
export const failure = (e: unknown): { field?: string; message: string } =>
  e instanceof KitError ? { field: e.field, message: e.message } : { message: "Something went wrong" };

/** Bookings from `from` to `to` (both included), kept fresh as the app tells us they change. Bookings are private, so this reads /api/bookings, not /api/_data. */
export function useBookings(from: string, to: string) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const seq = useRef(0);
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await kitFetch<{ rows: Booking[]; nextCursor: string | null }>(`bookings?from=${from}&to=${to}&limit=500`);
      if (mine !== seq.current) return;
      setRows(r.rows); setTruncated(!!r.nextCursor); setError(null);
    } catch (e) { if (mine === seq.current) setError(failure(e).message); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [from, to]);
  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    const off = subscribeEvents((e) => { if (e.table === "bookings") soon(); }, soon);
    return () => { clearTimeout(t); off(); };
  }, [refetch]);
  return { rows, loading, error, truncated, refetch };
}

export const SERVICE_FIELDS = [
  { type: "text", name: "name", label: "Service", required: true },
  { type: "number", name: "minutes", label: "Minutes", required: true },
  { type: "money", name: "price", label: "Price" },
] as const;

/** The app's opening hours and slot length (settings at /api/_app), kept fresh when they change. Today's defaults until they load. */
export function useBookingSettings(): BookingSettings {
  const [s, setS] = useState<BookingSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let live = true;
    const load = () => { kitFetch<{ settings: Record<string, unknown> }>("_app").then((r) => { if (live) setS(usableSettings(r.settings ?? {})); }).catch(() => { /* keep what we have */ }); };
    load();
    const off = subscribeEvents((e) => { if (e.table === "_settings") load(); }, load);
    return () => { live = false; off(); };
  }, []);
  return s;
}

/** Times the edit form offers for a booking: its day's slots under the current hours that fit its length, plus its own time if that is off the grid
 *  (or outside hours that changed after it was booked). Each is a clock label and its HH:MM value. */
export const timeChoices = (s: BookingSettings, b: Pick<Booking, "start" | "minutes">, date = dateOf(b.start)) =>
  timesFor(s, date, b.minutes, date === dateOf(b.start) ? timeOf(b.start) : undefined).map((t) => ({ value: t, label: clockLabel(t) }));
