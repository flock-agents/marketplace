import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { budgets, goals, holdings, transactions } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM, `back` months before the month of `from`. */
export const monthOf = (back: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth() - back, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
/** The ISO date of `day` in the month `back` months ago; this month's days are scaled to end by today. */
const dayIn = (back: number, day: number, from: Date): string => {
  const d = new Date(from.getFullYear(), from.getMonth() - back, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // This month only runs to today: spread the days over 1..today instead of piling the later ones onto it.
  const at = back === 0 ? Math.max(1, Math.ceil((day * from.getDate()) / last)) : day;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(Math.min(at, last))}`;
};

type Entry = { day: number; merchant: string; category: string; amount: number; fixed?: boolean; thisMonthOnly?: boolean };
/** One month of a household's money. Fixed rows repeat as they are, the others scale from month to month. */
const MONTH: Entry[] = [
  { day: 1, merchant: "Salary · Kestrel Labs", category: "Salary", amount: 240000, fixed: true },
  { day: 2, merchant: "Freelance · Lattice", category: "Freelance", amount: 35000, fixed: true },
  { day: 1, merchant: "Rent · Indiranagar", category: "Rent", amount: -48000, fixed: true },
  { day: 5, merchant: "Zerodha · Nifty 50 SIP", category: "Investments", amount: -25000, fixed: true },
  { day: 4, merchant: "Tata Power", category: "Utilities", amount: -2180 },
  { day: 8, merchant: "Airtel Fibre", category: "Utilities", amount: -999 },
  { day: 11, merchant: "BWSSB water", category: "Utilities", amount: -1121 },
  { day: 6, merchant: "BigBasket", category: "Groceries", amount: -3240 },
  { day: 12, merchant: "Zepto", category: "Groceries", amount: -1860 },
  { day: 17, merchant: "Nature's Basket", category: "Groceries", amount: -2450 },
  { day: 23, merchant: "BigBasket", category: "Groceries", amount: -2250 },
  { day: 7, merchant: "Swiggy", category: "Eating out", amount: -640 },
  { day: 9, merchant: "Third Wave Coffee", category: "Eating out", amount: -480 },
  { day: 14, merchant: "Toit Brewpub", category: "Eating out", amount: -2380 },
  { day: 19, merchant: "Swiggy", category: "Eating out", amount: -1120 },
  { day: 25, merchant: "Truffles", category: "Eating out", amount: -1480 },
  { day: 3, merchant: "IndiGo · Goa flights", category: "Travel", amount: -21600, thisMonthOnly: true },
  { day: 5, merchant: "Uber", category: "Travel", amount: -412 },
  { day: 13, merchant: "Uber", category: "Travel", amount: -588 },
  { day: 21, merchant: "Uber", category: "Travel", amount: -640 },
  { day: 15, merchant: "Namma Metro card top-up", category: "Travel", amount: -1560 },
  { day: 10, merchant: "Amazon", category: "Shopping", amount: -2899 },
  { day: 16, merchant: "Myntra", category: "Shopping", amount: -3201 },
  { day: 22, merchant: "Decathlon", category: "Shopping", amount: -1800 },
];
/** How much the everyday spending of each earlier month differs from this month's. */
const SCALE = [1, 0.93, 1.08, 0.86, 1.04, 0.97];

/** Six months of sample transactions: this month and the five before it, dated relative to `from`. */
export const sampleTransactions = (from = new Date()) =>
  SCALE.flatMap((k, back) =>
    MONTH.filter((e) => back === 0 || !e.thisMonthOnly).map((e) => ({
      date: dayIn(back, e.day, from), merchant: e.merchant, category: e.category,
      amount: e.fixed || back === 0 ? e.amount : Math.round((e.amount * k) / 10) * 10,
    })));

/** This month's limits. Rent is exactly at its limit, Travel and Eating out are over. */
export const sampleBudgets = (from = new Date()) =>
  ([["Rent", 48000], ["Groceries", 14000], ["Eating out", 6000], ["Travel", 8000], ["Utilities", 6000], ["Shopping", 10000]] as const)
    .map(([category, limit_amount]) => ({ category, month: monthOf(0, from), limit_amount }));

export const sampleHoldings = [
  { name: "Parag Parikh Flexi Cap", kind: "Equity funds", value: 1240000, invested: 960000 },
  { name: "UTI Nifty 50", kind: "Index funds", value: 980000, invested: 810000 },
  { name: "HDFC Bank, Infosys, TCS", kind: "Stocks", value: 610000, invested: 540000 },
  { name: "SBI FD · 7.1%", kind: "Fixed deposits", value: 800000, invested: 800000 },
  { name: "Sovereign gold bond", kind: "Gold", value: 290000, invested: 210000 },
  { name: "PPF · Maya", kind: "PPF", value: 340000, invested: 300000 },
];

/** Goal dates are set relative to today so none of the sample goals starts out already past. */
export const sampleGoals = (from = new Date()) => {
  const at = (months: number) => { const d = new Date(from.getFullYear(), from.getMonth() + months, 28); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-28`; };
  return [
    { goal: "Emergency fund · 6 months", saved: 540000, target: 600000, by: at(3) },
    { goal: "Goa trip", saved: 98000, target: 120000, by: at(1) },
    { goal: "New laptop", saved: 95000, target: 90000, by: at(0) },
    { goal: "Home down payment", saved: 1850000, target: 4000000, by: at(20) },
  ];
};

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(transactions).values(staggered(sampleTransactions()));
  await db.insert(budgets).values(staggered(sampleBudgets()));
  await db.insert(holdings).values(staggered(sampleHoldings));
  await db.insert(goals).values(staggered(sampleGoals()));
}
