// Pure GST maths: no React, no CSS, no imports. The LineItems component and an app's server routes share it,
// so a total can never differ between the editor, a list and the printed invoice.

export interface GstLine { qty: number | null; unit_price: number | null; gst_rate: number | null }
export interface TotalsRow { label: string; value: number; strong?: boolean }
export type GstSplit = "intra" | "inter" | "none";
export interface GstTotals { subtotal: number; tax: number; total: number; rows: TotalsRow[] }

/** GST slabs since 22 Sep 2025 (56th GST Council): nil, 5%, 18% and 40%. Any other rate (3% on gold, 0.25% on rough
 *  diamonds, a rate stored before the change) is entered as a custom %; stored rates are never re-mapped. */
export const GST_RATES = [0, 5, 18, 40] as const;
/** A custom GST rate typed by a person: a number from 0 to 100 with at most two decimals, else null. */
export function parseGstRate(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= 100 ? n : null;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const n0 = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
export const lineAmount = (l: GstLine): number => round2(n0(l.qty) * n0(l.unit_price));

/** Subtotal, tax per slab and total. Tax is worked out per slab on the taxable total, not per line.
 *  intra: CGST and SGST are each round2(taxable * rate / 200), so they are always equal and tax is exactly twice that.
 *  inter: one IGST line per slab. none: a single Tax line. */
export function gstTotals(lines: GstLine[], split: GstSplit = "intra"): GstTotals {
  const subtotal = round2(lines.reduce((n, l) => n + lineAmount(l), 0));
  const taxable = new Map<number, number>();
  for (const l of lines) taxable.set(n0(l.gst_rate), round2((taxable.get(n0(l.gst_rate)) ?? 0) + lineAmount(l)));
  const rows: TotalsRow[] = [{ label: "Subtotal", value: subtotal }];
  let tax = 0;
  for (const rate of [...taxable.keys()].sort((a, b) => a - b)) {
    if (rate === 0) continue;
    const base = taxable.get(rate)!;
    if (split === "intra") {
      const half = round2((base * rate) / 200);
      tax = round2(tax + 2 * half);
      rows.push({ label: `CGST ${rate / 2}%`, value: half }, { label: `SGST ${rate / 2}%`, value: half });
    } else {
      const t = round2((base * rate) / 100);
      tax = round2(tax + t);
      if (split === "inter") rows.push({ label: `IGST ${rate}%`, value: t });
    }
  }
  if (split === "none" && tax > 0) rows.push({ label: "Tax", value: tax });
  const total = round2(subtotal + tax);
  rows.push({ label: "Total", value: total, strong: true });
  return { subtotal, tax, total, rows };
}
