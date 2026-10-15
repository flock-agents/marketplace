import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { metrics, events } from "./schema";
export { KINDS } from "./constants";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** An ISO date `days` from today, so the sample rows never look stale. */
export const inDays = (days: number, from = new Date()): string => iso(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days));

const DAILY = {
  "Orders today": { unit: "orders", values: [96, 104, 99, 118, 121, 112, 132] },
  "Revenue today": { unit: "₹", values: [24100, 26800, 25200, 30500, 31900, 29400, 34600] },
  "Repeat customers": { unit: "%", values: [58, 59, 59, 61, 62, 62, 64] },
  "Avg. delivery time": { unit: "min", values: [34, 33, 35, 31, 30, 31, 29] },
};

/** Sample readings: a week of daily numbers for a tiffin kitchen in Koramangala, oldest first, the last one today. */
export const sampleMetrics = (from = new Date()) =>
  Object.entries(DAILY).flatMap(([label, { unit, values }], n) =>
    values.map((value, i) => {
      // One reading a day, the newest a few minutes before `from` (a minute apart per label), so every stamp is in the past and an
      // agent's next reading sorts after the sample.
      const at = new Date(from.getTime() - (values.length - 1 - i) * 86_400_000 - (Object.keys(DAILY).length - n) * 60_000).toISOString();
      return {
        label, value, unit,
        created_at: at, updated_at: at,
      };
    }),
  );

/** Sample events, newest last in this list. */
export const sampleEvents = (from = new Date()) => [
  { title: "Bulk order of 40 meals from Infosys, Electronic City", at: `${inDays(-5, from)}T12:10`, kind: "Sale" },
  { title: "Gas cylinder delivery is late; the kitchen is down to one burner", at: `${inDays(-4, from)}T09:20`, kind: "Alert" },
  { title: "Crossed 100 orders in a day for the first time", at: `${inDays(-3, from)}T20:05`, kind: "Milestone" },
  { title: "Swiggy listing moved to the top row in Koramangala", at: `${inDays(-2, from)}T11:30`, kind: "Note" },
  { title: "Corporate lunch plan signed with a Sarjapur Road startup (25 meals a day)", at: `${inDays(-1, from)}T15:45`, kind: "Sale" },
  { title: "Rating dipped to 4.3 after two late deliveries on Monday", at: `${inDays(0, from)}T08:50`, kind: "Alert" },
];

export async function seed(db: BunSQLiteDatabase<any>) {
  await db.insert(metrics).values(sampleMetrics());
  await db.insert(events).values(sampleEvents());
}

/** A plan's sample readings arrive in one import, so every reading of a label carries the same minute and the trend repeats one time.
 *  Re-stamp each label's sample readings (in insert order, oldest first) a week apart ending a few minutes ago. Only readings that
 *  are still samples and share a minute are touched; the template's own seed is already spread. Returns the number re-stamped. */
type Kit = { sqlite: { query(q: string): any }; status: { state: string }; importState: { state: string }; flagSamples: (t: string, rows: any[]) => any[] };
export function spreadSampleReadings(kit: Kit, from = new Date()): number {
  // Only on a writable boot: a blocked schema, a failed import or check mode writes nothing, and a helper must never stop the app starting.
  if (kit.status.state !== "ok" || kit.importState.state === "failed" || process.env.FLOCK_KIT_SCHEMA === "check") return 0;
  try { return spreadNow(kit, from); }
  catch (e) { console.warn(`[dashboard] sample readings left as they are: ${(e as Error).message}`); return 0; }
}
function spreadNow(kit: Kit, from: Date): number {
  const rows = kit.sqlite.query(`SELECT id, label, created_at FROM metrics ORDER BY rowid`).all() as { id: string; label: string; created_at: string }[];
  const flagged = new Set(kit.flagSamples("metrics", rows).filter((r) => r._sample).map((r) => r.id));
  const byLabel = new Map<string, typeof rows>();
  for (const r of rows) if (flagged.has(r.id)) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
  const labels = [...byLabel.keys()];
  let n = 0;
  for (const [label, list] of byLabel) {
    if (list.length < 2 || new Set(list.map((r) => r.created_at.slice(0, 16))).size !== 1) continue;
    const step = list.length <= 6 ? 7 : 3;   // a week apart for a few readings, every few days for more, so the span stays within a couple of months
    list.forEach((r, i) => {
      const at = new Date(from.getTime() - (list.length - 1 - i) * step * 86_400_000 - (labels.length - labels.indexOf(label)) * 60_000).toISOString();
      kit.sqlite.query(`UPDATE metrics SET created_at = ?, updated_at = ? WHERE id = ?`).run(at, at, r.id);
      n++;
    });
  }
  return n;
}
