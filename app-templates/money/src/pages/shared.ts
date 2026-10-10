import { useEffect, useState } from "react";
import { kitFetch, subscribeEvents } from "../flock/ui";
import { CATEGORIES as CATS, KINDS as KINDS_, changePct } from "../../server/db/constants";

export interface Transaction { id: string; date: string; merchant: string; category: string; amount: number }
export interface Holding { id: string; name: string; kind: string; value: number; invested: number }
export interface Goal { id: string; goal: string; saved: number; target: number; by: string | null }
export interface MonthTotals { month: string; income: number; expenses: number; invested: number }
export interface BudgetLine { category: string; spent: number; limit: number }
/** What the chat is pointed at: the row the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

export const CATEGORIES: string[] = [...CATS];
const KIND_LIST: string[] = [...KINDS_];

const pad = (n: number) => String(n).padStart(2, "0");
/** This month as YYYY-MM in the viewer's own time zone. */
export const thisMonth = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monthName = (ym: string, long = false): string =>
  new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleString("en-IN", { month: long ? "long" : "short" });
export const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** One of the app's own routes (server/money-routes.ts), fetched again whenever a transaction or budget changes. */
export function useRoute<T>(route: string, tables: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true, t: ReturnType<typeof setTimeout> | undefined;
    const load = () => kitFetch<T>(`${route}${route.includes("?") ? "&" : "?"}month=${thisMonth()}`).then((d) => { if (live) { setData(d); setError(null); } }, () => { if (live) setError("Couldn't load this"); });
    const soon = () => { clearTimeout(t); t = setTimeout(load, 150); };
    void load();
    const off = subscribeEvents((e) => { if (tables.includes(e.table)) soon(); }, soon);
    return () => { live = false; clearTimeout(t); off(); };
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

export type FieldDef = { type: "text" | "longtext" | "number" | "money" | "date" | "select" | "multi" | "checkbox" | "person" | "url"; name: string; label: string; options?: string[]; required?: boolean };

/** The form fields for one transaction. "Money" says whether it went out or came in; the sign is worked out on save. */
export const TRANSACTION_FIELDS: FieldDef[] = [
  { type: "date", name: "date", label: "Date", required: true },
  { type: "text", name: "merchant", label: "Merchant", required: true },
  { type: "select", name: "direction", label: "Money", options: ["Spent", "Received"] },
  { type: "money", name: "amount", label: "Amount", required: true },
  { type: "select", name: "category", label: "Category", options: CATEGORIES, required: true },
];
/** Form values to a transaction: a negative amount is money spent. */
export const toTransaction = (v: Record<string, any>): Partial<Transaction> => {
  const { direction, amount, ...rest } = v;
  return { ...rest, amount: direction === "Received" ? Math.round(Math.abs(amount)) : -Math.round(Math.abs(amount)) } as Partial<Transaction>;
};
/** A holding with its Change worked out from worth and invested (never stored, so it cannot drift). */
export const withChange = (h: Holding): Holding & { change: number | null } => ({ ...h, change: changePct(h.value, h.invested) });
export const HOLDING_FIELDS: FieldDef[] = [
  { type: "text", name: "name", label: "Holding", required: true },
  { type: "select", name: "kind", label: "Kind", options: KIND_LIST, required: true },
  { type: "money", name: "invested", label: "Invested", required: true },
  { type: "money", name: "value", label: "Worth today", required: true },
];
export const GOAL_FIELDS: FieldDef[] = [
  { type: "text", name: "goal", label: "Goal", required: true },
  { type: "money", name: "saved", label: "Saved so far", required: true },
  { type: "money", name: "target", label: "Target", required: true },
  { type: "date", name: "by", label: "By" },
];
