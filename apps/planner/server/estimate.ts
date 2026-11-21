// The running-out estimate (spec 3.5), as pure functions: no DB. An item's events (purchases, answers, asks) are tagged in
// date order, the tagged events make the item's pattern, and the pattern gives the run-out date, whether to ask, and the
// status the Pantry shows. An item's cycle ("500 ml every day", "30 pc about once a week") is that pattern in words; where the
// purchases show none yet, it is the cycle the family stated.

import { ESTIMATE } from "./db/constants";
import { addDays } from "./dates";

export type Ev = { id: string; date: string; kind: "purchase" | "answer" | "ask" | "unanswered"; amount: number | null; unit: string | null;
  product: string | null; app: string | null; days: number | null; void?: boolean };
/** `restocked`: the purchase moved the anchor (tagEvents decides; pattern reads it). `sized`: its amount is in the item's unit. */
export type Tagged = Ev & { tag: "counted" | "early_buy" | "your_answer" | "one_off" | "not_counted" | null; cycle_days: number | null;
  restocked: boolean; sized: boolean };
export type Pattern = { usual_amount: number | null; lasts_days: number | null; product: string | null; app: string | null;
  last_bought: string | null; anchor_amount: number | null; cycles: number; confident: boolean };
/** `cycles` (pattern().cycles) orders asks with the same run-out: more cycles, more sure, first. */
export type ItemState = { id: string; name: string; group: string | null; subscription: string | null; dont_ask: boolean;
  snoozed_until: string | null; wait_factor: number; run_out: string | null; confident: boolean; last_bought: string | null; cycles: number };

/** The median; 0 for no numbers (callers use medianOrNull when the list can be empty). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DAY_MS = 86_400_000;
const utc = (date: string) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);
const lastN = (xs: number[]) => xs.slice(-ESTIMATE.cycles);
const medianOrNull = (xs: number[]) => (xs.length ? median(lastN(xs)) : null);

type Dir = "amount-low" | "amount-high" | "gap-short" | "gap-long" | "unit";
const PATTERN_TAGS = new Set<Tagged["tag"]>(["counted", "early_buy"]);

/** The events tagged in date order (void events dropped): how each purchase counts, and the cycle each one closes. */
export function tagEvents(events: Ev[], unit: string | null): Tagged[] {
  const out: Tagged[] = events.filter((e) => !e.void)
    .map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .map(({ e }) => ({ ...e, tag: null, cycle_days: null, restocked: false,
      sized: e.kind === "purchase" && e.amount != null && e.unit === unit }));
  const amounts: number[] = [];   // sized pattern purchases' amounts, in order
  const cycles: number[] = [];    // cycle lengths, in order
  let anchor = null as Tagged | null;   // `as`: set inside restock(), which TS does not follow
  let askedSinceAnchor = false;
  let answerClosedCycle = false;  // an answer with days closed the anchor's cycle: the next purchase adds no gap
  let prev: { t: Tagged; dir: Dir | null; gap: number | null } | null = null;

  const restock = (t: Tagged) => { t.restocked = true; anchor = t; askedSinceAnchor = false; answerClosedCycle = false; };
  // Enters the pattern: its amount when sized, its cycle when it closes one.
  const enter = (t: Tagged) => { if (t.sized) amounts.push(t.amount!); if (t.cycle_days != null) cycles.push(t.cycle_days); restock(t); };

  for (const t of out) {
    if (t.kind === "ask") { askedSinceAnchor = true; continue; }
    if (t.kind === "unanswered") { t.tag = "not_counted"; continue; }
    if (t.kind === "answer") {
      // An answer before any purchase has no anchor to count from: not counted.
      if (t.days == null || !anchor) { t.tag = "not_counted"; continue; }
      t.tag = "your_answer";
      t.cycle_days = daysBetween(anchor.date, t.date) + t.days;
      cycles.push(t.cycle_days);
      askedSinceAnchor = true;
      answerClosedCycle = true;
      continue;
    }

    // A purchase. Its gap is the days since the anchor; after an answer closed the cycle it has none.
    const gap = anchor && !answerClosedCycle ? daysBetween(anchor.date, t.date) : null;
    const usual = medianOrNull(amounts);
    const lasts = medianOrNull(cycles);
    let dir: Dir | null = null;
    // Until a sized purchase is in the pattern, an unsized one is judged by its gap alone (histories without pack sizes).
    if (!t.sized && amounts.length) dir = "unit";
    else if (t.sized && usual != null && t.amount! / usual <= ESTIMATE.oneOffLow) dir = "amount-low";
    else if (t.sized && usual != null && t.amount! / usual >= ESTIMATE.oneOffHigh) dir = "amount-high";
    else if (gap != null && lasts != null && gap / lasts < ESTIMATE.oneOffLow) dir = "gap-short";
    else if (gap != null && lasts != null && gap / lasts > ESTIMATE.oneOffHigh) dir = "gap-long";

    if (dir && dir !== "unit" && prev?.t.tag === "one_off" && prev.dir === dir) {
      // Two one-offs in a row in the same direction: both are the pattern now. The earlier one counts as a restock.
      const p = prev.t;
      p.tag = "counted";
      p.cycle_days = prev.gap;
      enter(p);
      t.tag = "counted";
      t.cycle_days = daysBetween(p.date, t.date);
      enter(t);
    } else if (dir) {
      t.tag = "one_off";
      // Every purchase resets the item but a top-up (amount below the usual). An unsized one closes no cycle and enters
      // nothing: its cycle_days stays null, and the next purchase's gap runs from it.
      if (dir !== "amount-low") restock(t);
    } else {
      t.tag = gap != null && lasts != null && gap < lasts && !askedSinceAnchor ? "early_buy" : "counted";
      t.cycle_days = gap;   // the first purchase has no gap
      enter(t);
    }
    prev = { t, dir, gap };
  }
  return out;
}

