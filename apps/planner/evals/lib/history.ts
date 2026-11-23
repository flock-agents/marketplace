// What the planner derives from history (spec §2.2), computed the eval's own way from the rows it loaded, so Eval 2 can
// tell a staple (exempt from the repeat window) from a dish that should rotate.
import { plain } from "./truth";

/** A history row of one slot: the dishes made together (the seed's rows have no date). */
export type HistoryRow = { slot: string; dishes: string[]; date?: string | null };

/** spec §10.1 (owner, 23 Nov): a staple of a slot is a dish in ≥ 60% of that slot's last 14 history rows with dishes, from the
 *  seed and CONFIRMED rows only (a planned row is never history here: pass only those), once the slot has STAPLE_MIN_ROWS
 *  such rows, plus every `daily` dish of the slot. */
export const STAPLE_SHARE = 0.6;
export const STAPLE_WINDOW = 14;
/** Owner, 23 Nov: history makes staples only once the slot has at least this many rows with dishes; below it, only `daily`. */
export const STAPLE_MIN_ROWS = 3;

/** The staples of `slot`, as plain names. Rows are taken newest first by date; the seed (no date) after dated rows. */
export function staplesOf(rows: HistoryRow[], slot: string, daily: string[] = []): Set<string> {
  const mine = rows.filter((r) => r.slot.toLowerCase() === slot.toLowerCase() && r.dishes.length)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, STAPLE_WINDOW);
  const out = new Set<string>(daily.map(plain));
  if (mine.length < STAPLE_MIN_ROWS) return out;
  const counts = new Map<string, number>();
  for (const r of mine) for (const d of new Set(r.dishes.map(plain))) counts.set(d, (counts.get(d) ?? 0) + 1);
  for (const [d, n] of counts) if (n / mine.length >= STAPLE_SHARE) out.add(d);
  return out;
}

/** The mean number of dishes in a slot's rows (the shape the plan is compared with, tracked only). */
export function meanDishes(rows: HistoryRow[], slot: string): number | null {
  const mine = rows.filter((r) => r.slot.toLowerCase() === slot.toLowerCase() && r.dishes.length);
  return mine.length ? mine.reduce((a, r) => a + r.dishes.length, 0) / mine.length : null;
}
