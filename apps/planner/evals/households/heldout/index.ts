// The held-out households (spec §8): written separately from h1–h8, never used to tune a prompt or a check, and run only at
// milestones with an explicit --heldout flag. Scored runs use fresh chats.
import type { Household } from "../../lib/truth";
import { h9 } from "./h9-mehta";
import { h10 } from "./h10-qureshi";
import { h11 } from "./h11-dsouza";
import { h12 } from "./h12-sen";

export const HELDOUT: Household[] = [h9, h10, h11, h12];