/** Most frequent value; a tie goes to the most recent. */
function mostFrequent(xs: string[]): string | null {
  const count = new Map<string, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const x of xs) if (best == null || count.get(x)! >= count.get(best)!) best = x;
  return best;
}

/** The item's pattern from its tagged events. `last_bought` is the anchor: the last purchase that restocked. */
export function pattern(tagged: Tagged[]): Pattern {
  const purchases = tagged.filter((t) => t.kind === "purchase");
  const usual = medianOrNull(purchases.filter((t) => PATTERN_TAGS.has(t.tag) && t.sized).map((t) => t.amount!));
  const cycles = tagged.filter((t) => t.cycle_days != null && (PATTERN_TAGS.has(t.tag) || t.tag === "your_answer")).map((t) => t.cycle_days!);
  const anchor = [...purchases].reverse().find((t) => t.restocked) ?? null;
  // An unsized anchor (a "pack", another unit, bought outside) counts as the usual amount.
  const anchorAmount = anchor ? (anchor.sized ? anchor.amount : usual) : null;

  const products = purchases.slice(-ESTIMATE.cycles).map((t) => t.product).filter((x): x is string => !!x);
  const [a, b] = purchases.slice(-2).map((t) => t.product);
  const product = purchases.length >= 2 && a && a === b ? a : mostFrequent(products);
  const app = mostFrequent(purchases.map((t) => t.app).filter((x): x is string => !!x && x !== "outside"));

  return {
    usual_amount: usual,
    lasts_days: medianOrNull(cycles),
    product, app,
    last_bought: anchor?.date ?? null,
    anchor_amount: anchorAmount,
    cycles: cycles.length,
    confident: cycles.length >= 1,
  };
}

/** The day the item is expected to run out. With a plan (dish-specific items only): the day the plan's amounts from the
 *  anchor on use up what was bought, when that is sooner. */
export function runOut(p: Pattern, waitFactor: number, plan?: { date: string; amount: number }[]): string | null {
  if (!p.last_bought) return null;
  // No sized purchase yet (no usual): gaps alone, anchor + lasts × wait factor.
  const ratio = p.usual_amount && p.anchor_amount != null ? p.anchor_amount / p.usual_amount : 1;
  const base = p.lasts_days != null ? addDays(p.last_bought, Math.round(p.lasts_days * ratio * waitFactor)) : null;
  let byPlan: string | null = null;
  if (plan && p.anchor_amount != null) {
    let used = 0;
    for (const u of [...plan].filter((u) => u.date >= p.last_bought!).sort((x, y) => x.date.localeCompare(y.date))) {
      used += u.amount;
      if (used >= p.anchor_amount) { byPlan = u.date; break; }
    }
  }
  // No cycle yet: the plan alone says when it runs out.
  if (byPlan && (!base || byPlan < base)) return byPlan;
  return base;
}

const leadDays = (group: string | null) => ESTIMATE.askLeadDays[group as keyof typeof ESTIMATE.askLeadDays] ?? 0;

