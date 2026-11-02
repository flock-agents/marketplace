// No seed: a fresh install starts empty (core goals, no tracker), never with sample rows.
export { KINDS } from "./constants";

/** A plan's sample readings arrive in one import, so every reading of a label carries the same minute and the trend repeats one time.
 *  Re-stamp each label's sample readings (in insert order, oldest first) a week apart ending a few minutes ago. Only readings that
 *  are still samples and share a minute are touched; the template's own seed is already spread. Returns the number re-stamped. */
type Kit = { sqlite: { query(q: string): any }; status: { state: string }; importState: { state: string }; flagSamples: (t: string, rows: any[]) => any[] };
export function spreadSampleReadings(kit: Kit, from = new Date()): number {
  // Only on a writable boot: a blocked schema, a failed import or check mode writes nothing, and a helper must never stop the app starting.
  if (kit.status.state !== "ok" || kit.importState.state === "failed" || process.env.FLOCK_KIT_SCHEMA === "check") return 0;
  try { return spreadNow(kit, from); }
  catch (e) { console.warn(`[fitness] sample readings left as they are: ${(e as Error).message}`); return 0; }
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
