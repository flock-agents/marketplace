// What code checks of a week's plan (docs/slot-model-spec.md §5.4; owner 25 Nov; kinds model contract rules 6 and 7): each
// slot's facts (its staples, its plates); every hard rule kept for every person at every slot-day, read from what each dish
// contains and failing closed where a dish was never read for a rule's item, an allergy by the family's word for their own
// dishes or a careful read; a rule broken only by ingredients the dish can be made without a note, never a block (rule 7,
// decided 21: onion and garlic, cashews in upma), one broken by a main ingredient the dish not theirs; who is left with
// nothing; a catalog item read by the catalog for every tag its own read left out; the checks a saved
// week is read against (changes.ts). The week itself is filled by fillWeek.ts. Pure: no database, no model.
import { BASE_TAGS, FREQUENCY_DAYS, STAPLES_FROM_PLANNED, TAG_PARENT, UNTRIED_MAX_OFFERS, type Frequency } from "./db/constants";
import { isAllergyRule } from "./allergy";
import { dishKey } from "./dishText";
import { looksLike, looksLikeRows, staples, type HistoryRow, type LibraryDish, type Rule, type Slot } from "./slotStore";
import { catalogIngredients, contentsItem, plannerTags } from "./kinds";
import { ruleHolds, type PlanDay } from "./planDays";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = <T>(xs: T[]) => [...new Set(xs)];

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
/** One ingredient of a dish: the tags it brings (with their families), and whether the dish is itself without it. */
export type DishIngredient = { name: string; main: boolean; tags: Set<string> };
/** What a dish contains and was read for; for a catalog item, its ingredients (decided 21: a rule broken only by ingredients
 *  the dish can be made without is a note, not a block). */
export type DishFacts = { tags: Set<string>; read: Set<string>; ingredients?: DishIngredient[] };
/** The ingredients that bring a tag into a dish when it can be made without every one of them (decided 21): none of its main
 *  ingredients brings it. Null when one does, when no ingredient of it does (the tag came from a read: it is the dish's), or
 *  when the dish's ingredients are not known. */
export function leaveOut(f: DishFacts, tag: string): string[] | null {
  if (!f.ingredients?.length) return null;
  const hits = f.ingredients.filter((x) => x.tags.has(canonTag(tag)));
  return hits.length && hits.every((x) => !x.main) ? hits.map((x) => x.name) : null;
}

/** The tags a hard rule forbids to its person: vegetarian forbids meat and fish; no eggs, eggs; an avoid and a swap, their
 *  items; eggs-but-no-meat, its items or meat and fish. */
/** The tags a rule item may be said as in the plural ("peanuts", "eggs", "mushrooms"): read as the tag. */
const KNOWN_TAGS = new Set<string>([...BASE_TAGS, ...Object.keys(TAG_PARENT), ...Object.values(TAG_PARENT), "mushroom", "brinjal", "karela", "coconut", "soy", "wheat", "root_veg", "prawn"]);
const ruleItem = (t: string): string => { const c = canonTag(t); return !KNOWN_TAGS.has(c) && c.endsWith("s") && KNOWN_TAGS.has(c.slice(0, -1)) ? c.slice(0, -1) : c; };
export function forbidden(r: Rule): string[] {
  const items = (r.items ?? []).map(ruleItem);
  switch (r.what) {
    case "veg": return uniq(["meat", "fish", ...items]);
    case "no_eggs": return uniq(["egg", ...items]);
    case "egg": return items.length ? items : ["meat", "fish"];
    case "avoid": case "swap": return items;
    // "Chicken only at Sunday lunch": a rule kept to days or meals forbids its items everywhere else (ruleBinds).
    case "only": return r.days?.length || r.slots?.length ? items : [];
    default: return [];
  }
}
/** Does a hard rule bind at a slot-day: an "only" rule kept to days or meals ("chicken only at Sunday lunch") binds everywhere
 *  outside them, in every kind of meal (a tiffin, someone's own meal), and never inside; every other rule where its days and
 *  meals hold. */
export function ruleBinds(r: Rule, date: string, slot: Slot | undefined, slotName: string): boolean {
  if (r.what === "only") return !!(r.days?.length || r.slots?.length) && !ruleHolds(r, date, slot, slotName);
  return ruleHolds(r, date, slot, slotName);
}
/** Every tag the family's rules name, and the base ones: what a new dish is read for. */
export function ruleTags(rules: Rule[]): string[] {
  return uniq([...BASE_TAGS, ...rules.flatMap((r) => [...forbidden(r), ...(r.items ?? []).map(canonTag), ...(r.to ? [canonTag(r.to)] : [])])]).filter(Boolean);
}

