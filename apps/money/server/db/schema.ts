import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";
export { CATEGORIES, KINDS, INCOME_CATEGORIES, INVESTMENTS } from "./constants";


/** Every money, transaction and holding amount is whole rupees. A negative transaction amount is money spent. */
export const transactions = sqliteTable("transactions", {
  ...kitColumns(),
  date: text("date").notNull(),                       // ISO date
  merchant: text("merchant").notNull(),
  category: text("category").notNull(),
  amount: integer("amount").notNull(),                // negative = spend
});

/** One spending limit per category per month. How much was spent is worked out from the transactions. */
export const budgets = sqliteTable("budgets", {
  ...kitColumns(),
  category: text("category").notNull(),
  month: text("month").notNull(),                     // YYYY-MM
  limit_amount: integer("limit_amount").notNull(),
});

export const holdings = sqliteTable("holdings", {
  ...kitColumns(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  value: integer("value").notNull(),                  // worth today
  invested: integer("invested").notNull(),            // put in so far
});

export const goals = sqliteTable("goals", {
  ...kitColumns(),
  goal: text("goal").notNull(),
  saved: integer("saved").notNull(),
  target: integer("target").notNull(),
  by: text("by"),                                     // ISO date
});
