import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { customers, invoices, invoice_lines, payments } from "./schema";
import { SAMPLE_BUSINESS, SELLER_STATE } from "./constants";

/** The sample's issued invoices carry the sample seller as issued (bill-to.ts copies the live settings only onto an invoice with none),
 *  so they show Brindavan whatever the owner's own settings say, and the owner's settings never need to hold sample data. */
const SAMPLE_SELLER = JSON.stringify({ ...SAMPLE_BUSINESS, state: SELLER_STATE });

/** An ISO date `days` from today, so the sample rows never look stale. */
export const inDays = (days: number, from = new Date()): string => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Sample rows: a small Bengaluru design studio billing its clients. Replace them with the owner's real ones. */
export function sampleData(from = new Date()) {
  const id = () => crypto.randomUUID();
  const c = {
    cafe: id(), clinic: id(), signs: id(), textile: id(), yoga: id(), pitch: id(),
  };
  const customerRows = [
    { id: c.cafe, name: "Third Wave Kitchens Pvt Ltd", gstin: "29AABCT5521M1ZP", email: "accounts@thirdwave.example", phone: "+91 98450 11872", address: "80 Feet Road, Koramangala, Bengaluru 560034" },
    { id: c.clinic, name: "Smile Arc Dental Clinic", gstin: "29AAGFS9034B1Z2", email: "frontdesk@smilearc.example", phone: "+91 80 4125 7788", address: "12th Main, Indiranagar, Bengaluru 560008" },
    { id: c.signs, name: "Workbench Co-working LLP", gstin: "29AAKFW7710Q1ZK", email: "finance@workbench.example", phone: "+91 99020 66143", address: "27th Main, HSR Layout, Bengaluru 560102" },
    { id: c.textile, name: "Kanchi Looms (Chennai)", gstin: "33AAACK2284F1ZD", email: "billing@kanchilooms.example", phone: "+91 44 4200 9910", address: "Usman Road, T. Nagar, Chennai 600017" },
    { id: c.yoga, name: "Anahata Yoga Studio", gstin: null, email: "hello@anahata.example", phone: "+91 98860 40217", address: "4th Block, Jayanagar, Bengaluru 560011" },
    { id: c.pitch, name: "Orbit Labs Technologies", gstin: "27AAFCO6613L1ZQ", email: "ap@orbitlabs.example", phone: "+91 22 6140 3321", address: "Bandra Kurla Complex, Mumbai 400051" },
  ];
  const d = (n: number) => inDays(n, from);
  const yr = (n: number) => Number(d(n).slice(0, 4));
  type L = [string, number, number, number];
  const specs: { key: string; cust: string; issue: number; due: number; status: string; notes?: string; lines: L[]; paid?: [number, number, string, string | null][] }[] = [
    { key: "a", cust: c.textile, issue: -64, due: -34, status: "sent", notes: "Net 30. Interstate supply, IGST applies.", lines: [["Catalogue design, 48 pages", 1, 96000, 18], ["Product photography, 30 sarees", 30, 1400, 18]] },
    { key: "b", cust: c.pitch, issue: -52, due: -22, status: "sent", lines: [["Investor deck, 24 slides", 1, 85000, 18], ["Brand illustrations", 6, 4500, 18]] },
    { key: "c", cust: c.cafe, issue: -41, due: -11, status: "sent", notes: "Second milestone of the rebrand.", lines: [["Menu and signage design", 1, 72000, 18], ["Printed menu cards (200)", 200, 38.5, 18]], paid: [[-3, 40000, "upi", "UPI/4021887765"]] },
    { key: "d", cust: c.signs, issue: -26, due: -2, status: "sent", lines: [["Lobby wayfinding signage, design", 1, 140000, 18], ["Site measurement visit", 1, 6000, 18]] },
    { key: "e", cust: c.clinic, issue: -18, due: 12, status: "sent", lines: [["Clinic website, 6 pages", 1, 95000, 18], ["Domain and hosting, 1 year", 1, 4800, 18]] },
    { key: "f", cust: c.yoga, issue: -9, due: 6, status: "sent", lines: [["Brand kit: logo, palette, type", 1, 52000, 0], ["Class schedule poster", 2, 3500, 5]] },
    { key: "g", cust: c.cafe, issue: -75, due: -45, status: "paid", lines: [["Rebrand, first milestone", 1, 90000, 18]], paid: [[-48, 106200, "bank", "NEFT HDFCN52026091744"]] },
    { key: "h", cust: c.yoga, issue: -58, due: -43, status: "paid", lines: [["Studio signage artwork", 1, 18000, 0]], paid: [[-50, 18000, "cash", null]] },
    { key: "i", cust: c.signs, issue: -3, due: 27, status: "draft", lines: [["Wayfinding signage, production supervision", 1, 55000, 18]] },
    { key: "j", cust: c.pitch, issue: -33, due: -3, status: "void", notes: "Raised twice by mistake. See the later invoice.", lines: [["Investor deck, 24 slides", 1, 85000, 18]] },
  ];
  // Numbers run in issue order within each year.
  const counters = new Map<number, number>();
  const ordered = [...specs].sort((x, y) => x.issue - y.issue);
  const numbers = new Map<string, string>();
  for (const s of ordered) { const y = yr(s.issue); const n = (counters.get(y) ?? 40) + 1; counters.set(y, n); numbers.set(s.key, `INV-${y}-${String(n).padStart(4, "0")}`); }
  const invoiceRows = specs.map((s) => ({ id: id(), number: numbers.get(s.key)!, customer_id: s.cust, issue_date: d(s.issue), due_date: d(s.due), status: s.status, notes: s.notes ?? null, ...(s.status === "draft" ? {} : { seller: SAMPLE_SELLER }) }));
  const lineRows = specs.flatMap((s, i) => s.lines.map(([description, qty, unit_price, gst_rate]) => ({ id: id(), invoice_id: invoiceRows[i].id, description, qty, unit_price, gst_rate })));
  const paymentRows = specs.flatMap((s, i) => (s.paid ?? []).map(([day, amount, method, ref]) => ({ id: id(), invoice_id: invoiceRows[i].id, date: d(day), amount, method, ref })));
  return { customers: customerRows, invoices: invoiceRows, invoice_lines: lineRows, payments: paymentRows };
}

/** One second apart and all in the past, so rows keep this order instead of tying on created_at. */
const staggered = <T extends object>(rows: T[], from: Date) => rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

/** `from` is the day the sample is told from (today by default); tests pass a fixed one. */
export async function seed(db: BunSQLiteDatabase<any>, from = new Date()) {
  const s = sampleData(from);
  await db.insert(customers).values(staggered(s.customers, from));
  await db.insert(invoices).values(staggered(s.invoices, from));
  await db.insert(invoice_lines).values(staggered(s.invoice_lines, from));
  await db.insert(payments).values(staggered(s.payments, from));
}