// ── A slot's own facts for the week ──

/** How many days a week a dish may come, [min, max], by its frequency (null: none said: no count). */
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

export type SlotFacts = { slot: Slot; library: LibraryDish[]; staples: string[]; looks_like: string[];
  /** The family's own plates here (seed and confirmed), each its dishes. */ plates: string[][] };

/** A slot's staples (history's, from confirmed rows only; every dish the family has daily; and the library dishes of the
 *  slot's staple kinds), looks like and plates (seed and confirmed). */
export function slotFacts(slot: Slot, library: LibraryDish[], history: HistoryRow[], _recent?: unknown): SlotFacts {
  const mine = library.filter((d) => same(d.slot, slot.name));
  const daily = mine.filter((d) => d.frequency === "daily" && plannable(d)).map((d) => d.name);
  const stapleKinds = new Set((slot.kinds ?? []).filter((k) => k.staple).map((k) => k.name.toLowerCase()));
  const ofStapleKind = mine.filter((d) => plannable(d) && d.kind && stapleKinds.has(d.kind.toLowerCase())).map((d) => d.name);
  const all = [...staples(stapleRows(history)), ...daily, ...ofStapleKind].filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
  const plates = looksLikeRows(history).map((r) => r.dishes.map((d) => d.dish.trim()));
  return { slot, library: mine, staples: all, looks_like: looksLike(history), plates };
}

/** Is a dish a main of the plate (a person needs one of their own where the plate has one): any dish that is not a staple there. */
export const mainAt = (w: Week, slot: string, dish: string): boolean => !isStapleAt(w, slot, dish);

// ── The week as checked: every slot-day, the slots done ──

export type Week = { days: PlanDay[]; slots: Map<string, SlotFacts>; rules: Rule[]; library: LibraryDish[]; facts: Map<string, DishFacts>;
  /** The slots whose dishes are settled (fixed ones count always). */ done: Set<string>;
  /** New dishes placed so far, by key, with the slot they were placed at and the family's dish it is like. */ newDishes: Map<string, { name: string; slot: string; why: string; like?: string }>;
  /** What each of the week's guest rules (their words) forbids, as tags, from one read; none read: not checked. */ guestTags?: Map<string, string[]>;
  /** The careful allergy read (owner 25 Nov), by dish key: the allergy tags the dish has or may have. Given: a dish the
   *  family does not vouch for is safe for an allergy only by this read (none: not safe). Not given: the contains read. */
  careful?: Map<string, Set<string>>;
  /** The catalog's items of a category the family named ("poha", "dal"): theirs (lead's rule, 25 Nov), by dish key. */
  ownItems?: Set<string> };

const slotKey = (s: string) => s.toLowerCase();
export const isStapleAt = (w: Week, slot: string, dish: string): boolean => !!w.slots.get(slotKey(slot))?.staples.some((x) => dishKey(x) === dishKey(dish));
const libAt = (w: Week, slot: string, dish: string): LibraryDish | undefined => w.library.find((d) => same(d.slot, slot) && d.key === dishKey(dish));
/** What a dish contains and was read for, at a slot: a read made this run, else its library row there, else any row of it;
 *  and for a catalog item (or a staple named by its kind: "Rice" is Steamed rice) the catalog's answer for every tag that read
 *  left out, and its ingredients. A planned catalog item is so read for every catalog tag: none is left unknown to fail
 *  closed on (owner, 26 Nov: a Steamed rice saved without pork, nuts or sugar read). */
export function factsOf(w: Week, slot: string, dish: string): DishFacts {
  const row = libAt(w, slot, dish) ?? w.library.find((d) => d.key === dishKey(dish));
  const run = w.facts.get(dishKey(dish));
  const base = run ?? (row ? { tags: withParents(row.contains), read: new Set(row.contains_read.map(canonTag)) } : { tags: new Set<string>(), read: new Set<string>() });
  return withCatalog(base, contentsItem(row?.catalog_item ?? null) ?? contentsItem(row?.name ?? dish));
}
const withCatalogMemo = new WeakMap<DishFacts, Map<string, DishFacts>>();
/** A dish's facts with its catalog item's laid over what they left unread, and the item's ingredients. */
export function withCatalog(f: DishFacts, item: string | null): DishFacts {
  if (!item) return f;
  const memo = withCatalogMemo.get(f) ?? new Map<string, DishFacts>();
  withCatalogMemo.set(f, memo);
  const had = memo.get(item);
  if (had) return had;
  const t = plannerTags(item);
  if (!t) return f;
  const cat = withParents(t.contains);
  const out: DishFacts = { tags: new Set([...f.tags, ...[...cat].filter((x) => !readFor(f.read, x))]), read: new Set([...f.read, ...withParents(t.read)]),
    ingredients: f.ingredients ?? (catalogIngredients(item) ?? []).map((x) => ({ name: x.name, main: x.main, tags: withParents(x.tags) })) };
  memo.set(item, out);
  return out;
}


