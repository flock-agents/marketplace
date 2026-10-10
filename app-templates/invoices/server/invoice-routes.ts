import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { customers, invoices, invoice_lines, payments } from "./db/schema";
import { STATUSES, invoiceSettings, type InvoiceSettings } from "./db/constants";
import { billedParty, issuingSeller, watchIssued, type CurrentSettings } from "./bill-to";
import { computeTotals, effectiveStatus, nextNumber, round2, daysOverdue, type Status, type TotalsRow } from "./db/invoice-math";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export interface InvoiceSummaryRow {
  id: string; number: string; customer_id: string; customer_name: string; issue_date: string; due_date: string;
  stored_status: string; status: Status; total: number; paid: number; balance: number; days_overdue: number;
}

/** Every invoice with its total, what has been paid and what it is today. Newest first. */
export function enrichInvoices(db: BunSQLiteDatabase<any>, s: InvoiceSettings, today: string): InvoiceSummaryRow[] {
  const cust = new Map(db.select().from(customers).all().map((c) => [c.id, c]));
  const lines = new Map<string, { qty: number; unit_price: number; gst_rate: number }[]>();
  for (const l of db.select().from(invoice_lines).all()) lines.set(l.invoice_id, [...(lines.get(l.invoice_id) ?? []), l]);
  const paid = new Map<string, number>();
  for (const p of db.select().from(payments).all()) paid.set(p.invoice_id, round2((paid.get(p.invoice_id) ?? 0) + p.amount));
  return db.select().from(invoices).all().map((inv) => {
    const party = billedParty(s, inv, cust.get(inv.customer_id));
    const total = computeTotals(lines.get(inv.id) ?? [], party.inter, !!issuingSeller(s, inv).gstin).total;
    const p = paid.get(inv.id) ?? 0;
    const status = effectiveStatus(inv.status, total, p, inv.due_date, today);
    return {
      id: inv.id, number: inv.number, customer_id: inv.customer_id, customer_name: party.customer?.name ?? "Unknown customer",
      issue_date: inv.issue_date, due_date: inv.due_date, stored_status: inv.status, status, total, paid: p,
      balance: status === "void" ? 0 : round2(Math.max(0, total - p)), days_overdue: status === "overdue" ? daysOverdue(inv.due_date, today) : 0,
    };
  }).sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : a.number < b.number ? 1 : -1));
}

/** The numbers above the list: owed in total, owed late, and money received in the viewer's month. */
export function summarise(db: BunSQLiteDatabase<any>, s: InvoiceSettings, today: string) {
  const rows = enrichInvoices(db, s, today);
  const open = rows.filter((r) => r.status === "sent" || r.status === "overdue");
  const month = today.slice(0, 7);
  const received = db.select().from(payments).all().filter((p) => p.date.slice(0, 7) === month && rows.some((r) => r.id === p.invoice_id && r.status !== "void"));
  return {
    outstanding: round2(open.reduce((n, r) => n + r.balance, 0)),
    overdue: round2(rows.filter((r) => r.status === "overdue").reduce((n, r) => n + r.balance, 0)),
    overdue_count: rows.filter((r) => r.status === "overdue").length,
    paid_this_month: round2(received.reduce((n, p) => n + p.amount, 0)),
    drafts: rows.filter((r) => r.status === "draft").length,
  };
}

/** One invoice for the detail page and the printed copy. `seller` is who issues it: the copy taken at issue, or the live settings for a draft. */
export function invoiceDetail(db: BunSQLiteDatabase<any>, s: InvoiceSettings, id: string, today: string) {
  const invoice = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!invoice) return null;
  const { customer, inter, place_of_supply } = billedParty(s, invoice, db.select().from(customers).where(eq(customers.id, invoice.customer_id)).get());
  const lines = db.select().from(invoice_lines).where(eq(invoice_lines.invoice_id, id)).all().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const pays = db.select().from(payments).where(eq(payments.invoice_id, id)).all().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created_at < b.created_at ? -1 : 1));
  const seller = issuingSeller(s, invoice);
  const registered = !!seller.gstin;   // an unregistered seller cannot collect GST: no tax on the invoice
  const t = computeTotals(lines, inter, registered);
  const paid = round2(pays.reduce((n, p) => n + p.amount, 0));
  const status = effectiveStatus(invoice.status, t.total, paid, invoice.due_date, today);
  return {
    invoice, seller, gst_registered: registered, customer, lines, payments: pays, status, inter_state: inter, place_of_supply,
    totals: t.rows as TotalsRow[], subtotal: t.subtotal, tax: t.tax, total: t.total, paid,
    balance: status === "void" ? 0 : round2(Math.max(0, t.total - paid)), days_overdue: status === "overdue" ? daysOverdue(invoice.due_date, today) : 0,
  };
}

