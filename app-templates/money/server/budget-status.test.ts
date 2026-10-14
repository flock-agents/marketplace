import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { budgets, transactions } from "./db/schema";
import { mountMoneyRoutes, budgetStatus } from "./money-routes";
import { sampleBudgets, sampleTransactions } from "./db/seed";

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "money-routes-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T" });
  mountMoneyRoutes(hono, kit.db);
  return { hono, db: kit.db };
}
const get = async (hono: Hono, path: string) => { const r = await hono.request(path); return { status: r.status, body: (await r.json()) as any }; };

describe("GET /api/budget-status", () => {
  it("sums this month's spending per category against the limit, ignoring income and other months", async () => {
    const { hono, db } = await boot();
    await db.insert(budgets).values([{ category: "Travel", month: "2026-10", limit_amount: 8000 }, { category: "Groceries", month: "2026-10", limit_amount: 14000 }, { category: "Utilities", month: "2026-10", limit_amount: 6000 }]);
    await db.insert(transactions).values([
      { date: "2026-10-03", merchant: "IndiGo", category: "Travel", amount: -21600 },
      { date: "2026-10-05", merchant: "Uber", category: "Travel", amount: -412 },
      { date: "2026-10-31", merchant: "BigBasket", category: "Groceries", amount: -3240 },
      { date: "2026-10-04", merchant: "Refund", category: "Travel", amount: 500 },      // a refund nets against its category
      { date: "2026-09-30", merchant: "Uber", category: "Travel", amount: -9999 },       // last month
      { date: "2026-11-01", merchant: "Uber", category: "Travel", amount: -9999 },       // next month
      { date: "2026-10-02", merchant: "Salary", category: "Salary", amount: 240000 },
    ]);
    const { status, body } = await get(hono, "/api/budget-status?month=2026-10");
    expect(status).toBe(200);
    const by = Object.fromEntries(body.map((r: any) => [r.category, r]));
    expect(by.Travel).toEqual({ category: "Travel", spent: 21512, limit: 8000 });
    expect(by.Groceries).toEqual({ category: "Groceries", spent: 3240, limit: 14000 });
    expect(by.Utilities).toEqual({ category: "Utilities", spent: 0, limit: 6000 });
    expect(body).toHaveLength(3);                                                        // Salary has no limit, so it is not listed
  });

  it("uses the latest earlier month's limits when the month has none, and rejects a bad month", async () => {
    const { hono, db } = await boot();
    await db.insert(budgets).values({ category: "Rent", month: "2026-08", limit_amount: 48000 });
    await db.insert(transactions).values({ date: "2026-10-01", merchant: "Rent", category: "Rent", amount: -48000 });
    expect((await get(hono, "/api/budget-status?month=2026-10")).body).toEqual([{ category: "Rent", spent: 48000, limit: 48000 }]);
    expect((await get(hono, "/api/budget-status?month=October")).status).toBe(400);
  });

  it("never reports a negative spend, and lists each category once", async () => {
    const { hono, db } = await boot();
    // Two limits for one category: the most recently changed one wins, whatever order they were added in.
    await db.insert(budgets).values([{ category: "Shopping", month: "2026-10", limit_amount: 7000, updated_at: "2026-10-05T10:00:00.000Z" }, { category: "Shopping", month: "2026-10", limit_amount: 5000, updated_at: "2026-10-07T10:00:00.000Z" }]);
    await db.insert(transactions).values({ date: "2026-10-04", merchant: "Myntra refund", category: "Shopping", amount: 1200 });
    expect((await get(hono, "/api/budget-status?month=2026-10")).body).toEqual([{ category: "Shopping", spent: 0, limit: 5000 }]);
  });

  it("matches the seed: Travel and Eating out over, Rent exactly at its limit", async () => {
    const { db } = await boot();
    const now = new Date(2026, 9, 28);
    await db.insert(transactions).values(sampleTransactions(now));
    await db.insert(budgets).values(sampleBudgets(now));
    const by = Object.fromEntries(budgetStatus(db, "2026-10").map((r) => [r.category, r]));
    expect(by.Travel).toMatchObject({ spent: 24800, limit: 8000 });
    expect(by["Eating out"]).toMatchObject({ spent: 6100, limit: 6000 });
    expect(by.Rent).toMatchObject({ spent: 48000, limit: 48000 });
    expect(by.Groceries.spent).toBe(9800);
  });

  it("spreads this month's rows over the days so far, even on the 1st and the 2nd", () => {
    for (const day of [1, 2, 8]) {
      const dates = new Set(sampleTransactions(new Date(2026, 9, day)).filter((r) => r.date.startsWith("2026-10")).map((r) => r.date));
      expect([...dates].every((d) => d <= `2026-10-${String(day).padStart(2, "0")}`)).toBe(true);
    }
    expect(new Set(sampleTransactions(new Date(2026, 9, 28)).filter((r) => r.date.startsWith("2026-10")).map((r) => r.date)).size).toBeGreaterThan(10);
  });
});

describe("GET /api/monthly-totals", () => {
  it("gives six months ending at the month, with investments kept out of spending", async () => {
    const { hono, db } = await boot();
    await db.insert(transactions).values(sampleTransactions(new Date(2026, 9, 28)));
    const { body } = await get(hono, "/api/monthly-totals?month=2026-10");
    expect(body.map((m: any) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(body[5]).toEqual({ month: "2026-10", income: 275000, expenses: 100900, invested: 25000 });
    await db.insert(transactions).values([{ date: "2026-10-09", merchant: "Myntra refund", category: "Shopping", amount: 1000 }, { date: "2026-10-09", merchant: "SIP redemption", category: "Investments", amount: 5000 }]);
    const after = (await get(hono, "/api/monthly-totals?month=2026-10")).body[5];
    expect(after).toEqual({ month: "2026-10", income: 275000, expenses: 99900, invested: 20000 });
    await db.insert(transactions).values([
      { date: "2026-10-10", merchant: "Lattice invoice", category: "Freelance", amount: 12000 },       // every income category counts as income
      { date: "2026-10-10", merchant: "HDFC FD interest", category: "Interest & dividends", amount: 3000 },
      { date: "2026-10-10", merchant: "Big refund", category: "Utilities", amount: 9000 },             // a refund bigger than the category's spend floors at 0, like budget-status
    ]);
    const more = (await get(hono, "/api/monthly-totals?month=2026-10")).body[5];
    expect(more).toEqual({ month: "2026-10", income: 290000, expenses: 95600, invested: 20000 });   // refund and redemption net out; neither is income
  });
});
