import type { Outcome } from "./score";

export const LEGACY_KINDS = ["veg", "egg", "no_eggs", "no_meat", "fasting", "no_onion_garlic", "other"];

export type RunRecord = { fixture: string; rep: number; rounds: number; accepted: boolean; refusals: string[]; seed_notes: string[];
  outcomes: Outcome[]; cost: number; ms: number };

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : "n/a");
export function mdTable(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`)].join("\n");
}
