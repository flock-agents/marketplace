import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

export const tasks = sqliteTable("tasks", {
  ...kitColumns(),
  label: text("label").notNull(),
  group_name: text("group_name"),                                 // the heading the item sits under
  done: integer("done", { mode: "boolean" }).default(false),
  who: text("who"),                                               // a person's name
  due: text("due"),                                               // ISO date
});
