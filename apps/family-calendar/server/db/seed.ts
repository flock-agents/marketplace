import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { events, members, reminders } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The Monday on or before `from`, as an ISO date. */
export const mondayOf = (from = new Date()): string => iso(new Date(from.getFullYear(), from.getMonth(), from.getDate() - ((from.getDay() + 6) % 7)));
const plusDays = (monday: string, n: number): string => { const [y, m, d] = monday.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };
/** The first of the month after `from`. */
const nextFirst = (from = new Date()): string => iso(new Date(from.getFullYear(), from.getMonth() + 1, 1));

/** A sample family: two parents and two children. Replace them with the owner's own. */
export const sampleMembers = () => [
  { name: "Anita", colour: "accent", emoji: "👩" },
  { name: "Vikram", colour: "info", emoji: "👨" },
  { name: "Aarav", colour: "success", emoji: "⚽" },
  { name: "Diya", colour: "warning", emoji: "🎹" },
];

type Line = { title: string; start_time: string | null; end_time: string | null; who: string | null; location: string | null; notes: string | null; reminder_minutes: number | null };
const line = (title: string, start_time: string | null, end_time: string | null, who: string | null, location: string | null = null, notes: string | null = null, reminder_minutes: number | null = null): Line =>
  ({ title, start_time, end_time, who, location, notes, reminder_minutes });

// Monday to Sunday: what happens every week. One row per date, so each week is its own rows.
const EVERY_WEEK: Line[][] = [
  [line("School run", "08:00", "08:30", "Vikram", "Little Flowers School")],
  [line("School run", "08:00", "08:30", "Anita", "Little Flowers School"), line("Football practice", "17:00", "18:00", "Aarav", "Sports ground", "Shin pads and the water bottle", 30)],
  [line("School run", "08:00", "08:30", "Vikram", "Little Flowers School"), line("Piano lesson", "16:00", "16:45", "Diya", "Mrs Rao's", null, 15)],
  [line("School run", "08:00", "08:30", "Anita", "Little Flowers School")],
  [line("School run", "08:00", "08:30", "Vikram", "Little Flowers School")],
  [],
  [line("Grocery run", "10:00", "11:00", "Anita", "More Megastore")],
];
// Only in the first week: the one-offs, by weekday (Monday is 0).
const ONE_OFF: [number, Line][] = [
  [3, line("Parents' evening", "18:00", "19:00", null, "Little Flowers School", "Both of us; Aarav's class teacher at 18:00, Diya's at 18:30")],
  [4, line("Dentist", "16:30", "17:00", "Diya", "Smile Dental, 5th Block", "Six-month check-up; bring the insurance card", 60)],
  [5, line("Grandma's birthday", null, null, null, "Grandma's house", "Cake from Iyengar's; Diya is making the card")],
];

/**
 * Two weeks of a family's events from the Monday of the week containing `from`, so the week view always has today and tomorrow
 * filled, even when the app is created on a Sunday. The weekly items repeat in both weeks; the one-offs are in the first only.
 */
export const sampleEvents = (from = new Date()) => {
  const monday = mondayOf(from);
  const rows: (Line & { date: string })[] = [];
  for (let i = 0; i < 14; i++) {
    const date = plusDays(monday, i);
    for (const l of EVERY_WEEK[i % 7]) rows.push({ date, ...l });
    if (i < 7) for (const [day, l] of ONE_OFF) if (day === i) rows.push({ date, ...l });
  }
  return rows;
};

/** The family's reminders: a one-off for the dentist, and a daily, a weekly and a monthly one. */
export const sampleReminders = (from = new Date()) => {
  const monday = mondayOf(from);
  return [
    { title: "Dentist tomorrow: insurance card in the bag", due: `${plusDays(monday, 3)}T19:00`, repeat: "none", who: "Anita" },
    { title: "Pack the PE kit", due: `${monday}T07:30`, repeat: "weekly", who: "Aarav" },
    { title: "Water the plants", due: `${monday}T18:00`, repeat: "daily", who: "Diya" },
    { title: "Pay the school fees", due: `${nextFirst(from)}T09:00`, repeat: "monthly", who: "Vikram" },
  ];
};

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(members).values(staggered(sampleMembers()));
  await db.insert(events).values(staggered(sampleEvents()));
  await db.insert(reminders).values(staggered(sampleReminders()));
}