/** Columns only this server writes: /api/_data drops them from POST and PATCH bodies (kit option `serverColumns`). */
export const SERVER_COLUMNS = { invoices: ["bill_to", "seller"] };

/** Only a draft may be deleted or rewritten. An issued invoice is voided instead, so its number is never freed and the serial has no gaps.
 *  Register before mountKit so it runs ahead of the kit's /api/_data writes to invoices and invoice_lines; `db` is read at request time.
 *  (`bill_to` and `seller` are kept server-side by the kit's `serverColumns` option, see server/index.ts.) */
export function guardInvoiceWrites(hono: Hono, db: () => BunSQLiteDatabase<any> | null) {
  const statusOf = (id: unknown) => typeof id === "string" ? db()?.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id)).get()?.status : undefined;
  const issued = (status: string | undefined) => status !== undefined && status !== "draft";
  const body = async (c: { req: { json(): Promise<unknown> } }) => { try { const b = await c.req.json(); return b && typeof b === "object" && !Array.isArray(b) ? b as Record<string, unknown> : null; } catch { return null; } };
  hono.delete("/api/_data/invoices/:id", async (c, next) => {
    if (issued(statusOf(c.req.param("id")))) return c.json({ error: "issued", message: "Only a draft can be deleted. Void an issued invoice instead (PATCH status: \"void\")." }, 409);
    await next();
  });
  // An issued invoice is a record: only its status moves on (to paid, back to sent when a payment is removed, or to void) and its
  // notes change. Its number, customer, dates and lines are fixed, it never goes back to draft, and a void one stays void.
  // (Undo is the kit's /_changes route, not this one: an Undo of "Marked as sent" still returns it to draft.)
  hono.patch("/api/_data/invoices/:id", async (c, next) => {
    const d = db();
    const cur = d?.select().from(invoices).where(eq(invoices.id, c.req.param("id"))).get() as Record<string, unknown> | undefined;
    const b = await body(c);
    if (!cur || !b || !issued(cur.status as string)) return next();
    const free = new Set(["status", "notes", ...SERVER_COLUMNS.invoices]);   // server columns are dropped by the kit anyway
    const fixed = Object.keys(b).filter((k) => !free.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(cur[k] ?? null));
    if (fixed.length) return c.json({ error: "issued", field: fixed[0], message: `${cur.number} is issued: only its status and notes can change. Void it and issue a new one to change the ${fixed[0].replace(/_/g, " ")}.` }, 409);
    const to = b.status;
    if (to !== undefined && to !== cur.status && (to === "draft" || cur.status === "void"))
      return c.json({ error: "issued", field: "status", message: to === "draft" ? `${cur.number} is issued and cannot go back to draft. Void it instead.` : `${cur.number} is void and stays void.` }, 409);
    await next();
  });
  const lineRefused = (number: unknown) => ({ error: "issued", message: `${number ?? "That invoice"} is issued: its lines are fixed. Void it and issue a new one to change them.` });
  const invoiceNumber = (id: unknown) => typeof id === "string" ? db()?.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, id)).get()?.number : undefined;
  const lineInvoice = (id: string) => db()?.select({ invoice_id: invoice_lines.invoice_id }).from(invoice_lines).where(eq(invoice_lines.id, id)).get()?.invoice_id;
  hono.post("/api/_data/invoice_lines", async (c, next) => {
    const b = await body(c);
    if (b && issued(statusOf(b.invoice_id))) return c.json(lineRefused(invoiceNumber(b.invoice_id)), 409);
    await next();
  });
  hono.patch("/api/_data/invoice_lines/:id", async (c, next) => {
    const b = await body(c);
    const from = lineInvoice(c.req.param("id"));
    for (const inv of [from, b?.invoice_id]) if (issued(statusOf(inv))) return c.json(lineRefused(invoiceNumber(inv)), 409);
    await next();
  });
  hono.delete("/api/_data/invoice_lines/:id", async (c, next) => {
    const from = lineInvoice(c.req.param("id"));
    if (issued(statusOf(from))) return c.json(lineRefused(invoiceNumber(from)), 409);
    await next();
  });
}

