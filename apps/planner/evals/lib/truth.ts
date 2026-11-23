// A household of the eval set: what Flock knows before the planner's interview (household.* facts), what the owner would say
// (persona facts, one mid-interview correction), and the TRUTH: the setup the planner should end up with, in its own terms.
// Both evals read the same fixtures: Eval 1 scores apply_setup's rows against TRUTH, Eval 2 loads TRUTH into the planner
// and scores make_plan's week against it.
import { CATEGORIES } from "../../server/rules";

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEK: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SCHOOL: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export type Group = "child" | "adult" | "elder";
export type Often = "usually" | "sometimes" | "rarely";

export type TruthPerson = { name: string; group: Group; age?: number; relationship?: string };
export type TruthCook = { name: string; days: Weekday[]; visits: { at: string; meals: string[] }[] };
/** Who cooks on the days the paid cook does not come (or every day, with no cook). */
export type HomeCook = { days: Weekday[]; slots?: string[]; by: string };
/** An extra meal. `match` finds it among saved slot names; `for` unset: everyone. */
export type TruthSlot = { name: string; match: RegExp; days?: Weekday[]; for?: string[] };
export type TruthOrderIn = { day: Weekday; slot: string; note: string };

/** A rule as the planner's rules route takes it (family.ts set_house_rules). */
export type PlannerRule = { kind: string; who?: string; days?: string[]; slots?: string[]; items?: string[]; to?: string; per_meal?: number; per_week?: number; note?: string };

/** A hard rule: saved as a checked rule in Eval 1, kept in every planned meal in Eval 2. `check`: how the week is checked
 *  (null: not checkable in a week, e.g. Ekadashi). `accept`: extra saved kinds that count as this rule in Eval 1. */
export type HardRule = {
  id: string; title: string;
  rule: PlannerRule;
  check: { kind: "avoid"; who?: string; days?: Weekday[]; slots?: string[]; items: string[] }
    | { kind: "fasting"; who: string; days: Weekday[]; slots: string[] }
    | { kind: "swap"; who: string; items: string[]; ok: RegExp }
    | null;
  /** Eval 1: a saved rule of one of these kinds (beyond the rule's own) is accepted, e.g. a swap read as avoid. */
  alsoKinds?: string[];
  /** Eval 1: a non-weekday rule (Ekadashi) is matched by these words in the saved rule instead. */
  words?: RegExp;
};

/** A soft note (less salt, high protein, "ragi is good for her"): found as any saved rule of that person whose words match.
 *  `often`/`per_week`: how often it should show in a week (a soft preference, not every meal). `items`: what it is about,
 *  for the weekly count in Eval 2. */
export type SoftNote = { id: string; who?: string; text: string; re: RegExp; often?: Often; per_week?: [number, number]; items?: string[];
  /** The rule TRUTH loads for it in Eval 2 (default: an `other` note with its text and `often`). */
  rule?: PlannerRule & { often?: Often } };

/** A dish of the family's. `for`: only when the family says it is someone's. `often`, `per_week`, `days`: how often or when
 *  it is eaten, when the family said ("sometimes", "twice a week", "on Sunday"). */
export type TruthDish = { name: string; slots: string[]; for?: string[]; often?: Often; per_week?: number; days?: Weekday[] };

/** What a meal looks like, in the family's words, with what code checks a planned meal against: its number of parts and,
 *  when their words name one, the staple (rice, roti...) every such meal has. */
export type TruthExample = { slot: string; group?: "children" | "adults"; words: string; parts: number; staple?: RegExp };

export type Truth = {
  people: TruthPerson[];
  cook: TruthCook | null;
  homeCook: HomeCook[];
  extraSlots: TruthSlot[];
  orderIn: TruthOrderIn[];
  hardRules: HardRule[];
  softNotes: SoftNote[];
  dishes: TruthDish[];
  examples: TruthExample[];
  /** Notes for the judge: things about this family's week in words. */
  judgeNotes: string[];
};

