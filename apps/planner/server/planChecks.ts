// What code checks and mends of a week's plan (docs/slot-model-spec.md §5.2, §5.4; owner 25 Nov): each slot's facts and the
// plates' parts (the rice or bread a day must have, the staples); every hard rule kept for every person at every slot-day,
// read from what each dish contains and failing closed where a dish was never read for a rule's item, an allergy by the
// family's word for their own dishes or a careful read; the feasibility check, which says up front where the library is
// too thin and relaxes in a fixed order; and the walk, which makes the slot call's week right day by day: every dish from
// the slot's library, a staple, a particular way of a family dish or a new one within the budget (never disliked or
// dropped), on its days, at most its days a week across all slots, no main twice a day, nobody without food. Pure: no
// database, no model.
import { BASE_TAGS, DEFAULT_DISH_DAYS, FREQUENCY_DAYS, REPEAT_WINDOW_DAYS, REPEAT_WINDOW_RELAXED, SLOT_ORDER, STAPLES_FROM_PLANNED, TAG_PARENT,
  UNTRIED_MAX_OFFERS, type Frequency } from "./db/constants";
import { isAllergyRule } from "./allergy";
import { addDays, weekdayOf } from "./dates";
import { dishKey } from "./dishText";
import { looksLike, looksLikeRows, staples, type HistoryRow, type LibraryDish, type Rule, type Slot } from "./slotStore";
import { ruleHolds, type PlanDay } from "./planDays";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

// ── Tags ──

/** A rule item or a contains tag in one spelling: "@nuts" is "nuts", "Onion garlic" is "onion_garlic". */
export const canonTag = (t: string): string => t.trim().toLowerCase().replace(/^@/, "").replace(/[\s-]+/g, "_");
/** A dish's tags with the kinds they are of: a chicken dish has meat. */
export function withParents(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const t0 of tags) for (let t: string | undefined = canonTag(t0); t; t = TAG_PARENT[t]) out.add(t);
  return out;
}
/** Was a dish read for an item: the item itself, or a kind it is of, was read. */
export function readFor(read: Set<string>, item: string): boolean {
  for (let t: string | undefined = canonTag(item); t; t = TAG_PARENT[t]) if (read.has(t)) return true;
  return false;
}
/** What a dish contains and was read for. */
export type DishFacts = { tags: Set<string>; read: Set<string> };

/** The tags a hard rule forbids to its person: vegetarian forbids meat and fish; no eggs, eggs; an avoid and a swap, their
 *  items; eggs-but-no-meat, its items or meat and fish. */
export function forbidden(r: Rule): string[] {
  const items = (r.items ?? []).map(canonTag);
  switch (r.what) {
    case "veg": return uniq(["meat", "fish", ...items]);
    case "no_eggs": return uniq(["egg", ...items]);
    case "egg": return items.length ? items : ["meat", "fish"];
    case "avoid": case "swap": return items;
    default: return [];
  }
}
/** Every tag the family's rules name, and the base ones: what a new dish is read for. */
export function ruleTags(rules: Rule[]): string[] {
  return uniq([...BASE_TAGS, ...rules.flatMap((r) => [...forbidden(r), ...(r.items ?? []).map(canonTag), ...(r.to ? [canonTag(r.to)] : [])])]).filter(Boolean);
}

// ── A slot's own facts for the week ──

/** How many days a week a dish may come, [min, max], by its frequency (null: none said, at most DEFAULT_DISH_DAYS). */
export function frequencyRange(f: Frequency | null): [number, number] | null {
  if (!f) return null;
  if (f in FREQUENCY_DAYS) return FREQUENCY_DAYS[f as keyof typeof FREQUENCY_DAYS];
  const n = Number.parseInt(f, 10);
  return Number.isFinite(n) ? [n, n] : null;
}
/** A dish placed that the family never ate and never kept: dropped after UNTRIED_MAX_OFFERS offers. */
export const isDropped = (d: LibraryDish): boolean => d.untried && d.offers >= UNTRIED_MAX_OFFERS;
/** May a library row be planned as a library dish: not disliked, not dropped, not a suggestion only offered as new. */
export const plannable = (d: LibraryDish): boolean => !d.disliked && !isDropped(d) && !d.suggested;

/** The rows staples are counted from (a single filter, so it can be flipped: STAPLES_FROM_PLANNED). */
export const stapleRows = (rows: HistoryRow[]): HistoryRow[] => rows.filter((r) => r.date === null || r.status === "confirmed" || STAPLES_FROM_PLANNED);

/** The non-staple dishes counted on a main meal's plate when the family gave no plate of theirs (#29). */
export const UNKNOWN_MAIN_PLATE = 3;

// ── The plates' parts (one fast read a run, makePlan's PARTS call) ──

/** What a dish is on the plate: the rice or bread eaten with the rest; a complete dish (its own rice or bread, or a meal by
 *  itself: rajma chawal, khichdi, dosa); a main eaten with rice or bread (dal, sabzi, curry); a side (curd, salad, pickle). */
export const PART_KINDS = ["rice_or_bread", "complete", "main", "side"] as const;
export type PartKind = (typeof PART_KINDS)[number];
/** A dish's place on the family's plates: `part` its plain name (the same name for dishes that take the same place). */
export type Part = { part: string; kind: PartKind };
/** Kinds that are staples of a slot (no weekly cap): the rice or bread, and the sides. */
const BASE_KINDS: PartKind[] = ["rice_or_bread", "side"];

export type SlotFacts = { slot: Slot; library: LibraryDish[]; staples: string[]; daily: string[]; looks_like: string[];
  /** The family's own plates here (seed and confirmed), each its dishes. */ plates: string[][]; typical: number;
  /** The fewest and most dishes on the slot's past plates (seed and confirmed); null: none. */ plate: [number, number] | null;
  /** Each dish's part on the plate, by key (the parts read; new dishes, spares and variants as they come). */ parts: Map<string, Part>;
  /** The rice or bread every day here has (one of them), from the family's plates; [] none. */ mustHave: string[];
  /** Days of each shared dish the feasibility check set aside for this slot (by key). */ takes: Map<string, number>;
  recent: Record<string, string[]>; window: number; newAllowed: number; short: boolean;
  /** A short slot's own new dishes (owner 24 Nov): its shortfall in dishes, beside the week's setting and not counted
   *  against it; 0 for a slot that is not short. */ shortNew: number };

/** The typical count of non-staple dishes on the family's plates here (the median); none: one, or a main meal's plate. */
function typicalOf(sf: Pick<SlotFacts, "slot" | "library" | "plates" | "staples">): number {
  const keys = new Set(sf.staples.map(dishKey));
  const counts = sf.plates.map((r) => r.filter((d) => !keys.has(dishKey(d))).length).sort((a, b) => a - b);
  // A plate of staples only (two phulkas every night) has no other dish to fill; no history: one. A main meal with no plate
  // and no dish of theirs (planned from new dishes only, the family said "suggest some") is counted as the plate a model
  // fills, a main, a side and its rice or bread (#29: one a plate made 4 new dishes for 21 places, and repeats).
  return counts.length ? counts[Math.floor((counts.length - 1) / 2)] : sf.slot.kind === "main" && !sf.library.some(plannable) ? UNKNOWN_MAIN_PLATE : 1;
}

