// Test fixtures: a meal's full breakdown, every nutrient set.
import { NUTRIENT_KEYS, type Nutrients } from "./catalog";

/** Every nutrient of the full breakdown at `value`. */
export const breakdown = (value = 1): Nutrients => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, value])) as Nutrients;
/** Every nutrient of the full breakdown unknown. */
export const noBreakdown = (): Nutrients => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null])) as Nutrients;
