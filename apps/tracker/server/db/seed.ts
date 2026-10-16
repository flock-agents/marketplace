import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { items } from "./schema";

/** An ISO date `days` from today, so the sample rows never look stale. */
export const inDays = (days: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample rows: a home renovation, one row per vendor. Replace them with the owner's real ones. */
export const sampleItems = (from = new Date()) => [
  { title: "Sharma Electricals — rewiring quote", status: "Waiting", owner: "Maya", due: inDays(4, from), priority: "High", notes: "Visited Saturday. Wants to replace the old aluminium wiring in the two bedrooms. Quote promised by email." },
  { title: "Kapoor Interiors — modular kitchen", status: "In progress", owner: "Priya", due: inDays(9, from), priority: "High", notes: "Second round of drawings is in. Asked them to move the chimney 30 cm left and quote the quartz counter separately." },
  { title: "Joshi Plumbing — bathroom fittings", status: "New", owner: "Ravi", due: inDays(7, from), priority: "Normal", notes: "Needs a site visit to measure the shower wall before he can quote." },
  { title: "Asian Paints Colour Studio — shade matching", status: "In progress", owner: "Priya", due: inDays(2, from), priority: "Normal", notes: "Living room shortlisted to Warm Linen or Sage Mist. Test patches go up on Friday." },
  { title: "Gupta Carpentry — wardrobe in the master bedroom", status: "Waiting", owner: "Maya", due: inDays(-3, from), priority: "Normal", notes: "Sent the dimensions three days ago and have not heard back. Nudge before the end of the week." },
  { title: "Reddy Waterproofing — terrace", status: "Done", owner: "Ravi", due: inDays(-6, from), priority: "Low", notes: "Finished and paid. Ten year guarantee card is in the blue folder." },
];

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = (from = new Date()) => {
  const rows = sampleItems(from);
  return rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));
};

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(items).values(staggered());
}
