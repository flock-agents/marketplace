// Learned order windows: when this household actually orders, derived from history, and how a cart picks one.
// `learnOrderWindows`, `mergeWindows` and `planOrderAt` are pure and unit-tested; the two DB helpers at
// the bottom read history and store the result in shopping_prefs.order_windows (pinned windows are never overwritten).
import { and, eq, isNull } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, groceries, ingredients, shopping_prefs } from "./db/schema";
import { addDaysStr, addMinutes, dateTime } from "./timeline";

export interface OrderWindow { days: number[]; from: string; to: string; source: "learned" | "pinned"; confidence: number; sample_count: number }

export const MIN_SAMPLES = 3;
const HALF_LIFE_DAYS = 30;
/** The order must be placed at least this long before the delivery deadline — comfortable, not last-minute. */
export const ORDER_MARGIN_MIN = 60;

const pad = (n: number) => String(n).padStart(2, "0");
const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const weekdayOf = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

/** India Standard Time is a fixed UTC+05:30 (no DST), so weekday/hour in Asia/Kolkata never depend on the machine zone. */
const IST_OFFSET_MS = 330 * 60_000;
export const istWeekdayHour = (t: Date) => { const d = new Date(t.getTime() + IST_OFFSET_MS); return { day: d.getUTCDay(), hour: d.getUTCHours() }; };

/** One order often leaves several timestamps (the cart, each ingredient's last_ordered_at): any within an hour of the
 *  previous kept one is the same order. */
const SAME_ORDER_MS = 60 * 60_000;
export function distinctOrders(times: Date[]): Date[] {
  const out: Date[] = [];
  for (const t of times.filter((x) => !Number.isNaN(x.getTime())).sort((a, b) => a.getTime() - b.getTime())) {
    if (out.length && t.getTime() - out[out.length - 1].getTime() < SAME_ORDER_MS) continue;
    out.push(t);
  }
  return out;
}

/** Clusters past orders by IST hour of day, recording the weekdays each hour was seen on (recency-weighted, half-life
 *  30 days). An hour with ≥3 distinct orders is a window; it applies to every day once seen on ≥3 different weekdays,
 *  else only to the weekdays it was seen on. confidence = the cluster's share of all (weighted) orders. */
