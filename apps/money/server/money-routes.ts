import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { budgets, transactions } from "./db/schema";
import { INCOME_CATEGORIES, INVESTMENTS } from "./db/constants";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
export const monthsBack = (end: string, n: number): string[] => {
  const [y, mo] = end.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(y, mo - 1 - (n - 1 - i), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
};
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/** What was spent in a month against each category's limit. A month without limits uses the latest earlier month's. */
export function budgetStatus(db: BunSQLiteDatabase<any>, month: string): { category: string; spent: number; limit: number }[] {
  return budgetStatusRows(db, month).map(({ id: _id, ...r }) => r);
}

/** budgetStatus with each bar's budgets row id, so the route can mark sample rows. */
export function budgetStatusRows(db: BunSQLiteDatabase<any>, month: string): { id: string; category: string; spent: number; limit: number }[] {
  let limits = db.select().from(budgets).where(eq(budgets.month, month)).orderBy(desc(budgets.updated_at), desc(budgets.id)).all();
  if (!limits.length) {
    const latest = db.select({ m: sql<string>`max(${budgets.month})` }).from(budgets).where(lte(budgets.month, month)).get()?.m;
    if (latest) limits = db.select().from(budgets).where(eq(budgets.month, latest)).orderBy(desc(budgets.updated_at), desc(budgets.id)).all();
  }
  const spent = new Map(db.select({ category: transactions.category, spent: sql<number>`-sum(${transactions.amount})` }).from(transactions)
    .where(and(gte(transactions.date, `${month}-01`), lt(transactions.date, `${nextMonth(month)}-01`)))
    .groupBy(transactions.category).all().map((r) => [r.category, Number(r.spent)] as const));
  // A refund (money in under a spending category) nets against that category, so it cannot push "spent" below zero.
  const seen = new Set<string>();
  limits = limits.filter((b) => !seen.has(b.category) && !!seen.add(b.category));   // one bar per category: the most recently changed limit wins
  return limits.map((b) => ({ id: b.id, category: b.category, spent: Math.max(0, spent.get(b.category) ?? 0), limit: b.limit_amount }));
}

/** Income, spending and money invested for each of the `n` months ending at `end`.
 *  Income is money in under INCOME_CATEGORIES. Spending is judged per category like budget-status (a refund nets against its category, never below zero). Investments are not spending. */
export function monthlyTotals(db: BunSQLiteDatabase<any>, end: string, n = 6): { month: string; income: number; expenses: number; invested: number }[] {
  const months = monthsBack(end, n);
  const rows = db.select({
    month: sql<string>`substr(${transactions.date}, 1, 7)`, category: transactions.category,
    net: sql<number>`sum(${transactions.amount})`,
    positive: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
  }).from(transactions)
    .where(and(gte(transactions.date, `${months[0]}-01`), lt(transactions.date, `${nextMonth(end)}-01`)))
    .groupBy(sql`substr(${transactions.date}, 1, 7)`, transactions.category).all();
  const income = new Set<string>(INCOME_CATEGORIES);
  return months.map((month) => {
    let inc = 0, expenses = 0, invested = 0;
    for (const r of rows) {
      if (r.month !== month) continue;
      if (income.has(r.category)) inc += Number(r.positive);
      else if (r.category === INVESTMENTS) invested += Math.max(0, -Number(r.net));
      else expenses += Math.max(0, -Number(r.net));
    }
    return { month, income: inc, expenses, invested };
  });
}

/** The app's own routes. The viewer sends its own `month` so "this month" is the viewer's, not the server's. */
export function mountMoneyRoutes(hono: Hono, db: BunSQLiteDatabase<any>,
  /** The kit's `flagSamples`: a bar whose budget row is a sample says so (`_sample`), as /api/_data rows do. */
  flagSamples?: <R extends Record<string, unknown>>(table: string, rows: R[]) => (R & { _sample?: true })[]) {
  const monthParam = (raw: string | undefined) => (raw === undefined ? thisMonth() : MONTH_RE.test(raw) ? raw : null);
  hono.get("/api/budget-status", (c) => {
    const month = monthParam(c.req.query("month"));
    if (!month) return c.json({ error: "invalid_month", message: "month must look like 2026-10" }, 400);
    const rows = budgetStatusRows(db, month);
    const flagged = flagSamples ? flagSamples("budgets", rows) : rows;
    return c.json(flagged.map(({ id: _id, ...r }) => r));
  });
  hono.get("/api/monthly-totals", (c) => {
    const month = monthParam(c.req.query("month"));
    if (!month) return c.json({ error: "invalid_month", message: "month must look like 2026-10" }, 400);
    return c.json(monthlyTotals(db, month));
  });
}
