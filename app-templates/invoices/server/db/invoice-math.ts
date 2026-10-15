import type { InvoiceSettings } from "./constants";
import { gstTotals, round2, lineAmount, type GstLine, type TotalsRow } from "../../src/flock/ui/gst";

// The one place invoice money is worked out. The GST maths itself is the component library's `gstTotals` (src/flock/ui/gst.ts),
// the same function the LineItems editor uses; the server routes and the browser pages both go through this file.
export { round2, lineAmount };
export type MathLine = GstLine;
export type { TotalsRow };
export interface Totals { subtotal: number; tax: number; total: number; split: "intra" | "inter"; rows: TotalsRow[] }

/** A customer whose GSTIN starts with a different state code than the seller's (settings `seller_state`) is billed IGST;
 *  no GSTIN (a consumer) is treated as in-state. */
export const isInterState = (s: Pick<InvoiceSettings, "seller_state">, gstin: string | null | undefined): boolean => {
  const code = (gstin ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(code) && code !== s.seller_state;
};

/** Subtotal, tax per slab (equal CGST and SGST halves, or IGST) and total. A seller not registered for GST (`registered` false, an
 *  empty GSTIN) cannot collect GST: no tax at all, whatever rates the lines store, so the totals are Subtotal and Total. */
export function computeTotals(lines: MathLine[], inter: boolean, registered = true): Totals {
  const split = inter ? "inter" : "intra";
  return { ...gstTotals(registered ? lines : lines.map((l) => ({ ...l, gst_rate: 0 })), split), split };
}

export type Status = "draft" | "sent" | "paid" | "overdue" | "void";
/** What the invoice is today. Draft and void are stored; paid, overdue and sent are worked out from the payments and the due date. */
export function effectiveStatus(stored: string, total: number, paid: number, due: string | null | undefined, today: string): Status {
  if (stored === "void") return "void";
  if (stored === "draft") return "draft";
  if (round2(total - paid) <= 0) return "paid";   // a sent invoice for nothing owes nothing
  if (due && due < today) return "overdue";
  return "sent";
}

/** The next free number for a year under the current prefix (settings `number_prefix`): INV-2026-0043 after INV-2026-0042.
 *  A new prefix starts its own run at 0001; numbers already issued under another prefix are never touched. */
export function nextNumber(s: Pick<InvoiceSettings, "number_prefix">, existing: string[], year: number): string {
  const prefix = s.number_prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const top = existing.reduce((m, n) => { const x = re.exec(n); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `${s.number_prefix}-${year}-${String(top + 1).padStart(4, "0")}`;
}

/** Whole days an invoice is past due (0 when not). */
export function daysOverdue(due: string, today: string): number {
  const d = Date.parse(`${due}T00:00:00Z`), t = Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(d) || Number.isNaN(t) ? 0 : Math.max(0, Math.round((t - d) / 86_400_000));
}
