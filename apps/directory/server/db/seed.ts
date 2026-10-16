import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { entries } from "./schema";

/** Sample entries: a Bengaluru neighbourhood's go-to people and places. Replace them with the owner's own. */
export const sampleEntries = () => [
  { name: "Ramesh Plumbing Works", kind: "Plumber", phone: "+91 98450 11223", notes: "Fixed the geyser leak the same evening. Charges 400 rupees for a visit, adjusted against the work." },
  { name: "Suresh Electricals", kind: "Electrician", phone: "+91 98860 44512", notes: "Does MCB and inverter work. Calls back within the hour, closed on Sundays." },
  { name: "MTR Breakfast Rooms", kind: "Restaurant", phone: "+91 80 2222 0022", url: "https://mtrfoods.example", notes: "Rava idli and the filter coffee. Go before 9 on weekends or expect a queue." },
  { name: "Third Wave Coffee, 12th Main", kind: "Cafe", phone: "+91 80 4567 8901", notes: "Quiet until noon and good for a call. Power points along the left wall." },
  { name: "Amma's Tiffin", kind: "Tiffin service", phone: "+91 99001 23456", notes: "Lunch box delivered at 12:30. 3,200 rupees a month, pay on the first." },
  { name: "Lakshmi Home Cleaners", kind: "Cleaning", phone: "+91 97420 33781", notes: "Two people, three hours for a 2BHK. Bring your own phenyl, they bring the mops." },
  { name: "Khan Appliance Repair", kind: "Appliance repair", phone: "+91 98440 90017", notes: "Fixed the front-load washer drain pump in one visit. Keeps spares for LG and Bosch." },
  { name: "Lalbagh Nursery Stall", kind: "Nursery", notes: "Saturday morning stall near the west gate. Money plants for 80 rupees, terracotta pots from 60." },
];

/** One second apart, so the rows keep this order instead of tying on created_at. */
export const staggered = (from = new Date()) => sampleEntries().map((e, i) => ({ ...e, created_at: new Date(from.getTime() + i * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(entries).values(staggered());
}
