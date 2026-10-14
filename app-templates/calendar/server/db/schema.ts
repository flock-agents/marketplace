import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

/** One event. All day: `start` (and `end`) are ISO dates YYYY-MM-DD. Timed: local date-times YYYY-MM-DDTHH:MM (24h, no zone). */
export const events = sqliteTable("events", {
  ...kitColumns(),
  title: text("title").notNull(),
  start: text("start").notNull(),                                              // YYYY-MM-DD (all day) or YYYY-MM-DDTHH:MM
  end: text("end"),                                                            // optional, same forms, never before start; a date alone is a multi-day event's last day
  all_day: integer("all_day", { mode: "boolean" }).notNull().default(false),   // true when start is a date
  notes: text("notes"),
});
