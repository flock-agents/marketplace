// The fixed eval set: eight varied households, the same for both evals.
import type { Household } from "../lib/truth";
import { h1 } from "./h1-sharma";
import { h2 } from "./h2-iyer";
import { h3 } from "./h3-shiva";
import { h4 } from "./h4-reddy";
import { h5 } from "./h5-agarwal";
import { h6 } from "./h6-kulkarni";
import { h7 } from "./h7-menon";
import { h8 } from "./h8-banerjee";

export const HOUSEHOLDS: Household[] = [h1, h2, h3, h4, h5, h6, h7, h8];

/** The households a run names (`--only h1,h3` by id prefix), or all. */
export function pick(only: string | undefined): Household[] {
  if (!only) return HOUSEHOLDS;
  const want = only.split(",").map((s) => s.trim()).filter(Boolean);
  return HOUSEHOLDS.filter((h) => want.some((w) => h.id === w || h.id.startsWith(`${w}-`)));
}