/** A slot's staples (history's, from confirmed rows only, and every dish the family has daily; the parts read adds the
 *  rice, bread and sides: applyParts), looks like (seed and confirmed), recent (any status) and the typical count of
 *  non-staple dishes on a plate. */
export function slotFacts(slot: Slot, library: LibraryDish[], history: HistoryRow[], recentRows: Record<string, string[]>): SlotFacts {
  const mine = library.filter((d) => same(d.slot, slot.name));
  const daily = mine.filter((d) => d.frequency === "daily" && plannable(d)).map((d) => d.name);
  const all = [...staples(stapleRows(history)), ...daily].filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
  const rows = looksLikeRows(history);
  const plates = rows.map((r) => r.dishes.map((d) => d.dish.trim()));
  const sizes = rows.map((r) => r.dishes.length).filter((n) => n > 0);
  const plate: [number, number] | null = sizes.length ? [Math.min(...sizes), Math.max(...sizes)] : null;
  const sf: SlotFacts = { slot, library: mine, staples: all, daily, looks_like: looksLike(history), plates, typical: 1, plate, parts: new Map(), mustHave: [],
    takes: new Map(), recent: recentRows, window: REPEAT_WINDOW_DAYS, newAllowed: 0, short: false, shortNew: 0 };
  sf.typical = typicalOf(sf);
  return sf;
}

/** The parts read applied to a slot: each dish's part; the rice, bread and sides on its plates or in its library are its
 *  staples (no weekly cap); the typical plate counted again; and its must-have rice or bread. */
export function applyParts(sf: SlotFacts, parts: Map<string, Part>): void {
  const names = [...sf.plates.flat(), ...sf.library.map((d) => d.name), ...sf.staples];
  for (const n of names) { const x = parts.get(dishKey(n)); if (x) sf.parts.set(dishKey(n), x); }
  const base = names.filter((n) => BASE_KINDS.includes(sf.parts.get(dishKey(n))?.kind as PartKind) && !sf.library.some((d) => d.key === dishKey(n) && !plannable(d)));
  sf.staples = [...sf.staples, ...base].filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
  sf.typical = typicalOf(sf);
  sf.mustHave = mustHaveOf(sf);
}
/** The rice or bread a slot's every day has (owner 25 Nov): at lunch and dinner, the rice or bread the family's plates have;
 *  at another slot only when every plate of theirs has one (or a complete dish). */
function mustHaveOf(sf: SlotFacts): string[] {
  const kind = (x: string) => sf.parts.get(dishKey(x))?.kind;
  const breads = sf.plates.flat().filter((x) => kind(x) === "rice_or_bread").filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
  if (!breads.length) return [];
  const meal = sf.slot.kind === "main" && sf.slot.order >= SLOT_ORDER.Lunch;
  return meal || sf.plates.every((pl) => pl.some((x) => kind(x) === "rice_or_bread" || kind(x) === "complete")) ? breads : [];
}
/** A dish's part at a slot, when known. */
export const partOf = (w: Week, slot: string, dish: string): Part | undefined => w.slots.get(slotKey(slot))?.parts.get(dishKey(dish));
/** Does a dish bring the day's rice or bread: it is one, or a complete dish. */
const isBase = (w: Week, slot: string, dish: string) => { const k = partOf(w, slot, dish)?.kind; return k === "rice_or_bread" || k === "complete"; };

// ── The week as checked: every slot-day, the slots done ──

export type Week = { days: PlanDay[]; slots: Map<string, SlotFacts>; rules: Rule[]; library: LibraryDish[]; facts: Map<string, DishFacts>;
  /** The slots whose dishes are settled (fixed ones count always). */ done: Set<string>; newBudget: number;
  /** New dishes placed so far, by key, with the slot they were placed at and the family's dish it is like. */ newDishes: Map<string, { name: string; slot: string; why: string; like?: string }>;
  /** What each of the week's guest rules (their words) forbids, as tags, from one read; none read: not checked. */ guestTags?: Map<string, string[]>;
  /** The careful allergy read (owner 25 Nov), by dish key: the allergy tags the dish has or may have. Given: a dish the
   *  family does not vouch for is safe for an allergy only by this read (none: not safe). Not given: the contains read. */
  careful?: Map<string, Set<string>> };

const slotKey = (s: string) => s.toLowerCase();
/** The week's setting (new_dishes_per_week) used so far: each slot's new dishes past its own short-slot allowance (owner
 *  24 Nov: a short slot's new dishes are beside the setting, not counted against it). `skip`: new dishes not to count. */
export function settingUsed(w: Week, skip?: (key: string, slot: string) => boolean): number {
  const bySlot = new Map<string, number>();
  for (const [k, v] of w.newDishes) if (!skip?.(k, v.slot)) bySlot.set(slotKey(v.slot), (bySlot.get(slotKey(v.slot)) ?? 0) + 1);
  return [...bySlot].reduce((n, [s, c]) => n + Math.max(0, c - (w.slots.get(s)?.shortNew ?? 0)), 0);
}
export const isStapleAt = (w: Week, slot: string, dish: string): boolean => !!w.slots.get(slotKey(slot))?.staples.some((x) => dishKey(x) === dishKey(dish));
const libAt = (w: Week, slot: string, dish: string): LibraryDish | undefined => w.library.find((d) => same(d.slot, slot) && d.key === dishKey(dish));
/** A dish at an add-on slot with no how-often or days said: that person's standing difference (his phulkas every dinner).
 *  Like a staple there, it has no weekly cap and no repeat window; only a said frequency or days thins it (owner, 24 Nov). */
const standing = (w: Week, slot: string, dish: string): boolean => {
  if (w.slots.get(slotKey(slot))?.slot.kind !== "addon") return false;
  const row = libAt(w, slot, dish);
  return !!row && !row.frequency && !row.days?.length;
};

/** A dish that is one of the family's own entry made a particular way: its name keeps every word of the entry's and adds to it
 *  ("Bhindi sabzi" of "Sabzi", "Moong dal" of "Dal", "Idli with coconut chutney" of "Idli with chutney"), or the same dish
 *  with another accompaniment ("Idli with tomato chutney" of "Idli with coconut chutney"). The slot call
 *  names it so, with the entry as its `like`; it is the family's dish, not a new one. */
export function isVariantOf(entry: string, dish: string): boolean {
  const words = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const e = words(entry), d = words(dish);
  if (e.length > 0 && d.length > e.length && e.every((x) => d.includes(x))) return true;
  // The same dish with another accompaniment: "Idli with tomato chutney" of their "Idli with coconut chutney".
  const main = (w: string[]) => (w.includes("with") ? w.slice(0, w.indexOf("with")).join(" ") : null);
  const em = main(e), dm = main(d);
  return !!em && em === dm && e.join(" ") !== d.join(" ");
}
/** The library row a variant plans as: the entry's own row (its how often and days) under the variant's name, read afresh
 *  for what it contains; never saved to the library. */
