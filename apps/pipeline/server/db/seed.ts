import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { deals } from "./schema";

/** An ISO date `days` from today, so the sample rows never look stale. */
export const inDays = (days: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample rows: a small Bengaluru design studio's client deals. Replace them with the owner's real ones. */
export const sampleDeals = (from = new Date()) => [
  { title: "Koramangala cafe rebrand", stage: "Lead", owner: "Priya", value: 180000, next_step: "Intro call with the founder", due: inDays(2, from) },
  { title: "Indiranagar dental clinic website", stage: "Lead", owner: "Ravi", value: 95000, next_step: "Send the portfolio deck", due: inDays(1, from) },
  { title: "HSR Layout co-working signage", stage: "Talking", owner: "Maya", value: 240000, next_step: "Site visit to measure the lobby", due: inDays(4, from) },
  { title: "Whitefield apartment society app", stage: "Talking", owner: "Priya", value: 650000, next_step: "Share the scope questions", due: inDays(-2, from) },
  { title: "Jayanagar bakery packaging", stage: "Proposal", owner: "Maya", value: 125000, next_step: "Chase for a decision on the quote", due: inDays(3, from) },
  { title: "Malleswaram textile store catalogue", stage: "Proposal", owner: "Ravi", value: 310000, next_step: "Revise the quote after the call", due: inDays(5, from) },
  { title: "JP Nagar yoga studio brand kit", stage: "Won", owner: "Priya", value: 140000, next_step: "Collect the 50% advance", due: inDays(1, from) },
  { title: "Electronic City startup pitch deck", stage: "Won", owner: "Maya", value: 85000, next_step: "Kick-off on Monday", due: inDays(6, from) },
  { title: "Bellandur restaurant menu design", stage: "Lost", owner: "Ravi", value: 60000, next_step: "Went with a cheaper studio", due: null },
];

/** One second apart and all in the past, so the cards keep this order instead of tying on created_at. */
export const staggered = (from = new Date()) => {
  const rows = sampleDeals(from);
  return rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));
};

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(deals).values(staggered());
}