/** Is a dish the family's own: in their library (not a suggestion of the planner's, not a variant of one of theirs), or on
 *  one of their own plates. */
function familyDish(w: Week, key: string): boolean {
  return w.library.some((d) => d.key === key && !d.suggested && d.origin !== "planner_suggested")
    || [...w.slots.values()].some((sf) => sf.plates.some((pl) => pl.some((x) => dishKey(x) === key)));
}
/** Does the family vouch for a dish under an allergy rule (owner 25 Nov): a house-wide one, every family dish (the house
 *  cooks without it); one person's, a family dish on the family's own plates at a slot that person eats (the house cooks
 *  without it, or keeps their portion aside). Such a dish needs no read for that allergy. */
export function vouched(w: Week, r: Rule, dish: string): boolean {
  const key = dishKey(dish);
  // An item of a category the family named counts as theirs for variety, never for their allergies: the catalog picked it,
  // so it is checked like any other (decided 21).
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

/** Is a dish the family's own at a slot that is only this person's (her own dinner, his breakfast): it is made for them,
 *  so their own rules hold for it by the family's word (onboarding e2e: Gita's own "Veg torkari", read as having onion and
 *  garlic as usually made, left her own dinner empty). */
export function ownSlotDish(w: Week, person: string, dish: string): boolean {
  const key = dishKey(dish);
  return [...w.slots.values()].some((sf) => sf.slot.usual_people.length === 1 && same(sf.slot.usual_people[0], person)
    && (sf.library.some((d) => d.key === key && !d.suggested && d.origin !== "planner_suggested") || sf.plates.some((pl) => pl.some((x) => dishKey(x) === key))));
}

/** The hard rules that hold for one person at a slot-day. */
function rulesFor(w: Week, d: PlanDay, person: string): Rule[] {
  const slot = w.slots.get(slotKey(d.slot))?.slot;
  return w.rules.filter((r) => r.hard && (!r.who || same(r.who, person)) && ruleBinds(r, d.date, slot, d.slot));
}
/** Why a dish cannot go to the people of a slot-day (empty: it can): an item it has, or one it was never read for. Pass a
 *  slot-day with one person to ask for that person. */
export function ruleBreaks(w: Week, d: PlanDay, dish: string): string[] {
  const f = factsOf(w, d.slot, dish), out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p)) for (const t of forbidden(r)) {
    if (r.who && ownSlotDish(w, p, dish)) continue;
    if (isAllergyRule(r)) {
      // The family's word for their own dish; every other dish by the careful read only (owner 25 Nov), where an allergen
      // that only an ingredient the dish can be made without brings is a note (decided 21: suji upma without cashews).
      if (vouched(w, r, dish)) continue;
      if (w.careful) {
        const c = w.careful.get(dishKey(dish));
        if (!c) out.push(`${dish}: not read carefully for ${t.replace(/_/g, " ")}, so it cannot go to ${p} ("${r.quote}")`);
        else if (c.has(t) && !leaveOut(f, t)) out.push(`${dish} may have ${t.replace(/_/g, " ")}: against ${p}'s rule "${r.quote}"`);
        continue;
      }
    }
    if (r.what === "swap" && f.tags.has(t)) continue;   // a swap: the dish stays, with a note for them (swapNotes)
    // Onion and garlic never block a dish whose ingredients are not known (contract rule 7): it is made without, or their
    // portion kept aside (leaveOutNotes); only a dish that is mostly onion is not theirs. A catalog item says by its
    // ingredients: onion that is a main one (kanda poha) is not theirs.
    if (t === ONION_GARLIC && !isAllergyRule(r) && !f.ingredients?.length && !mostlyOnion(dish)) continue;
    // Decided 21: only ingredients the dish can be made without break the rule: it stays theirs, with a note.
    if (f.tags.has(t) && leaveOut(f, t)) continue;
    if (f.tags.has(t)) out.push(`${dish} has ${t.replace(/_/g, " ")}: against ${p}'s rule "${r.quote}"`);
    else if (!readFor(f.read, t)) out.push(`${dish}: not known whether it has ${t.replace(/_/g, " ")}, so it cannot go to ${p} ("${r.quote}")`);
  }
  return uniq(out);
}
const ONION_GARLIC = "onion_garlic";
/** A dish that is mostly onion, by its name (contract rule 7: onion, pyaaz, kanda, vengayam, ulli). */
export const mostlyOnion = (dish: string): boolean => /\b(onions?|pyaa?z|pyaza|kanda|vengaya\w*|ulli)\b/i.test(dish);
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** The note on a dish that has onion or garlic, for the people at the slot-day whose hard rule says none (contract rule 7):
 *  "make without onion and garlic, or keep <person>'s portion aside". None for a dish that is mostly onion (not theirs). */
