// What code checks of a week's plan (docs/slot-model-spec.md §5.2, §5.4), and its last resort: every dish from the slot's
// library, a staple or an allowed new dish (never a disliked or dropped one); every hard rule kept for every person at every
// slot-day, read from what each dish contains and failing closed where a dish was never read for a rule's item; each dish's
// days and how often, counted across all slots; the repeat window (staples exempt), and no main twice a day across main
// slots; soft rules within their counts. The feasibility check says up front where the library is too thin, and relaxes in
// a fixed order. Rotation fills a slot-day that still fails from the slot's own dishes. Pure: no database, no model.
import { BASE_TAGS, DEFAULT_DISH_DAYS, FREQUENCY_DAYS, REPEAT_WINDOW_DAYS, REPEAT_WINDOW_RELAXED, STAPLES_FROM_PLANNED, TAG_PARENT,
  UNTRIED_MAX_OFFERS, type Frequency } from "./db/constants";
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

export type SlotFacts = { slot: Slot; library: LibraryDish[]; staples: string[]; daily: string[]; looks_like: string[]; typical: number;
  /** The fewest and most dishes on the slot's past plates (seed and confirmed); null: none. */ plate: [number, number] | null;
  /** Days of each shared dish the feasibility check set aside for this slot (by key). */ takes: Map<string, number>;
  recent: Record<string, string[]>; window: number; newAllowed: number; short: boolean };

/** A slot's staples (history's, from confirmed rows only, and every dish the family has daily), looks like (seed and
 *  confirmed), recent (any status) and the typical count of non-staple dishes on a plate. */
export function slotFacts(slot: Slot, library: LibraryDish[], history: HistoryRow[], recentRows: Record<string, string[]>): SlotFacts {
  const mine = library.filter((d) => same(d.slot, slot.name));
  const daily = mine.filter((d) => d.frequency === "daily" && plannable(d)).map((d) => d.name);
  const fromHistory = staples(stapleRows(history));
  const all = uniq([...fromHistory, ...daily].map((x) => x)).filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
  const keys = new Set(all.map(dishKey));
  const rows = looksLikeRows(history);
  const counts = rows.map((r) => r.dishes.filter((d) => !keys.has(dishKey(d.dish))).length).sort((a, b) => a - b);
  // A plate of staples only (two phulkas every night) has no other dish to fill; no history: one.
  const typical = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 1;
  const sizes = rows.map((r) => r.dishes.length).filter((n) => n > 0);
  const plate: [number, number] | null = sizes.length ? [Math.min(...sizes), Math.max(...sizes)] : null;
  return { slot, library: mine, staples: all, daily, looks_like: looksLike(history), typical, plate, takes: new Map(), recent: recentRows, window: REPEAT_WINDOW_DAYS, newAllowed: 0, short: false };
}

// ── The week as checked: every slot-day, the slots done ──

export type Week = { days: PlanDay[]; slots: Map<string, SlotFacts>; rules: Rule[]; library: LibraryDish[]; facts: Map<string, DishFacts>;
  /** The slots whose dishes are settled (fixed ones count always). */ done: Set<string>; newBudget: number;
  /** New dishes placed so far, by key, with the slot they were placed at. */ newDishes: Map<string, { name: string; slot: string; why: string }>;
  /** What each of the week's guest rules (their words) forbids, as tags, from one read; none read: not checked. */ guestTags?: Map<string, string[]> };

const slotKey = (s: string) => s.toLowerCase();
export const isStapleAt = (w: Week, slot: string, dish: string): boolean => !!w.slots.get(slotKey(slot))?.staples.some((x) => dishKey(x) === dishKey(dish));
const libAt = (w: Week, slot: string, dish: string): LibraryDish | undefined => w.library.find((d) => same(d.slot, slot) && d.key === dishKey(dish));

