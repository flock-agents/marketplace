# Tier C hard-rule breaks: diagnosis (no model calls)

Source: the last end-to-end run before the kinds model (prod tiers, 3 runs each; `e2e-r4/results.json`, kept outside the
repo). Tier C failed 3 of 4 households, each on one run: h4 run 2, h5 run 3, h8 run 3. For each, the saved rules (what
`apply_setup` wrote) are compared with TRUTH, then the planned week with the rules the planner had.

Runs 3 of h5 and h8 had no transcript of their own and replayed run 1's (`eval-e2e.ts` falls back to `-rep1.json`), so for
those two the setup read the same words twice and once read them differently.

| run | rule broken | setup read it right? | what broke | lane / file to fix |
|---|---|---|---|---|
| h4 run 2 | the vegetarian grandparents' veg rule: Sunday lunch "Chicken" with no `not_for` for either | yes: veg + no_eggs saved for both, plus the chicken-only-Sunday rules for the other three | the planner's own contains read. Setup hit its 150 s cap (setup_time 150.09 s, also a fail) and left "Chicken" unread, so make_plan read it: the model answered has `chicken`, not `meat`. `makePlan.ts` `readContains` stores those tags as given (`w.facts.set(key, { tags: new Set([...row.contains, ...has]) })`) without `withParents`, and `factsOf` returns run facts before the library row, so "chicken" never became "meat" and the veg rule (meat, fish) let it through | **P**: `server/makePlan.ts` readContains, wrap the read tags in `withParents` (and let a child's yes override a parent's no). **S**: `server/setup.ts` stayed past 150 s and left a family dish unread |
| h5 run 3 | the grandfather (no onion or garlic, ever) and the grandmother (Tue/Sat): "nothing for" them at 5 lunches | yes: veg, no eggs, his always-rule and her Tue/Sat rule all saved as TRUTH has them | the planner. Setup read the family's dal, sabzi and kadhi chawal as having onion_garlic (the same read on runs 1 and 2, which passed); on run 3 the planner marked every lunch dish `not_for` him (Tue: kadhi chawal alone, not for either elder) and said so in `unmet` ("Ramesh has nothing to eat there"). Owner rule 7 (25 Nov): onion and garlic never block a dish; it is planned with a note "make without onion and garlic, or keep his portion aside". Owner rule 6: nobody at the table is left with nothing | **P**: `server/planChecks.ts` `ruleBreaks` / `notFor` (onion_garlic is a note, not a block, unless the dish is mostly onion) and `server/fillWeek.ts` (a person left with only staples gets an item of their own for that part) |
| h8 run 3 | the grandmother's no eggs: "Toast and egg" at three breakfasts | **no**: from the same words as run 1 ("Ma is vegetarian, no fish, meat, eggs, onion or garlic"), run 1 saved veg + no_eggs + avoid onion_garlic; run 3 saved only veg ("Ma is vegetarian") and the onion-garlic avoid. The egg was dropped | setup. The planner kept the rules it had: veg forbids meat and fish, not eggs | **S**: `server/setup.ts` rule read: "vegetarian, no ... eggs" must save no_eggs too (a vegetarian rule's quote ending at "vegetarian" is the sign the rest of the sentence was lost) |

## What the eval could add (lane E, proposed)

- The scorer already catches all three (hard_rules fail-closed off in e2e; the eval's vocabulary reads "Chicken" as meat).
- Proposed: an Eval 2 perturbation `parent_tag_only` (a library dish read with "chicken" but not "meat") to hold the planner's
  parent-tag mapping without a live run; and a TRUTH-vs-saved rules diff printed beside every hard_rules miss in e2e, so the
  next run says "setup" or "planner" by itself.
