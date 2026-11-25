// The week filled by code from the meals' templates (docs/kinds-model-build.md, owner rules 1–8): for each slot-day a
// template is chosen (shares first, a pinned dish's day the template that holds it, the rest spread evenly, never the same
// one two days running when there is another), and each of its parts is filled with an item:
//   - a staple part: the family's usual item of that kind, every time;
//   - a part of a kind (or one sub-kind): the family's items of it, least recently had first, shared across the meals, no
//     item again until every one of theirs has come, never the next day nor at two meals of a day, never twice on a plate,
//     kept to their own words (how often, which days); only when none of theirs fits, a brand-new variant from the catalog
//     (suggestable: of that kind, within the family's cuisines), while at least OWN_SHARE of the week's non-staple items stay
//     their own; else one of theirs comes back (the one had longest ago, never the next day);
//   - a part of the family's own dishes ({items}) or a kind only they have: their dishes only, rotated.
// Food rules: an item someone at the table may not eat is passed over while another fits; when none does, it stays with
// `not_for` them and they get their own item for that part. Nobody at a meal is left with nothing. Onion and garlic are a
// note, never a block (planChecks.onionNotes). Pure and deterministic: no database, no model, ties broken by date and slot.
import { CATALOG, catalogContains, catalogKind, matchDish, norm, suggestable, suggestMeals, type CatalogItem, type MealKind, type MealTemplate,
  type TemplatePart } from "./kinds";
import { TEMPLATE_DAYS } from "./db/constants";
import { addDays, weekdayOf } from "./dates";
import { dishKey } from "./dishText";
import { isAllergyRule } from "./allergy";
import { canonTag, carefulTags, factsOf, forbidden, frequencyRange, guestForbids, guestsCan, isDropped, isStapleAt, mainFeeds, notFor, onionNotes, ownAddon,
  readFor, slotFacts, withParents, OWN_SHARE, type DishFacts, type Week } from "./planChecks";