/** What a dish contains and was read for, at a slot: its library row there, else any row of it, else a read made this run. */
export function factsOf(w: Week, slot: string, dish: string): DishFacts {
  const row = libAt(w, slot, dish) ?? w.library.find((d) => d.key === dishKey(dish));
  const run = w.facts.get(dishKey(dish));
  if (run) return run;
  return row ? { tags: withParents(row.contains), read: new Set(row.contains_read.map(canonTag)) } : { tags: new Set(), read: new Set() };
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
/** Is a slot an add-on: its days may be empty, filled only as often as its dishes' frequency and days allow (owner 23 Nov). */
export const isAddon = (w: Week, slot: string): boolean => w.slots.get(slotKey(slot))?.slot.kind === "addon";
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

// ── The checks ──

export type ProblemKind = "empty" | "not_allowed" | "new_budget" | "rule" | "days" | "often" | "repeat" | "same_day" | "soft_over" | "few";
export type Problem = { kind: ProblemKind; text: string; dish?: string; soft: boolean };
/** A slot's proposal: its dishes by date, and the dishes it says are new (by key). */
export type Proposal = { days: Map<string, string[]>; newNames: Map<string, { name: string; why: string }> };

/** The days a dish is on this week across all slots, the given slot's proposal in place of what it had. */
function datesOf(w: Week, key: string, slot: string, p: Proposal): Map<string, string[]> {
  const out = new Map<string, string[]>();   // date → slots
  const add = (date: string, s: string) => out.set(date, [...(out.get(date) ?? []), s]);
  for (const d of w.days) {
    if (same(d.slot, slot) && !d.fixed) { const ds = p.days.get(d.date) ?? []; if (ds.some((x) => dishKey(x) === key)) add(d.date, d.slot); continue; }
    if (!d.fixed && !w.done.has(slotKey(d.slot))) continue;
    if (d.dishes.some((x) => dishKey(x) === key)) add(d.date, d.slot);
  }
  return out;
}
/** Is a slot settled or still to come: does it count now. */
const counts = (w: Week, d: PlanDay) => d.fixed || w.done.has(slotKey(d.slot));

/** Every problem of a slot's proposal, by date ("" for the week's): §5.4 checks 1 to 5. */
export function checkSlot(w: Week, slotName: string, p: Proposal): Map<string, Problem[]> {
  const sf = w.slots.get(slotKey(slotName))!;
  const out = new Map<string, Problem[]>();
  const add = (date: string, pr: Problem) => { const xs = out.get(date) ?? []; if (!xs.some((x) => x.text === pr.text)) out.set(date, [...xs, pr]); };
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip);
  const isNewHere = (dish: string) => { const row = libAt(w, slotName, dish); return !(row && plannable(row)) && !isStapleAt(w, slotName, dish) && p.newNames.has(dishKey(dish)); };

  // 1. From the library, a staple or a new dish within the budget; never a disliked or dropped one.
  const newKeys: string[] = [];
  for (const d of mine) {
    const dishes = p.days.get(d.date) ?? [];
    if (!dishes.length) { if (sf.slot.kind !== "addon") add(d.date, { kind: "empty", text: "no dish: every slot-day needs its dishes", soft: false }); continue; }
    for (const dish of dishes) {
      const k = dishKey(dish), row = libAt(w, slotName, dish), any = w.library.filter((x) => x.key === k);
      if (any.some((x) => x.disliked)) { add(d.date, { kind: "not_allowed", dish, text: `${dish}: the family did not like it, never plan it`, soft: false }); continue; }
      if (any.some(isDropped)) { add(d.date, { kind: "not_allowed", dish, text: `${dish}: offered twice and never made, do not plan it again`, soft: false }); continue; }
      if ((row && plannable(row)) || isStapleAt(w, slotName, dish)) continue;
      if (!p.newNames.has(k)) { add(d.date, { kind: "not_allowed", dish, text: `${dish} is not one of this slot's dishes: use the library or staples, or list it in new`, soft: false }); continue; }
      if (d.new_dishes_allowed === 0) { add(d.date, { kind: "new_budget", dish, text: `${dish}: no new dish on this day`, soft: false }); continue; }
      if (!newKeys.includes(k)) newKeys.push(k);
    }
  }
  // The week's budget: new dishes of other slots first, then this slot's allowance.
  const elsewhere = [...w.newDishes.entries()].filter(([, v]) => !same(v.slot, slotName)).map(([k]) => k);
  const room = Math.max(0, Math.min(sf.newAllowed, w.newBudget - elsewhere.filter((k) => !newKeys.includes(k)).length));
  for (const k of newKeys.slice(room)) for (const d of mine) for (const dish of (p.days.get(d.date) ?? []).filter((x) => dishKey(x) === k))
    add(d.date, { kind: "new_budget", dish, text: `${dish}: too many new dishes, at most ${room} new ${slotName} dish${room === 1 ? "" : "es"} this week`, soft: false });

  // 2. Hard rules, per person: a dish that breaks a person's rule is not for them (notFor); the problem is a person left with
  //    no dish of their own to eat: none at all, or only staples (rice, curd) where the plate has more. A require kept.
  for (const d of mine) {
    const dishes = p.days.get(d.date) ?? [];
    if (!dishes.length) continue;
    const mains = dishes.filter((x) => !isStapleAt(w, slotName, x));
    for (const person of d.people) {
      if (ownAddon(w, d, person)) continue;   // their own add-on that day holds their dish (checked when it is planned)
      const can = dishes.filter((x) => !notFor(w, d, x).includes(person));
      if (!can.length || (mains.length && !can.some((x) => mains.includes(x))))
        add(d.date, { kind: "rule", text: `${person} has nothing to eat on ${d.date} ${slotName}${mains.length ? ` but staples` : ""}: add a dish ${person} can eat, from the library or a new one (${uniq(mains.flatMap((x) => ruleBreaks(w, { ...d, people: [person] }, x))).join("; ")})`, soft: false });
    }
    for (const t of requireBreaks(w, d, dishes)) add(d.date, { kind: "rule", text: t, soft: false });
    // Guests with food rules ("vegetarian") need a dish of their own the same way, failing closed.
    const words = uniq(d.guests.flatMap((g) => g.rules ?? []));
    const forb = uniq(words.flatMap((x) => w.guestTags?.get(x.trim().toLowerCase()) ?? []));
    if (forb.length) {
      const theirs = dishes.filter((x) => { const f = factsOf(w, slotName, x); return forb.every((t) => !f.tags.has(t) && readFor(f.read, t)); });
      if (!theirs.length || (mains.length && !theirs.some((x) => mains.includes(x))))
        add(d.date, { kind: "rule", text: `the guests (${words.join(", ")}) have nothing to eat on ${d.date} ${slotName}${mains.length ? " but staples" : ""}: add a dish without ${forb.join(", ").replace(/_/g, " ")}, from the library or a new one`, soft: false });
    }
  }

  // 3. Days and how often, across all slots. A daily dish is on every slot-day of its slot.
  const placed = uniq(mine.flatMap((d) => (p.days.get(d.date) ?? []).map(dishKey)));
  for (const k of placed) {
    const row = libAt(w, slotName, k) ?? w.library.find((x) => x.key === k);
    const name = mine.flatMap((d) => p.days.get(d.date) ?? []).find((x) => dishKey(x) === k)!;
    const staple = isStapleAt(w, slotName, name);
    const mineDates = mine.filter((d) => (p.days.get(d.date) ?? []).some((x) => dishKey(x) === k)).map((d) => d.date).sort();
    if (row?.days?.length && same(row.slot, slotName)) for (const date of mineDates.filter((x) => !row.days!.includes(weekdayOf(x))))
      add(date, { kind: "days", dish: name, text: `${name} is had on ${row.days.join(", ")} only, not ${weekdayOf(date)}`, soft: false });
    if (row?.frequency === "daily") continue;
    const range = frequencyRange(row?.frequency ?? null) ?? (staple ? null : [0, DEFAULT_DISH_DAYS] as [number, number]);
    if (!range) continue;
    const all = datesOf(w, k, slotName, p);
    const others = [...all.keys()].filter((x) => !mineDates.includes(x) || all.get(x)!.some((s) => !same(s, slotName)));
    const left = Math.max(0, range[1] - new Set(others).size);
    const extra = mineDates.filter((x) => !others.includes(x)).slice(left);
    const why = row?.frequency ? `the family has it ${row.frequency}: ${range[1]} day${range[1] === 1 ? "" : "s"} a week at most` : `a dish comes on ${range[1]} days a week at most`;
    for (const date of extra) add(date, { kind: "often", dish: name, text: `${name} is on too many days: ${why}`, soft: sf.short && !row?.frequency });
  }
  // Too few for a dish the family has often (sometimes, usually, n a week), once no later slot can have it: put on the days it
  // can still go (its days, not within the repeat window of itself); none left, the softest note.
  // A dish had only on some days ("khichdi on Saturday night") comes at least once on them.
  for (const row of sf.library.filter((x) => ((x.frequency && x.frequency !== "daily") || (!x.frequency && x.days?.length)) && plannable(x))) {
    const range: [number, number] | null = row.frequency ? frequencyRange(row.frequency) : [1, DEFAULT_DISH_DAYS];
    if (!range || !range[0]) continue;
    const later = w.days.some((d) => !same(d.slot, slotName) && !counts(w, d) && !d.skip && w.library.some((x) => x.key === row.key && same(x.slot, d.slot)));
    if (later) continue;
    const all = datesOf(w, row.key, slotName, p);
    const room = mine.filter((d) => !row.days?.length || row.days.includes(weekdayOf(d.date)));
    const short = Math.min(range[0], room.length) - all.size;
    if (short <= 0) continue;
    const on = [...all.keys()];
    const free = room.filter((d) => !all.has(d.date) && on.every((x) => Math.abs(dayDiff(x, d.date)) >= sf.window) && notFor(w, d, row.name).length < d.people.length);
    const text = row.frequency ? `${row.name}: the family has it ${row.frequency}, on ${range[0]} days a week; it is on ${all.size}` : `${row.name}: the family has it on ${row.days!.join(", ")}; it is on none`;
    const picked: string[] = [];
    for (const d of free) if (picked.length < short && picked.every((x) => Math.abs(dayDiff(x, d.date)) >= sf.window)) picked.push(d.date);
    for (const date of picked) add(date, { kind: "few", dish: row.name, text: `${text}: add it on ${weekdayOf(date)}`, soft: false });
    if (picked.length < short) add("", { kind: "few", dish: row.name, text, soft: true });
  }
  // A daily dish missing from a slot-day of its slot.
  for (const dish of sf.daily) {
    const row = libAt(w, slotName, dish);
    for (const d of mine) if ((!row?.days?.length || row.days.includes(weekdayOf(d.date))) && !(p.days.get(d.date) ?? []).some((x) => dishKey(x) === dishKey(dish)) && notFor(w, d, dish).length < d.people.length)
      add(d.date, { kind: "often", dish, text: `${dish} is had every day here: add it`, soft: false });
  }

  // 4. The repeat window in this slot (staples exempt), from before the week too; no main twice a day across main slots.
  const seen: { date: string; key: string; dish: string; mine: boolean }[] = [];
  for (const [date, ds] of Object.entries(sf.recent)) for (const dish of ds) seen.push({ date, key: dishKey(dish), dish, mine: false });
  for (const d of w.days.filter((x) => same(x.slot, slotName))) {
    const ds = d.fixed ? d.dishes : d.skip ? [] : p.days.get(d.date) ?? [];
    for (const dish of ds) seen.push({ date: d.date, key: dishKey(dish), dish, mine: !d.fixed });
  }
  seen.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < seen.length; i++) {
    const x = seen[i];
    if (isStapleAt(w, slotName, x.dish)) continue;
    const prev = seen.slice(0, i).reverse().find((y) => y.key === x.key && y.date !== x.date);
    if (!prev || dayDiff(prev.date, x.date) >= sf.window) continue;
    const blame = x.mine ? x : prev.mine ? prev : null;
    if (blame) add(blame.date, { kind: "repeat", dish: blame.dish, text: `${blame.dish} is on ${weekdayOf(prev.date)} and ${weekdayOf(x.date)}: not within ${sf.window} days of itself`, soft: sf.short });
  }
  if (sf.slot.kind === "main") for (const d of mine) for (const dish of p.days.get(d.date) ?? []) {
    if (isStapleAt(w, slotName, dish)) continue;
    const other = w.days.find((x) => x.date === d.date && !same(x.slot, slotName) && counts(w, x) && w.slots.get(slotKey(x.slot))?.slot.kind === "main"
      && x.dishes.some((y) => dishKey(y) === dishKey(dish)) && !isStapleAt(w, x.slot, dish));
    if (other) add(d.date, { kind: "same_day", dish, text: `${dish} is already at ${other.slot} that day`, soft: false });
  }

  // 5. Soft rules with a count, across slots: a dish with `to` (a swap) or one of the items (a require) for the person.
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
export const hardOnly = (ps: Problem[] | undefined) => (ps ?? []).filter((x) => !x.soft);

