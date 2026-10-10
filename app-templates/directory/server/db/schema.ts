import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { KINDS } from "./constants";
export { KINDS };

export const entries = sqliteTable("entries", {
  ...kitColumns(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("Other"),              // free text; suggested: Plumber, Electrician, Restaurant, Cafe, Tiffin service, Cleaning, Appliance repair, Nursery, Other
  image: text("image"),                                        // http(s) url or /root-relative path; empty shows the kind's object
  phone: text("phone"),
  url: text("url"),
  notes: text("notes"),
});
