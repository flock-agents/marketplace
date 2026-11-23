// A household of the eval set, in slot-model terms (docs/slot-model-spec.md §2.1). What Flock knows before the planner's
// interview (household.* facts, incl. the structured `household.weekly`), what the owner would say (persona facts, one
// mid-interview correction), and the TRUTH: the setup the planner should end up with, as slots, a library per slot, rules
// with quotes and the seed history, plus who is away from which slot by the weekly pattern.
//
// This file and everything under evals/lib is written from the spec alone: it imports nothing from server/, so the scorers
// run (and their tests pass) before the slot-model code exists, and they never share a word list with the code they score.

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEK: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SCHOOL: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const WEEKEND: Weekday[] = ["Sat", "Sun"];
export const MON_SAT: Weekday[] = WEEK.slice(0, 6);
export type Group = "child" | "adult" | "elder";

export type SlotKind = "main" | "custom" | "addon";
export type Skip = "eaten_out" | "ordered_in";
/** spec §2.1 library.frequency / rules.frequency. */
export type Frequency = "usually" | "sometimes" | "rarely" | `${number}/week`;
export type RuleWhat = "veg" | "egg" | "no_eggs" | "avoid" | "only" | "swap" | "require" | "fasting" | "cap" | "note";
export const MAIN_SLOTS = ["Breakfast", "Lunch", "Dinner"] as const;

export type TruthPerson = { name: string; group: Group; age?: number };
export type TruthCook = { name: string; days: Weekday[]; visits: { at: string; meals: string[] }[] };

/** A slot (spec `slots`). `usual_people` omitted = everyone at home; `days` omitted = every day. `match`: how a saved
 *  custom/add-on slot's name is recognised (a main slot by its exact name). `optional`: Eval 1 neither requires nor
 *  forbids it; Eval 2 does not load it. */
export type TruthSlot = {
  name: string; kind: SlotKind; addon_of?: string;
  usual_people?: string[]; days?: Weekday[]; skip_days?: { day: Weekday; skip: Skip }[];
  match?: RegExp; optional?: boolean;
};

/** Away from a slot on some weekdays, by the weekly pattern (household.weekly): "Shiva's at the office". Someone who
 *  carries the home lunch to work is NOT away: the slot is cooked for them. */
export type Away = { person: string; slots: string[]; days: Weekday[] };

/** A library row (spec `library`, one per dish and slot). `contains`: the true tags when the name does not say them
 *  (vocab.ts reads the rest from the name); `notContains`: tags the name suggests but this family's dish lacks.
 *  `alsoSlots`: another slot Eval 1 accepts for it (an ambiguous sentence). `unsaid`: in TRUTH for Eval 2, but the
 *  persona never names it (Eval 1 does not count it). */
export type TruthDish = {
  name: string; slot: string; frequency?: Frequency; days?: Weekday[];
  contains?: string[]; notContains?: string[]; alsoSlots?: string[]; unsaid?: boolean;
};

/** A rule (spec `rules`). `quote`: what the saved quote must contain (a fragment of the family's words). `also`: other
 *  `what`s that mean the same here (a swap read as require). Items are tags (vocab.ts) or plain words ("brinjal"). */
export type TruthRule = {
  id: string; title: string; hard: boolean; what: RuleWhat;
  who?: string; slots?: string[]; days?: Weekday[]; items?: string[]; to?: string;
  frequency?: Frequency; per_meal?: number; fasting_food?: string[];
  quote: RegExp; also?: RuleWhat[];
  /** Hard or soft both accepted (a cook's limit: spec §10.6 says rules, not which kind). */
  hardAny?: boolean;
};

/** Something the family said that no weekday rule can hold (Ekadashi): kept in `unplaced` / "noted, not checked". */
export type TruthNoted = { id: string; who?: string; re: RegExp };

/** One seed row (spec §4.1 dishes.seed): a past meal of a slot, as the family described it. */
export type TruthSeed = { slot: string; dishes: string[] };

/** A change for the planned week (Eval 2): a stay or a trip from `household.dated`, or unnamed guests at one slot-day. */
export type WeekEvent =
  | { kind: "stay"; person: string; days: Weekday[]; slots?: string[]; dated: Record<string, unknown> }
  | { kind: "away"; person: string; days: Weekday[]; slots?: string[]; dated: Record<string, unknown> }
  | { kind: "guests"; day: Weekday; slot: string; count: number; rules?: string[]; items?: string[]; occasion?: string };

export type Truth = {
  people: TruthPerson[];
  cook: TruthCook | null;
  /** Who cooks on the days the paid cook does not (spec §4.1 home.family_cooks). */
  familyCooks: { person: string; days: Weekday[] }[];
  slots: TruthSlot[];
  away: Away[];
  /** People whose weekday lunch the household facts and replies cannot tell (spec §4.1 lunch_unclear). */
  lunchUnclear?: string[];
  library: TruthDish[];
  rules: TruthRule[];
  noted?: TruthNoted[];
  seed: TruthSeed[];
  /** Eval 2 only: the week's one-off changes. */
  week?: WeekEvent[];
  /** Notes for the judge, in words. */
  judgeNotes: string[];
};

