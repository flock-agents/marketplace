import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { _samples } from "@flock/app-kit";
import { bookings, services } from "./schema";
import { DEFAULT_SETTINGS, hoursFor, overlaps, toMin, fromMin, usableSettings as usable, withinHours, type BookingSettings } from "./constants";

/** An ISO date `days` from today, in local time, so the sample bookings never look stale. */
export const inDays = (days: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample services: a small family clinic in Indiranagar. Replace them with your own. */
export const sampleServices = [
  { name: "Consultation", minutes: 30, price: 600 },
  { name: "Follow-up visit", minutes: 30, price: 350 },
  { name: "Dental cleaning", minutes: 60, price: 1200 },
  { name: "Health check-up", minutes: 60, price: 1800 },
];

// [days from today, start time, customer, phone, service name, status, notes]. The seed keeps only the ones that fit that day's opening hours.
const BOOKINGS: [number, string, string, string, string, string, string | null][] = [
  [-1, "09:30", "Meera Nair", "+91 98450 11201", "Consultation", "done", null],
  [-1, "11:00", "Arjun Rao", "+91 99001 22302", "Dental cleaning", "done", null],
  [-1, "12:30", "Kavita Menon", "+91 98860 33403", "Follow-up visit", "no_show", "Did not pick up when called"],
  [0, "09:30", "Rohit Shetty", "+91 98440 44504", "Consultation", "booked", "Fever since two days"],
  [0, "10:30", "Sunita Iyer", "+91 97420 55605", "Health check-up", "booked", "Fasting from last night"],
  [0, "12:00", "Imran Khan", "+91 98800 66706", "Follow-up visit", "booked", null],
  [0, "12:30", "Lakshmi Gowda", "+91 99720 77807", "Consultation", "booked", "Knee pain, bring the X-ray"],
  [0, "16:00", "Dev Patel", "+91 98456 88908", "Dental cleaning", "booked", null],
  [1, "09:00", "Ananya Bhat", "+91 96320 99009", "Consultation", "booked", null],
  [1, "10:00", "Suresh Kumar", "+91 98450 10110", "Health check-up", "booked", "Corporate check-up, invoice to employer"],
  [1, "11:30", "Farah Siddiqui", "+91 99000 21221", "Follow-up visit", "booked", null],
  [1, "15:30", "Vivek Hegde", "+91 98860 32332", "Consultation", "booked", null],
  [2, "10:30", "Nandini Reddy", "+91 97400 43443", "Dental cleaning", "booked", null],
  [2, "14:00", "Karthik Subramanian", "+91 98440 54554", "Consultation", "booked", "First visit"],
  [3, "09:30", "Pooja Joshi", "+91 98450 65665", "Health check-up", "booked", null],
  [4, "11:00", "Mohan Das", "+91 99160 76776", "Follow-up visit", "cancelled", "Travelling, will call to rebook"],
  [4, "11:00", "Rekha Pillai", "+91 98860 87887", "Consultation", "booked", null],
];

/** The sample bookings as rows, relative to `from` and never outside the default opening hours (the seed runs on a new app, before any setting is changed). */
export const sampleBookings = (serviceIds: Record<string, string>, from = new Date()) =>
  BOOKINGS.flatMap(([day, time, customer_name, phone, service, status, notes]) => {
    const start = `${inDays(day, from)}T${time}`;
    const minutes = sampleServices.find((s) => s.name === service)!.minutes;
    return withinHours(DEFAULT_SETTINGS, start, minutes) ? [{ customer_name, phone, service_id: serviceIds[service], start, minutes, status, notes }] : [];
  });

/** One second apart and all in the past, so rows keep this order instead of tying on created_at. */
const stagger = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  const made = await db.insert(services).values(stagger(sampleServices)).returning();
  const ids = Object.fromEntries(made.map((s) => [s.name, s.id]));
  await db.insert(bookings).values(stagger(sampleBookings(ids)));
}