// ── Feasibility (§5.2) ──

/** Before the slot calls: for each slot, are there enough non-staple library dishes for its places this week. When short:
 *  more new dishes for it (up to the week's setting), then the repeat window from 3 days to 2, then a question to the family
 *  (`short`: makePlan asks what else they have there, owner 23 Nov). An add-on is never short. Then the
 *  rest of the new-dish budget goes, one at a time, to the slots that need it most. Sets each slot's `newAllowed`, `window`
 *  and `short`; answers the short slots and the log. */
export type ShortSlot = { slot: string; known: number; supply: number; places: number };
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
    if (supply < places && budget > 0) {
      const extra = Math.min(budget, Math.ceil((places - supply) / DEFAULT_DISH_DAYS));
      sf.newAllowed += extra; budget -= extra;
      supply += extra * Math.min(DEFAULT_DISH_DAYS, Math.ceil(days.length / sf.window));
      steps.push(`${extra} more new dish${extra === 1 ? "" : "es"}`);
    }
    if (supply < places) {
      sf.window = REPEAT_WINDOW_RELAXED;
      supply = supplyAt(sf.window) + sf.newAllowed * Math.min(DEFAULT_DISH_DAYS, Math.ceil(days.length / sf.window));
      steps.push(`repeat window ${REPEAT_WINDOW_RELAXED} days`);
    }
    if (supply < places) {
      sf.short = true;
      const known = sf.library.filter((d) => plannable(d) && !sf.staples.some((s) => dishKey(s) === d.key)).length;
      short.push({ slot: name, known, supply: supply0, places });
      steps.push("asked");
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

// ── Swaps, rotation and the add-ons (§5.4, the last resort) ──
//
// Code never takes a dish off the model's plate without putting another in its place (owner, 23 Nov): a dish a check
// rejects (back too soon, too often, the wrong day, not allowed) is swapped in the same place for an allowed library dish,
// the dish at the same place in the family's own plates first (Kadhi for Dal, one dry vegetable for another); when no
// dish fits, the original stays and the repeat is noted. The plate's size is never counted. The one exception is an add-on
// slot: its days are filled only as often as its dishes allow, so a dish over its count with no swap leaves that day empty.

/** Each dish's places in the family's plates at a slot: its index among a plate's non-staple parts, and how many there are. */
function rolesOf(w: Week, slotName: string): Map<string, { i: number; n: number }[]> {
  const out = new Map<string, { i: number; n: number }[]>();
  for (const row of w.slots.get(slotKey(slotName))?.looks_like ?? []) {
    const parts = row.split(",").map((x) => x.trim()).filter((x) => x && !isStapleAt(w, slotName, x));
    parts.forEach((x, i) => out.set(dishKey(x), [...(out.get(dishKey(x)) ?? []), { i, n: parts.length }]));
  }
  return out;
}
/** How well a dish stands in for another: 2 at the same place in plates of the same size, 1 at the same place, 0 none. */
function peerScore(roles: Map<string, { i: number; n: number }[]>, a: string, b: string): number {
  let best = 0;
  for (const x of roles.get(dishKey(a)) ?? []) for (const y of roles.get(dishKey(b)) ?? []) if (x.i === y.i) best = Math.max(best, x.n === y.n ? 2 : 1);
  return best;
}
/** The days a dish is on this week, the slot's proposal in place of its saved days (the rotation's least-used order). */
function usedDaysOf(w: Week, slotName: string, p: Proposal): (name: string) => number {
  return (name: string) => new Set(w.days.filter((d) => (counts(w, d) || same(d.slot, slotName)) && (same(d.slot, slotName) && !d.fixed ? p.days.get(d.date) ?? [] : d.dishes)
    .some((x) => dishKey(x) === dishKey(name))).map((d) => d.date)).size;
}
/** The library dishes that may stand in at a slot-day (plannable, not a staple, on its days), best stand-ins for `dish`
 *  first, then the least used this week. */
function standIns(w: Week, slotName: string, p: Proposal, date: string, dish: string | null, plate: string[]): string[] {
  const sf = w.slots.get(slotKey(slotName))!, roles = rolesOf(w, slotName), used = usedDaysOf(w, slotName, p);
  return sf.library.filter((x) => plannable(x) && !isStapleAt(w, slotName, x.name) && (!x.days?.length || x.days.includes(weekdayOf(date)))
    && !plate.some((y) => dishKey(y) === x.key)).map((x, i) => ({ name: x.name, i, s: dish ? peerScore(roles, dish, x.name) : 0, u: used(x.name) }))
    .sort((a, b) => b.s - a.s || a.u - b.u || a.i - b.i).map((x) => x.name);
}
/** A dish's own count for the week, as the checks read it: its frequency, else the default (none for a staple or a daily dish). */
function maxDays(w: Week, slotName: string, dish: string): number | null {
  const row = libAt(w, slotName, dish) ?? w.library.find((x) => x.key === dishKey(dish));
  if (row?.frequency === "daily") return null;
  const r = frequencyRange(row?.frequency ?? null);
  return r ? r[1] : isStapleAt(w, slotName, dish) ? null : DEFAULT_DISH_DAYS;
}
const withAt = (xs: string[], i: number, x: string) => xs.map((y, j) => (j === i ? x : y));

/** An add-on's days thinned to what its dishes allow (owner, 23 Nov): a dish on more days than its count (its frequency,
 *  else the default, less its days at other slots) or on a day not its own keeps the days spread furthest apart; on the
 *  others it is swapped for another of the add-on's dishes with room that is not back too soon, else taken off, and a
 *  day left with nothing is empty. Not where a person of the add-on would then have nothing of their own at the main
 *  slot: that day keeps its dish, and says so. Answers the lines for `unmet` and the log. */
export function thinAddon(w: Week, slotName: string, p: Proposal): { unmet: string[]; changed: string[] } {
  const sf = w.slots.get(slotKey(slotName))!, unmet: string[] = [], changed: string[] = [];
  if (sf.slot.kind !== "addon") return { unmet, changed };
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip).sort((a, b) => a.date.localeCompare(b.date));
  const before = new Map(mine.map((d) => [d.date, [...(p.days.get(d.date) ?? [])]]));
  const elsewhere = (name: string) => new Set(w.days.filter((d) => !same(d.slot, slotName) && counts(w, d) && d.dishes.some((x) => dishKey(x) === dishKey(name))).map((d) => d.date));
  const datesHere = (name: string) => mine.filter((d) => (p.days.get(d.date) ?? []).some((x) => dishKey(x) === dishKey(name))).map((d) => d.date);
  const room = (name: string) => { const m = maxDays(w, slotName, name); return m === null ? Infinity : m - elsewhere(name).size - datesHere(name).filter((x) => !elsewhere(name).has(x)).length; };
  const far = (name: string, date: string) => datesHere(name).every((x) => x === date || Math.abs(dayDiff(x, date)) >= sf.window);
  const names = uniq(mine.flatMap((d) => (p.days.get(d.date) ?? []).map(dishKey))).map((k) => mine.flatMap((d) => p.days.get(d.date) ?? []).find((x) => dishKey(x) === k)!);
  const over: { date: string; dish: string }[] = [];
  for (const name of names) {
    const row = libAt(w, slotName, name);
    const dates = datesHere(name);
    const wrongDay = dates.filter((x) => row?.days?.length && !row.days.includes(weekdayOf(x)));
    const ok = dates.filter((x) => !wrongDay.includes(x) && !elsewhere(name).has(x));
    const m = maxDays(w, slotName, name);
    const cap = m === null ? Infinity : Math.max(0, m - elsewhere(name).size);
    // Keep the days furthest apart: each one at least the repeat window after the last kept, then the earliest left.
    const keep: string[] = [];
    for (const x of ok) if (keep.length < cap && keep.every((y) => Math.abs(dayDiff(y, x)) >= sf.window)) keep.push(x);
    for (const x of ok) if (keep.length < cap && !keep.includes(x)) keep.push(x);
    for (const x of dates.filter((y) => !keep.includes(y) && (wrongDay.includes(y) || ok.includes(y)))) over.push({ date: x, dish: name });
  }
  for (const { date, dish } of over.sort((a, b) => a.date.localeCompare(b.date))) {
    const d = mine.find((x) => x.date === date)!;
    const plate = p.days.get(date) ?? [];
    const i = plate.findIndex((x) => dishKey(x) === dishKey(dish));
    if (i < 0) continue;
    const swap = standIns(w, slotName, p, date, dish, plate).find((c) => room(c) > 0 && far(c, date) && notFor(w, d, c).length < d.people.length);
    p.days.set(date, swap ? withAt(plate, i, swap) : plate.filter((_, j) => j !== i));
  }
  for (const d of mine) {
    const was = before.get(d.date)!, now = p.days.get(d.date) ?? [];
    if (!was.length || now.join("|") === was.join("|")) continue;
    d.dishes = now;   // read by mainFeeds below (the main slot's own check of who is fed)
    if (!now.length && !mainFeeds(w, d)) {
      p.days.set(d.date, was);
      unmet.push(`${weekdayOf(d.date)} ${slotName}: ${was.join(", ")} comes back sooner than usual`);
    }
    d.dishes = [];
    changed.push(`${weekdayOf(d.date)} ${slotName} → ${(p.days.get(d.date) ?? []).join(", ") || "nothing (empty)"}`);
  }
  return { unmet, changed };
}