export const variantRow = (entry: LibraryDish, name: string): LibraryDish => ({ ...entry, id: `variant:${dishKey(name)}`, key: dishKey(name), name,
  contains: [], contains_read: [], suggested: false, untried: false, offers: 0, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [] });
export const isVariantRow = (d: LibraryDish): boolean => d.id.startsWith("variant:");

/** What a dish contains and was read for, at a slot: its library row there, else any row of it, else a read made this run. */
export function factsOf(w: Week, slot: string, dish: string): DishFacts {
  const row = libAt(w, slot, dish) ?? w.library.find((d) => d.key === dishKey(dish));
  const run = w.facts.get(dishKey(dish));
  if (run) return run;
  return row ? { tags: withParents(row.contains), read: new Set(row.contains_read.map(canonTag)) } : { tags: new Set(), read: new Set() };
}

/** Is a dish the family's own: in their library (not a suggestion of the planner's, not a variant of one of theirs), or on
 *  one of their own plates. */
function familyDish(w: Week, key: string): boolean {
  return w.library.some((d) => d.key === key && !isVariantRow(d) && !d.suggested && d.origin !== "planner_suggested")
    || [...w.slots.values()].some((sf) => sf.plates.some((pl) => pl.some((x) => dishKey(x) === key)));
}
/** Does the family vouch for a dish under an allergy rule (owner 25 Nov): a house-wide one, every family dish (the house
 *  cooks without it); one person's, a family dish on the family's own plates at a slot that person eats (the house cooks
 *  without it, or keeps their portion aside). Such a dish needs no read for that allergy. */
export function vouched(w: Week, r: Rule, dish: string): boolean {
  const key = dishKey(dish);
  if (!familyDish(w, key)) return false;
  if (!r.who) return true;
  return [...w.slots.values()].some((sf) => sf.plates.some((pl) => pl.some((x) => dishKey(x) === key))
    && (sf.slot.usual_people.some((p) => same(p, r.who!)) || w.days.some((d) => same(d.slot, sf.slot.name) && d.people.some((p) => same(p, r.who!)))));
}
/** The allergy tags a dish must be read for carefully (balanced, unsure counts as having it): those of every allergy rule
 *  the family does not vouch for it under. */
export function carefulTags(w: Week, dish: string): string[] {
  return uniq(w.rules.filter((r) => isAllergyRule(r) && !vouched(w, r, dish)).flatMap(forbidden));
}
/** The notes on a family dish one person's allergy is kept aside for (it has the item): "<person>'s <dish> without <item>". */
export function allergyNotes(w: Week, d: PlanDay, dish: string): string[] {
  const f = factsOf(w, d.slot, dish), out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p)) {
    if (!isAllergyRule(r) || !r.who || !vouched(w, r, dish)) continue;
    const items = (r.items ?? []).filter((i) => f.tags.has(canonTag(i)) || withParents([i]).has(canonTag(i)) && f.tags.has(canonTag(i)));
    if (items.length) out.push(`${p}'s ${dish} without ${items.join(", ").replace(/_/g, " ")}`);
  }
  return uniq(out);
}

/** The hard rules that hold for one person at a slot-day. */
function rulesFor(w: Week, d: PlanDay, person: string): Rule[] {
  const slot = w.slots.get(slotKey(d.slot))?.slot;
  return w.rules.filter((r) => r.hard && (!r.who || same(r.who, person)) && ruleHolds(r, d.date, slot, d.slot));
}
/** Why a dish cannot go to the people of a slot-day (empty: it can): an item it has, or one it was never read for. Pass a
 *  slot-day with one person to ask for that person. */
export function ruleBreaks(w: Week, d: PlanDay, dish: string): string[] {
  const f = factsOf(w, d.slot, dish), out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p)) for (const t of forbidden(r)) {
    if (isAllergyRule(r)) {
      // The family's word for their own dish; every other dish by the careful read only (owner 25 Nov).
      if (vouched(w, r, dish)) continue;
      if (w.careful) {
        const c = w.careful.get(dishKey(dish));
        if (!c) out.push(`${dish}: not read carefully for ${t.replace(/_/g, " ")}, so it cannot go to ${p} ("${r.quote}")`);
        else if (c.has(t)) out.push(`${dish} may have ${t.replace(/_/g, " ")}: against ${p}'s rule "${r.quote}"`);
        continue;
      }
    }
    if (r.what === "swap" && f.tags.has(t)) continue;   // a swap: the dish stays, with a note for them (swapNotes)
    if (f.tags.has(t)) out.push(`${dish} has ${t.replace(/_/g, " ")}: against ${p}'s rule "${r.quote}"`);
    else if (!readFor(f.read, t)) out.push(`${dish}: not known whether it has ${t.replace(/_/g, " ")}, so it cannot go to ${p} ("${r.quote}")`);
  }
  return uniq(out);
}
/** The people at a slot-day a dish is not for: a hard rule of theirs it breaks, or an item of their rule it was never read
 *  for (fail closed). Code's, never the model's (owner, 23 Nov: a fish lunch with dal for the vegetarian grandmother passes). */
export function notFor(w: Week, d: PlanDay, dish: string): string[] {
  return d.people.filter((p) => ruleBreaks(w, { ...d, people: [p] }, dish).length);
}
/** The notes a hard swap puts on a dish that has its items: "<to> in place of <items> for <who>". */
export function swapNotes(w: Week, d: PlanDay, dish: string): string[] {
  const f = factsOf(w, d.slot, dish), out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p)) if (r.what === "swap" && r.to && forbidden(r).some((t) => f.tags.has(t)))
    out.push(`${r.to} in place of ${(r.items ?? []).join(", ")} for ${p}`);
  return uniq(out);
}
/** Soft swaps with a count ("millets are good for him, a few times a week"), kept by code where the week falls short: on
 *  slot-days the person eats a dish with the swapped item, spread one a day, a note "<to> in place of <items> for <who>"
 *  until the count's least is met. Answers the notes by date|slot|dish key. */
export function softSwapNotes(w: Week): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of w.rules.filter((x) => !x.hard && x.what === "swap" && x.frequency && x.to && x.who && x.items?.length)) {
    const range = frequencyRange(r.frequency);
    if (!range) continue;
    const to = canonTag(r.to!), items = r.items!.map(canonTag);
    const theirs = w.days.filter((d) => !d.skip && d.dishes.length && d.people.some((p) => same(p, r.who!)) && ruleHolds(r, d.date, w.slots.get(slotKey(d.slot))?.slot, d.slot));
    const has = (d: PlanDay, t: string[]) => d.dishes.filter((x) => !notFor(w, d, x).some((p) => same(p, r.who!)) && t.some((y) => factsOf(w, d.slot, x).tags.has(y)));
    let kept = theirs.filter((d) => has(d, [to]).length).length;
    const done = new Set(theirs.filter((d) => has(d, [to]).length).map((d) => d.date));
    for (const d of theirs) {
      if (kept >= range[0]) break;
      if (done.has(d.date)) continue;
      const dish = has(d, items)[0];
      if (!dish) continue;
      out.set(`${d.date}|${d.slot}|${dishKey(dish)}`, `${r.to} in place of ${r.items!.join(", ").replace(/_/g, " ")} for ${r.who}`);
      done.add(d.date); kept++;
    }
  }
  return out;
}

