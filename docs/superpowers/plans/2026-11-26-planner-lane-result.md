# Meal Planner lane: one meaning model, result (26 Nov 2026)

Branch feat/one-meaning-model, worktree /Users/shivashankar/Developer/mp-one-meaning, from 91c32ed to 57172cd. Not pushed; no PR.

## Status
- Plan Tasks 1–14 are done and each passed review. The lead-added follow-ups T10b (a change asks right away) and T11b (uses lists household.weekly) are done too.
- Task 15 (acceptance) found defects. Two root-cause rounds fixed them: F1–F10 and G1–G9, each reviewed.
- A third acceptance run (h18 ×3, h1/h2/h3/h13, then held-out h15–h17 once) was STILL RUNNING when this summary was written. Its report will be at .superpowers/sdd/2026-11-26-one-meaning-model-planner/task-15-run3-report.md and its outputs under apps/planner/evals/results/e2e-*-<stamp>.
- The final whole-branch review has NOT run yet.
- Type errors stay at 62 (baseline). Every touched test file passes, run one file at a time.

## Eval results so far
- Run 1 (e2e-h18-20261126-1741, e2e-base-20261126-1741): h18 SAFETY 0/3, with no_silent_filler failing in every rep. attendance 80/95, box_attendance 48/63, real_dish 185/192, linked_parts 17/20. Base: A FAIL (h1, h2), B PASS (h13), C FAIL (h3).
- Run 2 (…-1910, after F1–F10): h18 SAFETY 2/3. attendance 100/100, box_attendance 63/63, real_dish 203/203, from_library 203/203, not_next_day 27/29, new_budget 2/3. linked_parts dropped to 4/23; G2, G3 and G5 fix that. Base: A FAIL (h1 not_next_day only; h2 attendance), B FAIL (h13, variance plus a scorer bug fixed in G8), C FAIL (h3 curd rice at night, fixed in G4).
- Run 3 and held-out: see the run-3 report path above.

