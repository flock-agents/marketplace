// What apply_setup (lane B) still compiles against from before the slot model: the old house shape (rules, extra slots, meals
// ordered in, meal examples as JSON on the house row). The tables behind it are gone (docs/slot-model-spec.md §3), so every
// read of them throws LANE_B; the pure helpers stay so the old code still type-checks until lane B rewrites it. make_plan
// (lane C) no longer uses any of it. Delete this file once lane B has landed.
import type { Weekday } from "./dates";
import { RULE_KINDS, SLOTS } from "./db/constants";
import { daysSaid, LONG_DAY, type Db, type HouseView } from "./family";
import type { Rule } from "./rules";

/** The error a read of a removed table throws until its lane rewrites the code that makes it. */
export const LANE_B = "slot model: rewritten in lane B";

/** An old house rule (rules.ts's shape): now a `rules` row (slotStore.ts Rule). */
export type HouseRule = Rule & { kind: (typeof RULE_KINDS)[number] };
/** An old extra slot: now a `slots` row. */
export type ExtraSlot = { name: string; days?: Weekday[]; for?: string[] };
/** An old meal ordered in every week: now a slot's `skip_days`. */
export type OrderIn = { day: Weekday; slot: string; note?: string };
/** An old meal example: now a seed slot-day (no date, confirmed). */
export type MealExample = { slot: string; group?: "children" | "adults"; words: string };
/** The house as the old setup and plan read it. */
export type LegacyHouse = HouseView & { rules: HouseRule[]; extra_slots: ExtraSlot[]; order_in: OrderIn[]; meal_examples: MealExample[] };

/** The old house shape: its columns are gone, so this throws (`lane`: who rewrites the caller). */
export function legacyHouse(_db: Db, lane: typeof LANE_B): LegacyHouse {
  throw new Error(lane);
}

/** What an old meal left out by set_cooking_days was noted as. */
export const NOT_COOKED = "not cooked at home";
/** A meal not cooked at home because the family eats out (not one ordered in). */
const EATEN_OUT = /eat(en|ing)? out|outside|restaurant|in-laws|parents|relatives|friends/i;
const andWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The old read-back of the meals a week was planned with ("Each day we'll plan Breakfast, Lunch and Dinner, plus Kabir's
 *  tiffin Mon–Fri..."). Pure; the setup's read-back (lane B) replaces it. */
export function slotsSaid(h: Pick<LegacyHouse, "extra_slots" | "order_in">): string {
  const extra = h.extra_slots.map((s) => {
    const whose = (s.for ?? []).filter((p) => !s.name.toLowerCase().includes(p.toLowerCase()));
    return `${s.name} ${daysSaid(s.days)}${whose.length ? ` for ${andWords(whose)}` : (s.for ?? []).length ? "" : " for everyone"}`;
  });
  const out = [`Each day we'll plan Breakfast, Lunch and Dinner${extra.length ? `, plus ${andWords(extra)}` : ""}.`];
  const meal = (o: OrderIn) => `${LONG_DAY[o.day]} ${(SLOTS as readonly string[]).includes(o.slot) ? o.slot.toLowerCase() : o.slot}`;
  const notCooked = h.order_in.filter((o) => o.note === NOT_COOKED), rest = h.order_in.filter((o) => o.note !== NOT_COOKED);
  const out_ = rest.filter((o) => EATEN_OUT.test(o.note ?? "")), ordered = rest.filter((o) => !EATEN_OUT.test(o.note ?? ""));
  if (out_.length) out.push(`${andWords(out_.map(meal))} you eat out.`);
  if (ordered.length) out.push(`${andWords(ordered.map(meal))} you order in.`);
  if (notCooked.length) out.push(`${andWords(notCooked.map(meal))} ${notCooked.length === 1 ? "isn't" : "aren't"} cooked at home.`);
  return out.join(" ");
}
