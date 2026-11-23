// The scorecard as Markdown: one row per run, one column per field, the totals, then the misses and the top failure kinds.
import { pct, totals, type Rates } from "./score-setup";

export type Row = { label: string; failed?: boolean; rates: Rates; extra?: Record<string, string | number> };

export function table(rows: Row[], extraCols: string[] = []): string[] {
  const tot = totals(rows.map((r) => r.rates));
  const fields = Object.keys(tot);
  const out = [`| run | ${[...fields, ...extraCols].join(" | ")} |`, `|---|${[...fields, ...extraCols].map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${r.label}${r.failed ? " (FAILED)" : ""} | ${[...fields.map((f) => (r.rates[f] ? `${r.rates[f][0]}/${r.rates[f][1]}` : "–")), ...extraCols.map((c) => String(r.extra?.[c] ?? "–"))].join(" | ")} |`);
  out.push(`| **total** | ${[...fields.map((f) => pct(tot[f])), ...extraCols.map(() => "")].join(" | ")} |`, "");
  return out;
}

export function misses(runs: { label: string; notes: string[]; error?: string }[]): string[] {
  const out = ["## Misses", ""];
  for (const r of runs) if (r.notes.length || r.error) out.push(`### ${r.label}`, ...(r.error ? [`- ERROR ${r.error.split("\n")[0]}`] : []), ...r.notes.map((n) => `- ${n}`), "");
  const kinds = new Map<string, number>();
  for (const r of runs) for (const n of r.notes) { const k = n.split(":")[0]; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  out.push("## Top failure kinds", "", ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), "");
  return out;
}