/** A hard require that holds at a slot-day and no dish of it keeps. */
function requireBreaks(w: Week, d: PlanDay, dishes: string[]): string[] {
  const out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p).filter((x) => x.what === "require" && x.items?.length)) {
    if (!dishes.some((x) => !notFor(w, d, x).includes(p) && r.items!.some((i) => factsOf(w, d.slot, x).tags.has(canonTag(i)))))
      out.push(`no dish with ${r.items!.join(" or ")} for ${p} ("${r.quote}")`);
  }
  return uniq(out);
}

/** A person's own add-on slot-day beside this main slot-day (Grandmother's dinner beside Dinner), cooked that day. */
export function ownAddon(w: Week, d: PlanDay, person: string): PlanDay | undefined {
  // Once the add-on is planned, only a day it has dishes on feeds them (an add-on day may be empty, owner 23 Nov).
  return w.days.find((x) => x.date === d.date && !x.skip && x.people.some((p) => same(p, person))
    && w.slots.get(slotKey(x.slot))?.slot.kind === "addon" && same(w.slots.get(slotKey(x.slot))!.slot.addon_of ?? "", d.slot)
    && (x.dishes.length > 0 || (!x.fixed && !w.done.has(slotKey(x.slot)))));
}
/** Can an add-on slot-day be left empty: each of its people has a dish of their own at the main slot that day (beside the
 *  staples, when it has more), so nobody is left without one. */
export function mainFeeds(w: Week, d: PlanDay): boolean {
  const main = w.slots.get(slotKey(d.slot))?.slot.addon_of;
  if (!main) return true;
  const m = w.days.find((x) => x.date === d.date && same(x.slot, main));
  if (!m) return true;
  if (m.skip || !m.dishes.length) return false;
  const mains = m.dishes.filter((x) => !isStapleAt(w, m.slot, x));
  return d.people.every((p) => { const can = m.dishes.filter((x) => !notFor(w, { ...m, people: [p] }, x).length); return can.length && (!mains.length || can.some((x) => mains.includes(x))); });
}

// ── The checks a saved week is read against (changes.ts: a rule changed after the week was planned) ──

export type ProblemKind = "rule" | "soft_over" | "few";
export type Problem = { kind: ProblemKind; text: string; dish?: string; soft: boolean };
/** A dish the slot call says is new: why it suits, the family's dish it is like, and its part on the plate. */
export type NewName = { name: string; why: string; like?: string; part?: string };
/** A slot's proposal: its dishes by date, the dishes it says are new (by key), and its spare dishes by part. */
export type Proposal = { days: Map<string, string[]>; newNames: Map<string, NewName>; spares?: Map<string, string[]> };

/** Is a slot settled or still to come: does it count now. */
const counts = (w: Week, d: PlanDay) => d.fixed || w.done.has(slotKey(d.slot));

/** The hard-rule problems of a slot's days (a person left with nothing of their own, a require not kept, guests with
 *  nothing of theirs) and the soft rules with a count kept too often or too few times, by date ("" for the week's). */
export function checkSlot(w: Week, slotName: string, p: Proposal): Map<string, Problem[]> {
  const out = new Map<string, Problem[]>();
  const add = (date: string, pr: Problem) => { const xs = out.get(date) ?? []; if (!xs.some((x) => x.text === pr.text)) out.set(date, [...xs, pr]); };
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip);
  for (const d of mine) {
    const dishes = p.days.get(d.date) ?? [];
    if (!dishes.length) continue;
    for (const t of unfed(w, d, dishes)) add(d.date, { kind: "rule", text: t, soft: false });
  }
  for (const r of w.rules.filter((x) => !x.hard && x.frequency && (x.what === "swap" || x.what === "require"))) {
    const range = frequencyRange(r.frequency);
    if (!range) continue;
    const want = (r.what === "swap" ? [r.to ?? ""] : r.items ?? []).map(canonTag).filter(Boolean);
    const applies = (d: PlanDay) => !d.skip && (!r.who || d.people.some((x) => same(x, r.who!))) && ruleHolds(r, d.date, w.slots.get(slotKey(d.slot))?.slot, d.slot);
    const hit = (d: PlanDay, ds: string[]) => ds.some((x) => want.some((t) => factsOf(w, d.slot, x).tags.has(t)));
    const elsewhere = w.days.filter((d) => !same(d.slot, slotName) && counts(w, d) && applies(d) && hit(d, d.dishes)).length;
    const here = mine.filter((d) => applies(d) && hit(d, p.days.get(d.date) ?? [])).map((d) => d.date);
    if (!mine.some(applies)) continue;
    const said = `${r.who ? `${r.who}: ` : ""}"${r.quote}" (${range[0]}–${range[1]} times a week)`;
    for (const date of here.slice(Math.max(0, range[1] - elsewhere))) add(date, { kind: "soft_over", text: `${said} is kept too often: plan it ${range[1]} times a week at most`, soft: false });
    const later = w.days.some((d) => !same(d.slot, slotName) && !counts(w, d) && applies(d));
    if (!later && elsewhere + here.length < range[0]) add("", { kind: "few", text: `${said} is kept only ${elsewhere + here.length} times`, soft: true });
  }
  return out;
}

/** Who at a slot-day is left without a dish of their own on this plate: nothing they can eat, or only staples where the
 *  plate has more; a hard require not kept; guests with food rules the same way (failing closed). A person with their own
 *  add-on that day is fed there. */
function unfed(w: Week, d: PlanDay, dishes: string[]): string[] {
  const out: string[] = [];
  const mains = dishes.filter((x) => !isStapleAt(w, d.slot, x));
  for (const person of d.people) {
    if (ownAddon(w, d, person)) continue;
    const can = dishes.filter((x) => !notFor(w, d, x).includes(person));
    if (!can.length || (mains.length && !can.some((x) => mains.includes(x))))
      out.push(`${person} has nothing to eat on ${d.date} ${d.slot}${mains.length && can.length ? " but staples" : ""} (${uniq(mains.flatMap((x) => ruleBreaks(w, { ...d, people: [person] }, x))).join("; ")})`);
  }
  out.push(...requireBreaks(w, d, dishes));
  const forb = guestForbids(w, d);
  if (forb.length) {
    const theirs = dishes.filter((x) => guestsCan(w, d, x));
    if (!theirs.length || (mains.length && !theirs.some((x) => mains.includes(x))))
      out.push(`the guests (${uniq(d.guests.flatMap((g) => g.rules ?? [])).join(", ")}) have nothing to eat on ${d.date} ${d.slot}${mains.length && theirs.length ? " but staples" : ""}`);
  }
  return out;
}
/** The tags the guests at a slot-day may not have (their words, read once); [] none or not read. */
const guestForbids = (w: Week, d: PlanDay) => uniq(d.guests.flatMap((g) => g.rules ?? []).flatMap((x) => w.guestTags?.get(x.trim().toLowerCase()) ?? []));
/** Can the guests eat a dish: none of what their rules forbid, and read for each of it. */
function guestsCan(w: Week, d: PlanDay, dish: string): boolean {
  const f = factsOf(w, d.slot, dish);
  return guestForbids(w, d).every((t) => !f.tags.has(t) && readFor(f.read, t));
}

