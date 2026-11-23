// The fixed eval set: eight varied households, the same for both evals. The held-out four (heldout/) are only picked with
// `heldout: true` (the evals' --heldout flag), never by default.
import type { Household } from "../lib/truth";
import { h1 } from "./h1-sharma";
import { h2 } from "./h2-iyer";
import { h3 } from "./h3-shiva";
import { h4 } from "./h4-reddy";
import { h5 } from "./h5-agarwal";
import { h6 } from "./h6-kulkarni";
import { h7 } from "./h7-menon";
import { h8 } from "./h8-banerjee";
import { HELDOUT } from "./heldout";

export const HOUSEHOLDS: Household[] = [h1, h2, h3, h4, h5, h6, h7, h8];
export { HELDOUT };
/** Every household, tuning and held-out: for checks that must cover all of them (the name guard). */
export const ALL_HOUSEHOLDS: Household[] = [...HOUSEHOLDS, ...HELDOUT];

/** The households a run names (`--only h1,h3` by id prefix), or all of its set. `heldout`: the held-out set instead. */
export function pick(only: string | undefined, o: { heldout?: boolean } = {}): Household[] {
  const set = o.heldout ? HELDOUT : HOUSEHOLDS;
  if (!only) return set;
  const want = only.split(",").map((s) => s.trim()).filter(Boolean);
  return set.filter((h) => want.some((w) => h.id === w || h.id.startsWith(`${w}-`)));
}
