import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

export { STATUSES, SLOT_MINUTES, HOURS } from "./constants";

export const services = sqliteTable("services", {
  ...kitColumns(),
  name: text("name").notNull(),
  minutes: integer("minutes").notNull().default(30),   // how long it takes; a booking holds this long
  price: integer("price"),                              // rupees, optional
});

/** Private: only server/bookings-routes.ts writes it, so a booking can never overlap another. Agents use /api/bookings. */
export const bookings = sqliteTable("bookings", {
  ...kitColumns(),
  customer_name: text("customer_name").notNull(),
  phone: text("phone"),
  service_id: text("service_id").notNull().references(() => services.id),   // metadata only: lets Clear samples keep a service a real booking uses
  start: text("start").notNull(),                       // local date-time "2026-10-09T10:30", IST, never UTC
  minutes: integer("minutes").notNull(),                // copied from the service when booked, so editing a service does not move old bookings
  status: text("status").notNull().default("booked"),   // booked | done | no_show | cancelled
  notes: text("notes"),
});
