import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { REPEATS, COLOURS } from "./constants";

export { REPEATS, COLOURS };

/** The people in the family. An event or reminder names one by `name` in its `who`. */
export const members = sqliteTable("members", {
  ...kitColumns(),
  name: text("name").notNull(),
  colour: text("colour").notNull().default("accent"),         // accent | info | success | warning | danger (a theme tone)
  emoji: text("emoji"),                                       // one emoji shown before the name
});

/** One row per event. A recurring event (football every Tuesday) is one row per date. */
export const events = sqliteTable("events", {
  ...kitColumns(),
  title: text("title").notNull(),
  date: text("date").notNull(),                               // ISO date
  start_time: text("start_time"),                             // "16:30", 24-hour; empty for an all-day event
  end_time: text("end_time"),                                 // "17:30", 24-hour
  who: text("who"),                                           // a member's name, or empty for everyone
  location: text("location"),
  notes: text("notes"),
  reminder_minutes: integer("reminder_minutes"),              // how long before the start to remind, if at all
});

export const reminders = sqliteTable("reminders", {
  ...kitColumns(),
  title: text("title").notNull(),
  due: text("due").notNull(),                                 // local date-time "2026-10-17T08:00": the first (or only) time it is due
  repeat: text("repeat").notNull().default("none"),           // none | daily | weekly | monthly
  who: text("who"),                                           // a member's name, or empty for everyone
});
