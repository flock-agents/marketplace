import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { STATUSES, PRIORITIES } from "./constants";

export { STATUSES, PRIORITIES };

export const items = sqliteTable("items", {
  ...kitColumns(),
  title: text("title").notNull(),
  status: text("status").notNull().default("New"),          // New | In progress | Waiting | Done
  owner: text("owner"),
  due: text("due"),                                           // ISO date
  priority: text("priority").default("Normal"),               // Low | Normal | High
  notes: text("notes"),
});