/** Should the item be asked about on `on`? An item with no group yet (new in a history) is never asked about. */
export function isDue(i: ItemState, on: string): boolean {
  if (!i.confident || !i.run_out || !i.group || i.group === "daily" || i.subscription || i.dont_ask) return false;
  if (i.snoozed_until && i.snoozed_until >= on) return false;
  return addDays(i.run_out, -leadDays(i.group)) <= on;
}

/** The items to ask about on `on`: the due ones that run out first (then the surer ones), at most ESTIMATE.maxAsks. */
export function pickAsks(items: ItemState[], on: string): ItemState[] {
  return items.filter((i) => isDue(i, on))
    .sort((x, y) => x.run_out!.localeCompare(y.run_out!) || (y.cycles ?? 0) - (x.cycles ?? 0))
    .slice(0, ESTIMATE.maxAsks);
}

/** What the Pantry shows. `onCart`: the item is on a cart as low. An item that is not confident is never due, so it reads
 *  In stock unless it is on a cart. */
export function pantryStatus(i: ItemState, today: string, onCart: boolean): "In stock" | "Low" | "Snoozed" {
  if (i.snoozed_until && i.snoozed_until >= today) return "Snoozed";
  return isDue(i, today) || onCart ? "Low" : "In stock";
}

// ── An item's cycle ──

const round = (n: number, places: number) => String(Math.round(n * 10 ** places) / 10 ** places);
/** "10 kg", "500 g", "1.5 l", "12 pc"; null when there is no amount or unit. */
export function quantityText(amount: number | null, unit: string | null): string | null {
  if (amount == null || !unit) return null;
  if (unit === "g") return amount >= 1000 ? `${round(amount / 1000, 2)} kg` : `${round(amount, 0)} g`;
  if (unit === "ml") return amount >= 1000 ? `${round(amount / 1000, 2)} l` : `${round(amount, 0)} ml`;
  return `${round(amount, 1)} ${unit}`;
}

/** How often, from a cycle in days: "every day", "every 2 days", "twice a week", "once a week", "every 2 weeks", "once a month". */
function oftenText(days: number): string {
  const d = Math.round(days);
  if (days < 1.5) return "every day";
  if (days >= 3.2 && days <= 3.8) return "twice a week";
  if (days < 5.5) return `every ${d} days`;
  if (days <= 8.5) return "once a week";
  if (days < 12.5) return `every ${d} days`;
  if (days <= 17) return "every 2 weeks";
  if (days <= 24) return "every 3 weeks";
  if (days <= 38) return "once a month";
  return `every ${Math.round(days / 30)} months`;
}

/** An item's cycle in plain words: "500 ml every day", "30 pc about once a week"; "About once a week" when no amount is known;
 *  null with no cycle. A cycle worked out from purchases is "about" (every day aside); one the family stated is as they said it. */
export function cycleText(i: { usual_amount: number | null; unit: string | null; lasts_days: number | null }, stated = false): string | null {
  if (i.lasts_days == null || !(i.lasts_days > 0)) return null;
  const often = stated || i.lasts_days < 1.5 ? oftenText(i.lasts_days) : `about ${oftenText(i.lasts_days)}`;
  const much = quantityText(i.usual_amount, i.unit);
  return much ? `${much} ${often}` : often.charAt(0).toUpperCase() + often.slice(1);
}

/** What the reminder reads of a daily item to decide whether it goes on the cart by itself. */
export type DailyState = { group: string | null; lasts_days: number | null; run_out: string | null; last_bought: string | null;
  subscription: string | null; dont_ask: boolean; snoozed_until: string | null; stated: boolean };

/** Does a daily item (milk, curd) go on the cart by itself for `day`, on a reminder run on `today`? It needs a cycle; it is
 *  due when it runs out by `day`, or was never bought (a cycle the family stated). Not a subscribed, left-alone or snoozed
 *  item, and not one whose cycle was only learned from purchases that stopped ESTIMATE.dailyStaleDays ago (the family no
 *  longer buys it on the apps: it comes back with the next purchase). */
export function dailyDue(i: DailyState, day: string, today: string): boolean {
  if (i.group !== "daily" || i.lasts_days == null || i.subscription || i.dont_ask) return false;
  if (i.snoozed_until && i.snoozed_until >= day) return false;
  if (!i.last_bought) return i.stated;
  if (!i.stated && daysBetween(i.last_bought, today) > ESTIMATE.dailyStaleDays) return false;
  return !i.run_out || i.run_out <= day;
}