## Commits (oldest first; task to commits mapping is in the ledger's 'complete' lines)
```
7e318be feat(catalog): a bare word's dish per kind and sub-kind
25701f4 feat(planner): template part shapes (words, dish, linked), typed rule columns, extras add-ons
6fddc54 feat(rules): typed rule targets, resolved once when a rule is written
f227813 fix(rules): a sub word with a decided bare dish gives that item
f03bce7 fix(rules): an ingredient word stays an ingredient; allergy needs allergy words and a target
fe9118e feat(planner): migrate saved setups to the one meaning model, once
1f665f1 fix(planner): a category row leaves the library only once its meal's templates are saved
6512527 fix(planDays): only a box that replaces a meal takes its person off it
fbaa5d6 test(makePlan): the child's lunch tiffin sits one step after Lunch, so it replaces it
da14afd fix(migrate): a person's own custom slot moves to one step after the meal it replaces
61a4029 feat(planChecks): rules checked by typed target; an unknown is asked, never a block
dc2d86c fix(planChecks): a dish's catalog facts by exact name only; the family's own dish is asked
e1a9c71 feat(fillWeek): fill from templates and history only; no word is matched again
692cccc feat(fillWeek): linked parts, swap items as planned dishes, extras add-ons, the cook's visit limit
05f79be fix(fillWeek): a linked dish its box's people may not eat is not theirs; only an everyday fixed dish keeps its template on a repeat
22c10cf feat(plan): unknowns asked in the weekly question; the answer saved on the dish; careful read removed
3c4822c fix(plan): "suggest some" plans a plain plate of new dishes again; Task 8 fixtures given templates
6a2ad7f fix(plan): a meal with no templates but dishes of theirs gets them derived once at plan time, saved
7aad12c fix(plan): derive a meal's templates only from what is theirs, and only when never set
de70c77 feat(manifest): meal questions in the one meaning model's shape (family meal, who differs, anyone differently)
8727f8c fix(manifest): otherDays is asked of every household without a cook, maid-only included
6a8ecb3 feat(setup): save each word's meaning once: template words and dishes, links, extras, typed rule targets
05f6e36 fix(setup): their own dish of a kind rotates with it; corrections drop category words and rebuild changed links
853bdde feat(evals): score plates as real dishes, linked parts, asked unknowns, no silent filler, box attendance
798d842 feat(evals): households in the one meaning model's shapes; h18 from the owner's walk-through
bf1a666 fix(evals): every removed category word lives on a TRUTH part; their words on parts; lunchWhere from lunch sentences
2d5c074 feat(manifest): the interview uses the weekly pattern (lunch question)
1c4d0cc feat(plan): a change asks about the unread dishes it places, right away
390d2a6 fix(setup): a box saves the meal it replaces
b4a6baf test(setup): the eval-name guard skips a cook written by the role word
62491a3 fix(planner): a meal's rules hold at the box that replaces it
29ad7b5 fix(planner): pass the slot list at the require-rule call site; type the test rule
ca28022 fix(planner): slots required on ruleHolds/ruleBinds; hardAt binds a meal's rules at its box
987cf5c fix(planner): one said share per phrase in templateCounts
6d63085 fix(planner): a phrase's days go to its variants had least recently
8785062 fix(planner): F4 a dish the kinds read leaves out is asked, never a dish on a plate
2054245 fix(planner): F5 keep a cook who has no name or clock time
8c545d2 fix(planner): F6 an extras add-on runs on its person's carrying days
e8c2e88 fix(planner): F4/F5/F6 review round 1
4413688 fix(planner): F7 setup prompts read who, swaps and how often
854c3f1 fix(planner): F7 review round 1: general reading rules, one-day shares by recency
a24f7bf fix(planner): F7 review round 2: general filling and box-link examples
f42e13a fix(planner): F7 review round 3: general whole-meal link example
f4b2c73 fix(planner): F8 h18 asks differently in its recall form; TRUTH keeps "4 eggs"
3db7f23 fix(planner): F9 scorer reads links, newness, categories, fixed extras, staple parts, OD5 and a nameless cook
2b4a825 fix(planner): F8/F9 review round 1: roll days held together, catalog kind first, strict plate match
18dc093 fix(planner): F10: unset new-dishes cap uses the declared default; school child off weekday Lunch unless carries
9660671 fix(planner): G1 a hard swap's item is no dish of its meal or of the box that replaces it
4327eca fix(planner): G2 the dishes prompt teaches a whole-meal box link and a box base made with a home part
5439fc0 fix(planner): G3 a linked box's base plate is the one named with the link's words, in any order
a998805 fix(planner): G7 a curry told with its own how-often never joins a whole dish told apart
be2d79e fix(planner): a rule word that is a kind and a main ingredient (rice) resolves to both targets, so Curd rice is hit through its facts
bd916ef fix(planner): G1/G2 review round 1: a swap's item drops only when the swap is its sole source; one box-link example
650d240 fix(planner): only an avoid rule doubles a kind word into kind plus ingredient; swap, only and require keep the one target
74d3c60 fix(evals): a roll said another way (Paratha with egg, Cheese paratha) is the template's roll by its words; a bare Paratha roll still is not the egg roll
f157a86 fix(evals): h18 TRUTH Pancakes contains egg, so Pancakes kept from the no-egg father with Idli is a known break, not silent filler
a2b3520 fix(evals): a shorter dish name of another kind is not the longer dish (Moong dal is no Moong dal khichdi) in dish_frequency and no_early_repeat
dc9d235 fix(planner): one targetsFor and doublesFor for set_rule and targetsOf; veg and no_eggs with items keep their derived expansion
5b5c99e fix(planner): a cook's visit cap counts cooked dishes only (owner decision OD6)
67caa40 fix(planner): extras exemption narrowed, flag renamed capFree, Fruit item-level (G9 review round 1)
57172cd fix(planner): a kind part is cap-free only when every item of the kind is (G9 round 2)
```