/** Each slot-day still failing a hard check, mended in code: each dish a hard problem names swapped in its place for an
 *  allowed library dish (its stand-ins in the family's plates first) that leaves fewer problems there and none more
 *  elsewhere; a person with nothing of their own gets a dish they can eat beside the others; a dish the family has often
 *  and is short of takes the place of one of its stand-ins. No swap fits: the original stays and the repeat is noted (a
 *  dish never allowed there takes the least bad stand-in instead); an add-on's dish over its count is taken off, the day
 *  left empty where its people are fed at the main slot. A day with no dish at all (not an add-on) gets one of the
 *  family's own plates. `swapsOnly`: only the dishes back too soon, too often or twice a day are swapped (before the fix
 *  call). Answers the lines for `unmet` and the log. */
export function rotate(w: Week, slotName: string, p: Proposal, failing: string[], opts: { swapsOnly?: boolean } = {}): { unmet: string[]; changed: string[] } {
  const sf = w.slots.get(slotKey(slotName))!;
  const addon = sf.slot.kind === "addon";
  const unmet: string[] = [], changed: string[] = [];
  const freqOf = (dish: string) => (libAt(w, slotName, dish) ?? w.library.find((y) => y.key === dishKey(dish)))?.frequency ?? null;
  const never = (x: Problem) => x.kind === "not_allowed" || x.kind === "new_budget" || x.kind === "days";
  const comesBack = (x: Problem) => x.kind === "repeat" || x.kind === "same_day" || x.kind === "often";
  for (const date of failing) {
    const d = w.days.find((x) => x.date === date && same(x.slot, slotName))!;
    const was = p.days.get(date) ?? [];
    const all = (ds: string[]) => checkSlot(w, slotName, { days: new Map(p.days).set(date, ds), newNames: p.newNames });
    const hardAt = (ds: string[]) => hardOnly(all(ds).get(date));
    const others = (ds: string[]) => [...all(ds).entries()].filter(([x]) => x !== date && x !== "").reduce((n, [, ps]) => n + hardOnly(ps).length, 0);
    /** The other days' hard problems, less those of a kind that does not count here (the least bad: a dish back early). */
    const othersBut = (ds: string[], skip: (x: Problem) => boolean) => [...all(ds).entries()].filter(([x]) => x !== date && x !== "").reduce((n, [, ps]) => n + hardOnly(ps).filter((x) => !skip(x)).length, 0);
    const own = (ds: string[], dish: string) => hardAt(ds).filter((x) => x.dish && dishKey(x.dish) === dishKey(dish));
    /** Is `next` better than `plate` here, no worse elsewhere, and the new dish clean (or, `least`, only back early). */
    const better = (plate: string[], next: string[], dish: string, least: boolean) =>
      hardAt(next).length < hardAt(plate).length && others(next) <= others(plate) && (least ? own(next, dish).every(comesBack) : !own(next, dish).length);
    let plate = [...was];
    const noted: string[] = [];
    // A day with nothing (the call left it out): one of the family's own plates at this slot that fits, else a dish.
    if (!plate.length && !addon && !opts.swapsOnly) {
      const staples = sf.staples.filter((s) => notFor(w, d, s).length < d.people.length);
      const lib = sf.library.filter((x) => plannable(x) && !isStapleAt(w, slotName, x.name) && (!x.days?.length || x.days.includes(weekdayOf(date))));
      const units = sf.looks_like.map((r) => r.split(",").map((x) => x.trim()).filter((x) => x && !isStapleAt(w, slotName, x)))
        .filter((u) => u.length && u.every((x) => lib.some((y) => y.key === dishKey(x)))).map((u) => u.map((x) => lib.find((y) => y.key === dishKey(x))!.name));
      const tries = [...units, ...standIns(w, slotName, p, date, null, []).map((x) => [x])].map((u) => [...staples, ...u]);
      plate = tries.find((t) => !hardAt(t).length) ?? tries.find((t) => hardAt(t).every((x) => comesBack(x))) ?? tries[0] ?? [];
      if (plate.length && hardAt(plate).some(comesBack)) noted.push(...plate.filter((x) => own(plate, x).some(comesBack)));
    }
    // Each dish a hard problem names: swapped in its place.
    for (let i = 0; i < plate.length; i++) {
      const x = plate[i];
      const mine = own(plate, x).filter((y) => !opts.swapsOnly || comesBack(y));
      if (!mine.length) continue;
      const cands = standIns(w, slotName, p, date, x, plate);
      const clean = cands.find((c) => better(plate, withAt(plate, i, c), c, false));
      if (clean) { plate = withAt(plate, i, clean); continue; }
      if (addon && mine.some((y) => y.kind === "often" || never(y))) { plate = plate.filter((_, j) => j !== i); i--; continue; }
      if (mine.some(never)) {
        const least = cands.find((c) => own(withAt(plate, i, c), c).every(comesBack) && !hardAt(withAt(plate, i, c)).some((y) => y.dish && dishKey(y.dish) === dishKey(x)));
        if (least) { plate = withAt(plate, i, least); noted.push(least); }
        else { plate = plate.filter((_, j) => j !== i); i--; }
        continue;
      }
      // Only back too soon or too often, and nothing to swap it for: kept, and said.
      if (mine.every(comesBack)) noted.push(x);
    }
    // A person with nothing of their own there: a dish they can eat, beside the others.
    for (const r of opts.swapsOnly ? [] : hardAt(plate).filter((x) => x.kind === "rule" && !x.dish)) {
      if (!hardAt(plate).some((x) => x.text === r.text)) continue;
      const cands = standIns(w, slotName, p, date, null, plate);
      // Feeds them: the person's problem gone, and the dish's own faults at most a repeat (the least bad), none elsewhere.
      const feeds = (c: string, least: boolean) => { const next = [...plate, c]; return !hardAt(next).some((x) => x.text === r.text)
        && (least ? othersBut(next, comesBack) <= othersBut(plate, comesBack) && own(next, c).every(comesBack) : others(next) <= others(plate) && !own(next, c).length); };
      const add = cands.find((c) => feeds(c, false)) ?? cands.find((c) => feeds(c, true));
      if (add) { plate = [...plate, add]; if (own(plate, add).length) noted.push(add); }
    }
    // A dish the family has often that this day should have: in the place of a stand-in of it, when that leaves fewer problems.
    for (const f of opts.swapsOnly ? [] : hardAt(plate).filter((x) => x.kind === "few" && x.dish)) {
      if (plate.some((x) => dishKey(x) === dishKey(f.dish!))) continue;
      const roles = rolesOf(w, slotName);
      const at = plate.map((x, i) => ({ x, i })).filter(({ x }) => !isStapleAt(w, slotName, x)).sort((a, b) => peerScore(roles, f.dish!, b.x) - peerScore(roles, f.dish!, a.x));
      for (const { i } of at) {
        const row = libAt(w, slotName, f.dish!);
        if (!row) break;
        const next = withAt(plate, i, row.name);
        if (better(plate, next, row.name, false)) { plate = next; break; }
      }
    }
    if (addon && !plate.length && was.length) {
      d.dishes = [];
      if (!mainFeeds(w, d)) { plate = was; noted.push(...was); }
    }
    if (!plate.length && !addon) { plate = was; unmet.push(`${weekdayOf(date)} ${slotName}: no known dish fits everyone there`); }
    for (const x of uniq(noted)) if (plate.some((y) => dishKey(y) === dishKey(x))) unmet.push(`${weekdayOf(date)} ${slotName}: ${x} comes back sooner than usual`);
    for (const x of hardAt(plate).filter((y) => y.kind === "rule" && !y.dish)) unmet.push(`${weekdayOf(date)} ${slotName}: ${x.text.split(":")[0]}`);
    p.days.set(date, plate);
    changed.push(`${weekdayOf(date)} ${slotName} → ${plate.join(", ") || "nothing (empty)"}`);
  }
  return { unmet, changed };
}

