import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { tasks } from "./schema";

/** An ISO date `days` from today, so the sample rows never look stale. */
export const inDays = (days: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample list: moving flats within Bengaluru. Replace it with the owner's own list. The page shows groups in the order they first appear, so created_at is staggered to keep the rows in this order. */
export const sampleTasks = (from = new Date()) => SAMPLE(from).map((t, i) => {
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();   // one second apart: rows tie on created_at otherwise, and ties come back in random order
  return { ...t, created_at: at, updated_at: at };
});

const SAMPLE = (from: Date) => [
  { group_name: "Two weeks before", label: "Give notice to the landlord in HSR Layout", who: "Priya", due: inDays(-4, from), done: true },
  { group_name: "Two weeks before", label: "Book Agarwal Packers and Movers for the 18th", who: "Ravi", due: inDays(-2, from), done: true },
  { group_name: "Two weeks before", label: "Transfer the BESCOM and Airtel connections to Indiranagar", who: "Priya", due: inDays(3, from), done: false },
  { group_name: "Two weeks before", label: "Get the society NOC for the movers' truck", who: "Ravi", due: inDays(5, from), done: false },
  { group_name: "Pack", label: "Sort the kitchen: pressure cookers, tiffin boxes, the big kadai", who: "Maya", due: inDays(6, from), done: false },
  { group_name: "Pack", label: "Wrap the TV and the framed pictures in bubble wrap", who: "Ravi", due: inDays(7, from), done: false },
  { group_name: "Pack", label: "Donate old clothes and books to the Goonj collection", who: "Maya", due: inDays(5, from), done: true },
  { group_name: "Move day", label: "Collect the keys from Mr. Hegde at 9 am", who: "Priya", due: inDays(9, from), done: false },
  { group_name: "Move day", label: "Take meter photos at both flats", who: "Ravi", due: inDays(9, from), done: false },
  { group_name: "After the move", label: "Update the address on Aadhaar, the bank and the Swiggy account", who: "Priya", due: inDays(14, from), done: false },
  { group_name: "After the move", label: "Return the security deposit cheque from the old landlord", who: "Maya", due: inDays(30, from), done: false },
];

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(tasks).values(sampleTasks());
}
