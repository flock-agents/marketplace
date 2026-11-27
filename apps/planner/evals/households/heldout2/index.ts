// The second held-out set (h15–h17), written blind from household descriptions: never used to tune, picked only with
// `heldout2: true` (the evals' --heldout2 flag).
import type { Household } from "../../lib/truth";
import { h15 } from "./h15-gupta";
import { h16 } from "./h16-pillai";
import { h17 } from "./h17-subramanian";

export const HELDOUT2: Household[] = [h15, h16, h17];