export function learnOrderWindows(orderTimes: Date[], now: Date): OrderWindow[] {
  const clusters = new Map<number, { weight: number; count: number; days: Set<number> }>();
  let total = 0;
  for (const t of distinctOrders(orderTimes)) {
    if (t > now) continue;
    const weight = 0.5 ** ((now.getTime() - t.getTime()) / 86_400_000 / HALF_LIFE_DAYS);
    const { day, hour } = istWeekdayHour(t);
    const c = clusters.get(hour) ?? { weight: 0, count: 0, days: new Set<number>() };
    c.weight += weight; c.count++; c.days.add(day);
    clusters.set(hour, c);
    total += weight;
  }
  return [...clusters.entries()]
    .filter(([, c]) => c.count >= MIN_SAMPLES)
    .map(([hour, c]) => ({
      days: c.days.size >= 3 ? [0, 1, 2, 3, 4, 5, 6] : [...c.days].sort(),
      from: `${pad(hour)}:00`, to: `${pad((hour + 1) % 24)}:00`, source: "learned" as const,
      confidence: Math.round((c.weight / total) * 100) / 100, sample_count: c.count,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

/** Pinned windows are kept as-is; learned ones are replaced by the fresh computation. */
export const mergeWindows = (existing: OrderWindow[], learned: OrderWindow[]): OrderWindow[] =>
  [...existing.filter((w) => w.source === "pinned"), ...learned];

/** The windows planning uses: pinned ones when there are any (they always win), else the learned ones. */
export const activeWindows = (all: OrderWindow[]): OrderWindow[] => {
  const pinned = all.filter((w) => w.source === "pinned");
  return pinned.length ? pinned : all.filter((w) => w.source === "learned");
};

/** The latest window start that is still at least ORDER_MARGIN_MIN before `deadline` and not in the past, looking
 *  back up to 3 days. Null when no window fits — the caller falls back to the settings-based rule. */
export function planOrderAt(deadline: string, windows: OrderWindow[], now: Date): string | null {
  const latest = addMinutes(deadline, -ORDER_MARGIN_MIN);
  const nowStamp = localStamp(now);
  const date = deadline.slice(0, 10);
  let best: string | null = null;
  for (let back = 0; back <= 3; back++) {
    const day = addDaysStr(date, -back);
    for (const w of windows) {
      if (!w.days.includes(weekdayOf(day))) continue;
      const start = dateTime(day, w.from);
      if (start > latest || start < nowStamp) continue;
      if (!best || start > best) best = start;
    }
    if (best) return best;
  }
  return null;
}

// --- Database -----------------------------------------------------------------------------------------------------------
type Db = BunSQLiteDatabase<any>;

export function readWindows(db: Db): { windows: OrderWindow[]; last_computed_at: string | null } {
  const row = db.select().from(shopping_prefs).where(eq(shopping_prefs.id, "household")).get() as { order_windows: string | null; patterns_computed_at: string | null } | undefined;
  let windows: OrderWindow[] = [];
  try { windows = JSON.parse(row?.order_windows ?? "[]"); } catch { /* malformed: nothing learned */ }
  return { windows: Array.isArray(windows) ? windows : [], last_computed_at: row?.patterns_computed_at ?? null };
}

/** Every past order time: ordered carts (ordered_at), ordered grocery rows bought outside any cart, and each
 *  ingredient's last_ordered_at (distinctOrders collapses the ones that belong to the same order). */
export function orderHistory(db: Db): Date[] {
  const cartTimes = (db.select({ at: carts.ordered_at }).from(carts).where(eq(carts.status, "ordered")).all() as { at: string | null }[]).map((r) => r.at);
  const looseRows = (db.select({ at: groceries.updated_at }).from(groceries).where(and(eq(groceries.status, "ordered"), isNull(groceries.cart_id))).all() as { at: string | null }[]).map((r) => r.at);
  const ingredientTimes = (db.select({ at: ingredients.last_ordered_at }).from(ingredients).all() as { at: string | null }[]).map((r) => r.at);
  return [...cartTimes, ...looseRows, ...ingredientTimes].filter((x): x is string => !!x).map((x) => new Date(x));
}

const writeWindows = (db: Db, windows: OrderWindow[], now: Date) => {
  const values = { order_windows: JSON.stringify(windows), patterns_computed_at: now.toISOString(), updated_by: "app" };
  const exists = db.select({ id: shopping_prefs.id }).from(shopping_prefs).where(eq(shopping_prefs.id, "household")).get();
  if (exists) db.update(shopping_prefs).set(values).where(eq(shopping_prefs.id, "household")).run();
  else db.insert(shopping_prefs).values({ id: "household", ...values }).run();
};

/** Re-learns the learned windows from history; pinned ones are kept untouched. */
export function refreshOrderPatterns(db: Db, now = new Date()): OrderWindow[] {
  const merged = mergeWindows(readWindows(db).windows, learnOrderWindows(orderHistory(db), now));
  writeWindows(db, merged, now);
  return merged;
}

/** A valid pinned window from the owner's input, or null. */
export function pinnedWindow(v: unknown): OrderWindow | null {
  const w = v as Partial<OrderWindow> | null;
  const isTime = (x: unknown) => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  if (!w || !Array.isArray(w.days) || !w.days.length || w.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || !isTime(w.from) || !isTime(w.to)) return null;
  return { days: [...new Set(w.days)].sort(), from: w.from!, to: w.to!, source: "pinned", confidence: 1, sample_count: typeof w.sample_count === "number" ? w.sample_count : 0 };
}

/** Replaces the pinned windows (an empty list clears them); learned ones stay. */
export function setPinnedWindows(db: Db, pinned: OrderWindow[], now = new Date()): OrderWindow[] {
  const merged = [...pinned, ...readWindows(db).windows.filter((w) => w.source === "learned")];
  writeWindows(db, merged, now);
  return merged;
}
