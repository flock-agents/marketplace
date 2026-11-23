// What apply_setup (lane B) and make_plan (lane C) still compile against from before the slot model: the old house shape
// (rules, extra slots, meals ordered in, meal examples as JSON on the house row) and the old family-dish shape. The tables
// behind them are gone (docs/slot-model-spec.md §3), so every read of them throws LANE_B / LANE_C; the pure helpers stay so
// the old code still type-checks until its lane rewrites it. Delete this file once both lanes have landed.
import type { Weekday } from "./dates";
import { RULE_KINDS, SLOTS, type Often } from "./db/constants";
import { dishKey } from "./dishText";
import { daysSaid, LONG_DAY, type Db, type HouseView } from "./family";
import type { Rule } from "./rules";

/** The error a read of a removed table throws until its lane rewrites the code that makes it. */
export const LANE_B = "slot model: rewritten in lane B";
export const LANE_C = "slot model: rewritten in lane C";

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
export function legacyHouse(_db: Db, lane: typeof LANE_B | typeof LANE_C): LegacyHouse {
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

/** How often the family has a dish, as the old dish book kept it: now a library row's `frequency` and `days`. */
export type DishOften = { often?: Often; per_week?: number; days?: Weekday[] };
export type FamilyDish = { dish: string; for?: string[]; rating?: string } & DishOften;
/** A dish the family rated or gave a video, as the old plan context listed it. */
export type KnownDish = { dish: string; rating: string | null; note: string | null; rated_on: string | null; video_url: string | null };
export type OftenMap = Map<string, DishOften & { name: string; for?: string[] }>;
/** How often each of the family's dishes may come in a week, by its key: only the dishes the family said something about. */
export function dishOftenMap(dishes: Record<string, FamilyDish[]>): OftenMap {
  const out: OftenMap = new Map();
  for (const d of Object.values(dishes).flat())
    if (d.often || d.per_week != null || d.days?.length) out.set(dishKey(d.dish), { name: d.dish, ...(d.for ? { for: d.for } : {}), ...(d.often ? { often: d.often } : {}),
      ...(d.per_week != null ? { per_week: d.per_week } : {}), ...(d.days?.length ? { days: d.days } : {}) });
  return out;
}