// ── Feasibility (§5.2) ──

/** Before the slot calls: for each slot, are there enough non-staple library dishes for its places this week. When short:
 *  the repeat window from 3 days to 2; still short, the slot's own new dishes for the shortfall (`shortNew`, beside the
 *  week's setting, owner 24 Nov) and a question to the family (`short`: makePlan asks what else they have there, owner
 *  23 Nov). An add-on is never short. The week's setting (new_dishes_per_week) goes first to a person with nothing of their
 *  own at a slot, then is shared by every slot. Sets each slot's `newAllowed`, `shortNew`, `window` and `short`; answers the
 *  short slots and the log. */
export type ShortSlot = { slot: string; known: number; supply: number; places: number; /** its own new dishes */ newDishes: number };
export function feasibility(w: Week, order: string[]): { short: ShortSlot[]; log: string[] } {
  const short: ShortSlot[] = [], log: string[] = [];
  let budget = w.newBudget;
  const used = (k: string) => new Set(w.days.filter((d) => d.fixed && d.dishes.some((x) => dishKey(x) === k)).map((d) => d.date)).size;
  // A dish at several slots has one count for the week: what an earlier slot will take of it is not there for a later one.
  const claimed = new Map<string, number>();
  const slotsOf = (k: string) => order.filter((n) => w.slots.get(slotKey(n))!.library.some((x) => x.key === k)).length;
  // First: a person at a slot who can eat none of its dishes beside the staples (the vegetarian at a fish-and-mutton lunch)
  // needs a new dish there, before any slot's shortfall is counted.
  for (const name of order) {
    if (budget <= 0) break;
    const sf = w.slots.get(slotKey(name))!;
    const days = w.days.filter((d) => same(d.slot, name) && !d.fixed && !d.skip);
    const others = sf.library.filter((d) => plannable(d) && !sf.staples.some((s) => dishKey(s) === d.key));
    if (!days.length || !others.length) continue;
    const left = uniq(days.flatMap((d) => {
      const there = others.filter((x) => !x.days?.length || x.days.includes(weekdayOf(d.date)));
      return there.length ? d.people.filter((p) => !ownAddon(w, d, p) && there.every((x) => ruleBreaks(w, { ...d, people: [p] }, x.name).length)) : [];
    }));
    if (!left.length) continue;
    sf.newAllowed += 1; budget -= 1;
    log.push(`feasibility ${name}: 1 new dish for ${left.join(", ")} (none of its dishes beside the staples is theirs on some day)`);
  }
  for (const name of order) {
    const sf = w.slots.get(slotKey(name))!;
    const days = w.days.filter((d) => same(d.slot, name) && !d.fixed && !d.skip);
    if (!days.length) continue;
    let places = days.length * sf.typical;
    const avail = (d: LibraryDish, window: number) => {
      const max = (frequencyRange(d.frequency) ?? [0, DEFAULT_DISH_DAYS])[1];
      const on = days.filter((x) => !d.days?.length || d.days.includes(weekdayOf(x.date))).length;
      return Math.max(0, Math.min(max - used(d.key) - (claimed.get(d.key) ?? 0), on, Math.ceil(days.length / window)));
    };
    const supplyAt = (window: number) => sf.library.filter((d) => plannable(d) && !sf.staples.some((s) => dishKey(s) === d.key)).reduce((n, d) => n + avail(d, window), 0);
    let supply = supplyAt(sf.window);
    const steps: string[] = [];
    // An add-on is filled only as often as its dishes allow: never short, its other days empty (owner 23 Nov).
    if (sf.slot.kind === "addon" && supply < places) { steps.push(`add-on: ${supply} of ${places} days filled, the rest empty`); places = supply; }
    const supply0 = supply;
    // The family's own dishes first: the repeat window from 3 days to 2.
    if (supply < places) {
      sf.window = REPEAT_WINDOW_RELAXED;
      supply = supplyAt(sf.window);
      steps.push(`repeat window ${REPEAT_WINDOW_RELAXED} days`);
    }
    // Still short: new dishes of the family's own kind for the shortfall, as many as it takes (each comes on up to the
    // default days), beside the week's setting and not counted against it; and the family is asked (owner 24 Nov).
    if (supply < places) {
      sf.short = true;
      sf.shortNew = Math.ceil((places - supply) / Math.max(1, Math.min(DEFAULT_DISH_DAYS, Math.ceil(days.length / sf.window))));
      const known = sf.library.filter((d) => plannable(d) && !sf.staples.some((s) => dishKey(s) === d.key)).length;
      short.push({ slot: name, known, supply: supply0, places, newDishes: sf.shortNew });
      steps.push(`${sf.shortNew} new dish${sf.shortNew === 1 ? "" : "es"} of their kind for the shortfall (beside the week's setting)`, "asked");
    }
    // What this slot will take: its own dishes first, then those it shares.
    let need = places;
    for (const d of sf.library.filter((x) => plannable(x) && !sf.staples.some((s) => dishKey(s) === x.key)).sort((a, b) => slotsOf(a.key) - slotsOf(b.key))) {
      if (need <= 0) break;
      const take = Math.min(avail(d, sf.window), need);
      claimed.set(d.key, (claimed.get(d.key) ?? 0) + take);
      if (take) sf.takes.set(d.key, take);
      need -= take;
    }
    log.push(`feasibility ${name}: ${places} places (${days.length} × ${sf.typical}), ${supply} from the library${steps.length ? `; relaxed: ${steps.join(", then ")}` : ""}`);
  }
  // The rest of the budget is shared: every slot may use it, and the week's check keeps the total (the slots placed first
  // come first); what a thin slot was given above stays its own.
  for (const name of order) w.slots.get(slotKey(name))!.newAllowed += budget;
  return { short, log };
}

// ── The walk (owner 25 Nov): the slot call's week made right in code, day by day ──
//
// Monday to Sunday, each dish of the call's day stays when it fits that day: one of the slot's dishes (its library, a
// staple, a particular way of one of the family's dishes, or a new one within the slot's budget), never disliked or
// dropped, on its days, within its days a week (counted across the week's meals so far: no main more than twice a week
// unless the family's own words say more), not the main at another meal that day, and someone there can eat it. One that
// does not fit is replaced by a dish of the same part from that day's allowed dishes or the call's spares with room; a
// person with nothing of their own gets a dish beside; the rice or bread the family's plates have is added where missing.
// What still cannot be filled is a gap: makePlan asks one targeted call for the slot's gap days, then the walk runs again
// and fills what is left with the closest dish that day's people can eat, said in unmet. Nobody is left without food.

