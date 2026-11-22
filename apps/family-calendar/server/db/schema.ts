import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { REPEATS, COLOURS, KINDS, STATUSES, TODO_STATUSES } from "./constants";

export { REPEATS, COLOURS, KINDS, STATUSES, TODO_STATUSES };

/** The people in the family. An event names one by `name` in its `who`. */
export const members = sqliteTable("members", {
  ...kitColumns(),
  name: text("name").notNull(),
  colour: text("colour").notNull().default("accent"),         // accent | info | success | warning | danger (a theme tone)
  emoji: text("emoji"),                                       // one emoji shown before the name
});

/** One row per event. One that happens every week (football every Tuesday) is one row with repeat weekly. */
export const events = sqliteTable("events", {
  ...kitColumns(),
  title: text("title").notNull(),
  date: text("date").notNull(),                               // ISO date; for a repeating event, the first day it happens
  repeat: text("repeat").notNull().default("none"),           // none | daily | weekly | monthly | yearly
  start_time: text("start_time"),                             // "16:30", 24-hour; empty for an all-day event
  end_time: text("end_time"),                                 // "17:30", 24-hour
  who: text("who"),                                           // a member's name, or empty for everyone
  location: text("location"),
  notes: text("notes"),
  reminder_minutes: integer("reminder_minutes"),              // how long before the start to remind, if at all
  kind: text("kind").notNull().default("event"),              // event | deadline (a day something is due by)
  status: text("status").notNull().default("active"),         // active | cancelled (a cancelled event stays, struck through)
  added_by: text("added_by"),                                 // the member who added it; empty for an import (it shows its sources)
  planned_at: integer("planned_at"),                          // ms: when its prep was last planned (imported events only)
  plan_basis: text("plan_basis"),                             // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM": the date and time it was planned for
  imported: integer("imported").notNull().default(0),         // 1: first made by import_events (only these are planned)
});

/** Where an imported event was seen: one row per source and item. Two people's copies of one mail are one event, two rows. */
export const event_sources = sqliteTable("event_sources", {
  ...kitColumns(),
  event_id: text("event_id").notNull().references(() => events.id),
  source: text("source").notNull(),                           // "email:<personId>", a portal, a group
  ref: text("ref").notNull(),                                 // the source's own stable ref for the item
  label: text("label"),                                       // shown: "Shiva's email", "MyClassBoard"
  match: text("match"),                                       // JSON array of identifiers naming the real-world thing
  first_seen_at: integer("first_seen_at").notNull(),          // ms
  last_seen_at: integer("last_seen_at").notNull(),            // ms
});

/** An event's to-dos, as the app published them to Flock (tasks.publish, sourceRef `event:<event id>:<key>`). */
export const todos = sqliteTable("todos", {
  ...kitColumns(),
  event_id: text("event_id").notNull().references(() => events.id),
  key: text("key").notNull(),                                 // a slug of the title, or the plan step's key
  title: text("title").notNull(),
  due: text("due").notNull(),                                 // ISO date, on or before its event's
  show_from: text("show_from").notNull(),                     // ISO date it shows from, on or before due
  why: text("why"),                                           // the plan's reason, or the source's words
  // open | done | withdrawn (a line of its own: a trailing note would be read as the events' status note by the catalog)
  status: text("status").notNull().default("open"),
  closed_at: integer("closed_at"),                            // ms
  synced: integer("synced").notNull().default(0),             // 1 once Flock has this version (published, or withdrawn)
});
