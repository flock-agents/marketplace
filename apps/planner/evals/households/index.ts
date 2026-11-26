// The fixed eval set: eleven varied households (h13 and h14 are tier B: elders with no diet of their own; h18 is the owner's
// walk-through, its fixed transcript run as Flock sends it), the same for both evals. The held-out four (heldout/) are only picked with
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
import { h13 } from "./h13-familyb";
import { h14 } from "./h14-familyb2";
import { h18 } from "./h18-shiva-walkthrough";
import { HELDOUT } from "./heldout";
import { HELDOUT2 } from "./heldout2";

export const HOUSEHOLDS: Household[] = [h1, h2, h3, h4, h5, h6, h7, h8, h13, h14, h18];
export { HELDOUT, HELDOUT2 };
/** Every household, tuning and held-out: for checks that must cover all of them (the name guard). */
export const ALL_HOUSEHOLDS: Household[] = [...HOUSEHOLDS, ...HELDOUT, ...HELDOUT2];

/** The households a run names (`--only h1,h3` by id prefix), or all of its set. `heldout`: the held-out set instead; `heldout2`: the second held-out set (h15–h17). */
export function pick(only: string | undefined, o: { heldout?: boolean; heldout2?: boolean } = {}): Household[] {
  const set = o.heldout2 ? HELDOUT2 : o.heldout ? HELDOUT : HOUSEHOLDS;
  if (!only) return set;
  const want = only.split(",").map((s) => s.trim()).filter(Boolean);
  return set.filter((h) => want.some((w) => h.id === w || h.id.startsWith(`${w}-`)));
}
