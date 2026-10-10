import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

export { STAGES } from "./constants";

export const deals = sqliteTable("deals", {
  ...kitColumns(),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("Lead"),   // Lead | Talking | Proposal | Won | Lost
  owner: text("owner"),
  value: integer("value"),                            // rupees, optional
  next_step: text("next_step"),
  due: text("due"),                                   // ISO date of the next step
});
