import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { bookings, packing, plan, trip_budget } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The first Friday that is at least 14 days from `from`, so the sample trip is always upcoming and its days read Fri to Mon. */
export const tripStart = (from = new Date()): Date => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 14);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d;
};
const dayOf = (start: Date, offset: number) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset));

export const samplePlan = (start = tripStart()) =>
  ([
    [0, "06:40", "flight", "IndiGo 6E 531 to Goa", "BLR to GOX, lands 7:55"],
    [0, "11:00", "stay", "Check in at Villa Azul", "Anjuna. Early check-in confirmed"],
    [0, "15:30", "do", "Anjuna beach walk", "Stay on the Curlies side, shacks open from 3"],
    [0, "19:30", "food", "Dinner at Thalassa", "Booked for 4, sunset table"],
    [1, "08:00", "do", "Beach morning at Vagator", "Bring the snorkel set"],
    [1, "13:00", "food", "Lunch at Britto's, Baga", "Fish thali, no booking needed"],
    [1, "17:00", "do", "Saturday night market", "Arpora, cash only"],
    [1, "20:30", "food", "Dinner at Gunpowder, Assagao", "Booked for 4, garden table"],
    [2, "10:00", "do", "Old Goa churches", "If it rains: spice farm"],
    [2, "13:30", "food", "Lunch at Viva Panjim", "Goan thali"],
    [2, "17:30", "do", "Sunset at Chapora Fort", "Short climb, bring water"],
    [3, "09:00", "do", "Kayaking at Chapora", "2 hours, guide included"],
    [3, "12:00", "stay", "Check out of Villa Azul", "Leave bags with the caretaker"],
    [3, "19:00", "flight", "IndiGo 6E 534 home", "GOX to BLR"],
  ] as const).map(([offset, time, kind, title, detail]) => ({ day: dayOf(start, offset), time, kind, title, detail }));

export const sampleBookings = (start = tripStart()) =>
  ([
    ["Flights, BLR to GOX and back", "6E-K7Q2PL", 0, "Confirmed", 21600],
    ["Villa Azul, 3 nights", "AZL-55821", 0, "Confirmed", 58000],
    ["Thalassa dinner", "TH-1930", 0, "Confirmed", 0],
    ["Gunpowder dinner", "GP-2030", 1, "Confirmed", 0],
    ["Kayaking at Chapora", "", 3, "Pending", 6400],
    ["Airport cab", "", 0, "Pending", 1800],
  ] as const).map(([what, ref, offset, status, cost]) => ({ what, ref: ref || null, when: dayOf(start, offset), status, cost }));

export const samplePacking = [
  ["Sunscreen", "Shared", true], ["Snorkel set", "Shared", false], ["Rain jackets x4", "Shared", false], ["Chargers", "Shared", true],
  ["Swimwear", "Maya", true], ["Hat", "Maya", false], ["Kindle", "Priya", false], ["Swimwear", "Priya", false],
  ["Swimwear", "Ananya", false], ["Colouring book", "Ananya", true], ["Water bottle", "Ananya", false],
] as const;

export const sampleBudget = [
  ["Flights", 21600, 24000], ["Stay", 58000, 60000], ["Food", 4200, 16000], ["Activities", 6400, 12000], ["Getting around", 1800, 8000],
] as const;

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

/** For each sample booking, the index in samplePlan of the plan item it books (null for none). */
const BOOKING_PLAN = [0, 1, 3, 7, 11, null] as const;

export async function seed(db: BunSQLiteDatabase<any>) {
  const planIds = (await db.insert(plan).values(staggered(samplePlan())).returning({ id: plan.id })).map((r) => r.id);
  await db.insert(bookings).values(staggered(sampleBookings().map((b, i) => ({ ...b, plan_id: BOOKING_PLAN[i] === null ? null : planIds[BOOKING_PLAN[i]!] }))));
  await db.insert(packing).values(staggered(samplePacking.map(([item, who, packed]) => ({ item, who, packed }))));
  await db.insert(trip_budget).values(staggered(sampleBudget.map(([category, spent, limit_amount]) => ({ category, spent, limit_amount }))));
}
