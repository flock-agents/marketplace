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
  const typical = counts.length ? Math.max(1, counts[Math.floor((counts.length - 1) / 2)]) : 1;
  return { slot, library: mine, staples: all, daily, looks_like: looksLike(history), typical, recent: recentRows, window: REPEAT_WINDOW_DAYS, newAllowed: 0, short: false };
}

// ── The week as checked: every slot-day, the slots done ──

export type Week = { days: PlanDay[]; slots: Map<string, SlotFacts>; rules: Rule[]; library: LibraryDish[]; facts: Map<string, DishFacts>;
  /** The slots whose dishes are settled (fixed ones count always). */ done: Set<string>; newBudget: number;
  /** New dishes placed so far, by key, with the slot they were placed at. */ newDishes: Map<string, { name: string; slot: string; why: string }> };

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
/** A hard require that holds at a slot-day and no dish of it keeps. */
function requireBreaks(w: Week, d: PlanDay, dishes: string[]): string[] {
  const out: string[] = [];
  for (const p of d.people) for (const r of rulesFor(w, d, p).filter((x) => x.what === "require" && x.items?.length)) {
    if (!dishes.some((x) => !notFor(w, d, x).includes(p) && r.items!.some((i) => factsOf(w, d.slot, x).tags.has(canonTag(i)))))
      out.push(`no dish with ${r.items!.join(" or ")} for ${p} ("${r.quote}")`);
  }
  return uniq(out);
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
    if (!dishes.length) { add(d.date, { kind: "empty", text: "no dish: every slot-day needs its dishes", soft: false }); continue; }
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
      const can = dishes.filter((x) => !notFor(w, d, x).includes(person));
      if (!can.length || (mains.length && !can.some((x) => mains.includes(x))))
        add(d.date, { kind: "rule", text: `${person} has nothing to eat on ${d.date} ${slotName}${mains.length ? ` but staples` : ""}: add a dish ${person} can eat (${uniq(mains.flatMap((x) => ruleBreaks(w, { ...d, people: [person] }, x))).join("; ")})`, soft: false });
    }
    for (const t of requireBreaks(w, d, dishes)) add(d.date, { kind: "rule", text: t, soft: false });
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
    // Too few for a dish the family has often, once its slot is the last to plan: the softest.
    if (row?.frequency && same(row.slot, slotName) && all.size < Math.min(range[0], mine.filter((d) => !row.days?.length || row.days.includes(weekdayOf(d.date))).length))
      add("", { kind: "few", dish: name, text: `${name}: the family has it ${row.frequency}, on ${range[0]} days a week; it is on ${all.size}`, soft: true });
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
 *  more new dishes for it (up to the week's setting), then the repeat window from 3 days to 2, then a line in `unmet`. Then the
 *  rest of the new-dish budget goes, one at a time, to the slots that need it most. Sets each slot's `newAllowed`, `window`
 *  and `short`; answers the unmet lines and the log. */
export function feasibility(w: Week, order: string[]): { unmet: string[]; log: string[] } {
  const unmet: string[] = [], log: string[] = [];
  let budget = w.newBudget;
  const used = (k: string) => new Set(w.days.filter((d) => d.fixed && d.dishes.some((x) => dishKey(x) === k)).map((d) => d.date)).size;
  for (const name of order) {
    const sf = w.slots.get(slotKey(name))!;
    const days = w.days.filter((d) => same(d.slot, name) && !d.fixed && !d.skip);
    if (!days.length) continue;
    const places = days.length * sf.typical;
    const supplyAt = (window: number) => sf.library.filter((d) => plannable(d) && !sf.staples.some((s) => dishKey(s) === d.key)).reduce((n, d) => {
      const max = (frequencyRange(d.frequency) ?? [0, DEFAULT_DISH_DAYS])[1];
      const on = days.filter((x) => !d.days?.length || d.days.includes(weekdayOf(x.date))).length;
      return n + Math.max(0, Math.min(max - used(d.key), on, Math.ceil(days.length / window)));
    }, 0);
    let supply = supplyAt(sf.window);
    const steps: string[] = [];
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
      unmet.push(`only ${known} ${name} dish${known === 1 ? "" : "es"} known, so some come back more often than usual`);
      steps.push("noted in unmet");
    }
    log.push(`feasibility ${name}: ${places} places (${days.length} × ${sf.typical}), ${supply} from the library${steps.length ? `; relaxed: ${steps.join(", then ")}` : ""}`);
  }
  // The rest of the budget is shared: every slot may use it, and the week's check keeps the total (the slots placed first
  // come first); what a thin slot was given above stays its own.
  for (const name of order) w.slots.get(slotKey(name))!.newAllowed += budget;
  return { unmet, log };
}

