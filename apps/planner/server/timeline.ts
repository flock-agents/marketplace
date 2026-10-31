// The shopping timeline: when each grocery item is bought, and how items batch into one order (a `carts` row).
// Pure date/grouping logic lives here with no DB import, so it is unit-tested directly; `recalcTimeline` at the
// bottom is the only part that touches the database, called by the app's own routes and routines.
import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { HELD_BACK_CATEGORIES } from "./db/constants";
import { carts, groceries, ingredients, meals, message_log, staples } from "./db/schema";
import { normalizeIngredientName } from "./ingredients";
import { activeWindows, planOrderAt, readWindows } from "./orderPatterns";

/** Announces a row this module wrote with a raw `db` call (bypassing the kit's own data routes, which would
 *  otherwise announce it) so an open page's live stream still picks it up. Optional: tests pass none. */
export type ChangeEmitter = (table: "groceries" | "carts", id: string, op: "insert" | "update" | "delete") => void;

export interface TimelineSettings {
  cookMorning: string;        // "07:30"
  cookEvening: string;        // "19:00": when dinner is cooked (cookTimeFor)
  deliveryLeadMin: number;    // 60
  earliestOrder: string;      // "06:30"
  preferredOrderTime: string; // "18:00" — the evening-before slot latestBuyAt reaches for first
  freshWindowDays: Record<string, number>;   // { dairy: 1, vegetables: 2, pantry: 7, spices: 14 }
}

