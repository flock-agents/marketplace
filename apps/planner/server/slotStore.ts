// The slot model's data (docs/slot-model-spec.md §2): typed rows, small reads and writes of the slots, slot-days with their
// dishes and ingredients, the library and the rules, and the derived values of §2.2 (staples, looks like, recent) as pure
// functions. Setup (apply_setup), the plan (make_plan) and the later-change operations build on this module; nothing here
// asks a model or decides what a word means.
//
// Writes take a transaction (`tx`), who writes (`by`: "app", "agent:<id>", "user:<id>") and the list of changes to tell the
// pages once the transaction commits (`changes`, emitted by `commit`). Lists are JSON text in the rows and plain arrays here.
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { _settings } from "@flock/app-kit";
import { ingredients, library, rules, slot_days, slot_dishes, slots } from "./db/schema";
import { LOOKS_LIKE_MAX, SETTINGS, SLOT_ORDER, STAPLE_MIN_ROWS, STAPLE_SHARE, STAPLE_WINDOW,
  type Frequency, type LibraryOrigin, type RuleWhat, type Skip, type SlotDayStatus, type SlotKind } from "./db/constants";
import { addDays, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import type { Db, Emit } from "./family";

export type Change = Parameters<Emit>;

// ── Rows, as stored ──

export type SlotRow = typeof slots.$inferSelect;
export type SlotDayRow = typeof slot_days.$inferSelect;
export type SlotDishRow = typeof slot_dishes.$inferSelect;
export type IngredientRow = typeof ingredients.$inferSelect;
export type LibraryRow = typeof library.$inferSelect;
export type RuleRow = typeof rules.$inferSelect;

// ── Rows, as read: lists parsed, flags as booleans ──

export type SkipDay = { day: Weekday; skip: Skip };
export type Slot = { id: string; name: string; kind: SlotKind; addon_of: string | null; usual_people: string[]; days: Weekday[];
  skip_days: SkipDay[]; order: number; active: boolean };
export type Guest = { count: number; rules?: string[] };
export type Ingredient = { item: string; amount: number | null; unit: string | null };
export type SlotDish = { id: string; position: number; dish: string; new: boolean; feedback_asked: boolean; note: string | null; not_for: string[];
  ingredients: (Ingredient & { id: string })[] };
/** A slot on a date (`date` null: a setup seed example), with its dishes in order. */
export type SlotDay = { id: string; date: string | null; slot: string; people: string[]; guests: Guest[]; occasion: string | null;
  new_dishes_allowed: number | null; skip: Skip | null; status: SlotDayStatus; edited: boolean; note: string | null;
  dishes: SlotDish[]; created_at: string | null };
export type RatingEntry = { rating: string; note: string | null; date: string; by: string | null };
export type LibraryDish = { id: string; key: string; slot: string; name: string; frequency: Frequency | null; days: Weekday[] | null;
  contains: string[]; contains_read: string[]; origin: LibraryOrigin; suggested: boolean; untried: boolean; offers: number;
  disliked: boolean; prep: string | null; video_url: string | null; video_title: string | null; video_thumbnail: string | null;
  rating: string | null; rating_note: string | null; rated_on: string | null; rated_by: string | null; ratings: RatingEntry[] };
export type Rule = { id: string; hard: boolean; what: RuleWhat; who: string | null; slots: string[] | null; days: Weekday[] | null;
  items: string[] | null; to: string | null; frequency: Frequency | null; per_meal: number | null; fasting_food: string[] | null; quote: string };

// ── What a write takes: only the fields given change (an update), the rest take their defaults (an insert) ──

export type SlotInput = { name: string; kind?: SlotKind; addon_of?: string | null; usual_people?: string[]; days?: Weekday[];
  skip_days?: SkipDay[]; order?: number; active?: boolean };
export type SlotDishInput = { dish: string; new?: boolean; feedback_asked?: boolean; note?: string | null; not_for?: string[]; ingredients?: Ingredient[] };
/** `dishes` given: they replace the slot-day's dishes (and their ingredients). `date` null: a seed example, always a new row. */
export type SlotDayInput = { date: string | null; slot: string; people?: string[]; guests?: Guest[]; occasion?: string | null;
  new_dishes_allowed?: number | null; skip?: Skip | null; status?: SlotDayStatus; edited?: boolean; note?: string | null; dishes?: SlotDishInput[] };
export type LibraryInput = { name: string; slot: string; origin?: LibraryOrigin; frequency?: Frequency | null; days?: Weekday[] | null;
  contains?: string[]; contains_read?: string[]; suggested?: boolean; untried?: boolean; offers?: number; disliked?: boolean;
  prep?: string | null; video_url?: string | null; video_title?: string | null; video_thumbnail?: string | null };
export type RuleInput = Omit<Rule, "id" | "who" | "slots" | "days" | "items" | "to" | "frequency" | "per_meal" | "fasting_food"> &
  Partial<Pick<Rule, "who" | "slots" | "days" | "items" | "to" | "frequency" | "per_meal" | "fasting_food">>;

// ── JSON lists and flags ──

const arr = <T>(json: string | null | undefined): T[] => { try { const v = json ? JSON.parse(json) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
const arrOrNull = <T>(json: string | null | undefined): T[] | null => (json == null ? null : arr<T>(json));
const js = (v: unknown[] | null | undefined): string | null => (v == null ? null : JSON.stringify(v));
const bit = (v: boolean | undefined): number | undefined => (v === undefined ? undefined : v ? 1 : 0);
const now = () => new Date().toISOString();
/** The fields of `o` that are not undefined: an update changes only what was given. */
const given = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const slotOf = (r: SlotRow): Slot => ({ id: r.id, name: r.name, kind: r.kind as SlotKind, addon_of: r.addon_of, usual_people: arr(r.usual_people),
  days: arr(r.days), skip_days: arr(r.skip_days), order: r.order, active: r.active !== 0 });
export const libraryOf = (r: LibraryRow): LibraryDish => ({ id: r.id, key: r.key, slot: r.slot, name: r.name, frequency: (r.frequency as Frequency | null) ?? null,
  days: arrOrNull(r.days), contains: arr(r.contains), contains_read: arr(r.contains_read), origin: r.origin as LibraryOrigin, suggested: !!r.suggested,
  untried: !!r.untried, offers: r.offers ?? 0, disliked: !!r.disliked, prep: r.prep, video_url: r.video_url, video_title: r.video_title,
  video_thumbnail: r.video_thumbnail, rating: r.rating, rating_note: r.rating_note, rated_on: r.rated_on, rated_by: r.rated_by, ratings: arr(r.ratings) });
export const ruleOf = (r: RuleRow): Rule => ({ id: r.id, hard: !!r.hard, what: r.what as RuleWhat, who: r.who, slots: arrOrNull(r.slots), days: arrOrNull(r.days),
  items: arrOrNull(r.items), to: r.to, frequency: (r.frequency as Frequency | null) ?? null, per_meal: r.per_meal, fasting_food: arrOrNull(r.fasting_food), quote: r.quote });

/** Run a write in one transaction; the pages hear of its changes only once it is committed. */
export function commit<T>(db: Db, emit: Emit, run: (tx: Db, changes: Change[]) => T): T {
  const changes: Change[] = [];
  const out = db.transaction((tx) => run(tx as unknown as Db, changes));
  for (const c of changes) emit(...c);
  return out;
}

// ── Slots ──

/** The slots in planning order (then by name); only the active ones unless `all`. */
export function listSlots(db: Db, opts: { all?: boolean } = {}): Slot[] {
  return db.select().from(slots).orderBy(asc(slots.order), asc(slots.name)).all().map(slotOf).filter((s) => opts.all || s.active);
}
/** A slot by its name, whatever its capitals. */
export function getSlot(db: Db, name: string): Slot | null {
  return listSlots(db, { all: true }).find((s) => sameName(s.name, name)) ?? null;
}
/** Add a slot, or change the one of that name (whatever its capitals): only the fields given change. A new slot needs its
 *  kind and order. */
export function upsertSlot(tx: Db, s: SlotInput, by: string, changes: Change[]): Slot {
  const had = getSlot(tx, s.name);
  const set = given({ kind: s.kind, addon_of: s.addon_of, usual_people: s.usual_people && js(s.usual_people), days: s.days && js(s.days),
    skip_days: s.skip_days && js(s.skip_days), order: s.order, active: bit(s.active) });
  if (had) {
    const row = tx.update(slots).set({ ...set, updated_at: now(), updated_by: by }).where(eq(slots.id, had.id)).returning().get();
    changes.push(["slots", row.id, "update", by]);
    return slotOf(row);
  }
  if (!s.kind || s.order === undefined) throw new Error(`a new slot (${s.name}) needs its kind and order`);
  const row = tx.insert(slots).values({ usual_people: "[]", days: "[]", skip_days: "[]", ...set, kind: s.kind, order: s.order, name: s.name.trim(), updated_by: by }).returning().get();
  changes.push(["slots", row.id, "insert", by]);
  return slotOf(row);
}
/** Take a slot away: its row stays, inactive, so its past slot-days still read. False when there is no such slot. */
export function removeSlot(tx: Db, name: string, by: string, changes: Change[]): boolean {
  const had = getSlot(tx, name);
  if (!had) return false;
  upsertSlot(tx, { name: had.name, active: false }, by, changes);
  return true;
}

// ── Slot-days ──

function slotDaysOf(db: Db, rows: SlotDayRow[]): SlotDay[] {
  if (!rows.length) return [];
  const dishRows = db.select().from(slot_dishes).where(inArray(slot_dishes.slot_day_id, rows.map((r) => r.id)))
    .orderBy(asc(slot_dishes.position), asc(slot_dishes.created_at), sql`rowid`).all();
  const itemRows = dishRows.length
    ? db.select().from(ingredients).where(inArray(ingredients.slot_dish_id, dishRows.map((d) => d.id))).orderBy(asc(ingredients.created_at), sql`rowid`).all() : [];
  return rows.map((r) => ({
    id: r.id, date: r.date, slot: r.slot, people: arr(r.people), guests: arr(r.guests), occasion: r.occasion, new_dishes_allowed: r.new_dishes_allowed,
    skip: (r.skip as Skip | null) ?? null, status: r.status as SlotDayStatus, edited: !!r.edited, note: r.note, created_at: r.created_at,
    dishes: dishRows.filter((d) => d.slot_day_id === r.id).map((d, i) => ({ id: d.id, position: d.position ?? i, dish: d.dish, new: !!d.new,
      feedback_asked: !!d.feedback_asked, note: d.note, not_for: arr(d.not_for),
      ingredients: itemRows.filter((x) => x.slot_dish_id === d.id).map((x) => ({ id: x.id, item: x.item, amount: x.amount, unit: x.unit })) })),
  }));
}

/** Dated slot-days with their dishes, by date then planning order: `from`/`to` inclusive, one `slot` (by name, any capitals). */
export function listSlotDays(db: Db, q: { from?: string; to?: string; slot?: string } = {}): SlotDay[] {
  const where = [sql`${slot_days.date} IS NOT NULL`];
  if (q.from) where.push(gte(slot_days.date, q.from));
  if (q.to) where.push(lte(slot_days.date, q.to));
  if (q.slot) where.push(sql`lower(${slot_days.slot}) = ${q.slot.trim().toLowerCase()}`);
  // A slot with no row yet (a test's plan, a slot-day saved before its slot) ranks as the main slot of its name would.
  const order = new Map(listSlots(db, { all: true }).map((s) => [s.name.toLowerCase(), s.order]));
  const main: Record<string, number> = { breakfast: SLOT_ORDER.Breakfast, lunch: SLOT_ORDER.Lunch, dinner: SLOT_ORDER.Dinner };
  const rank = (s: string) => order.get(s.toLowerCase()) ?? main[s.toLowerCase()] ?? Number.MAX_SAFE_INTEGER;
  const rows = db.select().from(slot_days).where(and(...where)).all()
    .sort((a, b) => a.date!.localeCompare(b.date!) || rank(a.slot) - rank(b.slot) || a.slot.localeCompare(b.slot));
  return slotDaysOf(db, rows);
}
/** One slot-day by its date and slot. */
export function getSlotDay(db: Db, date: string, slot: string): SlotDay | null {
  return listSlotDays(db, { from: date, to: date, slot })[0] ?? null;
}
export function slotDayById(db: Db, id: string): SlotDay | null {
  return slotDaysOf(db, db.select().from(slot_days).where(eq(slot_days.id, id)).all())[0] ?? null;
}
/** The setup's seed examples (no date), oldest first; one slot's only when given. */
export function seedSlotDays(db: Db, slot?: string): SlotDay[] {
  const rows = db.select().from(slot_days).where(isNull(slot_days.date)).orderBy(asc(slot_days.created_at), sql`rowid`).all()
    .filter((r) => !slot || sameName(r.slot, slot));
  return slotDaysOf(db, rows);
}
/** Remove the setup's seed examples (no date), with their dishes; one slot's only when given. Answers how many went. */
export function deleteSeedSlotDays(tx: Db, by: string, changes: Change[], slot?: string): number {
  const gone = seedSlotDays(tx, slot);
  for (const d of gone) {
    replaceDishes(tx, d.id, [], by, changes);
    tx.delete(slot_days).where(eq(slot_days.id, d.id)).run();
    changes.push(["slot_days", d.id, "delete", by]);
  }
  return gone.length;
}
/** A slot's history (spec §2.2): its seed examples and its dated slot-days before `before`, of any status. */
export function slotHistory(db: Db, slot: string, before: string): SlotDay[] {
  return [...seedSlotDays(db, slot), ...listSlotDays(db, { to: addDays(before, -1), slot })];
}

function replaceDishes(tx: Db, slotDayId: string, dishes: SlotDishInput[], by: string, changes: Change[]): void {
  for (const d of tx.select({ id: slot_dishes.id }).from(slot_dishes).where(eq(slot_dishes.slot_day_id, slotDayId)).all()) {
    for (const i of tx.delete(ingredients).where(eq(ingredients.slot_dish_id, d.id)).returning().all()) changes.push(["dish_ingredients", i.id, "delete", by]);
    tx.delete(slot_dishes).where(eq(slot_dishes.id, d.id)).run();
    changes.push(["slot_dishes", d.id, "delete", by]);
  }
  dishes.forEach((d, position) => {
    const row = tx.insert(slot_dishes).values({ slot_day_id: slotDayId, position, dish: d.dish.trim(), new: bit(d.new) ?? 0, feedback_asked: bit(d.feedback_asked) ?? 0,
      note: d.note ?? null, not_for: d.not_for?.length ? js(d.not_for) : null, updated_by: by }).returning().get();
    changes.push(["slot_dishes", row.id, "insert", by]);
    setIngredients(tx, row.id, d.ingredients ?? [], by, changes);
  });
}
/** A planned dish's ingredients, in place of the ones it had. */
export function setIngredients(tx: Db, slotDishId: string, items: Ingredient[], by: string, changes: Change[]): void {
  for (const i of tx.delete(ingredients).where(eq(ingredients.slot_dish_id, slotDishId)).returning().all()) changes.push(["dish_ingredients", i.id, "delete", by]);
  for (const i of items) {
    const row = tx.insert(ingredients).values({ slot_dish_id: slotDishId, item: i.item, amount: i.amount ?? null, unit: i.unit ?? null, updated_by: by }).returning().get();
    changes.push(["dish_ingredients", row.id, "insert", by]);
  }
}
/** Save a slot-day: the one at that date and slot changes (only the fields given), else a new one is made (`planned` unless
 *  given). A seed example (date null) is always a new row, `confirmed` unless given. `dishes` replace its dishes. */
export function saveSlotDay(tx: Db, d: SlotDayInput, by: string, changes: Change[]): SlotDay {
  const had = d.date === null ? null : tx.select().from(slot_days).where(and(eq(slot_days.date, d.date), sql`lower(${slot_days.slot}) = ${d.slot.trim().toLowerCase()}`)).get();
  const set = given({ people: d.people && js(d.people), guests: d.guests && js(d.guests), occasion: d.occasion, new_dishes_allowed: d.new_dishes_allowed,
    skip: d.skip, status: d.status, edited: bit(d.edited), note: d.note });
  let id: string;
  if (had) {
    id = tx.update(slot_days).set({ ...set, updated_at: now(), updated_by: by }).where(eq(slot_days.id, had.id)).returning().get().id;
    changes.push(["slot_days", id, "update", by]);
  } else {
    id = tx.insert(slot_days).values({ people: "[]", guests: "[]", ...set, status: d.status ?? (d.date === null ? "confirmed" : "planned"), date: d.date,
      slot: d.slot.trim(), updated_by: by }).returning().get().id;
    changes.push(["slot_days", id, "insert", by]);
  }
  if (d.dishes) replaceDishes(tx, id, d.dishes, by, changes);
  return slotDayById(tx, id)!;
}
/** Remove slot-days with their dishes and ingredients: those dated `from`..`to`, all slots or one; `keepEdited` leaves the
 *  ones the family changed. Answers how many went. */
export function deleteSlotDays(tx: Db, q: { from: string; to: string; slot?: string; keepEdited?: boolean }, by: string, changes: Change[]): number {
  const gone = listSlotDays(tx, q).filter((d) => !(q.keepEdited && d.edited));
  for (const d of gone) {
    replaceDishes(tx, d.id, [], by, changes);
    tx.delete(slot_days).where(eq(slot_days.id, d.id)).run();
    changes.push(["slot_days", d.id, "delete", by]);
  }
  return gone.length;
}
/** One placed dish changed: its note, `new`, `feedback_asked`. */
export function updateSlotDish(tx: Db, id: string, set: { note?: string | null; new?: boolean; feedback_asked?: boolean }, by: string, changes: Change[]): void {
  tx.update(slot_dishes).set({ ...given({ note: set.note, new: bit(set.new), feedback_asked: bit(set.feedback_asked) }), updated_at: now(), updated_by: by })
    .where(eq(slot_dishes.id, id)).run();
  changes.push(["slot_dishes", id, "update", by]);
}

// ── Library ──

/** The library, by name; one slot's only, or only the rows of these dish names (any slot), when given. */
export function listLibrary(db: Db, q: { slot?: string; names?: string[] } = {}): LibraryDish[] {
  const keys = q.names ? [...new Set(q.names.map(dishKey))] : null;
  if (keys && !keys.length) return [];
  const rows = keys ? db.select().from(library).where(inArray(library.key, keys)).orderBy(asc(library.name)).all()
    : db.select().from(library).orderBy(asc(library.name), asc(library.slot)).all();
  return rows.map(libraryOf).filter((r) => !q.slot || sameName(r.slot, q.slot));
}
/** A dish's library row at a slot. */
export function getLibraryDish(db: Db, name: string, slot: string): LibraryDish | null {
  return listLibrary(db, { names: [name], slot })[0] ?? null;
}
/** Add a dish to the library at a slot, or change the one there (same key and slot): only the fields given change. A new
 *  one is `family_added` unless an origin is given. */
export function upsertLibrary(tx: Db, d: LibraryInput, by: string, changes: Change[]): LibraryDish {
  const had = getLibraryDish(tx, d.name, d.slot);
  const set = given({ origin: d.origin, frequency: d.frequency, days: d.days === undefined ? undefined : js(d.days),
    contains: d.contains && js(d.contains), contains_read: d.contains_read && js(d.contains_read), suggested: bit(d.suggested), untried: bit(d.untried),
    offers: d.offers, disliked: bit(d.disliked), prep: d.prep, video_url: d.video_url, video_title: d.video_title, video_thumbnail: d.video_thumbnail });
  if (had) {
    const row = tx.update(library).set({ ...set, updated_at: now(), updated_by: by }).where(eq(library.id, had.id)).returning().get();
    changes.push(["library", row.id, "update", by]);
    return libraryOf(row);
  }
  const row = tx.insert(library).values({ contains: "[]", contains_read: "[]", ...set, origin: d.origin ?? "family_added", key: dishKey(d.name), slot: d.slot.trim(),
    name: d.name.trim(), updated_by: by }).returning().get();
  changes.push(["library", row.id, "insert", by]);
  return libraryOf(row);
}
/** Change every row of a dish (all its slots) at once: its video and how it went belong to the dish, not to one slot. */
export function updateLibraryByName(tx: Db, name: string, set: Partial<Pick<LibraryRow, "video_url" | "video_title" | "video_thumbnail" | "rating" | "rating_note"
  | "rated_on" | "rated_by" | "ratings" | "untried" | "suggested" | "offers" | "disliked">>, by: string, changes: Change[]): LibraryDish[] {
  const rows = tx.update(library).set({ ...set, updated_at: now(), updated_by: by }).where(eq(library.key, dishKey(name))).returning().all();
  for (const r of rows) changes.push(["library", r.id, "update", by]);
  return rows.map(libraryOf);
}
/** Take a dish off the library at a slot. False when it was not there. */
export function removeLibrary(tx: Db, name: string, slot: string, by: string, changes: Change[]): boolean {
  const had = getLibraryDish(tx, name, slot);
  if (!had) return false;
  tx.delete(library).where(eq(library.id, had.id)).run();
  changes.push(["library", had.id, "delete", by]);
  return true;
}

// ── Rules ──

export function listRules(db: Db): Rule[] {
  return db.select().from(rules).orderBy(asc(rules.created_at), sql`rowid`).all().map(ruleOf);
}
const ruleCols = (r: Partial<RuleInput>) => given({ hard: bit(r.hard), what: r.what, who: r.who, slots: r.slots === undefined ? undefined : js(r.slots),
  days: r.days === undefined ? undefined : js(r.days), items: r.items === undefined ? undefined : js(r.items), to: r.to, frequency: r.frequency,
  per_meal: r.per_meal, fasting_food: r.fasting_food === undefined ? undefined : js(r.fasting_food), quote: r.quote });
export function addRule(tx: Db, r: RuleInput, by: string, changes: Change[]): Rule {
  const row = tx.insert(rules).values({ ...ruleCols(r), hard: r.hard ? 1 : 0, what: r.what, quote: r.quote, updated_by: by }).returning().get();
  changes.push(["rules", row.id, "insert", by]);
  return ruleOf(row);
}
/** Change a rule by its id: only the fields given. Null when there is no such rule. */
export function updateRule(tx: Db, id: string, r: Partial<RuleInput>, by: string, changes: Change[]): Rule | null {
  const row = tx.update(rules).set({ ...ruleCols(r), updated_at: now(), updated_by: by }).where(eq(rules.id, id)).returning().get();
  if (!row) return null;
  changes.push(["rules", row.id, "update", by]);
  return ruleOf(row);
}
export function removeRule(tx: Db, id: string, by: string, changes: Change[]): boolean {
  const row = tx.delete(rules).where(eq(rules.id, id)).returning().get();
  if (!row) return false;
  changes.push(["rules", row.id, "delete", by]);
  return true;
}

// ── Settings ──

/** How many new dishes a week may bring: the owner's setting, else its default (2). */
export function newDishesPerWeek(db: Db): number {
  const def = SETTINGS.find((s) => s.key === "new_dishes_per_week")!.default as number;
  try {
    const row = db.select({ value: _settings.value }).from(_settings).where(eq(_settings.key, "new_dishes_per_week")).get();
    const v = row?.value ? JSON.parse(row.value) : def;
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : def;
  } catch { return def; }
}

// ── Derived, not stored (spec §2.2): pure, over a slot's history rows ──

/** What the derived values read of a slot-day. */
export type HistoryRow = { date: string | null; status: SlotDayStatus; skip?: Skip | null; dishes: { dish: string }[] };

const hasDishes = (r: HistoryRow) => !r.skip && r.dishes.length > 0;
/** Newest first; the seed examples (no date) are the oldest. */
const newestFirst = (rows: HistoryRow[]): HistoryRow[] => {
  const dated = rows.filter((r) => r.date !== null).sort((a, b) => b.date!.localeCompare(a.date!));
  return [...dated, ...rows.filter((r) => r.date === null)];
};

/** A slot's staples: the dishes in at least `share` (60%) of its last `window` (14) history rows with dishes, the seed
 *  examples counting. A dish counts once a row. Named as most recently written, most frequent first. Staples are exempt from
 *  the repeat window. `rows`: one slot's history (slotHistory), any status. */
export function staples(rows: HistoryRow[], opts: { share?: number; window?: number; minRows?: number } = {}): string[] {
  const last = newestFirst(rows).filter(hasDishes).slice(0, opts.window ?? STAPLE_WINDOW);
  if (!last.length || last.length < (opts.minRows ?? STAPLE_MIN_ROWS)) return [];
  const seen = new Map<string, { name: string; n: number }>();
  for (const r of last) for (const k of new Set(r.dishes.map((d) => dishKey(d.dish)))) {
    const had = seen.get(k);
    if (had) had.n++; else seen.set(k, { name: r.dishes.find((d) => dishKey(d.dish) === k)!.dish.trim(), n: 1 });
  }
  const need = (opts.share ?? STAPLE_SHARE) * last.length;
  return [...seen.values()].filter((d) => d.n >= need - 1e-9).sort((a, b) => b.n - a.n).map((d) => d.name);
}

/** The rows a slot's plates are shaped like: at most `max` (6), from the seed and confirmed slot-days only (a planned one is
 *  what the family was shown, not what they ate), the most recent confirmed first, then the seed in its order. */
export function looksLikeRows(rows: HistoryRow[], max = LOOKS_LIKE_MAX): HistoryRow[] {
  const confirmed = rows.filter((r) => r.date !== null && r.status === "confirmed" && hasDishes(r)).sort((a, b) => b.date!.localeCompare(a.date!));
  const seed = rows.filter((r) => r.date === null && hasDishes(r));
  return [...confirmed, ...seed].slice(0, max);
}
/** The same as lines: "Rice, Sambar, Beans poriyal, Curd". */
export function looksLike(rows: HistoryRow[], max = LOOKS_LIKE_MAX): string[] {
  return looksLikeRows(rows, max).map((r) => r.dishes.map((d) => d.dish.trim()).join(", "));
}

/** What was on the slot in the `days` days before `from`, by date, planned or confirmed alike (repeat avoidance avoids
 *  repeating what the family was shown). A skipped slot-day and the seed are left out. */
export function recent(rows: HistoryRow[], from: string, days: number): Record<string, string[]> {
  const start = addDays(from, -days), out: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.date === null || r.date < start || r.date >= from || !hasDishes(r)) continue;
    (out[r.date] ??= []).push(...r.dishes.map((d) => d.dish.trim()));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
