// What makes a food rule an allergy: a hard rule against items, in words that say allergy. An allergy is never guessed
// about: a dish not vouched for by the family is read for it carefully, and an unsure read counts as having it. Shared by
// setup (the read-back asks how the house cooks for it) and make_plan (which dishes it reads, and how).
import type { Rule } from "./slotStore";
import { targetsOf } from "./targets";

const ALLERGY_WORDS = /\b(allerg\w*|anaphyla\w*|epipen|reacts? to|intoleran\w*|coeliac|celiac)\b/i;

/** A hard avoid rule against an ingredient whose own words say allergy ("Ishaan is allergic to peanuts, not even groundnut oil"). */
export const isAllergyRule = (r: Pick<Rule, "hard" | "what" | "items" | "quote"> & Partial<Pick<Rule, "targets">>): boolean =>
  r.hard && r.what === "avoid" && targetsOf({ what: r.what, items: r.items, targets: r.targets ?? null }).some((t) => t.type === "ingredient") && ALLERGY_WORDS.test(r.quote);