/** The app's own routes. The viewer sends its own `today` so "overdue" is judged on the viewer's date, not the server's.
 *  `settings` is the kit's (`kit.settings`): the business, its state code and the number prefix, read on every request.
 *  With the kit's `events`, every issued invoice keeps a copy of its customer as billed and of the seller as issued (bill-to.ts).
 *  Only when the schema is in place (`status.state === "ok"`): while a change waits for the owner, those columns may not exist yet. */
export function mountInvoiceRoutes(hono: Hono, db: BunSQLiteDatabase<any>, settings: { all(): Record<string, unknown> }, events?: Parameters<typeof watchIssued>[2], status?: { state: string },
  /** The kit's `flagSamples`: the list marks seeded invoices `_sample`, as /api/_data does, so the Table shows them lighter with the chip. */
  flagSamples?: <R extends Record<string, unknown>>(table: string, rows: R[]) => (R & { _sample?: true })[]) {
  const cur: CurrentSettings = () => invoiceSettings(settings.all());
  if (events && status?.state === "ok") watchIssued(db, cur, events);
  const todayParam = (raw: string | undefined) => (raw === undefined ? localToday() : DATE_RE.test(raw) ? raw : null);
  const bad = (field: string, message: string) => ({ error: "invalid", field, message });

  hono.get("/api/invoice-summary", (c) => {
    const today = todayParam(c.req.query("today"));
    if (!today) return c.json(bad("today", "today must look like 2026-10-09"), 400);
    return c.json(summarise(db, cur(), today));
  });

  hono.get("/api/invoice-list", (c) => {
    const today = todayParam(c.req.query("today"));
    if (!today) return c.json(bad("today", "today must look like 2026-10-09"), 400);
    const status = c.req.query("status");
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) return c.json(bad("status", `status must be one of ${STATUSES.join(", ")}`), 400);
    const limRaw = c.req.query("limit");
    if (limRaw !== undefined && !/^[1-9]\d{0,3}$/.test(limRaw)) return c.json(bad("limit", "limit must be a whole number"), 400);
    const limit = Math.min(Number(limRaw ?? 50), 200);
    const curRaw = c.req.query("cursor");
    const offset = curRaw === undefined ? 0 : Number(curRaw);
    if (!Number.isSafeInteger(offset) || offset < 0) return c.json(bad("cursor", "invalid cursor"), 400);
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const all = enrichInvoices(db, cur(), today).filter((r) => (!status || r.status === status) && (!q || r.number.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q)));
    const page = all.slice(offset, offset + limit);
    const rows = flagSamples ? flagSamples("invoices", page as unknown as Record<string, unknown>[]) : page;
    return c.json({ rows, total: all.length, nextCursor: offset + limit < all.length ? String(offset + limit) : null });
  });

  hono.get("/api/invoice/:id", (c) => {
    const today = todayParam(c.req.query("today"));
    if (!today) return c.json(bad("today", "today must look like 2026-10-09"), 400);
    const d = invoiceDetail(db, cur(), c.req.param("id"), today);
    return d ? c.json(d) : c.json({ error: "not_found" }, 404);
  });

  hono.get("/api/next-number", (c) => {
    const raw = c.req.query("year");
    const year = raw === undefined ? new Date().getFullYear() : /^\d{4}$/.test(raw) ? Number(raw) : null;
    if (year === null) return c.json(bad("year", "year must look like 2026"), 400);
    return c.json({ number: nextNumber(cur(), db.select({ n: invoices.number }).from(invoices).all().map((r) => r.n), year) });
  });
}