/** A day's place the walk could not fill: the part it needs (null: any), who it is for, and why. `place`: a dish's place
 *  on the plate (filled again by the last walk); else a person's (or the guests') own dish, which the last walk finds again. */
export type Gap = { date: string; part: string | null; for: string[]; why: string; place: boolean };
export type WalkResult = { gaps: Gap[]; unmet: string[]; changed: string[] };

/** How many days a week a dish may come, counted across meals: its frequency's most, else as many as its days, at least
 *  DEFAULT_DISH_DAYS. null: no count (a staple, a daily dish, an add-on person's standing dish). */
export function capOf(w: Week, slot: string, dish: string): number | null {
  if (isStapleAt(w, slot, dish) || standing(w, slot, dish)) return null;
  const row = libAt(w, slot, dish) ?? w.library.find((x) => x.key === dishKey(dish));
  if (row?.frequency === "daily") return null;
  const r = frequencyRange(row?.frequency ?? null);
  return r ? r[1] : Math.max(DEFAULT_DISH_DAYS, row?.days?.length ?? 0);
}
/** The dates a dish is on this week across the meals that count: settled ones, and this slot's own days (before `before`
 *  only, when given: the walk counts the days it has made). */
function datesUsed(w: Week, slotName: string, key: string, p: Proposal, before?: string): Set<string> {
  const out = new Set<string>();
  for (const d of w.days) {
    if (same(d.slot, slotName) && !d.fixed) { if ((!before || d.date < before) && !d.skip && (p.days.get(d.date) ?? []).some((x) => dishKey(x) === key)) out.add(d.date); continue; }
    if (counts(w, d) && d.dishes.some((x) => dishKey(x) === key)) out.add(d.date);
  }
  return out;
}
/** A dish named as a particular way of one of the slot's family dishes ("Bhindi sabzi" of their "Sabzi"): planned as that
 *  dish under its own name (its row, how often and days; read afresh for what it contains; never saved). Answers the
 *  name; a variant's row joins the week's library the first time. */
export function asVariant(w: Week, slotName: string, dish: string, like?: string): { name: string; entry?: string } {
  const sf = w.slots.get(slotKey(slotName))!, k = dishKey(dish);
  if (sf.library.some((x) => x.key === k) || isStapleAt(w, slotName, dish)) return { name: dish };
  const entries = sf.library.filter((x) => plannable(x) && !isVariantRow(x));
  const entry = (like ? entries.find((x) => x.key === dishKey(like) && isVariantOf(x.name, dish)) : undefined) ?? entries.find((x) => isVariantOf(x.name, dish));
  if (!entry) return { name: dish };
  const row = variantRow(entry, dish);
  sf.library.push(row);
  if (!w.library.some((x) => x.key === k && same(x.slot, slotName))) w.library.push(row);
  const part = sf.parts.get(entry.key);
  if (part) sf.parts.set(k, part);
  return { name: dish, entry: entry.name };
}

/** The slot's dishes that have had their days this week (the targeted call is told not to use them). */
export function usedUp(w: Week, slotName: string, p: Proposal): string[] {
  const sf = w.slots.get(slotKey(slotName))!;
  return sf.library.filter((x) => plannable(x) && !isStapleAt(w, slotName, x.name)).filter((x) => { const cap = capOf(w, slotName, x.name); return cap !== null && datesUsed(w, slotName, x.key, p).size >= cap; })
    .map((x) => x.name);
}

/** The slot's week walked Monday to Sunday (see above). `final`: what cannot be filled takes the closest dish that day's
 *  people can eat (said in unmet) instead of being a gap; an add-on is always walked so (a day of it may be empty: its
 *  person eats the main slot's dishes). `gaps`: the first walk's, filled now; `extra`: the targeted call's dishes by date,
 *  tried first. Changes `p.days`; answers the gaps, the lines for unmet and the log. */