// --- Local, naive date/time strings ("YYYY-MM-DD" and "YYYY-MM-DDTHH:MM") ------------------------------------------------
// The whole app already treats `date` as a local calendar date with no timezone (src/pages/shared.ts): these helpers do the
// same for a date+time, so arithmetic never double-converts across the machine's zone.
const pad = (n: number) => String(n).padStart(2, "0");
export const todayStr = (now = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const addDaysStr = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
export const dateTime = (date: string, time: string): string => `${date}T${time}`;
function toDate(dt: string): Date {
  const [date, time] = dt.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = (time ?? "00:00").slice(0, 5).split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}
function fromDate(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export const addMinutes = (dt: string, min: number): string => fromDate(new Date(toDate(dt).getTime() + min * 60_000));
export const dateOf = (dt: string): string => dt.slice(0, 10);

/** When the meal that needs an item is cooked: its own `time` when set, else dinner at cook.evening and
 *  breakfast/lunch at cook.morning (both cooked in the morning). Rows with no meal (staple/manual) use the morning. */
export function cookTimeFor(slot: string | null | undefined, time: string | null | undefined, s: Pick<TimelineSettings, "cookMorning" | "cookEvening">): string {
  if (time && /^\d{2}:\d{2}$/.test(time)) return time;
  return slot === "Dinner" ? s.cookEvening : s.cookMorning;
}

/**
 * When an item due by `neededBy` is bought: preferably the evening before, at `preferredOrderTime` (Zepto's own
 * evening deals, and the family's own habit) — but never later than `neededBy`'s own safe deadline, the cooking
 * time that uses it (`cookTime`, from cookTimeFor; the morning by default) minus the delivery lead, floored to
 * the morning's earliest order.
 *
 * `now`, when given, floors the result once the preferred evening slot has already slipped by (an item added, or
 * checked, after that moment) so a cart is never left dated in the past — it falls back to the safe deadline above,
 * itself floored to right now, or today's earliest-order cutoff if that is still ahead. Without this a stuck item
 * just respawns an already-dead cart every time the last one expires, forever (the exact loop this guards against).
 */
export function latestBuyAt(neededBy: string, s: TimelineSettings, now?: Date, cookTime = s.cookMorning): string {
  const cookAt = dateTime(neededBy, cookTime);
  const safeLatest = addMinutes(cookAt, -s.deliveryLeadMin);
  const sameDayFloor = dateTime(neededBy, s.earliestOrder);
  const latest = safeLatest < sameDayFloor ? sameDayFloor : safeLatest;

  const preferredAt = dateTime(addDaysStr(neededBy, -1), s.preferredOrderTime);
  const target = preferredAt < latest ? preferredAt : latest;
  if (!now) return target;

  const today = todayStr(now);
  const nowStamp = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (nowStamp <= target) return target;   // the preferred (or, failing that, the safe) slot is still ahead of us

  // The preferred evening slot already slipped by: fall back to ordering as soon as possible, same floor as before.
  const todayEarliest = dateTime(today, s.earliestOrder);
  const immediateFloor = nowStamp < todayEarliest ? todayEarliest : nowStamp;
  return latest < immediateFloor ? immediateFloor : latest;
}

export interface SchedulableItem { id: string; category: string; latestBuy: string; shelfLifeDays?: number | null }
export interface OrderGroup { buyAt: string; itemIds: string[]; categories: string[] }

/** Buckets one category's own items, greedily: an order takes the earliest item's deadline as its `buy_at` and
 *  absorbs every later item of the SAME category whose own deadline still falls within that category's fresh
 *  window of the order's `buy_at`. Kept separate per category so a wide window (pantry, 7 days) never reaches
 *  out and swallows an unrelated item from a narrow one (dairy, 1 day) just because it is sorted nearby. */
function bucketCategory(items: SchedulableItem[], windowDays: number): OrderGroup[] {
  const sorted = [...items].sort((a, b) => (a.latestBuy < b.latestBuy ? -1 : a.latestBuy > b.latestBuy ? 1 : 0));
  const groups: OrderGroup[] = [];
  let current: OrderGroup | null = null;
  for (const it of sorted) {
    // An item joins only while bought-at-buyAt still keeps until its own need (shelf_life_days: never buy too early).
    const days = it.shelfLifeDays ? Math.min(windowDays, it.shelfLifeDays) : windowDays;
    if (current && it.latestBuy <= addMinutes(current.buyAt, days * 24 * 60)) {
      current.itemIds.push(it.id); continue;
    }
    current = { buyAt: it.latestBuy, itemIds: [it.id], categories: [it.category] };
    groups.push(current);
  }
  return groups;
}

/** Each category is bucketed on its own fresh window (`bucketCategory`); orders from different categories that
 *  land on the very same calendar day are then merged into one (so a same-day dairy-and-veg run is one order,
 *  per the "groups items due on the same day" rule) — never merged just for falling within either side's window. */
export function bucketOrders(items: SchedulableItem[], freshWindowDays: Record<string, number>): OrderGroup[] {
  const byCategory = new Map<string, SchedulableItem[]>();
  for (const it of items) { const arr = byCategory.get(it.category) ?? []; arr.push(it); byCategory.set(it.category, arr); }

  const perCategory: OrderGroup[] = [];
  for (const [category, catItems] of byCategory) {
    // An unknown category gets the SHORTEST window — never pantry's week, which would buy fresh food days early.
    const windowDays = freshWindowDays[category] ?? Math.min(...Object.values(freshWindowDays), 7);
    perCategory.push(...bucketCategory(catItems, windowDays));
  }

  const byDay = new Map<string, OrderGroup>();
  const merged: OrderGroup[] = [];
  for (const g of perCategory.sort((a, b) => (a.buyAt < b.buyAt ? -1 : a.buyAt > b.buyAt ? 1 : 0))) {
    const day = dateOf(g.buyAt);
    const existing = byDay.get(day);
    if (existing) {
      existing.itemIds.push(...g.itemIds);
      existing.categories = [...new Set([...existing.categories, ...g.categories])];
      if (g.buyAt < existing.buyAt) existing.buyAt = g.buyAt;
    } else {
      const fresh: OrderGroup = { buyAt: g.buyAt, itemIds: [...g.itemIds], categories: [...g.categories] };
      byDay.set(day, fresh); merged.push(fresh);
    }
  }
  return merged.sort((a, b) => (a.buyAt < b.buyAt ? -1 : a.buyAt > b.buyAt ? 1 : 0));
}

export interface StapleCadence {
  id: string; item: string; category: string; every_min_days: number | null; every_max_days: number | null;
  last_ordered_at: string | null; last_checked_at: string | null; active: boolean | null;
}

/** The next date a staple is due: a pantry row on its 7-day check, anything else on its ordering cadence (the
 *  shorter of the two bounds, so dairy reorders promptly rather than waiting for the looser upper bound). Null
 *  when that date is further off than `horizonDate` — nothing to do about it yet. */
export function staplesDue(staples: StapleCadence[], horizonDate: string, now = new Date()): { staple: StapleCadence; due: string }[] {
  const today = todayStr(now);
  const out: { staple: StapleCadence; due: string }[] = [];
  for (const s of staples) {
    if (s.active === false) continue;
    if (s.category === "pantry") {
      const due = s.last_checked_at ? addDaysStr(dateOf(s.last_checked_at), 7) : today;   // never checked: due now
      if (due <= horizonDate) out.push({ staple: s, due });
      continue;
    }
    const cadence = s.every_min_days ?? s.every_max_days ?? 1;
    const due = s.last_ordered_at ? addDaysStr(dateOf(s.last_ordered_at), cadence) : today;   // never ordered: due now
    if (due <= horizonDate) out.push({ staple: s, due });
  }
  return out;
}

// --- Database orchestration -------------------------------------------------------------------------------------------
export interface SettingsReader { get<T = unknown>(key: string): T }

export function timelineSettingsFrom(settings: SettingsReader): TimelineSettings {
  return {
    cookMorning: settings.get<string>("cook.morning"),
    cookEvening: settings.get<string>("cook.evening"),
    deliveryLeadMin: settings.get<number>("buy.delivery_lead_min"),
    earliestOrder: settings.get<string>("buy.earliest_order"),
    preferredOrderTime: settings.get<string>("buy.preferred_order_time"),
    freshWindowDays: settings.get<Record<string, number>>("buy.fresh_window_days"),
  };
}

const AISLE_FOR: Record<string, string> = { dairy: "Dairy", vegetables: "Vegetables", pantry: "Staples", spices: "Spices" };
const OPEN_ROW = ["pending", "confirmed"];

interface CartState { id: string; status: string; buy_at: string; categories: string | null; yes_at: string | null; moved_at: string | null }
/** A draft the timeline still plans: no yes yet (a yes freezes it for the order) and not moved by the owner. */
export const isLiveDraft = (c: Pick<CartState, "status" | "yes_at" | "moved_at">): boolean => c.status === "draft" && !c.yes_at && !c.moved_at;

const cartStates = (db: BunSQLiteDatabase<any>) =>
  db.select({ id: carts.id, status: carts.status, buy_at: carts.buy_at, categories: carts.categories, yes_at: carts.yes_at, moved_at: carts.moved_at }).from(carts).all() as CartState[];

/** Creates a grocery row for any staple whose cadence is due within the plan horizon and that has no open row
 *  (pending or confirmed) already covering it — nor a row the family removed from a draft (skipped on a draft), so a
 *  dropped staple never comes straight back. Idempotent: safe to call on every tick.
 *
 *  A held-back-category staple (pantry, spices — HELD_BACK_CATEGORIES) never gets a row here, however due its
 *  own 7-day check is — the family's standing assumption is that a long-shelf-life item is already in stock,
 *  confirmed or not; only the pantry check-in surface (server/pantryCheck.ts, the app's own Pantry page) ever
 *  turns one into a real grocery row, by the family's own selection. Dairy/vegetables staples are unaffected:
 *  those keep auto-generating as before. */
export function ensureStapleGroceries(db: BunSQLiteDatabase<any>, s: TimelineSettings, horizonDays: number, now = new Date(), emit?: ChangeEmitter) {
  const horizonDate = addDaysStr(todayStr(now), horizonDays);
  const rows = (db.select().from(staples).all() as StapleCadence[]).filter((r) => !(HELD_BACK_CATEGORIES as readonly string[]).includes(r.category));
  const due = staplesDue(rows, horizonDate, now);
  if (!due.length) return;
  const drafts = new Set(cartStates(db).filter((c) => c.status === "draft").map((c) => c.id));
  const current = (db.select().from(groceries).where(inArray(groceries.status, [...OPEN_ROW, "skipped"])).all() as { item: string; source: string | null; status: string | null; cart_id: string | null }[])
    .filter((g) => g.status !== "skipped" || (!!g.cart_id && drafts.has(g.cart_id)));
  const keyOf = stapleKeyResolver(db);
  const covered = new Set(current.filter((g) => g.source === "staple").map((g) => keyOf(g.item)));
  for (const { staple, due: dueDate } of due) {
    const key = keyOf(staple.item);
    if (covered.has(key)) continue;
    const row = db.insert(groceries).values({
      item: staple.item, aisle: AISLE_FOR[staple.category] ?? "Staples", for_dish: null,
      category: staple.category, needed_by: dueDate, qty: null, source: "staple", status: "pending", updated_by: "app",
    }).returning().get() as { id: string };
    emit?.("groceries", row.id, "insert");
    covered.add(key);
  }
}

/** A staple's identity: the catalog ingredient its name (or one of that ingredient's aliases) resolves to, else
 *  its normalised name — so "Milk", "milk " and "doodh" are one staple, not three. */
export function stapleKeyResolver(db: BunSQLiteDatabase<any>): (item: string) => string {
  const byName = new Map<string, string>();
  for (const r of db.select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases }).from(ingredients).all() as { id: string; name: string; aliases: string | null }[]) {
    let aliases: unknown = [];
    try { aliases = JSON.parse(r.aliases ?? "[]"); } catch { /* malformed: name only */ }
    for (const n of [r.name, ...(Array.isArray(aliases) ? aliases : [])]) if (typeof n === "string") byName.set(normalizeIngredientName(n), r.id);
  }
  return (item) => { const k = normalizeIngredientName(item); return byName.get(k) ?? `name:${k}`; };
}