// ── Rotation (§5.4, the last resort) ──

/** Each slot-day still failing a hard check, filled in code from the slot's own dishes: the dishes no hard problem names are
 *  kept (staples first, when it had none, those someone can eat), then library dishes are added one at a time, the least used
 *  this week first, each one that leaves fewer hard problems and names none of its own (a person with nothing to eat gets a
 *  dish they can eat), until none is left or the plate has its usual number of dishes. Where none fits, the least bad (a dish
 *  come back early) and a line in `unmet`. */
export function rotate(w: Week, slotName: string, p: Proposal, failing: string[]): { unmet: string[]; changed: string[] } {
  const sf = w.slots.get(slotKey(slotName))!;
  const unmet: string[] = [], changed: string[] = [];
  const usedDays = (k: string) => new Set(w.days.filter((d) => (counts(w, d) || same(d.slot, slotName)) && (same(d.slot, slotName) && !d.fixed ? p.days.get(d.date) ?? [] : d.dishes).some((x) => dishKey(x) === k)).map((d) => d.date)).size;
  for (const date of failing) {
    const d = w.days.find((x) => x.date === date && same(x.slot, slotName))!;
    const was = p.days.get(date) ?? [];
    const all = (ds: string[]) => checkSlot(w, slotName, { days: new Map(p.days).set(date, ds), newNames: p.newNames });
    const hardAt = (ds: string[]) => hardOnly(all(ds).get(date));
    /** The hard problems a plate leaves on the slot's other days (a dish come back too soon there). */
    const elsewhere = (ds: string[]) => [...all(ds).entries()].filter(([d]) => d !== date && d !== "").reduce((n, [, ps]) => n + hardOnly(ps).length, 0);
    const named = new Set(hardAt(was).map((x) => x.dish).filter((x): x is string => !!x));
    let plate = was.filter((x) => !named.has(x));
    if (!plate.some((x) => isStapleAt(w, slotName, x))) plate = [...sf.staples.filter((s) => notFor(w, d, s).length < d.people.length && !plate.includes(s)), ...plate];
    const pool = sf.library.filter((x) => plannable(x) && !sf.staples.some((s) => dishKey(s) === x.key) && (!x.days?.length || x.days.includes(weekdayOf(date))))
      .map((x, i) => ({ x, i })).sort((a, b) => usedDays(a.x.key) - usedDays(b.x.key) || a.i - b.i).map((y) => y.x.name).filter((x) => !plate.some((y) => dishKey(y) === dishKey(x)));
    const fill = (ok: (ps: Problem[], dish: string) => boolean) => {
      for (const dish of pool) {
        const now = hardAt(plate).filter((x) => x.kind !== "empty");
        const short = plate.filter((x) => !isStapleAt(w, slotName, x)).length < sf.typical;
        if (!now.length && !short) return;
        if (plate.includes(dish)) continue;
        const after = hardAt([...plate, dish]);
        if (elsewhere([...plate, dish]) > elsewhere(plate)) continue;
        if (ok(after.filter((x) => x.dish === dish), dish) && (after.length < now.length || (short && after.length <= now.length))) plate = [...plate, dish];
      }
    };
    fill((own) => !own.length);
    if (hardAt(plate).filter((x) => x.kind !== "empty").length || plate.filter((x) => !isStapleAt(w, slotName, x)).length < sf.typical) {
      // The least bad: a dish whose only fault is coming back early or too often.
      const before = plate.length;
      fill((own) => own.every((x) => x.kind === "repeat" || x.kind === "often"));
      for (const dish of plate.slice(before)) unmet.push(`${weekdayOf(date)} ${slotName}: ${dish} comes back sooner than usual`);
    }
    if (!plate.length) { unmet.push(`${weekdayOf(date)} ${slotName}: no known dish fits everyone there`); plate = was; }
    for (const x of hardAt(plate).filter((y) => y.kind === "rule" && !y.dish)) unmet.push(`${weekdayOf(date)} ${slotName}: ${x.text.split(":")[0]}`);
    p.days.set(date, plate);
    changed.push(`${weekdayOf(date)} ${slotName} → ${plate.join(", ") || "nothing"}`);
  }
  return { unmet, changed };
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