export function walkSlot(w: Week, slotName: string, p: Proposal, opts: { final?: boolean; gaps?: Gap[]; extra?: Map<string, string[]> } = {}): WalkResult {
  const sf = w.slots.get(slotKey(slotName))!;
  const addon = sf.slot.kind === "addon", final = !!opts.final || addon;
  const res: WalkResult = { gaps: [], unmet: [], changed: [] };
  const room = sf.shortNew + Math.max(0, Math.min(sf.newAllowed, w.newBudget - settingUsed(w, (_, s) => same(s, slotName))));
  const newUsed = new Set<string>();
  const known = (name: string) => { const row = libAt(w, slotName, name); return (!!row && plannable(row)) || isStapleAt(w, slotName, name); };
  const day = (d: PlanDay) => `${weekdayOf(d.date)} ${slotName}`;
  const canEat = (d: PlanDay, dish: string) => !d.people.length || notFor(w, d, dish).length < d.people.length;
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip).sort((a, b) => a.date.localeCompare(b.date));

  /** Why a dish cannot be on this day's plate (null: it can). `loose`: its days a week, its days and the other meals that day
   *  not counted (the closest dish, the last resort). */
  const why = (d: PlanDay, dish: string, plate: string[], loose = false): string | null => {
    const k = dishKey(dish);
    if (plate.some((x) => dishKey(x) === k)) return "twice on the plate";
    const any = w.library.filter((x) => x.key === k);
    if (any.some((x) => x.disliked)) return `${dish}: the family did not like it`;
    if (any.some(isDropped)) return `${dish}: offered twice and never made`;
    if (!known(dish)) {
      if (d.new_dishes_allowed === 0) return `${dish}: no new dish on this day`;
      if (!newUsed.has(k) && newUsed.size >= room) return `${dish}: no room for another new dish this week`;
    }
    if (!canEat(d, dish)) return `${dish}: nobody there can eat it`;
    const row = libAt(w, slotName, dish);
    if (row?.days?.length && !row.days.includes(weekdayOf(d.date))) return `${dish} is had on ${row.days.join(", ")} only`;
    if (loose) return null;
    const cap = capOf(w, slotName, dish);
    if (cap !== null) { const used = datesUsed(w, slotName, k, p, d.date); if (!used.has(d.date) && used.size >= cap) return `${dish} has had its ${cap} days this week`; }
    if (sf.slot.kind === "main" && !isStapleAt(w, slotName, dish)) {
      const other = w.days.find((x) => x.date === d.date && !same(x.slot, slotName) && counts(w, x) && w.slots.get(slotKey(x.slot))?.slot.kind === "main"
        && x.dishes.some((y) => dishKey(y) === k) && !isStapleAt(w, x.slot, dish));
      if (other) return `${dish} is already at ${other.slot} that day`;
    }
    return null;
  };
  const take = (plate: string[], dish: string) => { plate.push(dish); if (!known(dish)) newUsed.add(dishKey(dish)); };
  const partName = (dish: string) => (sf.parts.get(dishKey(dish))?.part ?? p.newNames.get(dishKey(dish))?.part)?.trim().toLowerCase() ?? null;
  /** The dishes that may take a place: the targeted call's for the day, the slot's library dishes of that part (the least
   *  used this week first, not yesterday's), then the spares of that part. No part: any, a part not on the plate first. */
  const choices = (d: PlanDay, part: string | null, plate: string[]): string[] => {
    const yday = new Set((p.days.get(addDays(d.date, -1)) ?? []).map(dishKey));
    const onPlate = new Set(plate.map(partName));
    const ok = (name: string) => !part || partName(name) === part;
    const lib = sf.library.filter((x) => plannable(x) && !isStapleAt(w, slotName, x.name) && ok(x.name))
      .map((x, i) => ({ name: x.name, i, u: datesUsed(w, slotName, x.key, p, d.date).size, y: yday.has(x.key) ? 1 : 0, o: onPlate.has(partName(x.name)) ? 1 : 0 }))
      .sort((a, b) => a.o - b.o || a.y - b.y || a.u - b.u || a.i - b.i).map((x) => x.name);
    const spares = [...(p.spares ?? new Map<string, string[]>()).entries()].filter(([k]) => !part || k === part).flatMap(([, v]) => v);
    return uniq([...(opts.extra?.get(d.date) ?? []), ...lib, ...spares].map((x) => asVariant(w, slotName, x).name)).filter((x) => !reserved.has(dishKey(x)));
  };
  /** Back within the slot's repeat window of itself here (this week's days before, or last week's): a staple or a
   *  person's standing add-on dish never is. Kept when nothing else fits; an add-on's day is then left to the main slot. */
  const soon = (d: PlanDay, dish: string) => {
    if (isStapleAt(w, slotName, dish) || standing(w, slotName, dish)) return false;
    const k = dishKey(dish);
    const before = [...Object.entries(sf.recent), ...[...p.days.entries()].filter(([dt]) => dt < d.date)].filter(([, ds]) => ds.some((x) => dishKey(x) === k)).map(([dt]) => dt);
    return before.some((dt) => dayDiff(dt, d.date) < sf.window);
  };
  const pick = (d: PlanDay, part: string | null, plate: string[], must?: (dish: string) => boolean) => {
    const ok = choices(d, part, plate).filter((c) => !why(d, c, plate) && (!must || must(c)));
    return ok.find((c) => !soon(d, c)) ?? ok[0];
  };
  /** The closest dish that day's people can eat (the last resort): an allowed dish of another part that fits the day (one
   *  of the same kind first); none, the one that could not stay, then the slot's dishes of that part, then any of its
   *  dishes, the least used first, its days a week not counted. */
  const closest = (d: PlanDay, was: string | null, part: string | null, plate: string[], must?: (dish: string) => boolean) => {
    const kind = was ? sf.parts.get(dishKey(was))?.kind : undefined;
    const fits = choices(d, null, plate).filter((c) => !why(d, c, plate) && (!must || must(c)));
    const allowed = fits.find((c) => !!kind && sf.parts.get(dishKey(c))?.kind === kind) ?? fits[0];
    if (allowed) return allowed;
    const lib = (pt: string | null) => sf.library.filter((x) => plannable(x) && !isStapleAt(w, slotName, x.name) && (!pt || partName(x.name) === pt))
      .sort((a, b) => datesUsed(w, slotName, a.key, p).size - datesUsed(w, slotName, b.key, p).size).map((x) => x.name);
    return uniq([...(was ? [was] : []), ...(opts.extra?.get(d.date) ?? []), ...lib(part), ...lib(null), ...sf.staples])
      .find((c) => !why(d, c, plate, true) && (!must || must(c)));
  };
  /** A place that cannot be filled: a gap on the first walk, the closest dish on the last (said in unmet when it is past
   *  its count or off its day). */
  const fill = (d: PlanDay, plate: string[], g: Gap, was: string | null, must?: (dish: string) => boolean): boolean => {
    const c = pick(d, g.part, plate, must);
    if (c) { take(plate, c); res.changed.push(`${day(d)}: ${was ? `${was} → ` : "+ "}${c}${was ? ` (${g.why})` : ""}`); return true; }
    if (!final) { res.gaps.push(g); return false; }
    const near = addon ? null : closest(d, was, g.part, plate, must);
    if (!near) return false;
    const off = why(d, near, plate);
    take(plate, near);
    res.changed.push(`${day(d)}: ${was && was !== near ? `${was} → ` : was ? "kept " : "+ "}${near} (closest)`);
    if (off) res.unmet.push(`${day(d)}: ${near} comes back sooner than usual`);
    return true;
  };

  /** The call's dishes of the day still to be walked: not taken for another place before their own turn. */
  let reserved = new Set<string>();
  mine.forEach((d, n) => {
    const was = uniq((p.days.get(d.date) ?? []).map((x) => asVariant(w, slotName, x, p.newNames.get(dishKey(x))?.like).name));
    const plate: string[] = [];
    reserved = new Set(was.map(dishKey));
    // 1. The call's dishes, each kept or replaced in its part.
    for (const x of was) {
      reserved.delete(dishKey(x));
      const no = why(d, x, plate);
      if (!no && soon(d, x)) {
        const c = pick(d, partName(x), plate);
        if (c && !soon(d, c)) { take(plate, c); res.changed.push(`${day(d)}: ${x} → ${c} (back too soon)`); continue; }
        if (addon) continue;   // the add-on's person eats the main slot's dishes that day
      }
      if (!no) { take(plate, x); continue; }
      if (no === "twice on the plate") continue;
      fill(d, plate, { date: d.date, part: partName(x), for: d.people, why: no, place: true }, x);
    }
    // 2. The first walk's gaps of this day.
    for (const g of (opts.gaps ?? []).filter((x) => x.date === d.date && x.place)) fill(d, plate, g, null);
    // 3. A day the call left empty (not an add-on's): one of the family's plates at this slot, part by part.
    if (!was.length && !addon && !(opts.gaps ?? []).some((g) => g.date === d.date && g.place)) {
      const tpl = sf.plates.length ? sf.plates[n % sf.plates.length].filter((x) => !isStapleAt(w, slotName, x)) : [];
      const parts = tpl.length ? uniq(tpl.map(partName)) : [null];
      for (const part of parts) fill(d, plate, { date: d.date, part, for: d.people, why: "the day had no dish", place: true }, null);
    }
    // 4. The daily dishes, where someone there can eat them.
    for (const dish of sf.daily) {
      const row = libAt(w, slotName, dish);
      if (plate.length && (!row?.days?.length || row.days.includes(weekdayOf(d.date))) && !plate.some((x) => dishKey(x) === dishKey(dish)) && canEat(d, dish)) plate.push(dish);
    }
    // 5. Each person (and the guests) with a dish of their own; a require kept. Not at an add-on (its person eats the main).
    if (!addon && plate.length) {
      for (const person of d.people) {
        if (ownAddon(w, d, person)) continue;
        const theirs = (x: string) => !notFor(w, d, x).includes(person) && !isStapleAt(w, slotName, x);
        if (plate.some(theirs) || !plate.some((x) => !isStapleAt(w, slotName, x)) && plate.some((x) => !notFor(w, d, x).includes(person))) continue;
        const one = { ...d, people: [person] };
        const ok = fill(one, plate, { date: d.date, part: null, for: [person], why: `${person} has nothing of their own`, place: false }, null, theirs);
        if (!ok && final) {
          const can = plate.filter((x) => !notFor(w, d, x).includes(person));
          res.unmet.push(can.length ? `${day(d)}: ${person} has only ${can.join(", ")}` : `${day(d)}: ${person} has nothing to eat there`);
        }
      }
      for (const r of w.rules.filter((x) => x.hard && x.what === "require" && x.items?.length && x.who && d.people.some((p) => same(p, x.who!)) && ruleHolds(x, d.date, sf.slot, slotName))) {
        const has = (x: string) => !notFor(w, d, x).includes(r.who!) && r.items!.some((i) => factsOf(w, slotName, x).tags.has(canonTag(i)));
        if (plate.some(has)) continue;
        const ok = fill({ ...d, people: [r.who!] }, plate, { date: d.date, part: null, for: [r.who!], why: `${r.who} needs a dish with ${r.items!.join(" or ")} ("${r.quote}")`, place: false }, null, has);
        if (!ok && final) res.unmet.push(`${day(d)}: no dish with ${r.items!.join(" or ")} for ${r.who}`);
      }
      if (guestForbids(w, d).length && !plate.some((x) => guestsCan(w, d, x) && !isStapleAt(w, slotName, x))) {
        const ok = fill(d, plate, { date: d.date, part: null, for: ["guests"], why: `the guests (${uniq(d.guests.flatMap((g) => g.rules ?? [])).join(", ")}) need a dish of theirs`, place: false }, null,
          (x) => guestsCan(w, d, x));
        if (!ok && final) res.unmet.push(`${day(d)}: the guests have nothing of their own`);
      }
    }
    // 6. The rice or bread the family's plates have here, where the day has none (a complete dish brings its own).
    if (sf.mustHave.length && plate.length && !plate.some((x) => isBase(w, slotName, x))) {
      const fits = sf.mustHave.filter((x) => canEat(d, x) && !w.library.some((y) => y.key === dishKey(x) && (y.disliked || isDropped(y))));
      const near = (x: string) => sf.plates.filter((pl) => pl.some((y) => dishKey(y) === dishKey(x))).reduce((m, pl) => Math.max(m, plate.filter((y) => pl.some((z) => dishKey(z) === dishKey(y))).length), 0);
      const used = (x: string) => [...p.days.entries()].filter(([dt, ds]) => dt < d.date && ds.some((y) => dishKey(y) === dishKey(x))).length;
      const one = fits.sort((a, b) => near(b) - near(a) || used(a) - used(b))[0];
      if (one) { plate.unshift(one); res.changed.push(`${day(d)}: + ${one} (its rice or bread)`); }
    }
    // An add-on day left with nothing: fine where its people eat the main slot's dishes; else the closest dish, said.
    if (addon && !plate.length && was.length) {
      d.dishes = [];
      if (!mainFeeds(w, d)) {
        const near = closest(d, was[0], partName(was[0]), plate);
        if (near) { plate.push(near); res.unmet.push(`${day(d)}: ${near} comes back sooner than usual`); }
      }
    }
    if (plate.join("|") !== was.join("|") && !res.changed.some((x) => x.startsWith(day(d)))) res.changed.push(`${day(d)} → ${plate.join(", ") || "nothing (empty)"}`);
    p.days.set(d.date, plate);
  });
  if (final) ownDays(w, slotName, p, res);
  return res;
}

