// Everyday items were once a list of their own (the `regulars` table: "milk, 1 l a day"). They are now each item's own cycle
// (items.stated_amount, items.stated_days; items.ts), so the house has one thing per item: what is bought and how often. The
// table stays in the schema, retired: nothing reads it after the move below (dropping a table with rows would stop an
// installed copy for the owner's approval, and Flock's catalogue generator still names it). What is left here: set_regular, the older operation, kept as another way to state an item's cycle (Flock's first conversation
// still names it), and the one-time move of an installed copy's rows into item cycles.
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { house, items } from "./db/schema";
import { EVERY } from "./db/constants";
import { todayStr, WEEKDAYS } from "./dates";
import { getHouse, list, name, refuse, weekdays, writeRoutes, type Db, type Emit } from "./family";
import { dateOf, flag } from "./meals";
import { positive, toBase } from "./products";
import { itemFor, recomputeItem } from "./items";

/** A cycle in days from "every day", "N times a week" or "on these weekdays". */
export function cycleDays(every: string, timesPerWeek: number | null | undefined, days: readonly string[]): number {
  return every === "day" ? 1 : every === "weekdays" ? 7 / Math.max(1, days.length) : 7 / Math.max(1, timesPerWeek ?? 1);
}
/** The group an item with no group takes from its cycle. */
const groupFor = (days: number): string => (days <= 2 ? "daily" : days <= 10 ? "few_days" : "monthly");

export function mountRegularRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { now?: () => Date } = {}) {
  const write = writeRoutes(hono);
  const today = () => todayStr((opts.now ?? (() => new Date()))());

  // set_regular { item, amount, unit, every: day | week | weekdays, times_per_week?, weekdays?, for_whom?, active?, paused_until?,
  // remove? }: the item's cycle as the family stated it, the same as set_item { item, usual_amount, unit, every_days }.
  // `paused_until` snoozes the item; `active: false` and `remove` take the stated cycle away. `for_whom` is not kept: an item
  // has one cycle for the house.
  write("/api/regulars", (b, by) => {
    const given = name(b.item, "item");
    const was = itemFor(db, given);
    const off = b.remove === true || (b.active !== undefined && !flag(b.active, "active"));
    if (off && !was) return { status: 404, body: { reason: `${given} is not an item the app knows` } };
    const set: Partial<typeof items.$inferInsert> = {};
    if (off) Object.assign(set, { stated_amount: null, stated_days: null });
    else {
      if (b.every != null) {
        if (!(EVERY as readonly unknown[]).includes(b.every)) refuse(`every must be one of: ${EVERY.join(", ")}`);
        const times = b.times_per_week == null ? null
          : typeof b.times_per_week === "number" && Number.isInteger(b.times_per_week) && b.times_per_week >= 1 && b.times_per_week <= 7 ? b.times_per_week
          : refuse("times_per_week must be a whole number from 1 to 7");
        const on = b.weekdays == null ? [] : weekdays(b.weekdays, "weekdays");
        if (b.every === "weekdays" && !on.length) refuse(`weekdays is required when every is weekdays: a list from ${WEEKDAYS.join(", ")}`);
        set.stated_days = cycleDays(b.every as string, times, on);
      } else if (was?.stated_days == null && b.paused_until === undefined) refuse(`every is required: one of ${EVERY.join(", ")}`);
      if (b.amount != null) {
        // An amount in a measure the app cannot add up ("1 pack") states how often only.
        const base = toBase(positive(b.amount, "amount")!, typeof b.unit === "string" ? b.unit : was?.unit);
        if (base && (!was?.unit || was.unit === base.unit)) Object.assign(set, { stated_amount: base.amount, unit: base.unit });
      }
      if (b.paused_until !== undefined) set.snoozed_until = b.paused_until === null ? null : dateOf(b.paused_until, "paused_until");
    }
    const row = db.transaction((tx) => {
      const t = tx as unknown as Db;
      const it = itemFor(t, given, { create: true })!;
      if (!it.group && set.stated_days != null) set.group = groupFor(set.stated_days);
      t.update(items).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(items.id, it.id)).run();
      return recomputeItem(t, it.id, today());
    });
    emit("items", row.id, was ? "update" : "insert", by);
    return { body: { item: row } };
  });
}

type OldRegular = { item: string; amount: number | null; unit: string | null; every: string; times_per_week: number | null; weekdays: string | null;
  active: number | null; paused_until: string | null };

/** At boot, once: the everyday items of an installed copy (the rows of the retired `regulars` table, left as they are) become item cycles.
 *  Each active one states its item's cycle: how much each time and how often; several of one item (the house's, one person's)
 *  add up. A cycle the item already has stands, a pause still running snoozes the item, and an item with no group takes one
 *  from its cycle. Rows that were switched off are left behind. "none": nothing in the table (or no table yet: a boot before the schema landed). */
export function moveRegulars(sqlite: Database, db: Db, now: Date = new Date()): "moved" | "none" | "already" {
  let rows: OldRegular[];
  try { rows = sqlite.query(`SELECT item, amount, unit, every, times_per_week, weekdays, active, paused_until FROM regulars`).all() as OldRegular[]; }
  catch { return "none"; }
  const home = getHouse(db);
  if (home.regulars_moved_at) return "already";
  const today = todayStr(now);
  db.transaction((txRaw) => {
    const tx = txRaw as unknown as Db;
    const byItem = new Map<string, OldRegular[]>();
    for (const r of rows) {
      const key = (r.item ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      if (key && r.active !== 0) byItem.set(key, [...(byItem.get(key) ?? []), r]);
    }
    for (const group of byItem.values()) {
      const it = itemFor(tx, group[0].item, { create: true })!;
      const each = group.map((r) => ({ days: cycleDays(r.every, r.times_per_week, list<string>(r.weekdays)), base: r.amount != null ? toBase(r.amount, r.unit ?? it.unit) : null }));
      const days = Math.min(...each.map((e) => e.days));
      const unit = it.unit ?? each.find((e) => e.base)?.base?.unit ?? null;
      // What all of them need over the shortest cycle, when every one has an amount the app can add up in the item's unit.
      const amount = unit && each.every((e) => e.base?.unit === unit) ? each.reduce((sum, e) => sum + e.base!.amount * (days / e.days), 0) : null;
      const paused = group.map((r) => r.paused_until).filter((d): d is string => !!d && d >= today).sort().pop() ?? null;
      const set: Partial<typeof items.$inferInsert> = {};
      if (it.stated_days == null) Object.assign(set, { stated_days: days, ...(amount != null && it.stated_amount == null ? { stated_amount: Math.round(amount * 1000) / 1000, unit } : {}) });
      if (!it.group) set.group = groupFor(days);
      if (paused && (!it.snoozed_until || it.snoozed_until < paused)) set.snoozed_until = paused;
      if (Object.keys(set).length) tx.update(items).set(set).where(eq(items.id, it.id)).run();
      recomputeItem(tx, it.id, today);
    }
    tx.update(house).set({ regulars_moved_at: now.toISOString() }).where(eq(house.id, home.id)).run();
  });
  return rows.length ? "moved" : "none";
}
