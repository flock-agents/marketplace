import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

export { STATUSES, GST_RATES, METHODS } from "./constants";

export const customers = sqliteTable("customers", {
  ...kitColumns(),
  name: text("name").notNull(),
  gstin: text("gstin"),                    // 15 characters; the first two are the state code
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
});

export const invoices = sqliteTable("invoices", {
  ...kitColumns(),
  number: text("number").notNull().unique(),                // INV-2026-0042
  customer_id: text("customer_id").notNull().references(() => customers.id),   // metadata only (foreign keys are off): import order and Clear samples
  issue_date: text("issue_date").notNull(),                 // ISO date
  due_date: text("due_date").notNull(),                     // ISO date
  status: text("status").notNull().default("draft"),        // draft | sent | paid | overdue | void; overdue and paid are worked out
  notes: text("notes"),
  bill_to: text("bill_to"),                                 // the app's copy of the customer as billed (JSON), taken when the invoice leaves draft; never write it by hand
  seller: text("seller"),                                   // the app's copy of the business settings as issued (JSON), taken when the invoice leaves draft; never write it by hand
});

export const invoice_lines = sqliteTable("invoice_lines", {
  ...kitColumns(),
  invoice_id: text("invoice_id").notNull().references(() => invoices.id),   // metadata only, like customer_id
  description: text("description").notNull(),
  qty: real("qty").notNull().default(1),
  unit_price: real("unit_price").notNull().default(0),      // rupees, before GST
  gst_rate: real("gst_rate").notNull().default(18),         // percent: 0 | 5 | 18 | 40, or a custom rate such as 3 (two decimals at most)
});

export const payments = sqliteTable("payments", {
  ...kitColumns(),
  invoice_id: text("invoice_id").notNull().references(() => invoices.id),   // metadata only, like customer_id
  date: text("date").notNull(),                             // ISO date
  amount: real("amount").notNull(),                         // rupees
  method: text("method").notNull().default("upi"),          // upi | bank | cash | card
  ref: text("ref"),                                         // UTR / cheque / transaction reference
});
