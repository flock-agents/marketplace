import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { events } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The ISO date `days` from `from`, so the sample events always sit around today. */
export const inDays = (days: number, from = new Date()): string => iso(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days));

/** Sample events around today: a few timed, a few all-day, one over several days. The kit marks seeded rows as samples
 *  (the pages show a Sample chip) and Clear samples removes them; replace them with the owner's own events. */
export const sampleEvents = (from = new Date()) =>
  ([
    [-6, "18:30", null, null, "Parent-teacher meeting", "Class 4 B, bring the report card"],
    [-2, null, null, null, "Car service", "Drop it off before 10, pick up after 5"],
    [0, "09:30", "10:00", null, "Dentist check-up", "Clinic on the 2nd floor"],
    [0, "19:00", "21:00", null, "Dinner with friends", null],
    [2, "07:00", "08:00", null, "Morning run", null],
    [3, null, null, null, "School sports day", "Wear the house T-shirt"],
    [5, "11:00", "12:30", null, "Plumber visit", "Kitchen tap and the bathroom geyser"],
    [8, null, null, 10, "Weekend away", "Three days, leave after breakfast"],
    [12, "16:00", "17:00", null, "Piano lesson", null],
    [15, null, null, null, "Electricity bill due", null],
  ] as const).map(([offset, start, end, endDay, title, notes]) => {
    const day = inDays(offset, from);
    return start
      ? { title, all_day: false, start: `${day}T${start}`, end: end ? `${day}T${end}` : null, notes }
      : { title, all_day: true, start: day, end: endDay !== null ? inDays(endDay, from) : null, notes };
  });

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(events).values(staggered(sampleEvents()));
}