// A plan brings its own sample services (a physio's treatments, not the clinic's) and skips the seed above, so Today would open
// empty under the sample banner. These are made from whatever sample services the app has, with generic names.
const PLAN_CUSTOMERS: [string, string][] = [
  ["Meera Nair", "+91 98450 11201"], ["Arjun Rao", "+91 99001 22302"], ["Kavita Menon", "+91 98860 33403"], ["Rohit Shetty", "+91 98440 44504"],
];

/** 2 to 4 sample bookings on today and tomorrow (the next open days when the business is closed then), inside opening hours, never overlapping. */
export function planSampleBookings(svc: { id: string; name: string; minutes: number }[], settings: BookingSettings, from = new Date()) {
  if (!svc.length) return [];
  const out: { customer_name: string; phone: string; service_id: string; start: string; minutes: number; status: string; notes: null }[] = [];
  let days = 0, n = 0;
  for (let day = 0; day < 8 && days < 2; day++) {
    const date = inDays(day, from), h = hoursFor(settings, date);
    if (!h) continue;
    days++;
    let at = toMin(h[0]) + 60;   // an hour after opening, then one every two hours or so
    for (let k = 0; k < 2; k++, n++) {
      const s = svc[n % svc.length], start = `${date}T${fromMin(at)}`;
      const clash = out.some((o) => overlaps(o.start, o.minutes, start, s.minutes));
      if (withinHours(settings, start, s.minutes) && !clash) {
        const [customer_name, phone] = PLAN_CUSTOMERS[n % PLAN_CUSTOMERS.length];
        out.push({ customer_name, phone, service_id: s.id, start, minutes: s.minutes, status: "booked", notes: null });
      }
      at += s.minutes + 90;
    }
  }
  return out;
}

/** The kit surface this needs (what mountKit returns). */
type Kit = { db: BunSQLiteDatabase<any>; sqlite: { transaction<T>(f: () => T): () => T }; status: { state: string }; importState: { state: string }; ctx: { dataDir: string }; settings: { get(k: string): unknown }; flagSamples: (t: string, rows: any[]) => any[] };

/** Once per app, after mountKit: when the only services are samples a plan brought and there are no bookings, add sample bookings
 *  (marked samples, so Clear samples removes them). The marker keeps it from returning after the owner clears or empties Today. */
export function addPlanSampleBookings(kit: Kit, from = new Date()): number {
  // Only on a writable boot: a blocked schema, a failed import or check mode writes nothing, and a helper must never stop the app starting.
  if (kit.status.state !== "ok" || kit.importState.state === "failed" || process.env.FLOCK_KIT_SCHEMA === "check") return 0;
  try { return addPlanSampleBookingsNow(kit, from); }
  catch (e) { console.warn(`[bookings] sample bookings skipped: ${(e as Error).message}`); return 0; }
}
function addPlanSampleBookingsNow(kit: Kit, from: Date): number {
  const marker = join(kit.ctx.dataDir, ".flock", "sample-bookings");
  if (existsSync(marker)) return 0;
  const done = () => { try { mkdirSync(join(kit.ctx.dataDir, ".flock"), { recursive: true }); writeFileSync(marker, "1"); } catch { /* best effort: it is idempotent by the checks below */ } };
  const svc = kit.db.select().from(services).all();
  if (!svc.length) return 0;   // not seeded yet (or cleared): leave the marker for a later boot
  done();
  if (kit.db.select().from(bookings).limit(1).all().length) return 0;
  if (!kit.flagSamples("services", svc).every((r) => r._sample)) return 0;   // the owner's own services: no invented bookings
  const settings = { hours: kit.settings.get("hours"), slot_minutes: kit.settings.get("slot_minutes") };
  const rows = planSampleBookings(svc, usable(settings), from);
  if (!rows.length) return 0;
  const stamped = rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));
  return kit.sqlite.transaction(() => {   // the rows and their sample marks land together, or not at all
    const made = kit.db.insert(bookings).values(stamped).returning().all();
    for (const b of made) kit.db.insert(_samples).values({ table_name: "bookings", row_id: b.id, updated_by: "app" }).onConflictDoNothing().run();
    return made.length;
  })();
}