/** The last resort's second step, when the swaps day by day still leave a dish back too soon or too often: the slot's
 *  whole week chosen again in code, day by day with backtracking. A day's choices are its plate as it is, then that plate
 *  with one dish swapped in its place for a stand-in (the family's own plates' dish at that place first, then the least
 *  used): never a plate with fewer dishes. A choice may leave no problem on its day or before but a person with nothing of
 *  their own where the plate already had that. Answers the new days, or null when no week was found within `nodes` tries
 *  or it is no better. */
export function resolveSlot(w: Week, slotName: string, p: Proposal, nodes = 4000): Map<string, string[]> | null {
  const mine = w.days.filter((d) => same(d.slot, slotName) && !d.fixed && !d.skip).sort((a, b) => a.date.localeCompare(b.date));
  if (!mine.length) return null;
  const now = checkSlot(w, slotName, p);
  // Not counted: soft ones, a dish short of its count (a later day may add it), and a person with nothing of their own that
  // the plate as it is already had (the library has nothing for them there).
  const tolerated = (x: Problem, date: string) => x.soft || x.kind === "few" || (x.kind === "rule" && !!now.get(date)?.some((y) => y.text === x.text));
  const countAt = (ps: Map<string, Problem[]>, date: string) => (ps.get(date) ?? []).filter((x) => !tolerated(x, date)).length;
  const total = (ps: Map<string, Problem[]>) => [...ps.keys()].reduce((n, d) => n + countAt(ps, d), 0);
  const before = total(now);
  if (!before) return null;
  const trial: Proposal = { days: new Map(p.days), newNames: p.newNames };
  const choices = (d: PlanDay): string[][] => {
    const had = p.days.get(d.date) ?? [];
    const out: string[][] = [had];
    had.forEach((x, i) => { if (!isStapleAt(w, slotName, x)) for (const c of standIns(w, slotName, p, d.date, x, had)) out.push(withAt(had, i, c)); });
    return out;
  };
  // The best week seen, should none leave every day clean.
  let best: { days: Map<string, string[]>; n: number } | null = null;
  let tries = 0;
  const pick = (i: number): boolean => {
    if (i === mine.length) return true;
    const d = mine[i];
    for (const u of choices(d)) {
      if (++tries > nodes) return false;
      trial.days.set(d.date, u);
      const ps = checkSlot(w, slotName, { days: new Map([...trial.days].filter(([x]) => mine.slice(0, i + 1).some((y) => y.date === x) || !mine.some((y) => y.date === x))), newNames: p.newNames });
      if (mine.slice(0, i + 1).every((y) => !countAt(ps, y.date)) && pick(i + 1)) return true;
    }
    trial.days.set(d.date, p.days.get(d.date) ?? []);
    return false;
  };
  if (pick(0)) best = { days: new Map(trial.days), n: total(checkSlot(w, slotName, trial)) };
  else {
    // No clean week: day by day, the choice that leaves the fewest problems so far (greedy, plates kept).
    const greedy: Proposal = { days: new Map(p.days), newNames: p.newNames };
    for (const d of mine) {
      let pickU = greedy.days.get(d.date) ?? [], pickN = Infinity;
      for (const u of choices(d)) {
        const n = total(checkSlot(w, slotName, { days: new Map(greedy.days).set(d.date, u), newNames: p.newNames }));
        if (n < pickN) { pickN = n; pickU = u; }
      }
      greedy.days.set(d.date, pickU);
    }
    best = { days: greedy.days, n: total(checkSlot(w, slotName, greedy)) };
  }
  return best && best.n < before ? new Map(mine.map((d) => [d.date, best!.days.get(d.date) ?? []])) : null;
}

/** A daily dish missing from a slot-day of its slot, put in by code (where every rule there allows it). */
export function addDaily(w: Week, slotName: string, p: Proposal): void {
  const sf = w.slots.get(slotKey(slotName))!;
  for (const dish of sf.daily) {
    const row = libAt(w, slotName, dish);
    for (const d of w.days.filter((x) => same(x.slot, slotName) && !x.fixed && !x.skip)) {
      const ds = p.days.get(d.date);
      if (!ds?.length || ds.some((x) => dishKey(x) === dishKey(dish))) continue;
      if (row?.days?.length && !row.days.includes(weekdayOf(d.date))) continue;
      if (notFor(w, d, dish).length < d.people.length) p.days.set(d.date, [...ds, dish]);
    }
  }
}

/** The dates `days` days before `from`, for the repeat window's look back. */
export const lookBack = (from: string, days: number) => addDays(from, -days);
