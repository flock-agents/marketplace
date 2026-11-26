// The week filled by code from the meals' templates (docs/2026-11-26-one-meaning-model-design.md §5.1–5.3, owner rules 1–8):
// the templates are the only place a family word's meaning lives, the library is history. For each slot-day a template is
// chosen (shares first, a template kept to days only on them, a pinned dish's day the template that holds it, the rest
// spread evenly, never the same one two days running when there is another), and each of its parts is filled with an item:
//   - a staple part: the family's usual item of that kind (their row had most at the meal), every time;
//   - a kind part ({kind, sub?, words?, dish?}): the family's items of it (their library rows of that kind at the meal; with no
//     `dish`, the catalog's items of the kind or sub-kind too, those called by their `words` first; with a `dish`, that dish
//     first), least recently had first, shared across the meals, no item again until every one of theirs has come, never the
//     next day nor at two meals of a day, never twice on a plate, kept to their named dishes' words (how often, which days);
//     only when none of theirs fits, a brand-new item of the kind (sub-kind when given) from the catalog, while at least
//     OWN_SHARE of the week's non-staple items stay their own; else one of theirs comes back (the one had longest ago);
//   - a part of the family's own dishes ({items}) or a kind only they have: their dishes only, rotated;
//   - a linked part ({from, kind?, sub?}): the item the meal it links to has of that kind that day (its whole plate with no
//     kind), filled after that meal; never a repeat, never new, counted once for the cook. When that meal is not cooked that
//     day, the part picks its own item (a kind part of its kind; a whole plate: one of that meal's templates).
// A hard swap's item is a planned dish for its person (`for_people`), placed beside what it swaps (a linked box dish leaves
// that person's box). An extras add-on's people stay at the main meal. A cook's visit (her morning's meals) prefers the
// templates that keep her dish count, and a day over it is said (unmet); no part is ever dropped for it.
// Nothing is ever matched by its words to the catalog: a dish's kind is its part's, its row's, or an exact catalog item's.
// Food rules: an item someone at the table may not eat (a known break) is passed over while another fits; when none does, it
// stays with `not_for` them and they get their own item for that part. A dish whose fit for a rule is not known is planned
// and asked (res.unknowns), never kept from anyone. A rule broken only by an ingredient the dish can be made without is a
// note, never a block (planChecks.leaveOutNotes). Pure and deterministic: no database, no model, ties broken by date and slot.
import { CATALOG, catalogContains, catalogItem, catalogKind, norm, suggestable, suggestMeals, type CatalogItem, type MealKind, type MealTemplate, isItemsPart, isKindPart, isLinkedPart, mealKinds,
  type KindPart, type LinkedPart, type TemplatePart } from "./kinds";
import { INSTEAD_STEP, TEMPLATE_DAYS } from "./db/constants";
import { addDays, weekdayOf, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import { canonTag, factsOf, frequencyRange, guestForbids, guestsCan, isDropped, isStapleAt, leaveOutNotes, mainFeeds, notFor, ownAddon, placeOfDish,
  readFor, ruleUnknowns, slotFacts, swapsAt, weekSlots, withParents, OWN_SHARE, type DishFacts, type Unknown, type Week } from "./planChecks";
import type { DishPlace } from "./targets";
import { ruleHolds, slotDayKey, type PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

/** One dish on a filled plate. `new`: a brand-new variant (the family never had it). `for_people`: only for these people (a swap's
 *  item); empty = the slot-day's people. `linked`: the item of the meal a linked part links to. */
export type FilledDish = { name: string; new: boolean; not_for: string[]; note: string | null; for_people: string[]; linked: boolean };
/** A cook's visit (§9.3): the meals she cooks in one go (her morning: Breakfast, Lunch and the boxes), on its days, at most `cap`
 *  distinct dishes. `label`: the meals in words ("breakfast and lunch"); `cook` null: "the cook". */
export type Visit = { cook: string | null; meals: string[]; days: Weekday[]; cap: number; label: string };
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
  guestTags?: Map<string, string[]>;
  /** The cooks' visits whose dish limits the fill keeps where a template fits (makePlan visitsOf). */
  visits?: Visit[];
  /** The meals the family said to suggest dishes for, knowing none of theirs (make_plan suggest_new): a kind part's catalog
   *  items there are new, never counted as theirs. */
  suggested?: string[];
};
export type FillResult = {
  /** Each planned slot-day's plate, by slotDayKey. */ plates: Map<string, FilledDish[]>;
  placed: PlacedNew[];
  /** The catalog's items of a category the family named, placed (theirs, not new): to be kept in their library, once per meal. */ named: PlacedNew[];
  /** What the week falls short of: a part with nothing, a dish back sooner than usual, a cook's visit over her limit. */ unmet: string[]; log: string[];
  /** The dishes planned whose fit for someone's rule is not known: planned, and asked (one meaning model: unknown = ask). */ unknowns: Unknown[];
  /** Where every planned item sits, by dish key: its kind, sub-kind and catalog item (the part it filled, or its row). */ places: Map<string, DishPlace>;
  /** Each slot's templates and kinds as planned. */ templates: Map<string, MealTemplate[]>; kinds: Map<string, MealKind[]>;
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
/** Words a family puts around a category's name ("some dal", "any poriyal", "a different khichdi"): not the name. */
const FILLER = ["a", "an", "any", "some", "the", "different", "other", "plain", "simple"];
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
/** A candidate for a part: a family item (a library row, their part's dish, or a catalog item of a category part of theirs)
 *  or a catalog variant. */
type Item = { name: string; key: string; kind: string; sub: string | null; family: boolean; idx: number; row?: LibraryDish; cuisine?: number;
  /** A catalog item (of a category part of the family's, when `family`). */ catalog?: boolean };

/** A family dish's kind and sub-kind, as stored on its row (setup decided them); null when it has none. */
export function placeOf(row: Pick<LibraryDish, "kind" | "sub">): Place | null {
  return row.kind ? { kind: row.kind, sub: row.sub ?? null } : null;
}
/** The catalog item a family dish is, as stored on its row. */
export const catalogNameOf = (row: Pick<LibraryDish, "catalog_item">): string | null => row.catalog_item ?? null;
/** A library row the family has as their own: not disliked, not dropped, not a suggestion still untried. */
const familyRow = (r: LibraryDish) => !r.disliked && !isDropped(r) && (!r.suggested || !r.untried);
const sameKind = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);

/** The catalog's tags for an item, as the planner's: seafood is fish, and each tag with its parents. All of the catalog's
 *  tags are read. */
/** The tags that say what a diet is: meat, fish, eggs. */
const DIET_TAGS = ["egg", "chicken", "mutton", "pork", "beef", "fish", "prawn", "meat", "red_meat"];
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
  // A person's own meal in place of a main meal (class 3) sits just after it: that meal.
  if (s.kind === "custom") { const own = slots.find((m) => m.kind === "main" && m.order + INSTEAD_STEP === s.order); if (own && own !== s) return mealOf(own, slots); }
  if (s.kind === "custom") return s.order <= 20 ? "tiffin" : s.order <= 45 ? "snack" : "dinner";
  return s.order <= 10 ? "breakfast" : s.order <= 30 ? "lunch" : "dinner";
}

/** The kinds of a slot's templates (kinds.ts mealKinds), read through `kindsOf` by the planner's own sites. */
const kindsOf = (s: Slot): MealKind[] => mealKinds(s.templates ?? []);
// deriveTemplates (a meal's templates read off its plates) moved to migrateMeaning.ts: it runs there once per install.

/** How many of `n` days each template has: a share in the family's words exactly ("2/week") or as its words' days (a part
 *  week its share of them); the days left spread evenly over the templates with none. The templates read from one phrase (the
 *  same `said` and worded share: "Or sometimes gobi paratha, aloo paratha, etc.") have that phrase's days once, spread over them: to
 *  the one had least recently first (`lastHad`, by template: its latest date, "" for never; ties in their order), so a variant
 *  comes again only when all have come. */
/** A worded share kept to fewer than this many of the week's days comes by recency (F7 review ruling), and how many of its
 *  last days it may have been had on before it skips one. */
const RECENCY_DAYS = 3;
const RECENCY_BACK = { sometimes: 1, rarely: 1, usually: 2 } as const;
export function templateCounts(templates: MealTemplate[], n: number, lastHad?: readonly string[]): number[] {
  const groups: number[][] = [];
  const byPhrase = new Map<string, number[]>();
  templates.forEach((t, i) => {
    // A count said of the phrase and split per dish ("rajma or chole twice a week": each 1/week) is each dish's own: the
    // phrase keeps the sum of its members' counts. Only a worded share ("sometimes") is the phrase's once.
    const said = t.share && t.share in TEMPLATE_DAYS && t.said ? norm(t.said) : "";
    if (!said) { groups.push([i]); return; }
    const k = `${t.share}|${said}`;
    const g = byPhrase.get(k);
    if (g) g.push(i); else { const ng = [i]; byPhrase.set(k, ng); groups.push(ng); }
  });
  const counts = countEach(groups.map((g) => templates[g[0]]), n);
  const out = templates.map(() => 0);
  groups.forEach((g, j) => {
    const order = lastHad ? [...g].sort((a, b) => (lastHad[a] ?? "").localeCompare(lastHad[b] ?? "") || a - b) : g;
    for (let x = 0; x < counts[j]; x++) out[order[x % order.length]]++;
  });
  return out;
}

