// What the evals read back from the planner, in spec §2.1 shapes. The adapter (adapter.ts) is the only file that turns the
// app's tables into these; the scorers read nothing else. Field names follow the spec's table columns so the adapter stays
// a straight read.
import type { Weekday } from "./truth";

export type SavedSlot = {
  name: string; kind: "main" | "custom" | "addon"; addon_of: string | null;
  usual_people: string[]; days: string[]; skip_days: { day: string; skip: string }[];
  order?: number; active?: boolean;
  /** An add-on beside the main plate: its people stay at the main meal. */
  extras?: boolean;
  /** Kinds model (server/kinds.ts MealKind[] / MealTemplate[]): null = not read yet; undefined = the adapter could not read it. */
  kinds?: SavedMealKind[] | null; templates?: SavedTemplate[] | null;
};
export type SavedMealKind = { name: string; subs?: string[]; staple?: boolean; own?: boolean };
export type SavedPart = { kind: string; sub?: string; words?: string; dish?: string } | { items: string[] } | { from: string; kind?: string; sub?: string };
export type SavedTemplate = { parts: SavedPart[]; share?: string | null; said?: string | null };
export type SavedDish = {
  slot: string; name: string; frequency: string | null; days: string[] | null;
  contains: string[]; contains_read: string[]; origin: string;
  suggested?: boolean; untried?: boolean; quote?: string | null;
  /** Kinds model: the catalog kind it is a variant of (or the slot's own kind), its sub-kind, the catalog item it is. */
  kind?: string | null; sub?: string | null; catalog_item?: string | null;
};
/** server/targets.ts RuleTarget as saved (rules.targets / rules.gives): what a rule is about. */
export type SavedTarget = { type: "kind"; kind: string } | { type: "sub"; kind: string; sub: string } | { type: "item"; item: string; kind: string | null } | { type: "ingredient"; tag: string };
export type SavedRule = {
  /** The typed targets of the rule and, for a hard swap, what it gives; null = not saved typed (an older rule). */
  targets?: SavedTarget[] | null; gives?: SavedTarget | null;
  hard: boolean; what: string; who: string | null; slots: string[] | null; days: string[] | null; items: string[] | null;
  to: string | null; frequency: string | null; per_meal: number | null; fasting_food: string[] | null; quote: string;
};
export type SavedSeed = { slot: string; dishes: string[] };

/** apply_setup's result, read from the planner (Eval 1), or TRUTH in the same shape (Eval 2 loads it). */
export type SetupOut = {
  ok: boolean;
  slots: SavedSlot[];
  library: SavedDish[];
  rules: SavedRule[];
  seed: SavedSeed[];
  cook: { name: string; days: string[]; visits: { at?: string; meals?: string[] }[] } | null;
  family_cooks: { person: string; days: string[] }[];
  /** spec §4.1 rules.unplaced + the read-back's "noted, not checked". */
  unplaced: { text: string; quote?: string }[];
  lunch_unclear: string[];
  /** Weekly attendance the planner works out at setup (slot → weekday → people), when the adapter can read it: the
   *  read-back's weekday lunch line, from the slot-day builder run on a plain week. Absent: not scored. */
  attendance?: Record<string, Partial<Record<Weekday, string[]>>>;
  said?: string;
  settings?: { new_dishes_per_week?: number };
  /** The family's cuisine profile (house.cuisines, catalog cuisine words); null = not read yet. */
  cuisines?: string[] | null;
};

export type PlanDish = { name: string; new?: boolean; note?: string | null; /** people this dish is not for, when the app says so in a structured way */ not_for?: string[];
  /** people this dish is only for (a swap's item: "Pancakes (for Agastya)"); empty = the slot-day's people */ for_people?: string[] };
export type PlanSlotDay = {
  date: string; slot: string; people: string[];
  guests: { count: number; rules?: string[] }[];
  skip: string | null; occasion?: string | null; note?: string | null;
  dishes: PlanDish[];
};
/** make_plan's result for one week, read from the planner (Eval 2). `library`: the library after planning (new dishes with
 *  their contains read). `relaxed`: the feasibility check's relaxations, when the app reports them (slot → repeat window). */
export type PlanOut = {
  ok: boolean;
  week_start: string;
  slotDays: PlanSlotDay[];
  library: SavedDish[];
  unmet: string[];
  message?: string;
  asked?: string[];
  relaxed?: Record<string, number>;
};