/** Recomputes the shopping timeline: schedules every open grocery row onto a draft (a `carts` row), batching by
 *  category fresh-window. Drafts stay live until a yes: every row on a live draft (isLiveDraft) is re-planned each
 *  pass, so the draft always says what the meals need right now. What the timeline leaves alone: rows on an order, on
 *  a draft with a yes, or on a draft the owner moved; and a row with no due date that was added to a live draft (it
 *  stays on that draft). A live draft keeps its identity while it can — same day first, else the draft already
 *  holding most of the group's rows — so its message budget follows it; once its window has opened its time no
 *  longer slides. A draft nothing points at any more (no open or removed line, no message asked for) is dropped. */
export function recalcTimeline(db: BunSQLiteDatabase<any>, settings: SettingsReader, horizonDays: number, now = new Date(), emit?: ChangeEmitter) {
  const s = timelineSettingsFrom(settings);
  ensureStapleGroceries(db, s, horizonDays, now, emit);

  const allCarts = cartStates(db);
  const liveDrafts = allCarts.filter(isLiveDraft);
  const liveIds = new Set(liveDrafts.map((c) => c.id));

  const open = db.select().from(groceries).where(inArray(groceries.status, OPEN_ROW)).all() as
    { id: string; category: string | null; needed_by: string | null; cart_id: string | null; in_stock_until: string | null; meal_id: string | null; ingredient_id: string | null }[];
  const mealById = new Map((db.select({ id: meals.id, slot: meals.slot, time: meals.time }).from(meals).all() as { id: string; slot: string; time: string | null }[]).map((m) => [m.id, m]));
  const shelfLife = new Map((db.select({ id: ingredients.id, d: ingredients.shelf_life_days }).from(ingredients).all() as { id: string; d: number | null }[]).map((r) => [r.id, r.d]));
  const today = todayStr(now);
  const nowStamp = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const snoozed = new Set(open.filter((r) => !!r.in_stock_until && r.in_stock_until! > today).map((r) => r.id));
  // Already have it: pull it off any draft it was on, so a now-empty draft can still be cleaned up below.
  const toDetach = open.filter((r) => snoozed.has(r.id) && r.cart_id).map((r) => r.id);
  if (toDetach.length) {
    db.update(groceries).set({ cart_id: null, buy_at: null, updated_by: "app" }).where(inArray(groceries.id, toDetach)).run();
    for (const id of toDetach) emit?.("groceries", id, "update");
  }
  const onLiveDraft = (r: { cart_id: string | null }) => !!r.cart_id && liveIds.has(r.cart_id);
  const movable = open.filter((r) => !snoozed.has(r.id) && (!r.cart_id || onLiveDraft(r)) && (!!r.needed_by || !r.cart_id));

  // A learned (or pinned) order window comfortably before the delivery deadline wins; without one, the settings rule.
  const windows = activeWindows(readWindows(db).windows);
  const scheduled = movable.filter((r) => !!r.needed_by).map((r) => {
    const meal = r.meal_id ? mealById.get(r.meal_id) : undefined;
    const cookTime = cookTimeFor(meal?.slot, meal?.time, s);
    const deadline = addMinutes(dateTime(r.needed_by!, cookTime), -s.deliveryLeadMin);
    return {
      id: r.id, category: r.category ?? "vegetables", shelfLifeDays: r.ingredient_id ? shelfLife.get(r.ingredient_id) : null,
      latestBuy: (windows.length ? planOrderAt(deadline, windows, now) : null) ?? latestBuyAt(r.needed_by!, s, now, cookTime),
    };
  });
  const unscheduled = movable.filter((r) => !r.needed_by);
  const cartOfRow = new Map(open.map((r) => [r.id, r.cart_id]));

  const groups = bucketOrders(scheduled, s.freshWindowDays);
  const cartIdByDate = new Map<string, { id: string; buyAt: string }>();
  const usedCartIds = new Set<string>();
  const pickDraft = (g: OrderGroup) => {
    const free = liveDrafts.filter((c) => !usedCartIds.has(c.id));
    const sameDay = free.find((c) => dateOf(c.buy_at) === dateOf(g.buyAt));
    if (sameDay) return sameDay;
    const held = (c: CartState) => g.itemIds.filter((id) => cartOfRow.get(id) === c.id).length;
    return free.filter((c) => held(c) > 0).sort((a, b) => held(b) - held(a))[0];
  };

  for (const g of groups) {
    const reuse = pickDraft(g);
    let cartId: string;
    let buyAt = g.buyAt;
    if (reuse) {
      cartId = reuse.id;
      // A window that has already opened (heads-up, price) keeps its time: an overdue item's ASAP slot never drags it on.
      if (reuse.buy_at <= nowStamp) buyAt = reuse.buy_at;
      const merged = [...new Set([...(reuse.categories ? JSON.parse(reuse.categories) as string[] : []), ...g.categories])];
      db.update(carts).set({ categories: JSON.stringify(merged), buy_at: buyAt, order_at: buyAt, updated_by: "app" }).where(eq(carts.id, cartId)).run();
      emit?.("carts", cartId, "update");
    } else {
      const row = db.insert(carts).values({ buy_at: buyAt, order_at: buyAt, categories: JSON.stringify(g.categories), status: "draft", created_at: now.toISOString(), updated_by: "app" }).returning().get() as { id: string };
      cartId = row.id; emit?.("carts", cartId, "insert");
    }
    usedCartIds.add(cartId);
    if (!cartIdByDate.has(dateOf(buyAt))) cartIdByDate.set(dateOf(buyAt), { id: cartId, buyAt });
    db.update(groceries).set({ buy_at: buyAt, cart_id: cartId, updated_by: "app" }).where(inArray(groceries.id, g.itemIds)).run();
    for (const id of g.itemIds) emit?.("groceries", id, "update");
  }

  if (unscheduled.length) {
    // No due date of its own and on no draft yet: it joins the earliest draft planned this pass, or starts a fallback one.
    const earliest = [...cartIdByDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1];
    const buyAt = earliest?.buyAt ?? dateTime(addDaysStr(today, 1), s.earliestOrder);
    const cartId = earliest?.id ?? (() => {
      const row = db.insert(carts).values({ buy_at: buyAt, order_at: buyAt, categories: JSON.stringify([...new Set(unscheduled.map((r) => r.category ?? "other"))]), status: "draft", created_at: now.toISOString(), updated_by: "app" }).returning().get() as { id: string };
      emit?.("carts", row.id, "insert");
      return row.id;
    })();
    usedCartIds.add(cartId);
    db.update(groceries).set({ buy_at: buyAt, cart_id: cartId, updated_by: "app" }).where(inArray(groceries.id, unscheduled.map((r) => r.id))).run();
    for (const r of unscheduled) emit?.("groceries", r.id, "update");
  }

  for (const c of allCarts) {
    if (c.status !== "draft" || usedCartIds.has(c.id)) continue;
    const holdsLines = !!db.select({ id: groceries.id }).from(groceries).where(and(eq(groceries.cart_id, c.id), inArray(groceries.status, [...OPEN_ROW, "skipped"]))).get();
    const messaged = !!db.select({ id: message_log.id }).from(message_log).where(eq(message_log.cart_id, c.id)).get();
    if (!holdsLines && !messaged) { db.delete(carts).where(eq(carts.id, c.id)).run(); emit?.("carts", c.id, "delete"); }
  }
}