/** A family dish with its own days ("khichdi on Saturday night") on each of them, and one they have often (sometimes,
 *  usually, n a week) on at least that many days, when the call left it short and no later meal has it: put in the place of
 *  a main on a day it fits (one of its part first, else any; owner 25 Nov), where nobody is then left without a dish of
 *  their own and the day keeps its rice or bread. */
function ownDays(w: Week, slotName: string, p: Proposal, res: WalkResult): void {
  const sf = w.slots.get(slotKey(slotName))!;
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip).sort((a, b) => a.date.localeCompare(b.date));
  const wanted = sf.library.filter((x) => plannable(x) && !isVariantRow(x) && x.frequency !== "daily" && !isStapleAt(w, slotName, x.name)
    && ((x.frequency && (frequencyRange(x.frequency)?.[0] ?? 0) > 0) || (!x.frequency && x.days?.length)));
  const wantedKeys = new Set(wanted.map((x) => x.key));
  for (const row of wanted) {
    if (w.days.some((d) => !same(d.slot, slotName) && !counts(w, d) && !d.skip && w.library.some((x) => x.key === row.key && same(x.slot, d.slot)))) continue;
    const part = sf.parts.get(row.key)?.part;
    const on = mine.filter((d) => !row.days?.length || row.days.includes(weekdayOf(d.date)));
    const least = row.frequency ? frequencyRange(row.frequency)![0] : on.length;
    const cap = capOf(w, slotName, row.name) ?? Infinity;
    for (const d of on) {
      const used = datesUsed(w, slotName, row.key, p);
      if (used.size >= Math.min(least, cap)) break;
      const plate = p.days.get(d.date) ?? [];
      if (used.has(d.date) || notFor(w, d, row.name).length === d.people.length) continue;
      if (sf.slot.kind === "main" && w.days.some((x) => x.date === d.date && !same(x.slot, slotName) && counts(w, x) && w.slots.get(slotKey(x.slot))?.slot.kind === "main" && x.dishes.some((y) => dishKey(y) === row.key))) continue;
      const swap = (j: number) => plate.map((x, k) => (k === j ? row.name : x));
      const keepsBase = (next: string[]) => !sf.mustHave.length || !plate.some((x) => isBase(w, slotName, x)) || next.some((x) => isBase(w, slotName, x));
      const places = plate.map((x, j) => ({ x, j })).filter(({ x }) => !wantedKeys.has(dishKey(x)) && !isStapleAt(w, slotName, x))
        .sort((a, b) => Number(!!part && sf.parts.get(dishKey(b.x))?.part === part) - Number(!!part && sf.parts.get(dishKey(a.x))?.part === part));
      const i = places.map(({ j }) => j).find((j) => keepsBase(swap(j)) && unfed(w, d, swap(j)).length <= unfed(w, d, plate).length);
      if (i === undefined) continue;
      const next = swap(i);
      p.days.set(d.date, next);
      res.changed.push(`${weekdayOf(d.date)} ${slotName}: ${plate[i]} → ${row.name} (its day)`);
    }
  }
}
