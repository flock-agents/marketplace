import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

/** One row per reading. A number on the page is the newest reading of its label; the trend is the readings over time. List sample readings of a label oldest first: they are spread over past weeks in the order given. */
export const metrics = sqliteTable("metrics", {
  ...kitColumns(),
  label: text("label").notNull(),
  value: real("value").notNull(),
  unit: text("unit"),                                // "₹" shows as money, "%" as a percent, anything else as a number
});

export const events = sqliteTable("events", {
  ...kitColumns(),
  title: text("title").notNull(),
  at: text("at").notNull(),                          // ISO date or date-time
  kind: text("kind").default("Note"),                // Sale | Alert | Milestone | Note
});
