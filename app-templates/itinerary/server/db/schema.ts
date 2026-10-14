import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

export { KINDS, PEOPLE, STATUSES } from "./constants";

/** One thing on the trip. `day` is an ISO date (YYYY-MM-DD) and `time` is 24h HH:MM. */
export const plan = sqliteTable("plan", {
  ...kitColumns(),
  day: text("day").notNull(),
  time: text("time"),
  kind: text("kind").notNull(),                       // flight | stay | food | do
  title: text("title").notNull(),
  detail: text("detail"),
});

/** Whole rupees. `when` is an ISO date. `plan_id` links a booking to the plan item it is for. */
export const bookings = sqliteTable("bookings", {
  ...kitColumns(),
  what: text("what").notNull(),
  ref: text("ref"),
  when: text("when"),
  status: text("status").notNull().default("Pending"),
  cost: integer("cost").default(0),
  plan_id: text("plan_id").references(() => plan.id),   // the plan item it books, if any; metadata only (foreign keys are off): import $refs and Clear samples
});

export const packing = sqliteTable("packing", {
  ...kitColumns(),
  item: text("item").notNull(),
  who: text("who").notNull().default("Shared"),
  packed: integer("packed", { mode: "boolean" }).default(false),
});

/** What has been spent against a limit, per category, in whole rupees. */
export const trip_budget = sqliteTable("trip_budget", {
  ...kitColumns(),
  category: text("category").notNull(),
  spent: integer("spent").default(0),
  limit_amount: integer("limit_amount").notNull(),
});