## Rulings (every Ruling line in the ledger, in order)
| Tasks | Shared file / interface | Finding | Ruling |
Ruling R1: all paths/git -C use /Users/shivashankar/Developer/mp-one-meaning, branch feat/one-meaning-model — the worktree given by the lead — wrong path would commit in another checkout.
Ruling R2: T1 ships no bare-draft.md; BARE values exactly bare-decided.md; commit message without "(draft for owner review)"; three new catalog items added in the generator — O1 — low cost.
Ruling R3: T12 partsOf and T14 h18 TRUTH use bare dishes per the decided list (rasam part gets dish Tomato rasam, kootu Mixed vegetable kootu, lunch-box paratha dish Plain paratha); those dishes are library rows like Plain dosa — follows spec §5.1 + O1/O3 — cost: scorer expectations re-tuned.
Ruling R4: T4 moves deriveTemplates into migrateMeaning.ts; fillWeek may import it from there until T8 deletes the per-run derive; isCategoryName in fillWeek stays until T8 — keeps each task compiling — trivial cost.
Ruling R5: T5 test 2 asserts the breakfast box alone puts no "has Agastya's breakfast box" why on Lunch and that Lunch absence of Agastya (if any) comes from weekly school, not the box — spec §5.4 — low cost.
Ruling R6: T8 may edit makePlan minimally (drop removed args) to keep the type count ≤ baseline; T10 does the full cleanup — compile discipline — low cost.
Ruling R7: T11 uses approved wording; recall lint: {{heard}} required, other placeholder allowed only {{children}} on a question whose when is household.children — O2 — low.
Ruling R8: T14 h18 Q lines use the approved asks (placeholders filled: cookName "your cook", children "Agastya"); A lines verbatim — O2 — low.
Ruling R9: T12 expects lunch box first part {kind:"Paratha", dish:"Plain paratha", words:"paratha"} — O3/R3 — low.
Ruling R10: TruthTarget item may carry optional kind ({ item, kind? }) so h18 GS swap gives {item:"Plain paratha", kind:"Paratha"} — O3 — low.
Task 2: Ruling: reviewer Important "derived mealKinds drops stored family sub-kinds (behaviour change)" — intended: spec §5.1 "the kinds a meal has are those its templates name"; fillWeek pools are rewritten in T8 anyway; implementer's fillWeek 60/0, setup 69/0 — cost if wrong: slight rotation shift on old installs until T8.
Task 2: Ruling: reviewer Important "buildMeal shape.kinds dead, checks with slots: []" — T12 removes MealShape.kinds per plan; carry to T12 dispatch — low.
Task 3: Ruling: resolveGives also applies a sub-kind's bare dish (rasam → Tomato rasam) — spec §5.1 bare per kind and sub-kind — low
Task 3: Ruling: allergen words that are also dishes (curd, paneer, shrimp) resolve as ingredients (catalog ingredient vocabulary checked before matchDish); isAllergyRule also true for allergy-worded rules with any target — spec §5.2 "ingredient targets checked through the catalog's ingredient lists"; an avoid on curd must cover every curd dish — cost if wrong: "no paneer" means ingredient not the Paneer sub (both cover the same dishes mostly).
Task 3: Ruling: isAllergyRule = hard avoid + allergy words + ≥1 target (implementer's reading) stands over my OR wording — the original function already required allergy words; the brief only swapped items.length for targets; "no eggs" is a diet, not an allergy — low.
Task 3: Ruling: ingredient vocabulary before matchDish widens ~48 catalog words (banana, rajma, dals, buttermilk, cereals) to ingredient targets — intended: an avoid on an ingredient-named food covers every dish containing it (spec §5.2 ingredient targets via catalog lists); swaps never resolve to ingredients — cost if wrong: "only brown rice"-style require rules read by ingredient, still correct by facts.
Task 4: Ruling: migration also treats a library row as a category when setup_state.places marks it named "category" (read-only) — the plan's own test ("Dry sabji") is no category by old isCategoryName; spec R1: setup's decision lives in places; migration is not planning (§5.1 bars planning reads only) — cost if wrong: a few legacy rows kept as dishes.
Task 5: Ruling: legacy custom boxes (named people, order not M+INSTEAD_STEP) get order Breakfast+INSTEAD_STEP when the name says breakfast, else Lunch+INSTEAD_STEP, in migrateMeaning — keeps saved installs taking the box person off Lunch as before (Review Focus 2) — cost if wrong: a legacy snack slot keeps taking its person off Lunch, as it did before.
Task 7: Ruling: carefulTags kept as @deprecated shim (makePlan/fillWeek import it) — R6 compile discipline; T8/T10 must delete it — low.
Task 7: Ruling: guestsCan still fails closed for guests — out of the brief; a guest has no weekly-question path to ask — parked for the final review / owner — cost: a guest's unread dish may be swapped out.
Task 7: Ruling: targetsOf fallback (rule without saved targets → resolveTarget) stays — it resolves a rule word, not a dish name; migration + set_rule + setup save targets on every rule, so in production it only covers unmigrated fixtures — low.
Task 8: Ruling: makePlan.test 30/10 after T8 (fixtures without templates, category rows, careful read) — the plan puts makePlan fixtures in T10; T10 must end with makePlan.test fully green and list each of these 10 — cost: red tests between T8 and T10 only.
Task 9: Ruling: everyday() second clause (an items part in the meal's usual template whose other templates are all share-only counts as daily) stands — it is exactly h18's lunch box (Paratha + link beside sometimes rolls), the case the exemption exists for; other items parts keep never-next-day — cost if wrong: a usual items template beside sometimes ones may repeat next day.
- F1 otherDays gated on cook.days, which nothing fills now. Ruling (→T11): gate otherDays variants on a fact Flock does fill — household.help's cook entry and its days — if the manifest `when` grammar (check manifest.test.ts / Flock spec.ts rules as encoded in tests) can test it: Mon–Sat → "On Sunday…", Mon–Fri → "On Saturday and Sunday…", other cook days → "On her days off…", no cook → "Who cooks at home…". If the grammar cannot test the days value, ship two variants: `household.help has cook` → "On her days off, who cooks, and is any meal eaten out or ordered in?" and no cook → "Who cooks at home, and is any meal eaten out or ordered in, on which days?" (both owner-approved texts). Record which in the T11 report — cost: a less specific day phrase.
- F2 mealsBy/groceriesBy/schoolBy are lists [{person, part?}]. Ruling (→T14 test, global constraint already): no planner server reader exists; T14's test forbids a text reader; if any reader is found (server/, src/, evals/lib), it must take the list shape — T14 implementer greps and reports.
- F3 eval households set those facts as text. Ruling: confirmed in T14 brief (rewrite to the list shape).
- F4 {{cookName}} always fills ("your cook"). Ruling (→T11): every question whose ask/recall/reask/fallback names the cook ({{cookName}} or "your cook"/"she") gets `when` requiring `household.help has cook` (combined with any existing condition); add a manifest test for it.
Task 10: Ruling: changes.test (19) + routines.test (2) red from T8 fixtures — T10 fixes them plus any other Task-8-caused fixture failures across server/*.test.ts (run one file at a time) — tests must be green before review.
Task 10: Ruling: a slot without templates but with library rows/history gets templates derived once at plan time (migration step 1 mapping) and saved — keeps meals added after setup working without a per-run derive (meaning decided once) — cost: derived templates may need owner edits.
Task 10: parked — a change re-plan (set_slot_day, not_for) never asks: an allergy-unknown dish placed by a change is not asked until the next weekly plan (makePlan.ts:1207) — Ruling: one question per weekly message (owner rule) and the brief scopes asks to the weekly plan; raise to owner — cost: an allergy unknown can sit unasked for up to a week.
Task 11: Ruling: F1 grammar cannot test cook days in household.help → two otherDays variants (approved texts); variant 2 must catch every no-cook household incl. maid-only (household.people if first-match-wins) — otherDays owns eating out/ordering in, must always be asked — cost: less specific day phrase ("her days off" not "Sunday").
Task 12: Ruling: a named non-catalog dish with a known kind → kind part with `dish` (rotation kept, other items new); `items` only for filling variants at a box whose templates already hold that kind, and kind-less dishes — spec §5.1 "the family's own item of that kind" — cost: other items of that kind counted new, not own.
Task 13: Ruling: scorePlan failClosed default left as is — eval-e2e passes failClosed:false, the only acceptance caller; flipping a default no test needs is scope creep — low.
- U1: Flock asks an ad-entry person only household questions whose facts `uses` lists. Ruling (→ Task 11 follow-up after T14, same files flock.app.json + manifest.test.ts): add "household.weekly" to setupOptions.uses (keep the six), manifest test that uses contains household.weekly. Checked (grep flock.app.json): no planner question, when or placeholder reads household.school / schoolUpdates / schoolBy; the word "school" appears only in question text/help (childSame "carry a box to school", reask "school box", help notes) and {{lunchKnown}} reads household.weekly — cost: none.
- U2 (owner, answers the parked T10 item): a change re-plan (set_slot_day, not_for, any edit) that places a dish with a plan-and-ask unknown asks RIGHT AWAY in that change's reply (same check copy, allergy first, ≤3 named + "<n> more to check on the week page"); the weekly plan keeps its one weekly question. Ruling: follow-up task "T10b" after T14, before T15, with review. The parked T10 item is closed by this.
Task 14: Ruling: h18 lunchWhere Q line keeps the brief's wording (R8 allowed), not the sim's lunchKnownLine — low.
Task 11b: Ruling: reviewer minor "trailer should name Haiku" rejected — the lead mandated the Opus 5.5 trailer for every commit in this lane.
Task 15: steps 1–2 run (e2e-h18-20261126-1741: SAFETY 0/3, no_silent_filler each rep; e2e-base-20261126-1741: h1 A FAIL, h2 A FAIL, h3 C FAIL, h13 B PASS). 9 defects listed in task-15-report.md. Ruling: per plan, defects become new TDD tasks, never patches; first a root-cause investigation (opus, read-only) classifying each defect (planner bug / setup code bug / model-reading miss / scorer bug) with fix + test proposal; heldout2 waits until fixes end.
Ruling F8: h18's `differently` Q line becomes its recall form ("You mentioned Dad doesn't eat egg or salad. Anything else, for anyone, like an allergy or a fasting day?") — Flock asks the recall when facts were heard (§6.2/§10; Dad's egg/salad heard in the lunch answer); A lines unchanged; TRUTH dish "4 eggs" (the family's words) — extends R8 — cost: TRUTH-side only.
Ruling OD5 (lead): a named catalog dish said alone with a day ("egg curry on saturdays") stays {kind, dish} per the T12 ruling, keeping its day and "sometimes"; scorer accepts {kind, dish:X} as matching TRUTH items(X) — cost: other egg dishes offered new under the budget.
F1: Ruling: setup.test eval-names guard red since T14 (h18 TRUTH cook named "Cook") — fixed in F1 follow-up (nameless TRUTH cook or the guard skips the role word) — T14 reviewers did not run setup.test — low.
F1: Ruling: follow-up b4a6baf is a 2-line test-guard change; scoped re-review done by the controller reading the diff (no reviewer seat for a test-only one-liner) — low.
Ruling: F4, F5, F6 (all setup.ts code after the model read, independent, small) go to ONE implementer as three commits with one review — saves two dispatch cycles; each keeps its own failing tests — cost: a larger single review.
F456: Ruling: "places none = no answer" applies to the first kinds answer only (a one-dish re-ask that omits it is a real second omission, per F4's spec test); set_cook accepts a nameless saved cook and an empty arrival (route contract widened, agentOps need:["name"] unchanged) — low.
F7: Ruling: prompt examples must not mirror any eval household's phrasing (overfit) — rules restated generally, one example each, different shapes/foods, tests assert rule text — cost: the acceptance run may score lower but honestly.
F7: Ruling: a worded share on a days-limited template with <3 eligible days goes by recency: sometimes/rarely alternate weeks (not had on its last eligible day), usually skips only after 2 in a row; surplus top-up never hands the day back — "sometimes on Saturdays" must not mean every Saturday — cost: an every-Saturday family would need "every Saturday".
F7: Ruling: the Task-12-mandated DISHES prompt sentences ("paratha rolled with egg or cheese inside…", the lunch-box example) are generalized too — plan-mandated but they overfit h18 (the plan's own §7 aims evals at the real reader) — cost: none beyond a reworded prompt.
F7: parked — "with two phulkas" in the new DISHES_EXAMPLE overlaps h3 ("two phulkas") — Ruling: a common count+bread phrase, already in a pre-lane prompt line ("Paati has just two phulkas at night"); a box-carries-the-home-dish example has the rule's own shape by necessity — not tuning to h18's words — cost: slight eval optimism on h3.
F89: Ruling: h2 TRUTH Dinner gets no Rice part (its TRUTH says "Rasam rice … not stated plainly enough") — h2's Friday-dinner Rice keeps failing from_library by design — low.
F10: Ruling: meals the family said 'suggest some' for (input.suggested) are exempt from the weekly new-dish cap — they asked for new dishes where none are theirs — low.
Ruling: one more focused root-cause + fix round for the regressions (N1, N2, D3c pancakes on non-upma days, N4, N5, h3 curd rice); model-reading misses (D3b, D4, D3d, D10 rep1) and owner items (h2 D2') are parked — stopping rule: after this round, heldout2 once, then the final review.
Ruling N3: not a defect (TRUTH has GS spicy note; the re-run report misread).
Ruling G4: NO name matching in planning ("a dish whose name holds rice" is forbidden by the global constraint). Root fix instead: a rule word that is both a kind and an ingredient the catalog lists ("rice") resolves to BOTH targets (kind Rice + the rice ingredient tag), so Curd rice (kind Curd, ingredient rice) is hit by facts — cost: "no rice" also keeps rice-ingredient dishes (idli? only if the catalog lists rice as a MAIN ingredient; leave-out ingredients stay notes).
Ruling G6: h18 TRUTH Pancakes gets contains ["egg"] (pancakes are made with egg; the planner read it so) — low.
Ruling OD7: no default link for an empty box (G2 fixes the read).
Ruling: dispatch as three batches — S (setup: G1, G2, G3, G7), P (targets/planner: G4), E (evals: G5, G6, G8) — each with its own review.
G7: Ruling: accept the narrower G7 (skip a whole dish only when it and the curry were said with different how-often words) — the literal step breaks dosa+kurma — cost: khichdi with no how-often words may fuse again.
G-setup review: Needs fixes — (1) G2 example mirrors h18's two-box shape; (2) G1 drops a dish that is both a meal dish for everyone and one person's swap item. Ruling (2): guard — keep the template when the dish was named as a dish of the meal in its own right (own said/frequency/days, or named in the meal's answer, not only in the swap); test both. The failing "no rice at night" setup test seen by the reviewer is G4's in-progress change (G4 updates it). Fix round queued after G4 finishes (one implementer at a time).
G4 review: Needs fixes — Ruling: the kind+ingredient double applies only to avoid rules (what avoid, and veg-like exclusions); swap, only, require keep the single resolveTarget (§5.2 a swap targets the swapped part); broad double for avoid ("no poha" also keeps Set dosa off) is intended — avoid means not eating it; test a rice swap not firing on Curd rice. Fix round queued after the setup round finishes.
G4 re-review: partly — (1) set_rule and targetsOf disagree on which rules double; (2) IMPORTANT safety: set_rule saving targets for veg/no_eggs WITH items drops the derived meat/fish/egg expansion (targetsOf only derives when targets null) — since T3. Ruling: one shared predicate in targets.ts; set_rule saves exactly what targetsOf would derive (expansion + items, doubled per predicate: avoid/veg/no_eggs/egg exclusions double; swap/only/require/fasting/cap/note don't). Queued after the eval implementer finishes.
OD6 (owner, answered): the cook's visit cap counts COOKED dishes only — staples (rice, roti/plain paratha, curd) and no-cook extras (boiled eggs, cut salad, fruit) are not counted; linked parts count once. Ruling: fix task G9 (fillWeek visit count + spec §9.3 note unchanged in code comments), test: owner's h18 weekday has no over-limit line. Replaces OD6 park.
G9: Ruling: extras-slot dish skipped only when catalog no-cook/staple or uncatalogued ("4 eggs"); a catalogued cooked extras dish counts; flag renamed (not counted for the cook's cap); Fruit flag item-level — OD6 says simple no-cook extras — cost: an uncatalogued cooked family extra is not counted.
G9: fix rounds 1–2 (67caa40, 57172cd). Ruling: round 2's scoped re-review done by the controller reading the 12-line diff (every-item rule + renames + one test) — low.

## Parked / for the owner
Task 7: Ruling: guestsCan still fails closed for guests — out of the brief; a guest has no weekly-question path to ask — parked for the final review / owner — cost: a guest's unread dish may be swapped out.
Task 10: parked — a change re-plan (set_slot_day, not_for) never asks: an allergy-unknown dish placed by a change is not asked until the next weekly plan (makePlan.ts:1207) — Ruling: one question per weekly message (owner rule) and the brief scopes asks to the weekly plan; raise to owner — cost: an allergy unknown can sit unasked for up to a week.
- U2 (owner, answers the parked T10 item): a change re-plan (set_slot_day, not_for, any edit) that places a dish with a plan-and-ask unknown asks RIGHT AWAY in that change's reply (same check copy, allergy first, ≤3 named + "<n> more to check on the week page"); the weekly plan keeps its one weekly question. Ruling: follow-up task "T10b" after T14, before T15, with review. The parked T10 item is closed by this.
Task 14: parked — approved childSame ask reads "Does Aditi and Ishaan eat…" with two children ({{children}} joined) — owner wording; raise to owner/Flock lane (e.g. Flock fills a verb form or the ask avoids the verb) — cost: ungrammatical question for multi-child households.
Provisional ruling OD1 (owner to confirm): an unset new_dishes_per_week falls back to the manifest's declared default 2 — the setting declares 2; uncapped contradicts it — cost: fewer new dishes until set.
Provisional ruling OD2 (owner to confirm): a school child (weekly school hours over lunch) is off weekday Lunch unless their weekday lunch is "carries" — §5.4 + owner 26 Nov note cited in rootcause — cost: a child who comes home for lunch would need a weekly entry saying so.
Provisional ruling OD3 (owner to confirm): no change — a bread part with a bare dish puts that dish first and offers other breads as new under the budget (spec §5.1 dish rule) — cost: Mooli paratha may appear in the box as a "new" dish.
Provisional ruling OD4 (owner to confirm): "no rice at night" = the Rice kind (all rice) — spec §5.2 kind targets, the family's word names the kind — cost: brown/matta rice also kept off.
F7: parked — "with two phulkas" in the new DISHES_EXAMPLE overlaps h3 ("two phulkas") — Ruling: a common count+bread phrase, already in a pre-lane prompt line ("Paati has just two phulkas at night"); a box-carries-the-home-dish example has the rule's own shape by necessity — not tuning to h18's words — cost: slight eval optimism on h3.
Ruling: one more focused root-cause + fix round for the regressions (N1, N2, D3c pancakes on non-upma days, N4, N5, h3 curd rice); model-reading misses (D3b, D4, D3d, D10 rep1) and owner items (h2 D2') are parked — stopping rule: after this round, heldout2 once, then the final review.

## Deferred minors (for the final review)
Task 1: minor (deferred): generator runs with `bun scripts/kinds/gen-kinds.js .` (node fails: type module); Lachha paratha lost aka "plain paratha" (needed so matchDish("plain paratha") is unambiguous); sub without own bare inherits kind's bare (Khichdi).
Task 2: minor (deferred): kindsOf(s) recomputes mealKinds in hot loops; unused `kinds` constants/stray space in fillWeek.test.ts; evals/lib/adapter.ts loadSetup still writes slots.kinds when sl.kinds set (T13 should drop).
Task 3: minor (deferred): changes.ts items still canonTag'd while targets use another canon (odd words may differ).
Task 3: minor (deferred): targets.ts comment says rajma stays a kind (false, it is an ingredient); unknown multi-word dish words fall back to an ingredient tag (e.g. "paneer tikka"); ingredient tags keep their own name (curd ≠ dairy parent) — T7 must match ingredient names.
Task 4: minor (deferred): marker set even when a template save is refused (refusal logged once, never retried; kept category row stays in library); derived templates the store refuses are dropped (slot keeps templates null → after T8 that slot plans nothing and makePlan asks); private copies of placeOf/familyRow/mealOf in migrateMeaning.ts (import loop) — T8 may clean.
Task 5: minor (deferred): a box skipped that day (skip_days) still takes its person off the main meal (planDays.ts:268); a "breakfast"-named custom slot already at Lunch+INSTEAD_STEP left alone by migration.
Task 7: minor (deferred): kind/sub/item target on a family dish with no saved place is never checked nor asked (rows without kind); givesOf can make an item from an old tag `to` (migration writes gives for hard swaps); singular() strips trailing s (>3 chars).
Task 8: minor (deferred): meal-level "nothing of its template, another dish of theirs" fallback still fires for non-break reasons (fillWeek.ts:710); stapleOf `?? kind` can put an own staple kind word on a plate (fillWeek.ts:311); diet filter lets meat items into a category when any family row has that meat (comment wrong, fillWeek.ts:245); w.ownItems not diet-filtered (fillWeek.ts:329).
Task 9: minor (deferred): egg/cheese share can overshoot when roll days fall before the wet day (fillWeek.ts:550); visitLoad estimate not updated on template switches, leaves out swap items (comment needed); visit preference yes/no not least-over; fixed daily {items:["Paratha"]} adds "comes back sooner than usual" to unmet every weekday — T10/messages should quiet it.
Task 9: minor (deferred): a whole-plate link drops a dish that breaks the box person's rule without refilling that part (fallback only when every dish breaks).
Task 10: minor (deferred): fits/not_for answer settles all of who's unread tags, not only the asked one (changes.ts:301); visitsOf keeps only the strictest cap per visit, over-limit line repeated per day; not_for with empty T leaves the row unchanged; dishText shows a dish note instead of "(for X)".
Task 10: minor (deferred): familyRow duplicated in fillWeek.ts and migrateMeaning.ts.
Task 11: minor (deferred): onboardingRun.test.ts:22-39 fixture still keyed by removed ids (kidsBreakfast, adultsLunch, orderIn) — T12 to check; manifest test re-implements Flock's when-evaluator locally (may drift).
Task 12: minor (deferred): seed slot-days still hold category names (no path to a plate found; migrate derive could read them if a slot's templates are refused).
Task 12: minor (deferred): category word dropped when a new reply names it and the reader omits it (depends on reader consistency); swap gives text not lower-cased (e.g. "Pancakes when it's upma" — matches the brief's expected line); findings 3/4 lack dedicated tests.
Task 13: minor (deferred): linked_parts whole-plate swap allowance lenient (score-plan.ts:497); unknowns_asked doesn't check allergy-first/≤3; no_filling_kind heuristic; cook_times skips visit-count compare when any TRUTH visit lacks `at`.
Task 14: minor (deferred): Plain paratha library row only at Agastya's lunch box though GS's swap gives it at Dinner — check in T15 Eval 1 library score.
Task 14: minor (deferred): part-dish exemption in real_dish not tied to a slot; extra part words make Eval 1 templates stricter (live setup must save them); h9–h12 keep category library rows (no TRUTH meals); h18 has no seed; h18 school "TCIS" stored as household.school.
Task 10b: minor (deferred): duplicated planQuestion ternary (makePlan.ts:517); a change spanning two weeks can carry one question per week (changes.ts:71); no change-path test for the ">3 named" cap.
F1: minor (deferred): a box with instead_of but no people falls back to a plain custom slot; an unplaced lunch-box dish only reaches the dropped log (no read-back ask).
F2: minor (deferred): cap rule (makePlan.ts:105) and soft-rule day matcher (rules.ts:285) match r.slots by name, no box handling.
F2: minor (deferred): planChecks recomputes weekSlots(w) per call (lines 272/419/490); soft-rule day matcher rules.ts:285 has no box handling.
F3: minor (deferred): pure-kind phrase variants count as never had (ties by index); phrase key duplicated.
F456: minor (deferred): a cook given only limits_words is dropped; several unplaced words → one ask line each (group per meal later); F5 changed HOME_PART line 82 — F7 must not re-edit it blindly.
F456: minor (deferred): family.ts hadCook tests raw JSON "[]" as a cook; a blank-name submit erases a named cook's name; carryDays all-home + "carries" falls back to Mon–Fri; nameless-cook removal by substring "cook".
F7: minor (deferred): a kind-only template (no named dish) can't see its history, so a one-day sometimes kind template comes every week.
F89: minor (deferred): newness relies on the planner's own flags (a mis-saved new dish as suggested:false passes from_library; own_share/no_new_kind still judge it); whole-plate linkedDish accepts any source dish.
F10: minor (deferred): awayBy doc comment displaced by coversSpan; inline coverage logic duplicated; newDishesSet a one-line wrapper; a school entry without hours keeps the child at Lunch.
G-setup: minor (deferred): swapOnly substring quote match; template-presence fallback for unread meals; box-part link taught by rule line only (no example).
G5+G6+G8: minor (deferred): no explicit bad cases for "Paratha with sabzi"/"Paratha"; saidRow still via dishNameOf (possible residual Moong dal/khichdi leak).
G4: minor (deferred): set_rule recomputes targets only when items are sent (a what-only edit keeps old targets); unreachable fallback branch changes.ts:324.

Ledger and every task report: .superpowers/sdd/2026-11-26-one-meaning-model-planner/ (git-ignored, kept).

## Update 27 Nov 2026 (resumed controller, sonnet-only): fix rounds K1-K5, runs 5 and 6

Branch HEAD ac2efca. Commits since 5c83828: 5f0bf91 J4, b9e3879 J5, cc6a787 J6, 7abfc77 (J6 test), 8edaf0c J10, 180ee0f J11, ac2efca (J11 needs 3 kinds). Review: K2 clean, K3 clean after a test-only round, K5 clean after one round (all sonnet). Setup.test.ts 180 pass; the other files were run one at a time.

Eval results (deepseek-v4-flash, --concurrency 1):
- Run 5 (HEAD 7abfc77): h18 3/3 (rep 1: one cause, a box saved with no instead_of -> J10). Base x3: h1 2/3 (rep 1 "Dal roti sabzi" saved as a dish -> J11), h2 3/3, h3 3/3, h13 3/3.
- Run 6 (HEAD ac2efca, the final acceptance run after all fixes): h18 3/3 PASS. Base x3: h1 3/3, h2 3/3, h3 3/3, h13 3/3 (tiers A, B, C all PASS). Misses left: h18 rep 1 only (reps 2-3 clean): from_library (Pancakes not in the box's library, Thu), dish_frequency (Egg curry on Thu), no_new_kind (Lunch Green salad), linked_parts (Mon lunch box Sabzi: Beans poriyal vs Rice, Pumpkin sambar); h2 rep 1 has a miss line though the household passes (known F89 class).
- Held-out h15-h17: NOT RUN (h18 is not miss-free). Final whole-branch review: NOT RUN.

Why I stopped: linked_parts, dish_frequency and no_new_kind were also in run 4's h18 misses and reappear after K1-K5, in a different dish each time and in one of three reps. These classes do not converge because each round closes one concrete shape (J1, J8, J10, J11) while the model's one-in-three setup read varies in a new place; the remaining ones have no single code cause I could name without a new root-cause round. A further round would loop. Owner call: accept h18 3/3 passes with rep-1 misses and run held-out + final review, or approve another root-cause round on linked_parts/dish_frequency for rep-1 shapes.