export type Household = {
  id: string; title: string;
  /** The owner, who answers (household.speaker). */
  owner: string;
  /** The persona's first line. */
  intro: string;
  /** Flock's household facts after its own household questions. */
  household: Record<string, unknown>;
  /** Grocery apps the owner names (decides whether the main-app question is asked). */
  groceryApps: string[];
  /** What the owner knows and would say, before the correction. */
  facts: { id: string; text: string }[];
  /** Sent once, as its own reply, right after the answer to question `after`; the fact `fact` then reads `corrected`. */
  correction: { after: string; line: string; fact: string; corrected: string };
  truth: Truth;
};

// ── Building blocks for the fixtures ──

export const avoid = (id: string, title: string, items: string[], o: { who?: string; days?: Weekday[]; slots?: string[]; alsoKinds?: string[] } = {}): HardRule => ({
  id, title, rule: { kind: "avoid", items, ...(o.who ? { who: o.who } : {}), ...(o.days ? { days: o.days } : {}), ...(o.slots ? { slots: o.slots } : {}) },
  check: { kind: "avoid", items, ...(o.who ? { who: o.who } : {}), ...(o.days ? { days: o.days } : {}), ...(o.slots ? { slots: o.slots } : {}) },
  ...(o.alsoKinds ? { alsoKinds: o.alsoKinds } : {}),
});
export const veg = (): HardRule => ({ ...avoid("veg", "Vegetarian (no meat or fish)", ["@meat", "@fish"]), rule: { kind: "veg" } });
export const noEggs = (): HardRule => ({ ...avoid("no_eggs", "No eggs", ["@egg"]), rule: { kind: "no_eggs" } });
export const fast = (id: string, title: string, who: string, days: Weekday[], slots: string[]): HardRule => ({
  id, title, rule: { kind: "fasting", who, days, slots, note: title }, check: { kind: "fasting", who, days, slots } });
export const swap = (id: string, title: string, who: string, items: string[], to: string, ok: RegExp): HardRule => ({
  id, title, rule: { kind: "swap", who, items, to }, check: { kind: "swap", who, items, ok }, alsoKinds: ["avoid", "cap"] });

// ── Matching used by both evals ──

const lower = (s: string) => s.trim().toLowerCase();
export const sameName = (a: string, b: string) => lower(a) === lower(b) || lower(a).split(/\s+/)[0] === lower(b).split(/\s+/)[0];
/** A dish name in plain words. */
export const plain = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(\w{4,})s\b/g, "$1").trim();

/** Does a saved item cover a truth item: the same word, a category and a word of it, or the same category. */
export function itemCovers(saved: string, truth: string): boolean {
  const s = lower(saved), t = lower(truth);
  if (s === t) return true;
  const terms = (x: string) => (x.startsWith("@") ? CATEGORIES[x.slice(1)] ?? [] : [x.replace(/s$/, "")]);
  const ts = terms(t), ss = terms(s);
  return ts.some((a) => ss.includes(a)) || ss.some((a) => ts.some((b) => b.includes(a) || a.includes(b)));
}

/** The truth dish a saved or planned dish name is: the same name, else the one whose name holds it or is held by it
 *  (the longest such). */
export function truthDishOf(name: string, dishes: TruthDish[]): TruthDish | null {
  const n = plain(name);
  const exact = dishes.find((d) => plain(d.name) === n);
  if (exact) return exact;
  const near = dishes.filter((d) => { const t = plain(d.name); return ` ${n} `.includes(` ${t} `) || ` ${t} `.includes(` ${n} `); });
  return near.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

/** The saved extra slot a truth slot is. */
export const slotFor = (t: TruthSlot, saved: { name: string }[]): string | null =>
  saved.find((s) => lower(s.name) === lower(t.name))?.name ?? saved.find((s) => t.match.test(s.name))?.name ?? null;

/** How many days a week a dish's `often` allows at most (the planner's reading: usually 5, sometimes 2, rarely 1). */
export const oftenMax = (o: Often | undefined): number | null => (o === "rarely" ? 1 : o === "sometimes" ? 2 : o === "usually" ? 5 : null);