export const onionNotes = (w: Week, d: PlanDay, dish: string): string[] => leaveOutNotes(w, d, dish).filter((x) => x.startsWith("make without onion and garlic, or keep"));
/** The notes on a dish someone at the slot-day eats though a hard rule or allergy of theirs is against one of its ingredients
 *  the dish can be made without (decided 21): "make without cashews for Anya"; one the whole house keeps, "make without
 *  peanuts"; onion and garlic as contract rule 7 says it, "make without onion and garlic, or keep <person>'s portion aside"
 *  (also for a dish whose ingredients are not known, unless it is mostly onion). Only for the people the dish is for (the
 *  chicken that is not for her needs no word on onion); a family dish one person's allergy is kept aside for is allergyNotes'. */
export function leaveOutNotes(w: Week, d: PlanDay, dish: string): string[] {
  const f = factsOf(w, d.slot, dish);
  const onion: string[] = [];
  const without = new Map<string, Set<string>>();   // person ("" the house) → ingredients
  for (const p of d.people) {
    if (notFor(w, { ...d, people: [p] }, dish).length) continue;
    for (const r of rulesFor(w, d, p)) {
      if (r.what === "swap" || (r.who && ownSlotDish(w, p, dish)) || (isAllergyRule(r) && vouched(w, r, dish))) continue;
      for (const t of forbidden(r)) {
        if (!f.tags.has(t)) continue;
        const names = leaveOut(f, t);
        if (t === ONION_GARLIC && !isAllergyRule(r) && (names || (!f.ingredients?.length && !mostlyOnion(dish)))) { if (!onion.includes(p)) onion.push(p); continue; }
        if (!names) continue;
        const k = r.who ? p : "";
        without.set(k, new Set([...(without.get(k) ?? []), ...names]));
      }
    }
  }
  const out: string[] = [];
  if (onion.length) out.push(`make without onion and garlic, or keep ${andList(onion)}'s portion aside`);
  // Onion and garlic already said for a person are not said again; the house's leave-outs are not said again per person.
  const onionNames = new Set((f.ingredients ?? []).filter((x) => x.tags.has(ONION_GARLIC)).map((x) => x.name));
  const house = without.get("") ?? new Set<string>();
  const byText = new Map<string, string[]>();
  for (const [k, names] of without) {
    const left = [...names].filter((n) => (k === "" || !house.has(n)) && !(onion.includes(k) && onionNames.has(n)));
    if (!left.length) continue;
    const text = andList(left);
    byText.set(text, [...(byText.get(text) ?? []), k]);
  }
  for (const [text, who] of byText) {
    const people = who.filter(Boolean);
    out.push(who.includes("") ? `make without ${text}` : `make without ${text} for ${andList(people)}`);
  }
  return out;
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
  const mains = m.dishes.filter((x) => mainAt(w, m.slot, x));
  return d.people.every((p) => { const can = m.dishes.filter((x) => !notFor(w, { ...m, people: [p] }, x).length); return can.length && (!mains.length || can.some((x) => mains.includes(x))); });
}

// ── The checks a saved week is read against (changes.ts: a rule changed after the week was planned) ──

export type ProblemKind = "rule" | "soft_over" | "few";
export type Problem = { kind: ProblemKind; text: string; dish?: string; soft: boolean };
/** A slot's dishes by date, as checked. */
export type Proposal = { days: Map<string, string[]> };

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
  const mains = dishes.filter((x) => mainAt(w, d.slot, x));
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
export const guestForbids = (w: Week, d: PlanDay) => uniq(d.guests.flatMap((g) => g.rules ?? []).flatMap((x) => w.guestTags?.get(x.trim().toLowerCase()) ?? []));
/** Can the guests eat a dish: none of what their rules forbid, and read for each of it. */
export function guestsCan(w: Week, d: PlanDay, dish: string): boolean {
  const f = factsOf(w, d.slot, dish);
  return guestForbids(w, d).every((t) => !f.tags.has(t) && readFor(f.read, t));
}

/** The least share of a week's non-staple items that are the family's own (owner 25 Nov, contract rule 4). */
export const OWN_SHARE = 0.3;
