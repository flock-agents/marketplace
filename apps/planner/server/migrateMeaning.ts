// A saved install moved to the one meaning model (docs/2026-11-26-one-meaning-model-design.md §5.1–§5.3, §9.6, §11), once, at
// boot; the marker is house.meaning_model_at. The only place left that re-reads a family's saved words (the old category test),
// and only this once:
//   1. a meal with no templates and something of theirs (history or library rows) gets them read off its plates (deriveTemplates,
//      as the planner did each run before), saved;
//   2. a library row that is a category word (the old isCategoryName, or setup's own decision in setup_state.places) becomes the
//      words of each kind part of its meal's templates of that kind (and sub-kind when it named one); its days, how often and
//      words move onto each template holding that part; the row leaves the library. One no template holds is dropped, logged;
//   3. a kind part whose words name one bare dish (bareDish) gets that dish;
//   4. a rule with no targets gets them (targetsOf: each word resolved, with veg / egg / no_eggs's own); a hard swap its `gives`;
//   5. slots.kinds (retired) is cleared on every slot;
//   6. setup_state.places is left as it is.
import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { house, slots as slotsTable } from "./db/schema";
import { INSTEAD_STEP, SLOT_ORDER } from "./db/constants";
import { todayStr, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import { getHouse, type Db } from "./family";
import { bareDish, bareWord, catalogKind, checkMealShape, isItemsPart, isKindPart, matchDish, norm, regionalWordOf, type KindPart, type MealTemplate, type TemplatePart } from "./kinds";
import { isDropped, slotFacts } from "./planChecks";
import { mealOf as setupMealOf } from "./setup";
import { commit, listLibrary, listRules, listSlots, removeLibrary, slotHistory, updateRule, upsertSlot, type LibraryDish, type Slot, type SlotDay } from "./slotStore";
import { resolveGives, targetsOf } from "./targets";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameKind = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

// ── The old reads of a saved word (fillWeek.ts before the one meaning model), kept here for this one pass ──

type Place = { kind: string; sub: string | null };
/** A family dish's kind and sub-kind: as stored, else as its words match the catalog. */
function placeOf(row: Pick<LibraryDish, "kind" | "sub" | "catalog_item" | "name">): Place | null {
  const m = matchDish(row.catalog_item ?? row.name);
  if (row.kind) return { kind: row.kind, sub: row.sub ?? (m && sameKind(m.kind, row.kind) ? m.sub : null) };
  return m ? { kind: m.kind, sub: m.sub } : null;
}
/** A word that names a kind or sub-kind ("Dal", "Sabzi", "a poriyal"), not one dish. A staple's name is its dish. */
function isCategoryName(name: string): boolean {
  if (regionalWordOf(name)) return true;
  const m = matchDish(name);
  if (!m || m.by === "item") return false;
  return !catalogKind(m.kind)?.staple;
}
/** Where a family's category word sits: its kind, and its sub-kind when it named one. */
function categoryPlace(r: LibraryDish): Place | null {
  if (r.catalog_item || !isCategoryName(r.name)) return null;
  if (regionalWordOf(r.name)) { const k = r.kind ? catalogKind(r.kind) : null; return k && !k.staple ? { kind: k.name, sub: k.subs.length > 1 ? r.sub ?? null : null } : null; }
  const m = matchDish(r.name)!;
  const kind = r.kind && catalogKind(r.kind) ? r.kind : m.kind;
  const sub = m.by === "sub" ? m.sub : r.sub;
  return catalogKind(kind) && catalogKind(kind)!.subs.length > 1 ? { kind, sub: sub ?? null } : { kind, sub: null };
}
/** A library row the family has as their own: not disliked, not dropped, not a suggestion still untried. */
const familyRow = (r: LibraryDish) => !r.disliked && !isDropped(r) && (!r.suggested || !r.untried);

const MEAL_NAMES = ["breakfast", "lunch", "dinner", "tiffin", "snack"];
/** The catalog meal a slot is: its name, else by its place in the day (fillWeek.ts's). */
function mealOf(s: Slot, slots: Slot[]): string | null {
  const n = norm(s.name);
  if (MEAL_NAMES.includes(n)) return n;
  if (s.kind === "addon" && s.addon_of) { const m = slots.find((x) => same(x.name, s.addon_of!)); if (m && m !== s) return mealOf(m, slots); }
  if (s.kind === "custom") { const own = slots.find((m) => m.kind === "main" && m.order + INSTEAD_STEP === s.order); if (own && own !== s) return mealOf(own, slots); }
  if (s.kind === "custom") return s.order <= 20 ? "tiffin" : s.order <= 45 ? "snack" : "dinner";
  return s.order <= 10 ? "breakfast" : s.order <= 30 ? "lunch" : "dinner";
}

/** A meal set up before templates (or with none): its templates read off its seed and confirmed plates, a part per dish (its
 *  kind, with its sub-kind where the kind has several; a dish the catalog does not know is that dish, `items`); with no
 *  plates, one template per kind of its dishes; with no dishes either, a plain plate of its meal. */
export function deriveTemplates(s: Slot, plates: string[][], library: LibraryDish[], meal: string | null): MealTemplate[] {
  const rows = library.filter((r) => familyRow(r));
  const partOf = (name: string): TemplatePart => {
    const row = rows.find((r) => r.key === dishKey(name) && same(r.slot, s.name)) ?? rows.find((r) => r.key === dishKey(name));
    const pl = row ? placeOf(row) : (() => { const m = matchDish(name); return m ? { kind: m.kind, sub: m.sub } : null; })();
    if (!pl) return { items: [name.trim()] };
    const ck = catalogKind(pl.kind);
    if (!ck) return { kind: pl.kind };
    if (ck.staple) return { kind: ck.name };
    return ck.subs.length > 1 && pl.sub ? { kind: ck.name, sub: pl.sub } : { kind: ck.name };
  };
  const dedupe = (ts: MealTemplate[]) => ts.filter((t, i) => ts.findIndex((u) => JSON.stringify(u.parts) === JSON.stringify(t.parts)) === i);
  if (plates.length) return dedupe(plates.map((p) => ({ parts: p.map(partOf) })));
  const mine = rows.filter((r) => same(r.slot, s.name));
  if (s.kind === "addon") return mine.length ? [{ parts: [{ items: mine.map((r) => r.name) }] }] : [];
  if (mine.length) {
    const parts = mine.map((r) => partOf(r.name));
    const staple = uniq(parts.filter(isKindPart).filter((p) => catalogKind(p.kind)?.staple).map((p) => p.kind)).map((kind) => ({ kind }));
    const loose = parts.filter(isItemsPart).flatMap((p) => p.items);
    const kinds = uniq(parts.filter(isKindPart).filter((p) => !catalogKind(p.kind)?.staple).map((p) => p.kind));
    const ts: MealTemplate[] = kinds.map((kind) => ({ parts: [...staple, { kind }] }));
    if (loose.length) ts.push({ parts: [...staple, { items: loose }] });
    return ts.length ? ts : staple.length ? [{ parts: staple }] : [];
  }
  // Nothing of theirs (they said to suggest some): a plain plate of the meal.
  const k = (...xs: string[]): MealTemplate => ({ parts: xs.map((kind) => ({ kind })) });
  if (meal === "breakfast" || meal === "tiffin") return [k("Poha"), k("Upma"), k("Idli"), k("Paratha")];
  if (meal === "snack") return [k("Fruit"), k("Chaat"), k("Sundal")];
  return [k("Roti", "Dal", "Sabzi"), k("Rice", "Dal", "Sabzi")];
}

/** A plain plate of a meal (its catalog meal's usual shapes), for a meal the family knows none of their dishes for and said to
 *  suggest some (make_plan suggest_new): used for that plan only, never saved as theirs. An add-on has none. */
export function plainPlate(s: Slot, slots: Slot[]): MealTemplate[] {
  return deriveTemplates(s, [], [], mealOf(s, slots));
}

/** The migration's step 1 for one meal, at plan time (controller, Task 10): a meal with no templates (one added after setup)
 *  gets them read off its plates and dishes, once, and each of its dishes with no kind saved gets the kind (and sub-kind) the
 *  read gave it, so the fill (which never reads words) gives them their dish. The caller saves both. */
export function templatesFromDishes(s: Slot, slots: Slot[], library: LibraryDish[], history: SlotDay[]): { templates: MealTemplate[]; kinds: { row: LibraryDish; kind: string; sub: string | null }[] } {
  // Only what is theirs: their own dishes at the meal or their plates (seed, confirmed). The planner's suggestions are never
  // read into their templates, and with nothing of theirs there is none (never the derive's plain plate).
  const plates = slotFacts(s, library, history.filter((d) => !d.skip && d.dishes.length)).plates;
  if (!plates.length && !library.some((r) => same(r.slot, s.name) && familyRow(r))) return { templates: [], kinds: [] };
  const templates = deriveTemplates(s, plates, library, mealOf(s, slots));
  const kinds = library.filter((r) => same(r.slot, s.name) && !r.kind && familyRow(r)).flatMap((row) => {
    const pl = placeOf(row);
    return pl && catalogKind(pl.kind) ? [{ row, kind: catalogKind(pl.kind)!.name, sub: pl.sub }] : [];
  });
  return { templates, kinds };
}

// ── The migration ──

type SetupPlace = { kind?: string | null; sub?: string | null; item?: string | null; named?: string };

/** Setup's places (house.setup_state.places, by "<meal>|<dish key>"), read only. */
function setupPlaces(db: Db): Record<string, SetupPlace> {
  try { const s = JSON.parse(getHouse(db).setup_state ?? "{}"); return s && typeof s.places === "object" && s.places ? s.places : {}; } catch { return {}; }
}

/** Where a library row sits as a category word: the old isCategoryName's place, else setup's own "category" decision for it
 *  ("dry sabji": no catalog word, but setup read it as the Sabzi category). Null: a dish. */
function categoryOf(r: LibraryDish, slot: Slot | undefined, places: Record<string, SetupPlace>): Place | null {
  if (r.catalog_item) return null;
  const old = categoryPlace(r);
  if (old) return old;
  if (isCategoryName(r.name)) return null;   // a regional word setup never placed: no kind to hold it
  const p = slot ? places[`${setupMealOf(slot)}|${r.key}`] : undefined;
  const kind = p?.named === "category" && !p.item ? p.kind ?? r.kind : null;
  if (!kind || !catalogKind(kind) || catalogKind(kind)!.staple) return null;
  return { kind: catalogKind(kind)!.name, sub: catalogKind(kind)!.subs.length > 1 ? p?.sub ?? r.sub ?? null : null };
}
/** A row the old test or setup called a category, whatever its place. */
const isCategoryRow = (r: LibraryDish, slot: Slot | undefined, places: Record<string, SetupPlace>): boolean =>
  !r.catalog_item && (isCategoryName(r.name) || (!!slot && places[`${setupMealOf(slot)}|${r.key}`]?.named === "category" && !places[`${setupMealOf(slot)}|${r.key}`]?.item));

/** The part's kind word names one dish: its bare dish (spec §5.1: "dosa" → Plain dosa), else none. */
function bareOf(p: KindPart): string | null {
  if (!p.words || p.dish) return null;
  const m = matchDish(p.words);
  if (!m || m.by === "item" || !sameKind(m.kind, p.kind) || !bareWord(p.kind, p.words)) return null;   // H7: as setup reads it
  if (m.by === "sub" && p.sub && !sameKind(m.sub, p.sub)) return null;
  return bareDish(p.kind, m.by === "sub" ? m.sub : p.sub);
}

/** Move this house to the one meaning model, once. "none": nothing was saved the old way (still marked). */
export function migrateMeaning(sqlite: Database, db: Db, now: Date = new Date(), log: (line: string) => void = (l) => console.log(`[planner] ${l}`)): "migrated" | "none" | "already" {
  if (getHouse(db).meaning_model_at) return "already";
  const oldKinds = (sqlite.query(`SELECT COUNT(*) AS n FROM slots WHERE kinds IS NOT NULL`).get() as { n: number }).n;
  const today = todayStr(now);
  const by = "app";
  let moved = oldKinds > 0;
  // At boot no page is connected yet: nothing to tell, so the changes are not emitted.
  commit(db, () => {}, (tx, changes) => {
    const all = listSlots(tx, { all: true });
    const names = all.map((s) => s.name);
    const library = listLibrary(tx);
    const places = setupPlaces(tx);
    const templates = new Map<string, MealTemplate[] | null>(all.map((s) => [s.name, s.templates ? structuredClone(s.templates) : null]));

    // 1. A meal with no templates and something of theirs: read off its plates, once.
    for (const s of all) {
      if (s.templates !== null) continue;
      const history = slotHistory(tx, s.name, today).filter((d) => !d.skip && d.dishes.length);
      const mine = library.filter((r) => same(r.slot, s.name));
      if (!history.length && !mine.length) continue;
      const ts = deriveTemplates(s, slotFacts(s, library, history).plates, library, mealOf(s, all));
      templates.set(s.name, ts);
      log(`migrate: ${s.name}: templates read off its plates`);
    }

    // 2. Category rows become their parts' words. A row held by a template leaves the library only once that meal's templates
    //    are saved (below): a shape the store refuses keeps the row, so the family's word is never lost.
    const heldRows: { row: LibraryDish; slot: string; word: string }[] = [];
    for (const r of library) {
      const slot = all.find((s) => same(s.name, r.slot));
      if (!isCategoryRow(r, slot, places)) continue;
      const place = categoryOf(r, slot, places);
      const word = r.name.trim().toLowerCase();
      let held = false;
      for (const t of (slot && templates.get(slot.name)) ?? []) {
        const parts = t.parts.filter((p): p is KindPart => isKindPart(p) && !!place && sameKind(p.kind, place.kind) && (!place.sub || !p.sub || sameKind(p.sub, place.sub)));
        if (!parts.length) continue;
        held = true;
        for (const p of parts) if (!(p.words ?? "").split(" or ").includes(word)) p.words = p.words ? `${p.words} or ${word}` : word;
        if (r.days?.length) t.days = t.days?.length ? uniq([...t.days, ...r.days]) as Weekday[] : [...r.days];
        if (r.frequency && !t.share) t.share = r.frequency;
        if (r.said && !t.said) t.said = r.said;
      }
      if (held) { heldRows.push({ row: r, slot: slot!.name, word }); continue; }
      log(`migrate: ${slot?.name ?? r.slot}: ${word} held by no template, dropped`);
      removeLibrary(tx, r.name, r.slot, by, changes);
      moved = true;
    }

    // 3. A part whose words name one dish gets it.
    for (const ts of templates.values()) for (const t of ts ?? []) for (const p of t.parts) {
      if (!isKindPart(p)) continue;
      const dish = bareOf(p);
      if (dish) p.dish = dish;
    }

    // The templates saved: a meal's shape the store refuses is logged and left as it was.
    const saved = new Set<string>();
    for (const s of all) {
      const ts = templates.get(s.name) ?? null;
      if (JSON.stringify(ts) === JSON.stringify(s.templates)) { saved.add(s.name); continue; }
      const errs = checkMealShape(ts ?? [], { slot: s.name, slots: names });
      if (errs.length) { log(`migrate: ${s.name}: templates not saved: ${errs.join("; ")}`); continue; }
      upsertSlot(tx, { name: s.name, templates: ts }, by, changes);
      saved.add(s.name);
      moved = true;
    }
    for (const h of heldRows) {
      if (!saved.has(h.slot)) { log(`migrate: ${h.slot}: ${h.word} kept in the library: its templates were not saved`); continue; }
      removeLibrary(tx, h.row.name, h.row.slot, by, changes);
      moved = true;
    }

    // 4. Rules get their targets; a hard swap what it gives.
    for (const r of listRules(tx)) {
      const set: { targets?: typeof r.targets; gives?: typeof r.gives } = {};
      if (r.targets === null) set.targets = targetsOf(r);
      if (r.what === "swap" && r.hard && r.to && !r.gives) set.gives = resolveGives(r.to);
      if (!Object.keys(set).length) continue;
      updateRule(tx, r.id, set, by, changes);
      moved = true;
    }

    // 4b. A person's own custom slot sits one step after the meal it replaces (§5.4): the old rule took such a person off Lunch,
    //     so one not already there goes after Lunch (after Breakfast when its name says breakfast).
    const mainOrders = new Set<number>([SLOT_ORDER.Breakfast, SLOT_ORDER.Lunch, SLOT_ORDER.Dinner, ...all.filter((s) => s.kind === "main").map((s) => s.order)]);
    for (const s of all) {
      if (s.kind !== "custom" || !s.usual_people.length || [...mainOrders].some((o) => o + INSTEAD_STEP === s.order)) continue;
      const meal = /breakfast/i.test(s.name) ? "Breakfast" : "Lunch";
      const order = SLOT_ORDER[meal] + INSTEAD_STEP;
      upsertSlot(tx, { name: s.name, order }, by, changes);
      log(`migrate: ${s.name}: order ${s.order} → ${order} (replaces ${meal})`);
      moved = true;
    }

    // 5. The retired kinds column, cleared. 6. setup_state.places is not touched.
    tx.update(slotsTable).set({ kinds: null }).run();
    const h = getHouse(tx);
    tx.update(house).set({ meaning_model_at: now.toISOString() }).where(eq(house.id, h.id)).run();
  });
  return moved ? "migrated" : "none";
}
