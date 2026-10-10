import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq, sql } from "drizzle-orm";
import { customers, invoices } from "./db/schema";
import type { InvoiceSettings } from "./db/constants";
import { isInterState } from "./db/invoice-math";

/** The customer as billed: copied onto an invoice when it leaves draft, so a later edit or delete of the customer never rewrites an issued tax invoice. */
export interface BillTo { customer_id: string; name: string; address: string | null; gstin: string | null; place_of_supply: string; inter_state: boolean }
/** The business as it issued the invoice (the settings `business.*` and `seller_state`), copied the same way: a later change of name,
 *  GSTIN, address or bank details never rewrites an issued tax invoice. */
export interface Seller { name: string; gstin: string; address: string; email: string; pay: string; state: string }
type CustomerRow = typeof customers.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;
/** The current settings, read at the moment they are needed (the owner can change them while the app runs). */
export type CurrentSettings = () => InvoiceSettings;

/** Two-digit state code the supply is to: the customer's GSTIN state, or the seller's own state when they have no GSTIN. */
export const placeOfSupply = (s: Pick<InvoiceSettings, "seller_state">, gstin: string | null | undefined): string => {
  const code = (gstin ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : s.seller_state;
};

const billToOf = (s: InvoiceSettings, c: CustomerRow): BillTo => ({
  customer_id: c.id, name: c.name, address: c.address ?? null, gstin: c.gstin ?? null, place_of_supply: placeOfSupply(s, c.gstin), inter_state: isInterState(s, c.gstin),
});
export const sellerOf = (s: InvoiceSettings): Seller => ({ ...s.business, state: s.seller_state });

const parse = (raw: string | null | undefined): BillTo | null => {
  if (!raw) return null;
  try { const b = JSON.parse(raw); return b && typeof b.name === "string" && typeof b.customer_id === "string" ? b as BillTo : null; } catch { return null; }
};
const parseSeller = (raw: string | null | undefined): Seller | null => {
  if (!raw) return null;
  try { const b = JSON.parse(raw); return b && typeof b.name === "string" && typeof b.state === "string" ? b as Seller : null; } catch { return null; }
};

/** Who an invoice is to and whether it is IGST: the copy for an issued invoice, the live customer for a draft (or an old invoice with no copy). */
export function billedParty(s: InvoiceSettings, inv: InvoiceRow, live: CustomerRow | null | undefined) {
  const b = inv.status === "draft" ? null : parse(inv.bill_to);
  if (b) {
    const customer = { ...(live ?? { id: b.customer_id, email: null, phone: null }), name: b.name, address: b.address, gstin: b.gstin };   // contact details stay live
    return { customer, inter: b.inter_state, place_of_supply: b.place_of_supply };
  }
  return { customer: live ?? null, inter: isInterState(s, live?.gstin), place_of_supply: live ? placeOfSupply(s, live.gstin) : null };
}

/** Who issues an invoice: the copy for an issued invoice, the live settings for a draft (or an invoice whose copy is not taken yet). */
export function issuingSeller(s: InvoiceSettings, inv: InvoiceRow): Seller {
  return (inv.status === "draft" ? null : parseSeller(inv.seller)) ?? sellerOf(s);
}

/** Keep one invoice's copies right: none on a draft; taken once it is issued (the customer's retaken after a change of customer). */
export function syncIssued(db: BunSQLiteDatabase<any>, s: CurrentSettings, id: string) {
  const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!inv) return;
  if (inv.status === "draft") {
    if (inv.bill_to !== null || inv.seller !== null) db.update(invoices).set({ bill_to: null, seller: null }).where(eq(invoices.id, id)).run();
    return;
  }
  const patch: { bill_to?: string; seller?: string } = {};
  const settings = s();
  const copied = parseSeller(inv.seller);
  if (!copied) patch.seller = JSON.stringify(sellerOf(settings));
  if (parse(inv.bill_to)?.customer_id !== inv.customer_id) {
    const c = db.select().from(customers).where(eq(customers.id, inv.customer_id)).get();
    // The supply is judged from the state the invoice was issued from: a later change of `seller_state` never moves an issued invoice.
    if (c) patch.bill_to = JSON.stringify(billToOf({ ...settings, seller_state: copied?.state ?? settings.seller_state }, c));
  }
  if (Object.keys(patch).length) db.update(invoices).set(patch).where(eq(invoices.id, id)).run();
}

/** Copy every issued invoice that has none yet (the sample, imported rows, older rows), then copy each one as it is written: by the
 *  pages, an agent or an Undo. It runs at mount, after the kit's boot import, so an imported issued invoice gets both copies. */
export function watchIssued(db: BunSQLiteDatabase<any>, s: CurrentSettings, events: { subscribe(fn: (e: { table: string; op: string; id: string }) => void): () => void }) {
  for (const { id } of db.select({ id: invoices.id }).from(invoices).all()) { syncIssued(db, s, id); adoptSampleChildren(db, id); }   // also repairs an app issued before the adoption existed
  return events.subscribe((e) => {
    if (e.table !== "invoices" || e.op === "delete") return;
    syncIssued(db, s, e.id);
    if (e.op !== "insert") adoptSampleChildren(db, e.id);
  });
}

/** The kit drops a sample row's mark when the row is edited (issuing a sample draft does): it is the owner's now. Its lines and payments
 *  belong to it, so they go the same way. Left marked, Clear samples would delete them and leave an issued invoice of nothing. */
function adoptSampleChildren(db: BunSQLiteDatabase<any>, invoiceId: string) {
  const marked = db.all(sql`SELECT 1 AS x FROM _samples WHERE table_name = 'invoices' AND row_id = ${invoiceId}`);
  if (marked.length) return;
  for (const t of ["invoice_lines", "payments"] as const)
    db.run(sql`DELETE FROM _samples WHERE table_name = ${t} AND row_id IN (SELECT id FROM ${sql.raw(t)} WHERE invoice_id = ${invoiceId})`);
}
