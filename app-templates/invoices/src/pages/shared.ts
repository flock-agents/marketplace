import { useCallback, useEffect, useRef, useState } from "react";
import { nounsFrom } from "./nouns";
import { kitFetch, label, subscribeEvents } from "../flock/ui";
import { DEFAULT_SETTINGS, STATUSES as STATUS_LIST, invoiceSettings, type InvoiceSettings } from "../../server/db/constants";

/** What a customer is called (label noun.one / noun.many, default customer / customers): a tuition app bills students. */
const nouns = () => nounsFrom({ one: label("noun.one", "customer"), many: label("noun.many", "customers"), title: label("title.customers", "Customers"), nav: label("nav.customers", "Customers") });
export const one = () => nouns().one;
export const many = () => nouns().many;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Status = "draft" | "sent" | "paid" | "overdue" | "void";
export interface Customer { id: string; name: string; gstin: string | null; email: string | null; phone: string | null; address: string | null; created_at: string; updated_at: string; updated_by: string | null }
export interface InvoiceRow { id: string; number: string; customer_id: string; customer_name: string; issue_date: string; due_date: string; stored_status: string; status: Status; total: number; paid: number; balance: number; days_overdue: number }
export interface InvoiceLine { id: string; invoice_id: string; description: string; qty: number; unit_price: number; gst_rate: number }
export interface Payment { id: string; invoice_id: string; date: string; amount: number; method: string; ref: string | null }
export interface TotalsRow { label: string; value: number; strong?: boolean }
/** Who issues an invoice: the copy taken when it was issued, or the live settings for a draft. */
export interface Seller { name: string; gstin: string; address: string; email: string; pay: string; state: string }
export interface InvoiceDetail {
  invoice: { id: string; number: string; customer_id: string; issue_date: string; due_date: string; status: string; notes: string | null };
  /** The seller as issued (copied at issue); for a draft, the business settings as they are now. */
  seller?: Seller;
  /** False when the seller (as issued, or the live settings for a draft) has no GSTIN: the invoice carries no tax. */
  gst_registered?: boolean;
  /** For an issued invoice, the customer as billed (name, address, GSTIN copied at issue); for a draft, the live customer. */
  customer: Customer | null; lines: InvoiceLine[]; payments: Payment[]; status: Status; inter_state: boolean; place_of_supply: string | null;
  totals: TotalsRow[]; subtotal: number; tax: number; total: number; paid: number; balance: number; days_overdue: number;
}
export interface Summary { outstanding: number; overdue: number; overdue_count: number; paid_this_month: number; drafts: number }
/** What the chat is pointed at: the invoice or customer the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

/** The statuses come from server/db/constants.ts; change the tones here when they change. */
export const STATUSES: string[] = [...STATUS_LIST];
export const STATUS_TONES = { draft: "muted", sent: "info", paid: "success", overdue: "danger", void: "neutral" } as const;
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue", void: "Void" };
/** The same tones keyed by the capitalised label, for chips that show the label. */
export const STATUS_LABEL_TONES = Object.fromEntries(Object.entries(STATUS_TONES).map(([k, v]) => [STATUS_LABEL[k], v])) as Record<string, (typeof STATUS_TONES)[keyof typeof STATUS_TONES]>;

/** The viewer's own date (YYYY-MM-DD), so "overdue" is judged where the viewer is. */
export const localToday = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** The viewer-local form of an ISO date: 12 Oct 2026. */
export const longDate = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

/** One GET against the app's own routes. It reloads when any of `tables` changes (live events, or a reconnect). */
export function useApi<T>(path: string | null, tables: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = tables.join(",");
  const load = useCallback(async () => {
    if (path === null) return;
    const mine = ++seq.current;
    try { const r = await kitFetch<T>(path); if (mine === seq.current) { setData(r); setError(null); } }
    catch (e) { if (mine === seq.current) setError((e as Error).message || "Couldn't load"); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    setLoading(path !== null); void load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 150); };
    const off = subscribeEvents((e) => { if (key.split(",").includes(e.table)) soon(); }, soon);
    return () => { off(); clearTimeout(t); };
  }, [load, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error, reload: load };
}

/** The invoice list a page at a time, with the status and search filters applied by the server. */
export function useInvoiceList(status: string | null, q: string) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const count = useRef(0);
  const base = `invoice-list?today=${localToday()}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const load = useCallback(async (keep: boolean) => {
    const mine = ++seq.current;
    try {
      const limit = keep ? Math.min(200, Math.max(50, count.current)) : 50;
      const r = await kitFetch<{ rows: InvoiceRow[]; nextCursor: string | null }>(`${base}&limit=${limit}`);
      if (mine !== seq.current) return;
      setRows(r.rows); setCursor(r.nextCursor); setError(null); count.current = r.rows.length;
    } catch (e) { if (mine === seq.current) setError((e as Error).message || "Couldn't load the invoices"); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [base]);
  useEffect(() => {
    setLoading(true); count.current = 0; void load(false);
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(true), 150); };
    const off = subscribeEvents((e) => { if (["invoices", "invoice_lines", "payments", "customers"].includes(e.table)) soon(); }, soon);
    return () => { off(); clearTimeout(t); };
  }, [load]);
  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const r = await kitFetch<{ rows: InvoiceRow[]; nextCursor: string | null }>(`${base}&limit=50&cursor=${cursor}`);
      setRows((x) => [...x, ...r.rows]); setCursor(r.nextCursor); count.current += r.rows.length;
    } catch (e) { setError((e as Error).message || "Couldn't load more"); }
    finally { setLoading(false); }
  };
  return { rows, loading, error, hasMore: cursor !== null, loadMore, reload: () => load(true) };
}

/** Delete a row through the kit and offer Undo from its change log. */
export async function removeRow(table: string, id: string): Promise<string | undefined> {
  const r = await kitFetch<{ changeId?: string } | null>(`_data/${table}/${id}`, { method: "DELETE" });
  return r?.changeId;
}
export const undoChange = (changeId: string) => kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" });

/** The app's business details, state code and number prefix (settings at /api/_app), kept fresh when they change. Today's defaults until they load. */
export function useInvoiceSettings(): InvoiceSettings {
  const [s, setS] = useState<InvoiceSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let live = true;
    const load = () => { kitFetch<{ settings: Record<string, unknown> }>("_app").then((r) => { if (live) setS(invoiceSettings(r.settings ?? {})); }).catch(() => { /* keep what we have */ }); };
    load();
    const off = subscribeEvents((e) => { if (e.table === "_settings") load(); }, load);
    return () => { live = false; off(); };
  }, []);
  return s;
}