import { ruleHolds, slotDayKey, type PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

/** One dish on a filled plate. `new`: a brand-new variant (the family never had it). */
export type FilledDish = { name: string; new: boolean; not_for: string[]; note: string | null };
/** A brand-new variant placed: on which slot-day, its kind and catalog item, and the family's item of that kind it stands in for. */
export type PlacedNew = { dish: string; date: string; slot: string; kind: string; sub: string | null; like: string | null };
export type FillInput = {
  /** The week's slot-days; a fixed one (or a skipped one) is kept as it is and read for what was had. */
  days: PlanDay[];
  slots: Slot[];
  library: LibraryDish[];
  /** Each slot's history (slotHistory: its seed plates and the slot-days before the week), by slot name in lower case. */
  history: Map<string, HistoryRow[]>;
  rules: Rule[];
  /** The house's cuisine profile: regional items only within it. */
  cuisines?: readonly string[] | null;
  /** The family's new-dishes-a-week setting, when they set it; null: no cap but OWN_SHARE. */
  newCap?: number | null;
  /** What dishes contain, read this run (by dish key). */
  facts?: Map<string, DishFacts>;
  /** The careful allergy read so far (by dish key). */
  careful?: Map<string, Set<string>>;
  /** No careful read is to come: a variant not read carefully is not safe for an allergy. Not strict: the catalog's
   *  contents stand in until the read (the variants that leaned on it are answered in `provisional`). */
  strict?: boolean;
  guestTags?: Map<string, string[]>;
};
export type FillResult = {
  /** Each planned slot-day's plate, by slotDayKey. */ plates: Map<string, FilledDish[]>;
  placed: PlacedNew[];
  /** The catalog's items of a category the family named, placed (theirs, not new): to be kept in their library. */ named: PlacedNew[];
  unmet: string[]; log: string[];
  /** Variants placed where an allergy holds, safe only by the catalog's contents so far: to be read carefully. */ provisional: string[];
  /** Each slot's templates and kinds as planned (read off its seed plates when it had none). */ templates: Map<string, MealTemplate[]>; kinds: Map<string, MealKind[]>;
  /** What the dishes checked contain (the run's reads with the catalog's), by dish key: the notes and the ingredients read it. */ facts: Map<string, DishFacts>;
  /** The catalog's items of the categories the family named (theirs), by dish key. */ ownItems?: Set<string>;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// ── Staples held in a dish's name ──

/** The words for one staple, as a family says it on a plate. */
const STAPLE_WORDS: Record<string, string[]> = {
  rice: ["rice", "chawal", "chaval", "bhaat", "bhat", "annam", "sadam", "saadam"],
  roti: ["roti", "rotis", "chapati", "chapatis", "chapathi", "phulka", "phulkas", "fulka", "poli", "rotli"],
  curd: ["curd", "dahi", "yogurt", "thayir", "mosaru"],
};
const wordsOf = (x: string) => norm(x).split(" ").filter(Boolean);
/** The staple a plain staple's name is ("Rice", "Steamed rice", "Phulka"), or null for a dish. */
function stapleWord(name: string): string | null {
  const ws = wordsOf(name).filter((w) => w !== "plain" && w !== "steamed");
  if (ws.length !== 1) return null;
  return Object.keys(STAPLE_WORDS).find((k) => STAPLE_WORDS[k].includes(ws[0])) ?? null;
}
/** Does a dish's name hold that staple ("rasam rice", "kadhi chawal", "curd rice"), being more than the staple itself. */
const holdsStaple = (name: string, base: string): boolean => { const ws = wordsOf(name); return ws.length > 1 && ws.some((w) => STAPLE_WORDS[base].includes(w)); };

// ── Items ──

type Place = { kind: string; sub: string | null };
/** A candidate for a part: a family item (a library row) or a catalog variant. */
type Item = { name: string; key: string; kind: string; sub: string | null; family: boolean; idx: number; row?: LibraryDish; cuisine?: number;
  /** A catalog item (of a category the family named, when `family`). */ catalog?: boolean;
  /** The days a category the family kept to days allows its items on ("pongal on Sundays"). */ days?: string[] | null };

/** A family dish's kind and sub-kind: as stored, else as its words match the catalog. */
export function placeOf(row: Pick<LibraryDish, "kind" | "sub" | "catalog_item" | "name">): Place | null {
  const m = matchDish(row.catalog_item ?? row.name);
  if (row.kind) return { kind: row.kind, sub: row.sub ?? (m && sameKind(m.kind, row.kind) ? m.sub : null) };
  return m ? { kind: m.kind, sub: m.sub } : null;
}
/** The catalog item a family dish is, when its words name one. */
export const catalogNameOf = (row: Pick<LibraryDish, "catalog_item" | "name">): string | null => {
  if (row.catalog_item) return row.catalog_item;
  const m = matchDish(row.name);
  return m?.by === "item" ? m.item : null;
};
/** A family's word that names a kind or sub-kind ("Dal", "Sabzi", "Sambar", "a poriyal"), not one dish: never placed as
 *  it is. The catalog's items of it are the family's own (lead's rule, 25 Nov). A staple's name ("Rice", "Roti") is its dish. */
export function isCategoryName(name: string): boolean {
  const m = matchDish(name);
  if (!m || m.by === "item") return false;
  return !catalogKind(m.kind)?.staple;
}
/** Where a family's category word sits: its kind, and its sub-kind when it named one. */
function categoryPlace(r: LibraryDish): Place | null {
  if (r.catalog_item || !isCategoryName(r.name)) return null;
  const m = matchDish(r.name)!;
  const kind = r.kind && catalogKind(r.kind) ? r.kind : m.kind;
  const sub = m.by === "sub" ? m.sub : r.sub;
  return catalogKind(kind) && catalogKind(kind)!.subs.length > 1 ? { kind, sub: sub ?? null } : { kind, sub: null };
}
/** A library row the family has as their own: not disliked, not dropped, not a suggestion still untried. */
const familyRow = (r: LibraryDish) => !r.disliked && !isDropped(r) && (!r.suggested || !r.untried);
const sameKind = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);

/** The catalog's tags for an item, as the planner's: seafood is fish, and each tag with its parents. All of the catalog's
 *  tags are read. */
const asPlanner = (t: string) => (t === "seafood" ? "fish" : canonTag(t));
export const CATALOG_READ = withParents([...CATALOG.tags, ...Object.values(CATALOG.parents), "meat", "red_meat", "nuts"].map(asPlanner));
function catalogFacts(item: string): DishFacts | null {
  const c = catalogContains(item);
  return c ? { tags: withParents(c.map(asPlanner)), read: new Set(CATALOG_READ) } : null;
}

// ── A meal's shape ──

const MEAL_NAMES = ["breakfast", "lunch", "dinner", "tiffin", "snack"];
/** The catalog meal a slot is (where a new item may be suggested): its name, else by its place in the day. */
function mealOf(s: Slot, slots: Slot[]): string | null {
  const n = norm(s.name);
  if (MEAL_NAMES.includes(n)) return n;
  if (s.kind === "addon" && s.addon_of) { const m = slots.find((x) => same(x.name, s.addon_of!)); if (m && m !== s) return mealOf(m, slots); }
  if (s.kind === "custom") return s.order <= 20 ? "tiffin" : s.order <= 45 ? "snack" : "dinner";
  return s.order <= 10 ? "breakfast" : s.order <= 30 ? "lunch" : "dinner";
}

/** The kinds a set of templates names. */
function kindsOf(templates: MealTemplate[], own: Set<string>): MealKind[] {
  const out = new Map<string, MealKind>();
  for (const t of templates) for (const p of t.parts) {
    if ("items" in p) continue;
    const k = out.get(norm(p.kind)) ?? { name: p.kind, ...(catalogKind(p.kind)?.staple ? { staple: true } : {}), ...(own.has(norm(p.kind)) || !catalogKind(p.kind) ? { own: true } : {}) };
    if (p.sub) k.subs = uniq([...(k.subs ?? []), p.sub]);
    out.set(norm(p.kind), k);
  }
  return [...out.values()];
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
    const staple = uniq(parts.filter((p) => "kind" in p && catalogKind(p.kind)?.staple).map((p) => (p as { kind: string }).kind)).map((kind) => ({ kind }));
    const loose = parts.filter((p) => "items" in p).flatMap((p) => (p as { items: string[] }).items);
    const kinds = uniq(parts.filter((p) => "kind" in p && !catalogKind(p.kind)?.staple).map((p) => (p as { kind: string }).kind));
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

/** How many of `n` days each template has: a share in the family's words exactly ("2/week") or as its words' days (a part
 *  week its share of them); the days left spread evenly over the templates with none. */
export function templateCounts(templates: MealTemplate[], n: number): number[] {
  const want = templates.map((t) => {
    const s = t.share;
    if (!s) return null;
    if (s in TEMPLATE_DAYS) { const v = TEMPLATE_DAYS[s as keyof typeof TEMPLATE_DAYS]; return s === "daily" ? n : Math.min(n, Math.round((v * n) / 7)); }
    const x = Number.parseInt(s, 10);
    return Number.isFinite(x) ? Math.min(n, x) : null;
  });
  const out = want.map((x) => x ?? 0);
  let sum = out.reduce((a, b) => a + b, 0);
  while (sum > n) { const i = out.indexOf(Math.max(...out)); out[i]--; sum--; }
  const free = want.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
  const spread = free.length ? free : templates.map((_, i) => i);
  for (let j = 0; sum < n; j++, sum++) out[spread[j % spread.length]]++;
  return out;
}

// ── The fill ──

export function fillWeek(input: FillInput): FillResult {
  const { library, rules } = input;
  const cuisines = new Set((input.cuisines ?? []).map(norm));
  const res: FillResult = { plates: new Map(), placed: [], named: [], unmet: [], log: [], provisional: [], templates: new Map(), kinds: new Map(), facts: new Map() };
  const slotByKey = new Map(input.slots.map((s) => [s.name.toLowerCase(), s]));

  // Each slot's shape: its own templates, else read off its plates.
  const shaped = input.slots.map((s): Slot => {
    const history = input.history.get(s.name.toLowerCase()) ?? [];
    const plates = slotFacts(s, library, history).plates;
    const own = new Set((s.kinds ?? []).filter((k) => k.own).map((k) => norm(k.name)));
    const templates = s.templates?.length ? s.templates : deriveTemplates(s, plates, library, mealOf(s, input.slots));
    const kinds = s.kinds?.length ? s.kinds : kindsOf(templates, own);
    if (!s.templates?.length) res.log.push(`${s.name}: templates read off its plates: ${templates.map((t) => `[${t.parts.map((p) => ("items" in p ? p.items.join("/") : p.sub ?? p.kind)).join(", ")}]`).join(" ")}`);
    res.templates.set(s.name.toLowerCase(), templates);
    res.kinds.set(s.name.toLowerCase(), kinds);
    return { ...s, kinds, templates };
  });
  const shapeOf = (slot: string) => shaped.find((s) => same(s.name, slot))!;

  // The week as planChecks reads it.
  const days = input.days.map((d) => ({ ...d, dishes: d.fixed ? [...d.dishes] : [] }));
  const w: Week = { days, slots: new Map(), rules, library, facts: new Map(input.facts ?? []), done: new Set(), newDishes: new Map(),
    ...(input.guestTags ? { guestTags: input.guestTags } : {}) };
  for (const s of shaped) w.slots.set(s.name.toLowerCase(), slotFacts(s, library, input.history.get(s.name.toLowerCase()) ?? []));
  const allergyTags = uniq(rules.filter(isAllergyRule).flatMap(forbidden));
  if (allergyTags.length) w.careful = new Map(input.careful ?? []);
  const provisional = new Set<string>();

  /** What a dish contains, made ready before it is checked: a library dish's own read, its catalog item's for what that read
   *  left out, a variant's from the catalog; and, until the careful read, a variant's allergy tags from the catalog. */
  const prepared = new Set<string>();
  const prep = (name: string) => {
    const key = dishKey(name);
    if (prepared.has(key)) return;
    prepared.add(key);
    const row = library.find((r) => r.key === key);
    const catName = catalogNameOf(row ?? { catalog_item: null, name });
    const cat = catName ? catalogFacts(catName) : null;
    if (cat) {
      const base = w.facts.get(key) ?? (row ? { tags: withParents(row.contains), read: new Set(row.contains_read.map(canonTag)) } : null);
      w.facts.set(key, base ? { tags: new Set([...base.tags, ...[...cat.tags].filter((t) => !readFor(base.read, t))]), read: new Set([...base.read, ...cat.read]) } : cat);
    }
    if (w.careful && !w.careful.has(key) && !input.strict && cat && carefulTags(w, name).length) {
      w.careful.set(key, new Set([...cat.tags].filter((t) => allergyTags.includes(t))));
      provisional.add(key);
    }
  };
  const dayOf = (d: PlanDay) => days.find((x) => x.date === d.date && same(x.slot, d.slot))!;
  const excluded = (d: PlanDay, who: string[], name: string) => { prep(name); return notFor(w, { ...dayOf(d), people: who }, name); };

  // ── What was had: this week's fixed days and the history, for the rotation ──
  const usedDates = new Map<string, Set<string>>();          // key → dates this week
  const atSlotDay = new Map<string, Set<string>>();          // date|slot → keys
  const lastUsed = new Map<string, string>();                // key → latest date, then the order placed ("2026-12-01#0007")
  let seq = 0;
  const use = (date: string, slot: string, name: string) => {
    const k = dishKey(name);
    usedDates.set(k, (usedDates.get(k) ?? new Set()).add(date));
    const sk = slotDayKey(date, slot);
    atSlotDay.set(sk, (atSlotDay.get(sk) ?? new Set()).add(k));
    const at = `${date}#${String(seq++).padStart(5, "0")}`;
    if ((lastUsed.get(k) ?? "") < at) lastUsed.set(k, at);
  };
  const planned = days.filter((d) => !d.fixed && !d.skip);
  const firstDate = planned.map((d) => d.date).sort()[0] ?? days[0]?.date ?? "";
  for (const [, rows] of input.history) for (const r of rows) if (r.date && r.date < firstDate && !r.skip) for (const x of r.dishes) {
    const k = dishKey(x.dish);
    if ((lastUsed.get(k) ?? "") < r.date) lastUsed.set(k, r.date);
    const sk = slotDayKey(r.date, "?");
    atSlotDay.set(sk, (atSlotDay.get(sk) ?? new Set()).add(k));
  }
  for (const d of days.filter((x) => x.fixed && !x.skip)) for (const x of d.dishes) use(d.date, d.slot, x);
  /** The keys had on a date at any slot (the history's too). */
  const hadOn = (date: string, but?: string) => {
    const out = new Set<string>();
    for (const [sk, ks] of atSlotDay) if (sk.startsWith(`${date}|`) && sk !== (but ? slotDayKey(date, but) : "")) for (const k of ks) out.add(k);
    return out;
  };

  // ── Pools ──
  const rowAt = (slot: string, key: string) => library.find((r) => r.key === key && same(r.slot, slot)) ?? library.find((r) => r.key === key);
  const famRows = library.filter(familyRow);
  /** The catalog items the family's own dishes are (never offered to them as new). */
  const familyCatalog = new Set(library.flatMap((r) => { const m = catalogNameOf(r); return m ? [norm(m)] : []; }));
  const noAgain = new Set(library.filter((r) => r.disliked || isDropped(r)).map((r) => r.key));
  /** The kinds and sub-kinds the family named as a category ("dal", "a poriyal"): their catalog items are the family's. */
  const categories = famRows.map(categoryPlace).filter((x): x is Place => !!x);
  /** Is a catalog item of a kind within a category the family named. */
  /** The days a family's category item may come on: where every category word of theirs that holds it is kept to days
   *  ("pongal on Sundays"), those days; else any day. */
  const catDays = (kind: string, sub: string | null): string[] | null => {
    const rows = famRows.filter((r) => { const c = categoryPlace(r); return !!c && sameKind(c.kind, kind) && (!c.sub || sameKind(c.sub, sub)); });
    return rows.length && rows.every((r) => r.days?.length) ? uniq(rows.flatMap((r) => r.days ?? [])) : null;
  };
  /** The family's category words at a slot that hold an item of this kind and sub-kind. */
  const catRowsAt = (slot: string, kind: string, sub: string | null) =>
    famRows.filter((r) => { if (!same(r.slot, slot)) return false; const c = categoryPlace(r); return !!c && sameKind(c.kind, kind) && (!c.sub || sameKind(c.sub, sub)); });
  /** The dates a category's items were placed at a slot, by slot|category key. */
  const catUse = new Map<string, Set<string>>();
  const named = (kind: string, sub: string | null) => categories.some((c) => sameKind(c.kind, kind) && (!c.sub || sameKind(c.sub, sub)));
  w.ownItems = new Set(CATALOG.kinds.flatMap((k) => (k.staple ? [] : k.items.filter((it) => named(k.name, it.sub ?? null)).map((it) => dishKey(it.name)))));
  /** The catalog's items of a kind (one sub-kind when given) for this family at this meal: regional only within their
   *  cuisines; their sub-kinds (`prefer`) first, then their cuisines, then everyday ones; never one of their dishes, nor one
   *  they disliked or dropped. Ties rotate with the week. */
  const catalogPool = (s: Slot, kind: string, sub: string | null, prefer: string[], family: boolean): Item[] => {
    const ck = catalogKind(kind);
    if (!ck || ck.staple) return [];
    const meal = mealOf(s, input.slots);
    let items: CatalogItem[] = suggestable(ck.name, { sub, cuisines: [...cuisines] });
    // The catalog's meals decide only what the family left general (decided 18, 19).
    if (meal && !family && suggestMeals({ kind: ck.name, sub }).includes(meal)) items = items.filter((it) => suggestMeals({ kind: ck.name, item: it.name }).includes(meal));
    items = items.filter((it) => !familyCatalog.has(norm(it.name)) && !noAgain.has(dishKey(it.name)) && !famRows.some((r) => r.key === dishKey(it.name))
      && named(ck.name, it.sub) === family);
    const off = items.length ? hash(`${firstDate}|${ck.name}|${sub ?? ""}`) % items.length : 0;
    return items.map((it, i) => ({ name: it.name, key: dishKey(it.name), kind: ck.name, sub: it.sub, family, catalog: true, idx: (i - off + items.length) % items.length,
      // The family's cuisines first, then an everyday item of no one cuisine, then another cuisine's.
      cuisine: (it.cuisines ?? []).some((c) => cuisines.has(norm(c))) ? 2 : (it.cuisines ?? []).length ? 0 : 1 }))
      .sort((a, b) => Number(prefer.some((p) => sameKind(p, b.sub))) - Number(prefer.some((p) => sameKind(p, a.sub))) || (b.cuisine ?? 0) - (a.cuisine ?? 0) || a.idx - b.idx)
      .map((x, i) => ({ ...x, idx: i }));
  };
  /** The family's items of a kind (one sub-kind when given), their own sub-kinds of it first; then the catalog's items of the
   *  kinds and sub-kinds they named as a category. */
  const familyPool = (s: Slot, kind: string, sub: string | null, prefer: string[] = []): Item[] => {
    const slot = s.name;
    const seen = new Set<string>(), out: Item[] = [];
    const rows = [...famRows.filter((r) => same(r.slot, slot)), ...famRows.filter((r) => !same(r.slot, slot))];
    for (const r of rows) {
      if (seen.has(r.key) || isCategoryName(r.name)) continue;
      const pl = placeOf(r);
      if (!pl || !sameKind(pl.kind, kind) || (sub && !sameKind(pl.sub, sub))) continue;
      seen.add(r.key);
      out.push({ name: r.name, key: r.key, kind, sub: pl.sub, family: true, idx: out.length, row: r });
    }
    const theirs = prefer.length ? [...out.filter((x) => prefer.some((p) => sameKind(p, x.sub))), ...out.filter((x) => !prefer.some((p) => sameKind(p, x.sub)))] : out;
    const cat = categories.some((c) => sameKind(c.kind, kind)) ? catalogPool(s, kind, sub, uniq([...prefer, ...categories.filter((c) => sameKind(c.kind, kind) && c.sub).map((c) => c.sub!)]), true) : [];
    return [...theirs, ...cat.filter((x) => !seen.has(x.key)).map((x) => ({ ...x, days: catDays(x.kind, x.sub) }))].map((x, i) => ({ ...x, idx: i }));
  };
  /** The brand-new variants of a kind (one sub-kind when given): the catalog's items outside what the family named; never a
   *  staple's or an own kind's. */
  const newPool = (s: Slot, kind: string, sub: string | null, prefer: string[] = []): Item[] => {
    const mk = (s.kinds ?? []).find((k) => sameKind(k.name, kind));
    return mk?.own || mk?.staple ? [] : catalogPool(s, kind, sub, prefer, false);
  };
  /** The family's usual item of a staple kind at a slot: their dish of it had most at this slot, else any of theirs, else the
   *  name on their plates, else the catalog's first. */
  const stapleOf = (s: Slot, kind: string): string => {
    const rows = famRows.filter((r) => sameKind(placeOf(r)?.kind, kind));
    const hist = input.history.get(s.name.toLowerCase()) ?? [];
    const count = (k: string) => hist.filter((h) => h.dishes.some((x) => dishKey(x.dish) === k)).length;
    const here = rows.filter((r) => same(r.slot, s.name)).sort((a, b) => count(b.key) - count(a.key));
    if (here.length) return here[0].name;
    if (rows.length) return rows[0].name;
    const onPlate = hist.flatMap((h) => h.dishes.map((x) => x.dish)).find((x) => sameKind(matchDish(x)?.kind, kind));
    return onPlate ?? catalogKind(kind)?.items[0]?.name ?? kind;
  };

  const isStaplePart = (s: Slot, p: TemplatePart) => "kind" in p && (!!(s.kinds ?? []).find((k) => sameKind(k.name, p.kind))?.staple || !!catalogKind(p.kind)?.staple);
  /** A non-staple part's candidates: the family's items of it, and the brand-new variants (of the family's own sub-kinds first:
   *  the meal's, else those of their items). */
  const poolsOf = (s: Slot, p: TemplatePart) => {
    const kind = "items" in p ? null : p.kind;
    const sub = "items" in p ? null : p.sub ?? null;
    const mk = kind ? (s.kinds ?? []).find((x) => sameKind(x.name, kind)) : undefined;
    const fam: Item[] = "items" in p
      ? p.items.map((n, i) => { const r = rowAt(s.name, dishKey(n)); const pl = r ? placeOf(r) : null; return { name: n.trim(), key: dishKey(n), kind: pl?.kind ?? n, sub: pl?.sub ?? null, family: true, idx: i, row: r }; })
      : familyPool(s, kind!, sub, sub ? [] : mk?.subs ?? []);
    const neu: Item[] = "items" in p || mk?.own ? [] : newPool(s, kind!, sub, sub ? [] : mk?.subs?.length ? mk.subs : uniq(fam.map((x) => x.sub).filter((x): x is string => !!x)));
    return { kind, sub, fam, neu };
  };

  // ── Templates for each slot's days ──
  const tplOf = new Map<string, number>();   // slotDayKey → template index
  const pinsOf = new Map<string, LibraryDish[]>();
  const holds = (t: MealTemplate, r: LibraryDish) => t.parts.some((p) => ("items" in p ? p.items.some((x) => dishKey(x) === r.key)
    : sameKind(p.kind, placeOf(r)?.kind) && (!p.sub || sameKind(p.sub, placeOf(r)?.sub))));
  for (const s of shaped) {
    const ts = s.templates ?? [];
    const mine = planned.filter((d) => same(d.slot, s.name)).sort((a, b) => a.date.localeCompare(b.date));
    if (!ts.length || !mine.length) continue;
    // A template made for a pinned dish ("pongal on Sundays": its part has only their dishes kept to days) comes only on
    // those days; the week's other days are spread over the rest.
    const pinnedOnly = ts.map((t) => t.parts.some((p) => {
      if (isStaplePart(s, p)) return false;
      const { fam } = poolsOf(s, p);
      return fam.length > 0 && fam.every((x) => (x.catalog ? !!x.days?.length : !!x.row?.days?.length));
    }));
    const free = ts.map((_, i) => i).filter((i) => !pinnedOnly[i]);
    const left = free.length && free.length < ts.length
      ? (() => { const c = templateCounts(free.map((i) => ts[i]), mine.length), out = ts.map(() => 0); free.forEach((i, j) => { out[i] = c[j]; }); return out; })()
      : templateCounts(ts, mine.length);
    const weight = [...left];
    // A pinned dish's day takes the template that holds it.
    for (const d of mine) {
      const kept = famRows.filter((r) => same(r.slot, s.name) && r.days?.includes(weekdayOf(d.date)));
      // A category word kept to a day ("pongal on Sundays") chooses the day's template; an item of it fills the part.
      const pins = kept.filter((r) => !isCategoryName(r.name));
      if (!kept.length) continue;
      if (pins.length) pinsOf.set(slotDayKey(d.date, s.name), pins);
      const i = ts.findIndex((t) => holds(t, pins[0] ?? kept[0]));
      if (i < 0) continue;
      tplOf.set(slotDayKey(d.date, s.name), i);
      if (left[i] > 0) left[i]--;
      else { const j = left.indexOf(Math.max(...left)); if (left[j] > 0) left[j]--; }
    }
    // The rest spread evenly (a smooth weighted round), never the same template two days running when another is left.
    const cur = ts.map(() => 0);
    const tplAt = (date: string) => tplOf.get(slotDayKey(date, s.name));
    for (const d of mine) {
      const k = slotDayKey(d.date, s.name);
      if (tplOf.has(k)) continue;
      const cand = ts.map((_, i) => i).filter((i) => left[i] > 0);
      if (!cand.length) { tplOf.set(k, 0); continue; }
      for (const i of cand) cur[i] += weight[i];
      const total = cand.reduce((n, i) => n + weight[i], 0);
      const ranked = [...cand].sort((a, b) => cur[b] - cur[a] || a - b);
      const near = new Set([tplAt(addDays(d.date, -1)), tplAt(addDays(d.date, 1))]);
      const pick = ranked.find((i) => !near.has(i)) ?? ranked[0];
      cur[pick] -= total;
      left[pick]--;
      tplOf.set(k, pick);
    }
  }

  // OWN_SHARE: the week's non-staple places, of which at most the rest are new.
  let places = 0;
  for (const d of planned) {
    const s = shapeOf(d.slot), i = tplOf.get(slotDayKey(d.date, d.slot));
    if (i !== undefined) places += s.templates![i].parts.filter((p) => !isStaplePart(s, p)).length;
  }
  const newMax = Math.floor(places * (1 - OWN_SHARE));
  let newCount = 0;
  const distinctNew = new Set<string>();
  const newOnDay = new Map<string, number>();

  // ── Choosing an item ──
  type Opts = { repeat: boolean; next: boolean; zero: boolean };
  type Step = { items: Item[]; isNew: boolean; share: boolean } & Opts;
  // Another item before a `not_for` (contract rule 6): every step where everyone can eat it first, then those where someone
  // cannot (they get their own item for that part); a brand-new variant past OWN_SHARE, and one of theirs again on the next
  // day, last.
  const stepsFor = (fam: Item[], neu: Item[]): Step[] => [
    { items: fam, isNew: false, share: false, repeat: false, next: false, zero: true },
    { items: neu, isNew: true, share: true, repeat: false, next: false, zero: true },
    { items: fam, isNew: false, share: false, repeat: true, next: false, zero: true },
    { items: fam, isNew: false, share: false, repeat: false, next: false, zero: false },
    { items: neu, isNew: true, share: true, repeat: false, next: false, zero: false },
    { items: fam, isNew: false, share: false, repeat: true, next: false, zero: false },
    { items: neu, isNew: true, share: false, repeat: false, next: false, zero: false },
    { items: fam, isNew: false, share: false, repeat: true, next: true, zero: false },
  ];
  type Plate = { name: string; key: string; part: number; staple: boolean; isNew: boolean; kind: string | null; sub: string | null }[];
  const newAllowed = (d: PlanDay, share: boolean, feeding: boolean) => {
    if (d.new_dishes_allowed === 0) return false;
    if (d.new_dishes_allowed != null && (newOnDay.get(slotDayKey(d.date, d.slot)) ?? 0) >= d.new_dishes_allowed) return false;
    if (feeding) return true;
    if (input.newCap != null && distinctNew.size >= input.newCap) return false;
    return !share || newCount < newMax;
  };
  /** May an item go on this plate today: not on it already, within the family's own words for it (its days, how often), not
   *  at another meal today, not yesterday (unless `next`), not had this week (unless `repeat`). */
  const fits = (s: Slot, d: PlanDay, plate: Plate, it: Item, o: Opts, loose = false): boolean => {
    if (plate.some((x) => x.key === it.key)) return false;
    if (noAgain.has(it.key)) return false;
    const row = it.family ? rowAt(s.name, it.key) : undefined;
    if (row?.days?.length && !row.days.includes(weekdayOf(d.date))) return false;
    if (!row && it.days?.length && !it.days.includes(weekdayOf(d.date))) return false;
    // A category the family said how often of at this meal ("dal sometimes"): its items together, that often there.
    if (!row && it.catalog && it.family) for (const c of catRowsAt(s.name, it.kind, it.sub)) {
      const r = c.frequency && c.frequency !== "daily" ? frequencyRange(c.frequency) : null;
      if (r && [...(catUse.get(`${s.name.toLowerCase()}|${c.key}`) ?? [])].filter((x) => x !== d.date).length >= r[1]) return false;
    }
    const range = row && row.frequency !== "daily" ? frequencyRange(row.frequency) : null;
    const usedOther = [...(usedDates.get(it.key) ?? [])].filter((x) => x !== d.date);
    if (!loose && range && usedOther.length >= range[1]) return false;
    if (loose) return true;
    if (s.kind !== "addon" && hadOn(d.date, s.name).has(it.key)) return false;
    if (!o.next && hadOn(addDays(d.date, -1)).has(it.key)) return false;
    if (!o.repeat && usedDates.get(it.key)?.size) return false;
    if (o.next && s.kind === "addon" && (row?.frequency || row?.days?.length) && hadOn(addDays(d.date, -1)).has(it.key)) return false;
    return true;
  };
  /** The best item of the steps for `who` (the slot-day's people, or one person being fed). */
  const choose = (s: Slot, d: PlanDay, plate: Plate, steps: Step[], who: string[], feeding: boolean, must?: (name: string) => boolean): { it: Item; ex: string[] } | null => {
    const samePart = (it: Item) => plate.filter((x) => sameKind(x.kind, it.kind) && !x.staple);
    for (const st of steps) {
      if (!st.items.length || (st.isNew && !newAllowed(d, st.share, feeding))) continue;
      const ok = st.items.filter((it) => fits(s, d, plate, it, st) && (!must || must(it.name)))
        .map((it) => ({ it, ex: excluded(d, who, it.name) }))
        .filter((x) => (st.zero ? !x.ex.length : !who.length || x.ex.length < who.length));
      if (!ok.length) continue;
      ok.sort((a, b) => a.ex.length - b.ex.length
        || Number(samePart(a.it).some((x) => sameKind(x.sub, a.it.sub))) - Number(samePart(b.it).some((x) => sameKind(x.sub, b.it.sub)))
        || (usedDates.get(a.it.key)?.size ?? 0) - (usedDates.get(b.it.key)?.size ?? 0)
        || (lastUsed.get(a.it.key) ?? "").localeCompare(lastUsed.get(b.it.key) ?? "") || a.it.idx - b.it.idx);
      return ok[0];
    }
    return null;
  };
  /** The family's item of the kind a new variant stands in for: of its sub-kind first, the one had most recently. */
  const likeOf = (s: Slot, it: Item): string | null => {
    const fam = familyPool(s, it.kind, null);
    const best = [...fam].sort((a, b) => Number(sameKind(b.sub, it.sub)) - Number(sameKind(a.sub, it.sub)) || (lastUsed.get(b.key) ?? "").localeCompare(lastUsed.get(a.key) ?? "") || a.idx - b.idx)[0];
    return best?.name ?? null;
  };
  const put = (s: Slot, d: PlanDay, plate: Plate, it: Item, part: number, staple: boolean) => {
    if (it.catalog && it.family) for (const c of catRowsAt(s.name, it.kind, it.sub)) { const k = `${s.name.toLowerCase()}|${c.key}`; catUse.set(k, (catUse.get(k) ?? new Set()).add(d.date)); }
    plate.push({ name: it.name, key: it.key, part, staple, isNew: !it.family, kind: it.kind, sub: it.sub });
    use(d.date, s.name, it.name);
    dayOf(d).dishes.push(it.name);
    if (it.family && it.catalog && !res.named.some((x) => dishKey(x.dish) === it.key)) res.named.push({ dish: it.name, date: d.date, slot: s.name, kind: it.kind, sub: it.sub, like: null });
    if (!it.family) {
      newCount++;
      distinctNew.add(it.key);
      newOnDay.set(slotDayKey(d.date, d.slot), (newOnDay.get(slotDayKey(d.date, d.slot)) ?? 0) + 1);
      res.placed.push({ dish: it.name, date: d.date, slot: s.name, kind: it.kind, sub: it.sub, like: likeOf(s, it) });
    }
  };
  const label = (d: PlanDay) => `${weekdayOf(d.date)} ${d.slot}`;
  /** The non-staple kinds of a slot, for a person's own item from another part. */
  const otherKinds = (s: Slot, but: string | null) => (s.kinds ?? []).filter((k) => !k.staple && !catalogKind(k.name)?.staple && !sameKind(k.name, but));
  /** A person (or the guests: `must`) fed where the plate has nothing for them: their own item for the part, else one of
   *  another part of this meal, else any dish of theirs here, else a plain dal or sabzi. */
  const feed = (s: Slot, d: PlanDay, plate: Plate, who: string[], part: number, fam: Item[], neu: Item[], kind: string | null, must?: (name: string) => boolean): boolean => {
    const tries: Step[][] = [stepsFor(fam, neu)];
    for (const k of otherKinds(s, kind)) tries.push(stepsFor(familyPool(s, k.name, null), []));
    const here: Item[] = famRows.filter((r) => same(r.slot, s.name) && !isCategoryName(r.name) && !isStapleAt(w, s.name, r.name))
      .map((r, i) => ({ name: r.name, key: r.key, kind: placeOf(r)?.kind ?? r.name, sub: placeOf(r)?.sub ?? null, family: true, idx: i, row: r }));
    tries.push(stepsFor(here, []));
    for (const k of otherKinds(s, kind)) tries.push(stepsFor([], newPool(s, k.name, null)));
    // A plain dal or sabzi only at lunch or dinner (never a new kind at breakfast or in a tiffin).
    if (["lunch", "dinner"].includes(mealOf(s, input.slots) ?? "")) for (const k of ["Dal", "Sabzi"]) tries.push(stepsFor([], newPool({ ...s, kinds: [] }, k, null)));
    for (const steps of tries) {
      const got = choose(s, d, plate, steps, who, true, must);
      if (got) { put(s, d, plate, got.it, part, false); return true; }
    }
    return false;
  };

  // ── Day by day, the meals in their order ──
  const order = (d: PlanDay) => slotByKey.get(d.slot.toLowerCase())?.order ?? 99;
  const todo = [...planned].sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b) || a.slot.localeCompare(b.slot));
  for (const d of todo) {
    const s = shapeOf(d.slot);
    const k = slotDayKey(d.date, s.name);
    let ti = tplOf.get(k);
    const plate: Plate = [];
    const people = d.people;
    // The people fed at their own add-on that day are not fed here.
    const atTable = s.kind === "addon" ? people : people.filter((p) => !ownAddon(w, dayOf(d), p));
    if (ti === undefined) { res.plates.set(k, []); continue; }
    // A template that cannot be filled that day (fish on a day the house keeps vegetarian, a breakfast whose items are all
    // kept from someone), or only with an item had yesterday, gives way to another of the meal's: the one had least this
    // week, never yesterday's when another fits. A plate is never left bare of what its template promised.
    const can = (i: number, fresh: boolean) => s.templates![i].parts.every((p) => isStaplePart(s, p) || (() => {
      const { fam, neu, kind, sub } = poolsOf(s, p);
      if ((pinsOf.get(k) ?? []).some((r) => fam.some((x) => x.key === r.key) || (!!kind && sameKind(placeOf(r)?.kind, kind) && (!sub || sameKind(placeOf(r)?.sub, sub))))) return true;
      return !!choose(s, d, [], stepsFor(fam, neu).filter((st) => !fresh || !st.next), atTable, false);
    })());
    if (!can(ti, true)) {
      const had = (i: number) => planned.filter((x) => same(x.slot, s.name) && x.date < d.date && tplOf.get(slotDayKey(x.date, s.name)) === i).length;
      const yesterday = tplOf.get(slotDayKey(addDays(d.date, -1), s.name));
      const others = s.templates!.map((_, i) => i).filter((i) => i !== ti)
        .sort((a, b) => Number(a === yesterday) - Number(b === yesterday) || had(a) - had(b) || a - b);
      const other = others.find((i) => can(i, true)) ?? (can(ti, false) ? undefined : others.find((i) => can(i, false)));
      if (other !== undefined) { res.log.push(`${label(d)}: template ${ti + 1} cannot be filled that day without a repeat; template ${other + 1} instead`); ti = other; tplOf.set(k, ti); }
    }
    const t = s.templates![ti];
    const pins = [...(pinsOf.get(k) ?? [])];
    t.parts.forEach((p, part) => {
      // A staple: their usual item, every time; a person who may not eat it gets another of its kind.
      if (isStaplePart(s, p)) {
        const kind = (p as { kind: string }).kind;
        const name = stapleOf(s, kind);
        const it: Item = { name, key: dishKey(name), kind, sub: null, family: true, idx: 0 };
        if (plate.some((x) => x.key === it.key)) return;
        put(s, d, plate, it, part, true);
        for (const who of excluded(d, atTable, name)) {
          if (plate.some((x) => x.part === part && x.key !== it.key && !excluded(d, [who], x.name).length)) continue;
          const alts: Item[] = uniq([...famRows.filter((r) => sameKind(placeOf(r)?.kind, kind)).map((r) => r.name), ...(catalogKind(kind)?.items ?? []).map((i) => i.name)])
            .map((n, i) => ({ name: n, key: dishKey(n), kind, sub: null, family: true, idx: i }));
          const got = choose(s, d, plate, [{ items: alts, isNew: false, share: false, repeat: true, next: true, zero: true }], [who], true);
          if (got) put(s, d, plate, got.it, part, true);
        }
        return;
      }
      const { kind, sub, fam, neu } = poolsOf(s, p);
      // A pinned dish of this part, on its day.
      const pin = pins.find((r) => fam.some((x) => x.key === r.key) || ("items" in p ? false : sameKind(placeOf(r)?.kind, kind) && (!sub || sameKind(placeOf(r)?.sub, sub))));
      let got: { it: Item; ex: string[] } | null = null;
      if (pin) {
        pins.splice(pins.indexOf(pin), 1);
        const it: Item = fam.find((x) => x.key === pin.key) ?? { name: pin.name, key: pin.key, kind: kind ?? pin.name, sub: placeOf(pin)?.sub ?? null, family: true, idx: 0, row: pin };
        if (!plate.some((x) => x.key === it.key)) got = { it, ex: excluded(d, atTable, it.name) };
      }
      got ??= choose(s, d, plate, stepsFor(fam, neu), atTable, false);
      if (!got) {
        if (s.kind !== "addon") res.unmet.push(`${label(d)}: nothing for its ${sub ?? kind ?? "own dish"}`);
        return;
      }
      if (got.it.family && usedDates.get(got.it.key)?.has(addDays(d.date, -1)) && s.kind !== "addon" && !pin) res.unmet.push(`${label(d)}: ${got.it.name} comes back sooner than usual`);
      put(s, d, plate, got.it, part, false);
      // Their own item for this part, for each person the item is not for.
      for (const who of got.ex) {
        if (!atTable.includes(who)) continue;
        if (plate.some((x) => x.part === part && !excluded(d, [who], x.name).length)) continue;
        feed(s, d, plate, [who], part, fam, neu, kind);
      }
    });
    // A pinned dish no template part holds: on the plate beside.
    for (const pin of pins) if (!plate.some((x) => x.key === pin.key)) put(s, d, plate, { name: pin.name, key: pin.key, kind: placeOf(pin)?.kind ?? pin.name, sub: null, family: true, idx: 0, row: pin }, t.parts.length, false);
    // A dish the family has every day (or usually) at this meal comes on its days whatever the template (class 2): the dish
    // itself, or for a category they named ("eggs every morning") an item of it, rotated but never held back by rotation.
    const mineDays = planned.filter((x) => same(x.slot, s.name)).map((x) => x.date).sort();
    const nth = mineDays.indexOf(d.date);
    for (const r of famRows.filter((x) => same(x.slot, s.name) && (x.frequency === "daily" || x.frequency === "usually"))) {
      const want = r.frequency === "daily" ? mineDays.length : Math.round((TEMPLATE_DAYS.usually * mineDays.length) / 7);
      const on = Math.floor(((nth + 1) * want) / mineDays.length) > Math.floor((nth * want) / mineDays.length);
      if (!on || (r.days?.length && !r.days.includes(weekdayOf(d.date)))) continue;
      const cat = categoryPlace(r);
      if (plate.some((x) => x.key === r.key || (!!cat && sameKind(x.kind, cat.kind) && (!cat.sub || sameKind(x.sub, cat.sub))))) continue;
      const pool: Item[] = cat ? familyPool(s, cat.kind, cat.sub).filter((x) => x.catalog)
        : [{ name: r.name, key: r.key, kind: placeOf(r)?.kind ?? r.name, sub: placeOf(r)?.sub ?? null, family: true, idx: 0, row: r }];
      const got = choose(s, d, plate, [{ items: pool, isNew: false, share: false, repeat: true, next: true, zero: false }], atTable, false);
      if (got) put(s, d, plate, got.it, t.parts.length, false);
    }
    // Still nothing beside the staples where the template had more (no template could be filled that day): the family's own
    // dish of this meal had longest ago, or one of another part's kind. Nobody's meal is ever empty.
    if (s.kind !== "addon" && atTable.length && !plate.some((x) => !x.staple) && t.parts.some((p) => !isStaplePart(s, p))) {
      if (feed(s, d, plate, atTable, t.parts.length, [], [], null)) res.log.push(`${label(d)}: nothing of its template that day; another dish of theirs instead`);
    }
    // An add-on day with nothing: fine where its people eat the main meal's dishes; else one of its dishes comes back.
    if (s.kind === "addon" && !plate.length && !mainFeeds(w, dayOf(d))) {
      const fam = (s.templates ?? []).flatMap((x) => x.parts).flatMap((p) => ("items" in p ? p.items : []))
        .map((n, i): Item => ({ name: n, key: dishKey(n), kind: n, sub: null, family: true, idx: i }));
      const near = fam.filter((it) => fits(s, d, plate, it, { repeat: true, next: true, zero: false }, true))
        .sort((a, b) => (lastUsed.get(a.key) ?? "").localeCompare(lastUsed.get(b.key) ?? "") || a.idx - b.idx)[0];
      if (near) { put(s, d, plate, near, 0, false); res.unmet.push(`${label(d)}: ${near.name} comes back sooner than usual`); }
    }
    // Nobody left with nothing: each person has an item beside the staples they can eat (where the plate has more than staples).
    if (s.kind !== "addon" && plate.length) {
      const mains = plate.filter((x) => !x.staple);
      for (const who of atTable) {
        const can = plate.filter((x) => !excluded(d, [who], x.name).length);
        if (can.length && (!mains.length || can.some((x) => !x.staple))) continue;
        if (!feed(s, d, plate, [who], t.parts.length, [], [], null)) res.unmet.push(`${label(d)}: ${who} has nothing to eat there`);
      }
      // A require kept: one dish with its item for its person.
      for (const r of rules.filter((x) => x.hard && x.what === "require" && x.items?.length && x.who && atTable.some((p) => same(p, x.who!)) && ruleHolds(x, d.date, s, s.name))) {
        const who = atTable.find((p) => same(p, r.who!))!;
        const has = (name: string) => { prep(name); return r.items!.some((i) => factsOf(w, s.name, name).tags.has(canonTag(i))); };
        if (plate.some((x) => has(x.name) && !excluded(d, [who], x.name).length)) continue;
        if (!feed(s, d, plate, [who], t.parts.length, [], [], null, has)) res.unmet.push(`${label(d)}: no dish with ${r.items!.join(" or ")} for ${who}`);
      }
      // The guests: a dish of theirs beside the staples.
      if (guestForbids(w, dayOf(d)).length) {
        const theirs = (name: string) => { prep(name); return guestsCan(w, dayOf(d), name); };
        if (!plate.some((x) => !x.staple && theirs(x.name)) && !feed(s, d, plate, [], t.parts.length, [], [], null, theirs)) res.unmet.push(`${label(d)}: the guests have nothing of their own`);
      }
    }
    // A dish that already holds a staple of the plate ("rasam rice", "curd rice", "rajma chawal") takes that plain staple's
    // place: never "Rice" beside "Rasam rice".
    for (const x of [...plate]) {
      const base = stapleWord(x.name);
      if (!base || !plate.some((y) => y !== x && y.key !== x.key && holdsStaple(y.name, base))) continue;
      plate.splice(plate.indexOf(x), 1);
      const ds = dayOf(d).dishes, at = ds.findIndex((n) => dishKey(n) === x.key);
      if (at >= 0) ds.splice(at, 1);
    }
    const row = dayOf(d);
    res.plates.set(k, plate.map((x) => ({ name: x.name, new: x.isNew, not_for: notFor(w, row, x.name), note: onionNotes(w, row, x.name).join("; ") || null })));
  }
  res.unmet = uniq(res.unmet);
  res.facts = w.facts;
  res.ownItems = w.ownItems;
  res.provisional = uniq([...res.plates.values()].flat().filter((x) => provisional.has(dishKey(x.name))).map((x) => x.name));
  return res;
}
