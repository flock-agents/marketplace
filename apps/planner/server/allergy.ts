// What makes a food rule an allergy: a hard avoid with at least one target, in words that say allergy. One meaning model
// (spec §5.2, owner 26 Nov): no careful read and no fail closed; a dish never read for an allergy is planned and asked, its
// question named first (planChecks.ruleUnknowns flags it); a family dish the family vouches for needs no ask. Shared by
// setup (the read-back asks how the house cooks for it) and the plan's checks.
import type { Rule } from "./slotStore";
import { targetsOf } from "./targets";

const ALLERGY_WORDS = /\b(allerg\w*|anaphyla\w*|epipen|reacts? to|intoleran\w*|coeliac|celiac)\b/i;

/** A hard avoid rule against something whose own words say allergy ("Ishaan is allergic to peanuts, not even groundnut oil"). */
export const isAllergyRule = (r: Pick<Rule, "hard" | "what" | "items" | "quote"> & Partial<Pick<Rule, "targets">>): boolean =>
  r.hard && r.what === "avoid" && ALLERGY_WORDS.test(r.quote) && targetsOf({ what: r.what, items: r.items, targets: r.targets ?? null }).length > 0;