export type Household = {
  id: string; title: string;
  /** The owner, who answers (household.speaker). */
  owner: string;
  /** The persona's first line. */
  intro: string;
  /** Flock's household facts after its own household questions (incl. `household.weekly`, spec §2.3). */
  household: Record<string, unknown>;
  groceryApps: string[];
  /** What the owner knows and would say, before the correction. */
  facts: { id: string; text: string }[];
  /** Sent once, as its own reply, right after the answer to question `after`; the fact `fact` then reads `corrected`. */
  correction: { after: string; line: string; fact: string; corrected: string };
  truth: Truth;
};

// ── Fixture helpers ──

/** One library row per slot the dish is eaten at. */
export const dish = (name: string, slots: string[], o: Omit<TruthDish, "name" | "slot"> = {}): TruthDish[] => slots.map((slot) => ({ name, slot, ...o }));
/** Breakfast, Lunch and Dinner, with their recurring skip days. */
export const mains = (skip: Partial<Record<(typeof MAIN_SLOTS)[number], { day: Weekday; skip: Skip }[]>> = {}): TruthSlot[] =>
  MAIN_SLOTS.map((name) => ({ name, kind: "main" as const, ...(skip[name] ? { skip_days: skip[name] } : {}) }));
export const veg = (quote: RegExp, o: Partial<TruthRule> = {}): TruthRule => ({ id: "veg", title: "Vegetarian", hard: true, what: "veg", items: ["meat", "fish"], quote, also: ["avoid"], ...o });
export const noEggs = (quote: RegExp, o: Partial<TruthRule> = {}): TruthRule => ({ id: "no_eggs", title: "No eggs", hard: true, what: "no_eggs", items: ["egg"], quote, also: ["avoid"], ...o });
export const avoid = (id: string, title: string, items: string[], quote: RegExp, o: Partial<TruthRule> = {}): TruthRule => ({ id, title, hard: true, what: "avoid", items, quote, ...o });
export const note = (id: string, title: string, who: string | undefined, quote: RegExp, o: Partial<TruthRule> = {}): TruthRule => ({ id, title, hard: false, what: "note", ...(who ? { who } : {}), quote, ...o });
/** The structured weekly pattern Flock reads from the weekday answer (spec §2.3 household.weekly). */
export type Weekly = { person: string; where: string; weekdays: Weekday[]; from?: string; to?: string; lunch?: "away" | "carries" | "home" | null };

// ── Matching shared by both scorers ──

const lower = (s: string) => s.trim().toLowerCase();
/** The same person: the same name, or the same first name. */
export const sameName = (a: string, b: string) => lower(a) === lower(b) || lower(a).split(/\s+/)[0] === lower(b).split(/\s+/)[0];
/** A dish name in plain words (case, punctuation and a plural "s" ignored). */
export const plain = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(\w{4,})s\b/g, "$1").trim();
export const sameSet = <T>(a: readonly T[] = [], b: readonly T[] = [], eq: (x: T, y: T) => boolean = (x, y) => x === y) =>
  a.every((x) => b.some((y) => eq(x, y))) && b.every((y) => a.some((x) => eq(x, y)));
export const sameNames = (a: readonly string[] = [], b: readonly string[] = []) => sameSet(a, b, sameName);
/** "monday", "Mon", "MON" → "Mon". */
export function dayOf(d: string): Weekday {
  const x = d.trim().slice(0, 3).toLowerCase();
  return (WEEK.find((w) => w.toLowerCase() === x) ?? d) as Weekday;
}
/** Weekday sets, where empty / missing means every day. */
export const sameDays = (a?: readonly string[] | null, b?: readonly string[] | null) =>
  sameSet(a?.length ? a.map(dayOf) : WEEK, b?.length ? b.map(dayOf) : WEEK);

/** The name among `names` a dish name is: the same name, else the longest one that holds it or is held by it. */
export function dishNameOf(name: string, names: readonly string[]): string | null {
  const n = plain(name);
  const exact = names.find((d) => plain(d) === n);
  if (exact) return exact;
  const near = names.filter((d) => { const t = plain(d); return !!t && (` ${n} `.includes(` ${t} `) || ` ${t} `.includes(` ${n} `)); });
  return [...near].sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The placements a frequency allows in a week, as [min, max] (spec §2.1: sometimes 2–3, usually 4–5, rarely ≤1, "n/week"
 *  n (n−1 accepted as the floor); no frequency: at most 2, staples exempt). The floor is asked only when the week has room. */
export function frequencyRange(f: string | null | undefined): [number, number] {
  if (!f) return [0, 2];
  if (f === "rarely") return [0, 1];
  if (f === "sometimes") return [2, 3];
  if (f === "usually") return [4, 7];
  const n = Number(/^(\d+)\s*\/\s*week$/i.exec(f.trim())?.[1]);
  return Number.isFinite(n) ? [Math.max(0, n - 1), n] : [0, 2];
}
/** The same frequency ("2/week" = "2 / week"). */
export const sameFrequency = (a?: string | null, b?: string | null) => (a ?? "").replace(/\s+/g, "").toLowerCase() === (b ?? "").replace(/\s+/g, "").toLowerCase();

/** The date of a weekday in the week starting `monday` (YYYY-MM-DD). */
export function dateOf(monday: string, day: Weekday): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + WEEK.indexOf(day));
  return d.toISOString().slice(0, 10);
}
export const weekdayOfDate = (date: string): Weekday => WEEK[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