/** templateCounts for templates each its own share. */
function countEach(templates: MealTemplate[], n: number): number[] {
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
  // Days left with every template given a share go to those said in words ("sometimes"), never past an exact "2/week".
  const worded = templates.map((t, i) => (t.share && t.share in TEMPLATE_DAYS ? i : -1)).filter((i) => i >= 0);
  const spread = free.length ? free : worded.length ? worded : templates.map((_, i) => i);
  for (let j = 0; sum < n; j++, sum++) out[spread[j % spread.length]]++;
  return out;
}

/** The sub-kinds that are wet (the catalog's Gravy sub-kinds): a sabzi of one does not roll (§5.4, egg/cheese days). */
export const WET_SUBS = ["Curry", "Kofta", "Kurma", "Dalna", "Kerala curry", "Paneer"];

// ── The fill ──

export function fillWeek(input: FillInput): FillResult {
  const { library, rules } = input;
  const cuisines = new Set((input.cuisines ?? []).map(norm));
  const res: FillResult = { plates: new Map(), placed: [], named: [], unmet: [], log: [], unknowns: [], places: new Map(), templates: new Map(), kinds: new Map(), facts: new Map() };
  const slotByKey = new Map(input.slots.map((s) => [s.name.toLowerCase(), s]));

  // Each slot's shape: its own templates. A meal with none plans nothing (makePlan asks about it).
  const shaped = input.slots.map((s): Slot => {
    const templates = s.templates ?? [];
    if (!templates.length) res.log.push(`${s.name}: no templates`);
    res.templates.set(s.name.toLowerCase(), templates);
    res.kinds.set(s.name.toLowerCase(), mealKinds(templates));
    return { ...s, templates };
  });
  const shapeOf = (slot: string) => shaped.find((s) => same(s.name, slot))!;

  // The week as planChecks reads it; every item placed has its place (its part's kind, sub-kind and catalog item).
  const days = input.days.map((d) => ({ ...d, dishes: d.fixed ? [...d.dishes] : [] }));
  const w: Week = { days, slots: new Map(), rules, library, facts: new Map(input.facts ?? []), done: new Set(), newDishes: new Map(), places: res.places,
    ...(input.guestTags ? { guestTags: input.guestTags } : {}) };
  for (const s of shaped) w.slots.set(s.name.toLowerCase(), slotFacts(s, library, input.history.get(s.name.toLowerCase()) ?? []));
  const weekSlotList = weekSlots(w);

  /** What a dish contains, made ready before it is checked: a library dish's own read, and its catalog item's (by exact name:
   *  its row's catalog_item, else the dish's own name) for what that read left out. */
  const prepared = new Set<string>();
  const prep = (name: string) => {
    const key = dishKey(name);
    if (prepared.has(key)) return;
    prepared.add(key);
    const row = library.find((r) => r.key === key);
    const catName = catalogNameOf(row ?? { catalog_item: null }) ?? catalogItem(row?.name ?? name)?.item.name ?? null;
    const cat = catName ? catalogFacts(catName) : null;
    if (cat) {
      const base = w.facts.get(key) ?? (row ? { tags: withParents(row.contains), read: new Set(row.contains_read.map(canonTag)) } : null);
      w.facts.set(key, base ? { tags: new Set([...base.tags, ...[...cat.tags].filter((t) => !readFor(base.read, t))]), read: new Set([...base.read, ...cat.read]) } : cat);
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
  /** The diet tags the family's own dishes have (their meat, fish and eggs). */
  const familyTags = new Set(famRows.flatMap((r) => [...withParents([...r.contains, ...(catalogContains(catalogNameOf(r) ?? "") ?? []).map(asPlanner)])]));
  const noAgain = new Set(library.filter((r) => r.disliked || isDropped(r)).map((r) => r.key));
  /** The catalog's items of a kind (one sub-kind when given) for this family at this meal: regional only within their
   *  cuisines; the items called by the family's own words for the part (`said`: their "upma" is an upma, before a sabudana
   *  khichdi of the same kind) first, then their sub-kinds (`prefer`), then their cuisines, then everyday ones; never one of
   *  their dishes, nor one they disliked or dropped. A new item (not `family`) only of the catalog's meals for this meal and of
   *  no meat, fish or egg their own dishes never have. Ties rotate with the week. */
  const catalogPool = (s: Slot, kind: string, sub: string | null, prefer: string[], family: boolean, said: string[] = []): Item[] => {
    const ck = catalogKind(kind);
    if (!ck || ck.staple) return [];
    const meal = mealOf(s, input.slots);
    let items: CatalogItem[] = suggestable(ck.name, { sub, cuisines: [...cuisines] });
    // The catalog's meals decide only what the family left general (decided 18, 19).
    if (meal && !family && suggestMeals({ kind: ck.name, sub }).includes(meal)) items = items.filter((it) => suggestMeals({ kind: ck.name, item: it.name }).includes(meal));
    // An item brings no meat, fish or egg the family's own dishes never have (a pulao of a house whose only meat is a Sunday
    // chicken is never a mutton yakhni; their "pulao" is never a chicken pulao), unless every item of the part has it (their
    // "chicken" is chicken).
    const tagsOf = (it: CatalogItem) => (catalogContains(it.name) ?? []).map(asPlanner);
    const all = items.length ? DIET_TAGS.filter((t) => items.every((it) => tagsOf(it).includes(t))) : [];
    items = items.filter((it) => tagsOf(it).every((t) => !DIET_TAGS.includes(t) || familyTags.has(t) || all.includes(t)));
    items = items.filter((it) => !noAgain.has(dishKey(it.name)) && (family || (!familyCatalog.has(norm(it.name)) && !famRows.some((r) => r.key === dishKey(it.name)))));
    const off = items.length ? hash(`${firstDate}|${ck.name}|${sub ?? ""}`) % items.length : 0;
    const says = (name: string) => { const ws = wordsOf(name); return said.length > 0 && said.every((w) => ws.includes(w)); };
    return items.map((it, i) => ({ name: it.name, key: dishKey(it.name), kind: ck.name, sub: it.sub, family, catalog: true, idx: (i - off + items.length) % items.length,
      // The family's cuisines first, then an everyday item of no one cuisine, then another cuisine's.
      cuisine: (it.cuisines ?? []).some((c) => cuisines.has(norm(c))) ? 2 : (it.cuisines ?? []).length ? 0 : 1, says: says(it.name) }))
      .sort((a, b) => Number(b.says) - Number(a.says) || Number(prefer.some((p) => sameKind(p, b.sub))) - Number(prefer.some((p) => sameKind(p, a.sub)))
        || (b.cuisine ?? 0) - (a.cuisine ?? 0) || a.idx - b.idx)
      .map(({ says: _, ...x }, i) => ({ ...x, idx: i }));
  };
  /** The family's dishes of a kind (one sub-kind when given) at this meal: their library rows of it there (history and the
   *  dishes they named), their own sub-kinds first. Class 1: a family dish fills places only at the meal it was named for
   *  ("rasam rice" said of dinner never fills lunch's rasam); the rotation still counts it across the meals. */
  const rowsPool = (s: Slot, kind: string, sub: string | null, prefer: string[] = []): Item[] => {
    const seen = new Set<string>(), out: Item[] = [];
    for (const r of famRows.filter((x) => same(x.slot, s.name))) {
      if (seen.has(r.key)) continue;
      const pl = placeOf(r);
      if (!pl || !sameKind(pl.kind, kind) || (sub && !sameKind(pl.sub, sub))) continue;
      seen.add(r.key);
      out.push({ name: r.name, key: r.key, kind, sub: pl.sub, family: true, idx: out.length, row: r });
    }
    const theirs = prefer.length ? [...out.filter((x) => prefer.some((p) => sameKind(p, x.sub))), ...out.filter((x) => !prefer.some((p) => sameKind(p, x.sub)))] : out;
    return theirs.map((x, i) => ({ ...x, idx: i }));
  };
  const suggestedAt = (s: Slot) => (input.suggested ?? []).some((n) => same(n, s.name));
  /** A kind part's family pool (§5.1): their rows of it at the meal; then with a `dish`, that dish (theirs, even with no row)
   *  first; with none, the catalog's items of the kind or sub-kind, counted as theirs, those called by their `words` first. */
  const familyPool = (s: Slot, p: KindPart, prefer: string[] = []): Item[] => {
    const sub = p.sub ?? null;
    const rows = rowsPool(s, p.kind, sub, prefer);
    if (p.dish) {
      const key = dishKey(p.dish), hit = catalogItem(p.dish);
      const own: Item = rows.find((x) => x.key === key) ?? { name: hit?.item.name ?? p.dish.trim(), key, kind: p.kind, sub: sub ?? hit?.item.sub ?? null, family: true, idx: 0,
        ...(hit ? { catalog: true } : {}) };
      return noAgain.has(key) ? rows : [own, ...rows.filter((x) => x.key !== key)].map((x, i) => ({ ...x, idx: i }));
    }
    // A meal they said to suggest for: nothing of the catalog is theirs there, it is all new.
    if (suggestedAt(s)) return rows;
    const said = wordsOf(p.words ?? "").filter((x) => !FILLER.includes(x));
    const seen = new Set(rows.map((x) => x.key));
    const cat = catalogPool(s, p.kind, sub, uniq([...prefer, ...(sub ? [sub] : [])]), true, said).filter((x) => !seen.has(x.key));
    return [...rows, ...cat].map((x, i) => ({ ...x, idx: i }));
  };
  /** The brand-new items of a kind part: the catalog's items of its kind (its sub-kind when given: an "etc." stays inside it)
   *  outside the family pool; never a staple's or an own kind's. */
  const newPool = (s: Slot, kind: string, sub: string | null, prefer: string[] = [], fam: Item[] = []): Item[] => {
    const mk = kindsOf(s).find((k) => sameKind(k.name, kind));
    if (mk?.own || mk?.staple) return [];
    const theirs = new Set(fam.map((x) => x.key));
    return catalogPool(s, kind, sub, prefer, false).filter((x) => !theirs.has(x.key));
  };
  /** The family's usual item of a staple kind at a slot: their dish of it had most at this slot, else any of theirs (never one of
   *  another person's own meal), else the catalog's first. */
  const stapleOf = (s: Slot, kind: string): string => {
    // Class 6: one person's own meal (an add-on, or a meal of named people) keeps its dishes; the family's meal never takes them.
    const personal = (slot: string) => { const x = slotByKey.get(slot.toLowerCase()); return !!x && x.kind !== "main" && x.usual_people.length > 0; };
    const rows = famRows.filter((r) => sameKind(placeOf(r)?.kind, kind) && (same(r.slot, s.name) || !personal(r.slot)));
    const hist = input.history.get(s.name.toLowerCase()) ?? [];
    const count = (k: string) => hist.filter((h) => h.dishes.some((x) => dishKey(x.dish) === k)).length;
    const here = rows.filter((r) => same(r.slot, s.name)).sort((a, b) => count(b.key) - count(a.key));
    if (here.length) return here[0].name;
    if (rows.length) return rows[0].name;
    return catalogKind(kind)?.items[0]?.name ?? kind;
  };

  const isStaplePart = (s: Slot, p: TemplatePart) => isKindPart(p) && (!!kindsOf(s).find((k) => sameKind(k.name, p.kind))?.staple || !!catalogKind(p.kind)?.staple);
  /** A non-staple part's candidates: the family's items of it, and the brand-new variants (of the family's own sub-kinds first:
   *  the meal's, else those of their items). A linked part has none here (not filled yet). */
  const poolsOf = (s: Slot, p: TemplatePart) => {
    const kp = isKindPart(p) ? p : null;
    const kind = kp ? kp.kind : null;
    const sub = kp ? kp.sub ?? null : null;
    const mk = kind ? kindsOf(s).find((x) => sameKind(x.name, kind)) : undefined;
    const fam: Item[] = !kp
      ? !isItemsPart(p) ? [] : p.items.map((n, i) => { const r = rowAt(s.name, dishKey(n)); const pl = r ? placeOf(r) : null; return { name: n.trim(), key: dishKey(n), kind: pl?.kind ?? n, sub: pl?.sub ?? null, family: true, idx: i, row: r }; })
      : familyPool(s, kp, sub ? [] : mk?.subs ?? []);
    const neu: Item[] = !kp || mk?.own ? [] : newPool(s, kind!, sub, sub ? [] : mk?.subs?.length ? mk.subs : uniq(fam.map((x) => x.sub).filter((x): x is string => !!x)), fam);
    return { kind, sub, fam, neu };
  };
  /** The catalog items the family's category parts make theirs (lead's rule, 25 Nov), by dish key. */
  w.ownItems = new Set(shaped.filter((s) => !suggestedAt(s)).flatMap((s) => (s.templates ?? []).flatMap((t) => t.parts)
    .flatMap((p) => (isKindPart(p) && !p.dish && !isStaplePart(s, p) ? suggestable(p.kind, { sub: p.sub ?? null, cuisines: [...cuisines] }).map((it) => dishKey(it.name)) : []))));

  // ── The family's own words on a dish (its days, how often) at a meal ──
  // Owner rule 3: "the family's own words still limit". A day or count said of a dish they named (its library row) limits
  // every placement that stands for it at that meal: the dish itself, and an item put in a part whose every item of theirs is
  // held by such words (a new variant there stands for their dish too), and so the template that part is in. A template's
  // own words (its share, its days) choose its days below.
  type Limit = { row: LibraryDish; days: string[] | null; max: number | null };
  const limitOf = (r: LibraryDish): Limit | null => {
    const days = r.days?.length ? r.days : null;
    // "usually" and "daily" say how often at least, never a most.
    const range = r.frequency && r.frequency !== "daily" && r.frequency !== "usually" ? frequencyRange(r.frequency) : null;
    return days || range ? { row: r, days, max: range ? range[1] : null } : null;
  };
  /** The rows of the family's words at this meal that hold an item: its own named row there. A catalog item of a category
   *  part is free of any dish's words. */
  const wordsFor = (slot: string, it: Item): Limit[] =>
    it.catalog && !it.row ? [] : famRows.filter((r) => r.key === it.key && same(r.slot, slot)).map(limitOf).filter((x): x is Limit => !!x);
  /** A part's limits: the words that hold every item of the family's that fills it (a staple: its usual item); none when one
   *  of their items is free of such words. */
  const partLimits = (s: Slot, p: TemplatePart): Limit[] => {
    if (isLinkedPart(p)) return [];
    const items: Item[] = isStaplePart(s, p)
      ? (() => { const kind = (p as { kind: string }).kind, n = stapleOf(s, kind); return [{ name: n, key: dishKey(n), kind, sub: null, family: true, idx: 0 }]; })()
      : poolsOf(s, p).fam;
    if (!items.length) return [];
    const out = new Map<string, Limit>();
    for (const it of items) { const ls = wordsFor(s.name, it); if (!ls.length) return []; for (const l of ls) out.set(l.row.key, l); }
    return [...out.values()];
  };
  // Class 2 (lead, 26 Nov: "uthappam sometimes" is 2–3 uthappam a week in all): a count said of a dish holds across the day's
  // meals. Each meal keeps its own count, and all the meals where the family said a count of it share the most they said
  // ("kadhi sometimes" at lunch and "khichdi and kadhi twice a week" at dinner: at most 3 kadhi days in all). A meal where the
  // family has the dish with no such words is free of them (no row of words there, nothing counted).
  /** The most days a week the family's words allow a dish (by its key) at any meal; Infinity when none says. */
  const mostOf = (key: string): number => {
    const ms = famRows.filter((r) => r.key === key).map((r) => limitOf(r)?.max).filter((x): x is number => x != null);
    return ms.length ? Math.max(...ms) : Infinity;
  };
  const usesOf = (uses: Map<string, Set<string>>, k: string, date: string) => [...(uses.get(k) ?? [])].filter((x) => x !== date).length;
  /** Do a row's words still allow it at this meal on a date: its days, its count at this meal, and the count across the meals. */
  const wordsAllow = (slot: string, l: Limit, date: string, uses: Map<string, Set<string>>) => (!l.days || l.days.includes(weekdayOf(date)))
    && (l.max == null || (usesOf(uses, `${slot.toLowerCase()}|${l.row.key}`, date) < l.max && usesOf(uses, `*|${l.row.key}`, date) < mostOf(l.row.key)));
  /** The words of a part that still allow it on a date; null when none does. `uses`: the dates each row's words were used, by
   *  slot|row key at its meal and *|row key across the meals. */
  const openLimit = (slot: string, lims: Limit[], date: string, uses: Map<string, Set<string>>): Limit | null =>
    lims.find((l) => wordsAllow(slot, l, date, uses)) ?? null;
  const markLimit = (slot: string, l: Limit, date: string, uses: Map<string, Set<string>>) => {
    for (const k of [`${slot.toLowerCase()}|${l.row.key}`, `*|${l.row.key}`]) uses.set(k, (uses.get(k) ?? new Set()).add(date));
  };
  /** The family's worded row that holds an item at a meal: the item's own row (at this meal, else at another: a dish they spoke
   *  of elsewhere keeps its words). */
  const saidRowsAt = (slot: string, it: Item): Limit[] => {
    if (!it.family || (it.catalog && !it.row)) return [];
    const r = rowAt(slot, it.key);
    const l = r ? limitOf(r) : null;
    return l ? [l] : [];
  };
  const limitUse = new Map<string, Set<string>>();   // as filled
  const planUse = new Map<string, Set<string>>();    // as templates are given, every meal together
  // The week's fixed days count for the family's words too.
  for (const d of days.filter((x) => x.fixed && !x.skip)) for (const x of d.dishes) {
    const r = rowAt(d.slot, dishKey(x));
    const l = r ? limitOf(r) : null;
    if (l) { markLimit(d.slot, l, d.date, limitUse); markLimit(d.slot, l, d.date, planUse); }
  }

  // ── The cooks' visits (§9.3) ──
  const visits = input.visits ?? [];
  /** The meals a slot's linked parts link to (lower case). */
  const linkSources = (s: Slot): string[] => uniq((s.templates ?? []).flatMap((t) => t.parts).filter(isLinkedPart).map((p) => p.from.toLowerCase()));
  /** Is a slot cooked in a visit: one of its meals, an add-on of one, or a box linked to one. */
  const inVisit = (v: Visit, slot: string): boolean => {
    const x = slotByKey.get(slot.toLowerCase());
    if (!x) return false;
    const of = (n: string) => v.meals.some((m) => same(m, n));
    return of(x.name) || (!!x.addon_of && of(x.addon_of)) || linkSources(x).some(of);
  };
  const visitsAt = (slot: string, date: string) => visits.filter((v) => v.days.includes(weekdayOf(date)) && inVisit(v, slot));
  // Owner decision OD6 (26 Nov): a cook's visit cap counts the dishes she COOKS. Not counted: a staple (rice, roti, plain paratha,
  // curd: a staple kind), a simple extra that needs no cooking (boiled eggs, salad, fruit: the catalog's `capFree` items and kinds),
  // and, in an `extras` add-on only, a family's own dish the catalog does not know ("4 eggs": a simple extra); a catalogued cooked
  // dish there (Egg bhurji) counts. A linked dish counts once, as the other meal's. Judged by the dish's saved place or catalog
  // facts, never by matching its words; elsewhere a dish with no catalog facts counts as cooked.
  const capFreeItem = (name: string, extras = false): boolean => {
    const row = library.find((r) => r.key === dishKey(name));
    const hit = catalogItem(row?.catalog_item ?? name);
    return hit ? !!hit.item.capFree || !!hit.kind.staple : extras && !row?.kind;
  };
  // A kind part is free only when EVERY item of the kind is (Salad; not Fruit: its custard is cooked).
  const capFreeKind = (kind: string | null | undefined): boolean => { const k = kind ? catalogKind(kind) : null; return !!k && k.items.length > 0 && k.items.every((i) => i.capFree); };
  /** The dishes a template has the cook make: every part but a linked one, a staple one, or a no-cook one. */
  const cooked = (t: MealTemplate, s: Slot) => t.parts.filter((p) => !isLinkedPart(p) && !(isKindPart(p) && (!!catalogKind(p.kind)?.staple || !!kindsOf(s).find((k) => sameKind(k.name, p.kind))?.staple || capFreeKind(p.kind)))
    && !(isItemsPart(p) && p.items.length > 0 && p.items.every((n) => capFreeItem(n, s.extras)))).length;
  /** Does a dish of a slot need cooking by the cook: not a staple or a no-cook item or kind (by its place), nor an extras add-on's dish the catalog does not know. */
  const needsCook = (slotName: string, dish: string): boolean => {
    const extras = !!slotByKey.get(slotName.toLowerCase())?.extras;
    if (isStapleAt(w, slotName, dish)) return false;
    const pl = placeOfDish(w, slotName, dish);
    if (pl.kind && catalogKind(pl.kind)?.staple) return false;   // a catalog item of a staple kind (Curd, Rice) the library does not hold
    if (extras && !pl.item && !pl.kind) return false;   // the family's own simple extra ("4 eggs")
    return !(pl.item ? !!catalogItem(pl.item)?.item.capFree : capFreeKind(pl.kind)) && !(pl.item === null && capFreeItem(dish));
  };
  const visitLoad = new Map<string, number>();   // visit index|date → dishes of the templates given so far
  const loadOf = (v: Visit, date: string) => visitLoad.get(`${visits.indexOf(v)}|${date}`) ?? 0;

  // ── Templates for each slot's days ──
  const tplOf = new Map<string, number>();   // slotDayKey → template index
  const pinsOf = new Map<string, LibraryDish[]>();
  const holds = (t: MealTemplate, r: LibraryDish) => t.parts.some((p) => (isItemsPart(p) ? p.items.some((x) => dishKey(x) === r.key)
    : isLinkedPart(p) ? false : sameKind(p.kind, placeOf(r)?.kind) && (!p.sub || sameKind(p.sub, placeOf(r)?.sub))));
  /** A template kept to days ("bread omelette on Sundays") comes only on them. */
  const onDay = (t: MealTemplate, date: string) => !t.days?.length || (t.days as string[]).includes(weekdayOf(date));
  // The meals in their order of the day, so a visit's later meal sees what its earlier ones were given.
  for (const s of [...shaped].sort((a, b) => a.order - b.order)) {
    const ts = s.templates ?? [];
    const mine = planned.filter((d) => same(d.slot, s.name)).sort((a, b) => a.date.localeCompare(b.date));
    if (!ts.length || !mine.length) continue;
    // Each template's limited parts (the family's words above), and the week's uses of those words as templates are given.
    const tplLimits = ts.map((t) => t.parts.map((p) => partLimits(s, p)).filter((ls) => ls.length));
    const allowed = (i: number, date: string) => onDay(ts[i], date) && tplLimits[i].every((ls) => !!openLimit(s.name, ls, date, planUse));
    const mark = (i: number, date: string) => { for (const ls of tplLimits[i]) { const l = openLimit(s.name, ls, date, planUse); if (l) markLimit(s.name, l, date, planUse); } };
    // A template kept to days, or made for a dish kept to days ("pongal on Sundays": a part whose every item is held to days),
    // comes only on those days; the week's other days are spread over the rest.
    const pinnedOnly = ts.map((t, i) => !!t.days?.length || tplLimits[i].some((ls) => ls.every((l) => !!l.days)) || t.parts.some((p) => {
      if (isStaplePart(s, p) || isLinkedPart(p)) return false;
      const { fam } = poolsOf(s, p);
      return fam.length > 0 && fam.every((x) => !!x.row?.days?.length);
    }));
    const free = ts.map((_, i) => i).filter((i) => !pinnedOnly[i]);
    // When each template was last had: the latest of the dishes it names that its phrase's other templates do not name.
    const named = ts.map((t) => new Set(t.parts.flatMap((p) => (isItemsPart(p) ? p.items : isKindPart(p) && p.dish ? [p.dish] : []).map(dishKey))));
    const phrase = (t: MealTemplate) => (t.share && t.said ? `${t.share}|${norm(t.said)}` : null);
    const lastHad = ts.map((t, i) => {
      const mates = ts.flatMap((u, j) => (j !== i && phrase(t) && phrase(u) === phrase(t) ? [named[j]] : []));
      const own = [...named[i]].filter((k) => !mates.length || !mates.every((m) => m.has(k)));
      return own.reduce((a, k) => { const l = (lastUsed.get(k) ?? "").slice(0, 10); return l > a ? l : a; }, "");
    });
    const left = free.length && free.length < ts.length
      ? (() => { const c = templateCounts(free.map((i) => ts[i]), mine.length, free.map((i) => lastHad[i])), out = ts.map(() => 0); free.forEach((i, j) => { out[i] = c[j]; }); return out; })()
      : templateCounts(ts, mine.length, lastHad);
    // A template whose part is held to a count ("chapati and a kurma twice a week") comes at most that often; its other days go
    // to the templates free of such words.
    const most = tplLimits.map((parts) => Math.min(Infinity, ...parts.map((ls) => (ls.every((l) => l.max != null) ? ls.reduce((n, l) => n + l.max!, 0) : Infinity))));
    const open = free.filter((i) => most[i] === Infinity);
    for (const i of free) {
      if (left[i] <= most[i] || !open.length || open.includes(i)) continue;
      for (let x = left[i] - most[i], j = 0; x > 0; x--, j++) { left[open[j % open.length]]++; left[i]--; }
    }
    // A worded share kept to fewer than RECENCY_DAYS of the week's days ("on saturdays we make egg curry sometimes") comes by
    // recency, never by count: a count of one day rounds to every week. "sometimes"/"rarely": not when it was had on its last
    // day before; "usually": not when it was had on each of its last 2 days. Its skipped days go to the other templates.
    const byRecency = ts.map((t) => !!t.days?.length && !!t.share && t.share in RECENCY_BACK && mine.filter((d) => onDay(t, d.date)).length < RECENCY_DAYS);
    for (let i = 0; i < ts.length; i++) if (byRecency[i]) left[i] = 0;
    const hadTpl = (i: number, date: string) => tplOf.get(slotDayKey(date, s.name)) === i || (named[i].size > 0 && [...hadOn(date)].some((k) => named[i].has(k)));
    const due = (i: number, date: string) => {
      const back = RECENCY_BACK[ts[i].share as keyof typeof RECENCY_BACK], prev: string[] = [];
      for (let k = 1; prev.length < back && k <= 7 * (back + 1); k++) { const x = addDays(date, -k); if (onDay(ts[i], x)) prev.push(x); }
      return prev.length < back || !prev.every((x) => hadTpl(i, x));
    };
    const weight = [...left];
    // A pinned dish's day takes the template that holds it; a template kept to days takes its days (its share of them).
    const keptTpl = ts.map((t, i) => (t.days?.length ? i : -1)).filter((i) => i >= 0);
    const keptLeft = new Map(keptTpl.map((i) => [i, ts[i].share && !byRecency[i] ? templateCounts([ts[i]], mine.filter((d) => onDay(ts[i], d.date)).length)[0] : Infinity]));
    for (const d of mine) {
      const pins = famRows.filter((r) => same(r.slot, s.name) && r.days?.includes(weekdayOf(d.date)));
      if (pins.length) pinsOf.set(slotDayKey(d.date, s.name), pins);
      let i = pins.length ? ts.findIndex((t) => onDay(t, d.date) && holds(t, pins[0])) : -1;
      if (i < 0) i = keptTpl.find((j) => onDay(ts[j], d.date) && (keptLeft.get(j) ?? 0) > 0 && allowed(j, d.date) && (!byRecency[j] || due(j, d.date))) ?? -1;
      if (i < 0) continue;
      if (keptLeft.has(i)) keptLeft.set(i, keptLeft.get(i)! - 1);
      tplOf.set(slotDayKey(d.date, s.name), i);
      mark(i, d.date);
      if (left[i] > 0) left[i]--;
      else { const j = left.indexOf(Math.max(...left)); if (left[j] > 0) left[j]--; }
    }
    // The rest spread evenly (a smooth weighted round), never the same template two days running when another is left; never
    // one the family's words keep from that day.
    const cur = ts.map(() => 0);
    const tplAt = (date: string) => tplOf.get(slotDayKey(date, s.name));
    for (const d of mine) {
      const k = slotDayKey(d.date, s.name);
      if (tplOf.has(k)) continue;
      let cand = ts.map((_, i) => i).filter((i) => left[i] > 0 && allowed(i, d.date));
      if (!cand.length) cand = ts.map((_, i) => i).filter((i) => allowed(i, d.date) && !pinnedOnly[i]);
      if (!cand.length) cand = ts.map((_, i) => i).filter((i) => left[i] > 0 && onDay(ts[i], d.date));
      if (!cand.length) { const any = [ts.findIndex((t, i) => onDay(t, d.date) && !byRecency[i]), ts.findIndex((t) => onDay(t, d.date))].find((x) => x >= 0) ?? -1; if (any >= 0) tplOf.set(k, any); else res.log.push(`${weekdayOf(d.date)} ${s.name}: no template for that day`); continue; }
      for (const i of cand) cur[i] += weight[i];
      const total = cand.reduce((n, i) => n + weight[i], 0);
      // A template that keeps the cook's visit within her limit that day comes before one that does not (§9.3).
      const vs = visitsAt(s.name, d.date);
      const over = (i: number) => Number(vs.some((v) => loadOf(v, d.date) + cooked(ts[i], s) > v.cap));
      const ranked = [...cand].sort((a, b) => over(a) - over(b) || cur[b] - cur[a] || a - b);
      const near = new Set([tplAt(addDays(d.date, -1)), tplAt(addDays(d.date, 1))]);
      const pick = ranked.find((i) => !near.has(i) && over(i) === over(ranked[0])) ?? ranked[0];
      cur[pick] -= total;
      if (left[pick] > 0) left[pick]--;
      tplOf.set(k, pick);
      mark(pick, d.date);
    }
    for (const d of mine) {
      const i = tplOf.get(slotDayKey(d.date, s.name));
      if (i !== undefined) for (const v of visitsAt(s.name, d.date)) visitLoad.set(`${visits.indexOf(v)}|${d.date}`, loadOf(v, d.date) + cooked(ts[i], s));
    }
  }
  /** Each slot-day's template as first given (before a day's own change: a wet sabzi's roll day, a template that cannot fill). */
  const firstTpl = new Map(tplOf);

  // OWN_SHARE: the week's non-staple places, of which at most the rest are new.
  let places = 0;
  for (const d of planned) {
    const s = shapeOf(d.slot), i = tplOf.get(slotDayKey(d.date, d.slot));
    if (i !== undefined) places += s.templates![i].parts.filter((p) => !isStaplePart(s, p) && !isLinkedPart(p)).length;
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
  /** `for`: only for these people (a swap's item); `linked`: the linked meal's item. */
  type Plate = { name: string; key: string; part: number; staple: boolean; isNew: boolean; kind: string | null; sub: string | null; for: string[]; linked: boolean }[];
  const newAllowed = (d: PlanDay, share: boolean, feeding: boolean) => {
    if (d.new_dishes_allowed === 0) return false;
    if (d.new_dishes_allowed != null && (newOnDay.get(slotDayKey(d.date, d.slot)) ?? 0) >= d.new_dishes_allowed) return false;
    if (feeding) return true;
    // A meal they said to suggest for is all new by their word: the weekly cap (its default included) does not hold there.
    if (input.newCap != null && distinctNew.size >= input.newCap && !(input.suggested ?? []).some((n) => same(n, d.slot))) return false;
    return !share || newCount < newMax;
  };
  /** May an item go on this plate today: not on it already, within the family's own words for it (its days, how often), not
   *  at another meal today, not yesterday (unless `next`), not had this week (unless `repeat`). */
  const fits = (s: Slot, d: PlanDay, plate: Plate, it: Item, o: Opts, loose = false): boolean => {
    if (plate.some((x) => x.key === it.key)) return false;
    if (noAgain.has(it.key)) return false;
    const row = it.family ? rowAt(s.name, it.key) : undefined;
    if (row?.days?.length && !row.days.includes(weekdayOf(d.date))) return false;
    // The family's words on it (its own row's): their count at this meal and across the meals (class 2).
    if (!loose && saidRowsAt(s.name, it).some((l) => l.max != null && !wordsAllow(s.name, { ...l, days: null }, d.date, limitUse))) return false;
    if (loose) return true;
    if (s.kind !== "addon" && hadOn(d.date, s.name).has(it.key)) return false;
    if (!o.next && hadOn(addDays(d.date, -1)).has(it.key)) return false;
    if (!o.repeat && usedDates.get(it.key)?.size) return false;
    // An add-on's dish the family said how often of comes back the next day only when they have it every day or most days
    // (class 5: "milk every day" at her own dinner is there every day, whatever kind of meal it is).
    if (o.next && s.kind === "addon" && ((row?.frequency && row.frequency !== "daily" && row.frequency !== "usually") || row?.days?.length) && hadOn(addDays(d.date, -1)).has(it.key)) return false;
    return true;
  };
  /** The best item of the steps for `who` (the slot-day's people, or one person being fed). */
  const choose = (s: Slot, d: PlanDay, plate: Plate, steps: Step[], who: string[], feeding: boolean, must?: (name: string) => boolean): { it: Item; ex: string[] } | null => {
    const samePart = (it: Item) => plate.filter((x) => sameKind(x.kind, it.kind) && !x.staple);
    // Everyone at the meal counts for the plate (contract rule 6: an item someone there may not eat is passed over while another
    // fits), the people fed at their own meal beside it too: that meal is a fallback for them, never a reason to give the
    // shared plate an item they cannot eat (h4: French toast for the whole breakfast while egg-free toasts fitted).
    const beside = feeding ? [] : dayOf(d).people.filter((p) => !who.includes(p));
    for (const st of steps) {
      if (!st.items.length || (st.isNew && !newAllowed(d, st.share, feeding))) continue;
      const ok = st.items.filter((it) => fits(s, d, plate, it, st) && (!must || must(it.name)))
        .map((it) => ({ it, ex: excluded(d, who, it.name), also: beside.length ? excluded(d, beside, it.name).length : 0 }))
        .filter((x) => (st.zero ? !x.ex.length : !who.length || x.ex.length < who.length));
      if (!ok.length) continue;
      ok.sort((a, b) => a.ex.length - b.ex.length || a.also - b.also
        || Number(samePart(a.it).some((x) => sameKind(x.sub, a.it.sub))) - Number(samePart(b.it).some((x) => sameKind(x.sub, b.it.sub)))
        || (usedDates.get(a.it.key)?.size ?? 0) - (usedDates.get(b.it.key)?.size ?? 0)
        || (lastUsed.get(a.it.key) ?? "").localeCompare(lastUsed.get(b.it.key) ?? "") || a.it.idx - b.it.idx);
      return ok[0];
    }
    return null;
  };
  /** The family's item of the kind a new variant stands in for: their dish of it at this meal (a part's `dish`, else a row),
   *  of its sub-kind first, the one had most recently. */
  const likeOf = (s: Slot, it: Item): string | null => {
    const dishes = uniq((s.templates ?? []).flatMap((t) => t.parts).flatMap((p) => (isKindPart(p) && p.dish && sameKind(p.kind, it.kind) ? [p.dish] : [])));
    const fam: Item[] = [...dishes.map((n, i): Item => ({ name: n, key: dishKey(n), kind: it.kind, sub: catalogItem(n)?.item.sub ?? null, family: true, idx: i })),
      ...rowsPool(s, it.kind, null).filter((x) => !dishes.some((n) => dishKey(n) === x.key)).map((x) => ({ ...x, idx: x.idx + dishes.length }))];
    const best = [...fam].sort((a, b) => Number(sameKind(b.sub, it.sub)) - Number(sameKind(a.sub, it.sub)) || (lastUsed.get(b.key) ?? "").localeCompare(lastUsed.get(a.key) ?? "") || a.idx - b.idx)[0];
    return best?.name ?? null;
  };
  /** Where an item sits: its part's kind (or its row's) with its sub-kind and catalog item (its row's catalog_item, else the
   *  catalog item of its exact name); a dish of an {items} part with no kind known: the catalog item of its exact name, if any. */
  const placeOfItem = (s: Slot, it: Item): DishPlace | null => {
    const item = it.catalog ? it.name : it.row?.catalog_item ?? catalogItem(it.name)?.item.name ?? null;
    if (it.row?.kind) return { kind: it.row.kind, sub: it.row.sub ?? it.sub, item };
    if (catalogKind(it.kind) || kindsOf(s).some((k) => sameKind(k.name, it.kind))) return { kind: it.kind, sub: it.sub, item };
    const hit = catalogItem(it.name);
    return hit ? { kind: hit.kind.name, sub: hit.item.sub ?? null, item: hit.item.name } : null;
  };
  const put = (s: Slot, d: PlanDay, plate: Plate, it: Item, part: number, staple: boolean, forPeople: string[] = []) => {
    const place = res.places.has(it.key) ? null : placeOfItem(s, it);
    if (place) res.places.set(it.key, place);
    for (const l of saidRowsAt(s.name, it)) markLimit(s.name, l, d.date, limitUse);
    plate.push({ name: it.name, key: it.key, part, staple, isNew: !it.family, kind: it.kind, sub: it.sub, for: forPeople, linked: false });
    use(d.date, s.name, it.name);
    dayOf(d).dishes.push(it.name);
    // Recorded once per meal: library rows are per slot (§5.3), so an item at a second meal is theirs there too.
    if (it.family && it.catalog && !res.named.some((x) => dishKey(x.dish) === it.key && same(x.slot, s.name))) res.named.push({ dish: it.name, date: d.date, slot: s.name, kind: it.kind, sub: it.sub, like: null });
    if (!it.family) {
      newCount++;
      distinctNew.add(it.key);
      newOnDay.set(slotDayKey(d.date, d.slot), (newOnDay.get(slotDayKey(d.date, d.slot)) ?? 0) + 1);
      res.placed.push({ dish: it.name, date: d.date, slot: s.name, kind: it.kind, sub: it.sub, like: likeOf(s, it) });
    }
  };
  const label = (d: PlanDay) => `${weekdayOf(d.date)} ${d.slot}`;
  /** The non-staple kinds of a slot, for a person's own item from another part. */
  const otherKinds = (s: Slot, but: string | null) => kindsOf(s).filter((k) => !k.staple && !catalogKind(k.name)?.staple && !sameKind(k.name, but));
  /** The family's items of a kind across the meal's parts of it (each part's family pool). */
  const kindPool = (s: Slot, kind: string): Item[] => {
    const seen = new Set<string>();
    return (s.templates ?? []).flatMap((t) => t.parts).filter((p): p is KindPart => isKindPart(p) && sameKind(p.kind, kind))
      .flatMap((p) => familyPool(s, p)).filter((x) => !seen.has(x.key) && !!seen.add(x.key)).map((x, i) => ({ ...x, idx: i }));
  };
  /** A person (or the guests: `must`) fed where the plate has nothing for them: their own item for the part, else one of
   *  another part of this meal, else any dish of theirs here, else a plain dal or sabzi. */
  const feed = (s: Slot, d: PlanDay, plate: Plate, who: string[], part: number, fam: Item[], neu: Item[], kind: string | null, must?: (name: string) => boolean): boolean => {
    const tries: Step[][] = [stepsFor(fam, neu)];
    for (const k of otherKinds(s, kind)) tries.push(stepsFor(kindPool(s, k.name), []));
    const here: Item[] = famRows.filter((r) => same(r.slot, s.name) && !isStapleAt(w, s.name, r.name))
      .map((r, i) => ({ name: r.name, key: r.key, kind: placeOf(r)?.kind ?? r.name, sub: placeOf(r)?.sub ?? null, family: true, idx: i, row: r }));
    tries.push(stepsFor(here, []));
    for (const k of otherKinds(s, kind)) tries.push(stepsFor([], newPool(s, k.name, null)));
    // A plain dal or sabzi only at lunch or dinner (never a new kind at breakfast or in a tiffin).
    if (["lunch", "dinner"].includes(mealOf(s, input.slots) ?? "")) for (const k of ["Dal", "Sabzi"]) tries.push(stepsFor([], newPool({ ...s, templates: [] }, k, null)));
    for (const steps of tries) {
      const got = choose(s, d, plate, steps, who, true, must);
      if (got) { put(s, d, plate, got.it, part, false); return true; }
    }
    return false;
  };

  /** Does an add-on have anything to give: a template with a part (a meal with none plans nothing). */
  const canFeed = (slot: string) => (shapeOf(slot).templates ?? []).some((t) => t.parts.length);

  // ── Day by day, the meals in their order; a meal with a linked part after the meal it links to ──
  const order = (d: PlanDay) => slotByKey.get(d.slot.toLowerCase())?.order ?? 99;
  const rank = new Map<string, number>();
  const rankOf = (slot: string, seen: Set<string> = new Set()): number => {
    const key = slot.toLowerCase(), x = slotByKey.get(key);
    if (!x) return 99;
    if (rank.has(key)) return rank.get(key)!;
    if (seen.has(key)) return x.order;
    seen.add(key);
    const r = Math.max(x.order, ...linkSources(x).map((f) => rankOf(f, seen) + 0.5));
    rank.set(key, r);
    return r;
  };
  const todo = [...planned].sort((a, b) => a.date.localeCompare(b.date) || rankOf(a.slot) - rankOf(b.slot) || order(a) - order(b) || a.slot.localeCompare(b.slot));
  /** Each filled slot-day's plate as placed (its items' kinds), by slotDayKey: what a linked part reads. */
  const filled = new Map<string, Plate>();
  /** What a meal has that day for a linked part: its plate (the dishes for everyone), a fixed day's dishes by their saved place;
   *  null when it is not cooked that day (no slot-day, skipped, nothing on it). */
  const sourceOf = (date: string, from: string): Plate | null => {
    const sd = days.find((x) => x.date === date && same(x.slot, from));
    if (!sd || sd.skip) return null;
    const pl = filled.get(slotDayKey(date, from))?.filter((x) => !x.for.length)
      ?? (sd.fixed ? sd.dishes.map((n) => { const pc = placeOfDish(w, from, n); return { name: n, key: dishKey(n), part: 0, staple: isStapleAt(w, from, n), isNew: false, kind: pc.kind, sub: pc.sub, for: [], linked: false }; }) : null);
    return pl?.length ? pl : null;
  };
  /** The item a linked part to kind K reads is wet (§5.4): its saved place's sub-kind is a Gravy sub-kind, or its catalog item is
   *  a gravy. */
  const wetAt = (date: string, p: LinkedPart): boolean => {
    const x = (sourceOf(date, p.from) ?? []).find((y) => sameKind(y.kind, p.kind) && (!p.sub || sameKind(y.sub, p.sub)));
    if (!x) return false;
    const pc = placeOfDish(w, p.from, x.name);
    return WET_SUBS.some((ws) => sameKind(ws, pc.sub)) || (!!pc.item && catalogItem(pc.item)?.kind.name === "Gravy");
  };
  /** A slot-day's plate as planned: each dish with whom it is not for and its notes; the plate kept for the meals linked to it.
   *  Dishes from `from` on are checked for what is not known of them (once each). */
  const keepPlate = (d: PlanDay, k: string, plate: Plate, from = 0) => {
    const row = dayOf(d);
    // A dish for some people only is checked for them.
    const rowFor = (x: Plate[number]) => (x.for.length ? { ...row, people: x.for } : row);
    res.plates.set(k, plate.map((x) => ({ name: x.name, new: x.isNew, not_for: notFor(w, rowFor(x), x.name), note: leaveOutNotes(w, rowFor(x), x.name).join("; ") || null,
      for_people: [...x.for], linked: x.linked })));
    filled.set(k, plate);
    // A dish whose fit for someone's rule is not known is planned and asked: once per placement, per person and ingredient.
    for (const x of plate.slice(from)) { prep(x.name); res.unknowns.push(...ruleUnknowns(w, rowFor(x), x.name)); }
  };
  /** Does a dish at a meal hold one of a require's items, by what it contains (its saved contents, else its catalog item's). */
  const holdsItem = (r: Rule, slot: string, name: string) => { prep(name); return r.items!.some((i) => factsOf(w, slot, name).tags.has(canonTag(i))); };
  /** A require of a person whose own add-on of that meal comes later that day (H12): met when a dish of that add-on holds its
   *  item, else fed on the meal's plate once the add-on is filled (or found to have nothing). */
  type Waiting = { r: Rule; who: string; s: Slot; d: PlanDay; k: string; plate: Plate; part: number; addon: PlanDay };
  const waiting: Waiting[] = [];
  const ownHolds = (x: Pick<Waiting, "r" | "who" | "addon">, names: string[]) =>
    names.some((n) => holdsItem(x.r, x.addon.slot, n) && !excluded(x.addon, [x.who], n).length);
  const settle = (x: Waiting) => {
    waiting.splice(waiting.indexOf(x), 1);
    if (ownHolds(x, (filled.get(slotDayKey(x.addon.date, x.addon.slot)) ?? []).map((y) => y.name))) return;
    const from = x.plate.length;
    if (feed(x.s, x.d, x.plate, [x.who], x.part, [], [], null, (n) => holdsItem(x.r, x.s.name, n))) keepPlate(x.d, x.k, x.plate, from);
    else res.unmet.push(`${label(x.d)}: no dish with ${x.r.items!.join(" or ")} for ${x.who}`);
  };
  for (const d of todo) {
    const s = shapeOf(d.slot);
    const k = slotDayKey(d.date, s.name);
    let ti = tplOf.get(k);
    const plate: Plate = [];
    const people = d.people;
    // The people fed at their own add-on that day are not fed here.
    // (Only an add-on that has something to give: one with no dish of theirs and no template feeds nobody.)
    // An extras add-on (Shiva's eggs and salad beside the home lunch) keeps its people at the main meal.
    const atTable = s.kind === "addon" ? people : people.filter((p) => { const a = ownAddon(w, dayOf(d), p); return !a || !canFeed(a.slot) || !!slotByKey.get(a.slot.toLowerCase())?.extras; });
    if (ti === undefined) { res.plates.set(k, []); continue; }
    // Egg/cheese days (§5.4): in a meal with a part linked to another's kind, a template of its own with a share (the "sometimes"
    // roll) comes on the days that kind's item there is wet, its days taken from the other days it was given.
    {
      const ts = s.templates!;
      const linkOf = (i: number) => ts[i].parts.find((p): p is LinkedPart => isLinkedPart(p) && !!p.kind);
      const linkedTs = ts.map((_, i) => i).filter((i) => !!linkOf(i) && onDay(ts[i], d.date));
      const alts = ts.map((_, i) => i).filter((i) => !!ts[i].share && !ts[i].parts.some(isLinkedPart) && onDay(ts[i], d.date));
      if (linkedTs.length && alts.length) {
        const mineDays = planned.filter((x) => same(x.slot, s.name));
        const given = (i: number) => mineDays.filter((x) => x.date < d.date && tplOf.get(slotDayKey(x.date, s.name)) === i).length;
        const lt = linkOf(linkedTs.includes(ti) ? ti : linkedTs[0])!;
        if (linkedTs.includes(ti) && wetAt(d.date, lt)) {
          const alt = [...alts].sort((a, b) => given(a) - given(b) || a - b)[0];
          res.log.push(`${label(d)}: its ${lt.from} ${lt.kind} is wet; template ${alt + 1} instead`);
          ti = alt; tplOf.set(k, ti);
        } else if (alts.includes(ti) && !wetAt(d.date, lt)) {
          const share = mineDays.filter((x) => alts.includes(firstTpl.get(slotDayKey(x.date, s.name)) ?? -1)).length;
          if (mineDays.filter((x) => x.date < d.date && alts.includes(tplOf.get(slotDayKey(x.date, s.name)) ?? -1)).length >= share) {
            res.log.push(`${label(d)}: its share of template ${ti + 1} went to a wet day; template ${linkedTs[0] + 1} instead`);
            ti = linkedTs[0]; tplOf.set(k, ti);
          }
        }
      }
    }
    // A template that cannot be filled that day (fish on a day the house keeps vegetarian, a breakfast whose items are all
    // kept from someone), or only with an item had yesterday, gives way to another of the meal's: the one had least this
    // week, never yesterday's when another fits. A plate is never left bare of what its template promised.
    const wordsAllow = (p: TemplatePart) => { const ls = partLimits(s, p); return !ls.length || !!openLimit(s.name, ls, d.date, limitUse); };
    /** An {items} part that is the meal's everyday dish (a box's paratha): its dishes are had daily by the family's words, or its
     *  template is the meal's usual one (no share, no days) beside templates that each come only "sometimes" (a share). A repeat
     *  of it never moves the template; any other part keeps "never the next day". */
    const everyday = (i: number, p: TemplatePart) => isItemsPart(p) && (p.items.every((n) => rowAt(s.name, dishKey(n))?.frequency === "daily")
      || (!s.templates![i].share && !s.templates![i].days?.length && s.templates!.length > 1 && s.templates!.every((o, j) => j === i || !!o.share)));
    const can = (i: number, fresh: boolean) => onDay(s.templates![i], d.date) && s.templates![i].parts.every((p) => isLinkedPart(p) || (wordsAllow(p) && (isStaplePart(s, p) || (() => {
      const { fam, neu, kind, sub } = poolsOf(s, p);
      if ((pinsOf.get(k) ?? []).some((r) => fam.some((x) => x.key === r.key) || (!!kind && sameKind(placeOf(r)?.kind, kind) && (!sub || sameKind(placeOf(r)?.sub, sub))))) return true;
      // The meal's everyday fixed dish ("paratha" in the box every day) never moves the template for a repeat of it.
      return !!choose(s, d, [], stepsFor(fam, neu).filter((st) => !fresh || !st.next || everyday(i, p)), atTable, false);
    })())));
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
    /** Fill one part on this plate. `ps`: the meal whose items fill it (a linked part's own meal when that meal is not cooked
     *  that day); the dish is still this slot-day's. */
    const fillPart = (p: KindPart | TemplatePart, part: number, ps: Slot = s) => {
      // A staple: their usual item, every time; a person who may not eat it gets another of its kind.
      const lims = partLimits(ps, p), lim = lims.length ? openLimit(ps.name, lims, d.date, limitUse) : null;
      if (isStaplePart(ps, p)) {
        const kind = (p as { kind: string }).kind;
        // Their staple kept to its words ("chapati twice a week"): past them, another of theirs of its kind free of such words.
        const other = lims.length && !lim ? famRows.find((r) => same(r.slot, ps.name) && sameKind(placeOf(r)?.kind, kind) && !limitOf(r)) : undefined;
        const name = other?.name ?? stapleOf(ps, kind);
        const it: Item = { name, key: dishKey(name), kind, sub: null, family: true, idx: 0 };
        if (plate.some((x) => x.key === it.key)) return;
        if (lims.length && !lim && !other) res.log.push(`${label(d)}: ${name} past the family's words for it (no other ${kind} of theirs)`);
        put(s, d, plate, it, part, true);
        if (lim && !other) markLimit(ps.name, lim, d.date, limitUse);
        for (const who of excluded(d, atTable, name)) {
          if (plate.some((x) => x.part === part && x.key !== it.key && !excluded(d, [who], x.name).length)) continue;
          const alts: Item[] = uniq([...famRows.filter((r) => sameKind(placeOf(r)?.kind, kind)).map((r) => r.name), ...(catalogKind(kind)?.items ?? []).map((i) => i.name)])
            .map((n, i) => ({ name: n, key: dishKey(n), kind, sub: null, family: true, idx: i }));
          const got = choose(s, d, plate, [{ items: alts, isNew: false, share: false, repeat: true, next: true, zero: true }], [who], true);
          if (got) put(s, d, plate, got.it, part, true);
        }
        return;
      }
      const { kind, sub, fam, neu } = poolsOf(ps, p);
      // A pinned dish of this part, on its day.
      const pin = ps !== s ? undefined : pins.find((r) => fam.some((x) => x.key === r.key) || (!isKindPart(p) ? false : sameKind(placeOf(r)?.kind, kind) && (!sub || sameKind(placeOf(r)?.sub, sub))));
      let got: { it: Item; ex: string[] } | null = null;
      if (pin) {
        pins.splice(pins.indexOf(pin), 1);
        const it: Item = fam.find((x) => x.key === pin.key) ?? { name: pin.name, key: pin.key, kind: kind ?? pin.name, sub: placeOf(pin)?.sub ?? null, family: true, idx: 0, row: pin };
        if (!plate.some((x) => x.key === it.key)) got = { it, ex: excluded(d, atTable, it.name) };
      }
      // A part the family's words keep from this day (its days, or its count reached): left off, never filled by something
      // standing in for their dish.
      if (!pin && lims.length && !lim) { res.log.push(`${label(d)}: its ${sub ?? kind ?? "own dish"} kept to the family's words; left off`); return; }
      got ??= choose(s, d, plate, stepsFor(fam, neu), atTable, false);
      if (!got) {
        if (s.kind !== "addon") res.unmet.push(`${label(d)}: nothing for its ${sub ?? kind ?? "own dish"}`);
        return;
      }
      // Said only where the part had another item to give: a part whose one dish it is (a box's Paratha every day it runs)
      // has it every day, as the family said.
      const only = !neu.length && fam.every((x) => x.key === got!.it.key);
      if (got.it.family && usedDates.get(got.it.key)?.has(addDays(d.date, -1)) && s.kind !== "addon" && !pin && !only) res.unmet.push(`${label(d)}: ${got.it.name} comes back sooner than usual`);
      put(s, d, plate, got.it, part, false);
      if (lims.length) { const l = wordsFor(ps.name, got.it).find((x) => lims.some((y) => y.row.key === x.row.key)) ?? lim; if (l) markLimit(ps.name, l, d.date, limitUse); }
      // Their own item for this part, for each person the item is not for.
      for (const who of got.ex) {
        if (!atTable.includes(who)) continue;
        if (plate.some((x) => x.part === part && !excluded(d, [who], x.name).length)) continue;
        feed(s, d, plate, [who], part, fam, neu, kind);
      }
    };
    t.parts.forEach((p, part) => {
      if (!isLinkedPart(p)) { fillPart(p, part); return; }
      // A linked part: the item the meal it links to has of its kind that day (its whole plate with no kind), as it is there:
      // not used again (no repeat), never new, the cook makes it once.
      // That meal was filled without this slot-day's people at its table: an item that is a known break for every one of them
      // here is not theirs (an unknown is kept and asked, §5.2); the part then picks its own item, as on a day it is not cooked.
      const theirs = (x: Plate[number]) => !atTable.length || excluded(d, atTable, x.name).length < atTable.length;
      const hits = (sourceOf(d.date, p.from) ?? []).filter((x) => !p.kind || (sameKind(x.kind, p.kind) && (!p.sub || sameKind(x.sub, p.sub))));
      const take = (p.kind ? hits.slice(0, 1) : hits).filter(theirs);
      if (take.length) {
        for (const x of take) if (!plate.some((y) => y.key === x.key)) { plate.push({ ...x, part, isNew: false, for: [], linked: true }); dayOf(d).dishes.push(x.name); }
        return;
      }
      // That meal is not cooked that day (eaten out, ordered in, or no item of the kind): the part picks its own item, of that
      // meal's items (Review Focus 1): a kind part of its kind; a whole plate, one of that meal's templates.
      const ps = slotByKey.get(p.from.toLowerCase()) ? shapeOf(p.from) : s;
      res.log.push(`${label(d)}: ${p.from} is not cooked that day; its ${p.sub ?? p.kind ?? "plate"} picked on its own`);
      if (p.kind) { fillPart({ kind: p.kind, ...(p.sub ? { sub: p.sub } : {}) }, part, ps); return; }
      const pts = (ps.templates ?? []).map((_, i) => i).filter((i) => onDay(ps.templates![i], d.date) && !ps.templates![i].parts.some(isLinkedPart));
      const had = (i: number) => planned.filter((x) => same(x.slot, ps.name) && tplOf.get(slotDayKey(x.date, ps.name)) === i).length;
      const pick = pts.sort((a, b) => had(a) - had(b) || a - b)[0];
      if (pick === undefined) { res.unmet.push(`${label(d)}: nothing for its ${p.from} plate`); return; }
      for (const q of ps.templates![pick].parts) fillPart(q, part, ps);
    });
    // A pinned dish no template part holds: on the plate beside.
    for (const pin of pins) if (!plate.some((x) => x.key === pin.key)) put(s, d, plate, { name: pin.name, key: pin.key, kind: placeOf(pin)?.kind ?? pin.name, sub: null, family: true, idx: 0, row: pin }, t.parts.length, false);
    // A dish the family has every day (or usually) at this meal comes on its days whatever the template (class 2).
    const mineDays = planned.filter((x) => same(x.slot, s.name)).map((x) => x.date).sort();
    const nth = mineDays.indexOf(d.date);
    for (const r of famRows.filter((x) => same(x.slot, s.name) && (x.frequency === "daily" || x.frequency === "usually"))) {
      const want = r.frequency === "daily" ? mineDays.length : Math.round((TEMPLATE_DAYS.usually * mineDays.length) / 7);
      const on = Math.floor(((nth + 1) * want) / mineDays.length) > Math.floor((nth * want) / mineDays.length);
      if (!on || (r.days?.length && !r.days.includes(weekdayOf(d.date)))) continue;
      const pl = placeOf(r);
      // Already there, or an item of its kind is (oats idli on an idli morning); or a template of the meal that holds it
      // has the family's share for it ("idli most days": the template comes that often).
      if (plate.some((x) => x.key === r.key || (!!pl && sameKind(x.kind, pl.kind) && (!pl.sub || !catalogKind(pl.kind) || catalogKind(pl.kind)!.subs.length < 2 || sameKind(x.sub, pl.sub))))) continue;
      if ((s.templates ?? []).some((tp) => tp.share === r.frequency && holds(tp, r))) continue;
      const pool: Item[] = [{ name: r.name, key: r.key, kind: pl?.kind ?? r.name, sub: pl?.sub ?? null, family: true, idx: 0, row: r }];
      const got = choose(s, d, plate, [{ items: pool, isNew: false, share: false, repeat: true, next: true, zero: false }], atTable, false);
      if (got) put(s, d, plate, got.it, t.parts.length, false);
    }
    // A hard swap's item is a planned dish for its person (§9.4): beside what it swaps, on this plate, used (rotation, never the
    // next day) and cooked. An item: that item, even one they disliked (Review Focus 5); a kind: the family's item of it had
    // longest ago, else a catalog item, new. A linked dish it swaps leaves that person's box.
    const at = { ...dayOf(d), people: atTable };
    for (const x of plate.filter((y) => !y.for.length)) for (const sw of swapsAt(w, at, x.name)) {
      const who = atTable.find((p) => same(p, sw.who));
      if (!who) continue;
      const g = sw.gives;
      if (g.type === "ingredient") continue;
      let it: Item | null = null;
      if (g.type === "item") {
        const key = dishKey(g.item), row = rowAt(s.name, key), hit = catalogItem(g.item);
        it = { name: row?.name ?? hit?.item.name ?? g.item.trim(), key, kind: row?.kind ?? g.kind ?? hit?.kind.name ?? g.item.trim(), sub: row?.sub ?? hit?.item.sub ?? null,
          family: true, idx: 0, ...(row ? { row } : {}) };
      } else {
        const sub = g.type === "sub" ? g.sub : null, seen = new Set<string>();
        const fam: Item[] = famRows.filter((r) => sameKind(placeOf(r)?.kind, g.kind) && (!sub || sameKind(placeOf(r)?.sub, sub)) && !seen.has(r.key) && !!seen.add(r.key))
          .map((r, i) => ({ name: r.name, key: r.key, kind: g.kind, sub: placeOf(r)?.sub ?? null, family: true, idx: i, row: r }));
        it = choose(s, d, plate, stepsFor(fam, catalogPool(s, g.kind, sub, [], false)), [who], true)?.it ?? null;
      }
      if (!it) { res.unmet.push(`${label(d)}: nothing to give ${who} in place of ${x.name}`); continue; }
      const given = it;
      if (!plate.some((y) => y.key === given.key && (!y.for.length || y.for.some((p) => same(p, who))))) put(s, d, plate, given, x.part, false, [who]);
      if (x.linked) {
        x.for = (x.for.length ? x.for : atTable).filter((p) => !same(p, who));
        if (!x.for.length) {
          plate.splice(plate.indexOf(x), 1);
          const ds = dayOf(d).dishes, i = ds.findIndex((n) => dishKey(n) === x.key);
          if (i >= 0) ds.splice(i, 1);
        }
      }
    }
    // Still nothing beside the staples where the template had more (no template could be filled that day): the family's own
    // dish of this meal had longest ago, or one of another part's kind. Nobody's meal is ever empty.
    if (s.kind !== "addon" && atTable.length && !plate.some((x) => !x.staple) && t.parts.some((p) => !isStaplePart(s, p) && !isLinkedPart(p))) {
      if (feed(s, d, plate, atTable, t.parts.length, [], [], null)) res.log.push(`${label(d)}: nothing of its template that day; another dish of theirs instead`);
    }
    // An add-on day with nothing: fine where its people eat the main meal's dishes; else one of its dishes comes back (its fixed
    // dishes, or its own items of a part's kind), one its people may eat first.
    if (s.kind === "addon" && !plate.length && !mainFeeds(w, dayOf(d))) {
      const fam = uniq((s.templates ?? []).flatMap((x) => x.parts).flatMap((p) => (isItemsPart(p) ? p.items : isLinkedPart(p) ? [] : rowsPool(s, p.kind, p.sub ?? null).map((x) => x.name))))
        .map((n, i): Item => ({ name: n, key: dishKey(n), kind: n, sub: null, family: true, idx: i }));
      const near = fam.filter((it) => fits(s, d, plate, it, { repeat: true, next: true, zero: false }, true))
        .sort((a, b) => excluded(d, d.people, a.name).length - excluded(d, d.people, b.name).length
          || (lastUsed.get(a.key) ?? "").localeCompare(lastUsed.get(b.key) ?? "") || a.idx - b.idx)[0];
      if (near) { put(s, d, plate, near, 0, false); res.unmet.push(`${label(d)}: ${near.name} comes back sooner than usual`); }
    }
    // Nobody left with nothing: each person has an item beside the staples they can eat (where the plate has more than staples).
    if (s.kind !== "addon" && plate.length) {
      const mains = plate.filter((x) => !x.staple);
      for (const who of atTable) {
        const can = plate.filter((x) => (!x.for.length || x.for.some((p) => same(p, who))) && !excluded(d, [who], x.name).length);
        if (can.length && (!mains.length || can.some((x) => !x.staple))) continue;
        if (!feed(s, d, plate, [who], t.parts.length, [], [], null)) res.unmet.push(`${label(d)}: ${who} has nothing to eat there`);
      }
      // A require kept: one dish with its item for its person.
      for (const r of rules.filter((x) => x.hard && x.what === "require" && x.items?.length && x.who && atTable.some((p) => same(p, x.who!)) && ruleHolds(x, d.date, s, s.name, weekSlotList))) {
        const who = atTable.find((p) => same(p, r.who!))!;
        const has = (name: string) => holdsItem(r, s.name, name);
        if (plate.some((x) => has(x.name) && !excluded(d, [who], x.name).length)) continue;
        // Their own add-on of this meal that day (an extras add-on beside it) meets it when a dish of it holds the item (H12):
        // known now when that day is fixed or already filled, else once it is filled.
        const addon = ownAddon(w, dayOf(d), who);
        if (addon) {
          const ak = slotDayKey(addon.date, addon.slot);
          const theirs = addon.fixed ? addon.dishes : filled.get(ak)?.map((x) => x.name);
          if (!theirs) { waiting.push({ r, who, s, d, k, plate, part: t.parts.length, addon }); continue; }
          if (ownHolds({ r, who, addon }, theirs)) continue;
        }
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
    keepPlate(d, k, plate);
    for (const x of waiting.filter((y) => slotDayKey(y.addon.date, y.addon.slot) === k)) settle(x);
  }
  // A require still waiting on an add-on that was never filled (no template that day): its add-on gave nothing.
  for (const x of [...waiting]) settle(x);
  // A cook's visit over her limit on a day no template kept it (§9.3, OD6): said, never a part dropped. Every distinct dish she
  // COOKS in the visit's meals that day counts (a box's own item, a swap item; not a staple or no-cook item); a linked dish is the other meal's, once.
  for (const v of visits) {
    const dates = uniq(planned.filter((x) => inVisit(v, x.slot)).map((x) => x.date)).filter((x) => v.days.includes(weekdayOf(x))).sort();
    for (const date of dates) {
      const n = new Set(days.filter((x) => x.date === date && !x.skip && inVisit(v, x.slot)).flatMap((x) => x.dishes.filter((n) => needsCook(x.slot, n)).map(dishKey))).size;
      if (n > v.cap) res.unmet.push(`${weekdayOf(date)} ${v.label}: ${n} dishes to cook, more than ${v.cook ? `${v.cook}'s` : "the cook's"} ${v.cap}`);
    }
  }
  res.unmet = uniq(res.unmet);
  res.facts = w.facts;
  res.ownItems = w.ownItems;
  return res;
}
