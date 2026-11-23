// What the evals read back from the planner, in spec §2.1 shapes. The adapter (adapter.ts) is the only file that turns the
// app's tables into these; the scorers read nothing else. Field names follow the spec's table columns so the adapter stays
// a straight read.
import type { Weekday } from "./truth";

export type SavedSlot = {
  name: string; kind: "main" | "custom" | "addon"; addon_of: string | null;
  usual_people: string[]; days: string[]; skip_days: { day: string; skip: string }[];
  order?: number; active?: boolean;
};
export type SavedDish = {
  slot: string; name: string; frequency: string | null; days: string[] | null;
  contains: string[]; contains_read: string[]; origin: string;
  suggested?: boolean; untried?: boolean; quote?: string | null;
};
export type SavedRule = {
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
  cook: { name: string; days: string[]; visits: { at: string; meals?: string[] }[] } | null;
  family_cooks: { person: string; days: string[] }[];
  /** spec §4.1 rules.unplaced + the read-back's "noted, not checked". */
  unplaced: { text: string; quote?: string }[];
  lunch_unclear: string[];
  /** Weekly attendance the planner works out at setup (slot → weekday → people), when the adapter can read it: the
   *  read-back's weekday lunch line, from the slot-day builder run on a plain week. Absent: not scored. */
  attendance?: Record<string, Partial<Record<Weekday, string[]>>>;
  said?: string;
  settings?: { new_dishes_per_week?: number };
};

export type PlanDish = { name: string; new?: boolean; note?: string | null; /** people this dish is not for, when the app says so in a structured way */ not_for?: string[] };
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
