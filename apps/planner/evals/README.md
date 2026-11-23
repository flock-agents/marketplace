# Meal Planner offline evals

Two independent evals over the same fixed set of 8 households, so a change to one step is scored on its own and on families
other than the one it was made for (owner, 23 Nov: "1. user inputs to constraints 2. constraints to a plan. We keep swinging
between the 2"). No sim stack, no Flock: the planner runs in-process (`server/testkit.ts`) and models are called over
OpenRouter with Flock's app-model contract. The key is read from `~/Developer/flock/flock-web-services/.env` and never printed.

| | Eval 1: input → constraints | Eval 2: constraints → plan |
|---|---|---|
| tests | `apply_setup` (`server/setup.ts`) | `make_plan` (`server/makePlan.ts`) |
| input | a simulated interview per household | TRUTH loaded through the app's own routes (no model) |
| scored against | TRUTH, field by field, in code | TRUTH, in code, plus a blind LLM judge |

## The households (`households/`)

Each file holds Flock's `household.*` facts (as Flock has them after its own household questions), the owner's PERSONA
FACTS (what they would say, one mid-interview correction) and TRUTH: the setup the planner should end up with in its own
terms (people and groups, cook days and visits, who cooks on other days, extra slots, order-in meals, hard rules with how each
is checked, soft notes, dishes with eaters and frequency, the typical meal per slot in the family's words with its number of
parts and staple).

| id | family | what it stresses |
|---|---|---|
| h1-sharma | North Indian, office parents, kid tiffin, cook Mon–Sat 2 visits, mother cooks Sunday | eggs OK, chicken only Sat/Sun; parathas on weekends, rajma twice a week, Maggi on Fridays; evening-time correction |
| h2-iyer | Tamil, wife cooks every meal, no cook | veg no eggs, Karthik no brinjal; curd rice when she's not well, pongal on Sundays; order-in day correction |
| h3-shiva | the owner's family (sim family a) | Thursday fast, diabetic elder (no sugar hard, millets good soft, no rice at night), nut-free tiffin, Sunday lunch out + Saturday dinner in; owner's own meal-shape words; 7:30 correction |
| h4-reddy | Telugu, grandparents + cook | per-person veg for the elders, chicken only Sunday lunch for three, ragi good for her (soft), Ekadashi fast (not a weekday), soft food |
| h5-agarwal | Marwari joint family, DIL cooks | no onion-garlic always for one elder, on Tue/Sat only for the other (corrected from Thu); khichdi Saturday night, dal baati Sunday |
| h6-kulkarni | Maharashtrian, cook Mon–Fri, parents cook weekends | non-veg weekends only, peanut allergy in a peanut-heavy cuisine, shared snack box for two kids, noodles sometimes on Friday |
| h7-menon | young couple, one weekday visit makes lunch+dinner | no breakfast by the cook, three weekend meals out/in, high protein, no red meat for one; eggs every morning, biryani rarely |
| h8-banerjee | Bengali, grandparents, cook every day | rice-dal-bhaja-torkari-fish shape, fish most days, luchi Sunday, veg no-onion-garlic grandmother, diabetic grandfather |

Frequency words are encoded in TRUTH (dish `often` usually ≤5 / sometimes ≤2 / rarely ≤1 days a week, `per_week`, `days`; a soft note's `often` and
its weekly range, sometimes 2–3, usually 4–5). The planner before 8dc4b89 had no such fields: its runs are the "before".

## Eval 1 — user input → constraints

```
cd apps/planner
bun evals/eval-setup.ts                                  # all 8, repeat 1, new persona chats
bun evals/eval-setup.ts --reuse-transcripts evals/results/<run>   # re-score a setup change on the same chats
bun evals/eval-setup.ts --only h3,h5 --repeat 3 --concurrency 4
bun evals/eval-setup.ts --self-test                      # TRUTH scored against itself: every field must pass (no model)
bun evals/eval-setup.ts --rescore evals/results/<run>/results.json --out evals/results/<run>   # a scorer change, no model
```

Flags: `--model` (apply_setup's balanced/fast upstream, default `deepseek/deepseek-v4-flash` as the live gateway),
`--no-think` (reasoning off; default is the model's own), `--persona-model`, `--out <dir>`, `--verbose` (the app's logs).

How it runs: for each household, the manifest's `setup` questions in order; for each id the first variant whose `when` holds
against facts worked out from the household (children, elders, the cook's days once the cook question is asked, grocery
apps, an elder named in the diet answer); sign-in, order read-back and closing questions skipped. A persona model
(deepseek-v4-flash, temperature 0.7, reasoning off; style rules copied from the sim's `persona.ts`) answers each question in
1–2 short messages; the correction is sent once as its own reply after the question it follows. The transcript is kept as
`Q:`/`A:` lines (saved to `<out>/transcripts/`), then `apply_setup` runs on a fresh database with the household facts and
`household.speaker`. **Time: ~2–4 min for all 8 (concurrency 4). Cost: ~$0.01–0.02 a run (deepseek).**

Scorecard fields (each a pass rate over what it counts; `–` = not applicable to that household):

| field | passes when |
|---|---|
| people | the same names (first name OK) with the right group, nobody extra |
| cook_days | the cook's name and days (no cook: none saved, or a family member) |
| cook_times | each visit's time and meals, the correction applied, no extra visit |
| home_cook | who cooks on each of the cook's days off (no cook: whoever cooks) saved as the "X cooks" note |
| slots_present / slot_days / slot_for | each extra meal exists, on its days, for its people (no `for` = everyone) |
| no_extra_slots | no extra meal the family did not have |
| order_in | exactly the meals eaten out or ordered in |
| hard_rules | each hard rule saved as a rule the planner checks (who, days, slots, items covered) |
| no_unsaid_rules | every saved rule traces to something the family said (a hard rule or a soft note) |
| soft_notes | each soft note (less salt, less spicy, high protein…) saved for its person |
| soft_kept_soft | a soft note is not turned into a rule enforced at every meal ("less oil" saved as avoid oil) |
| rule_frequency | a soft note with a frequency saved with it (`often`) |
| dish_no_wrong_restriction | no dish saved as someone's own when the family eats it together |
| personal_dishes | each one-person dish saved for exactly that person |
| dish_coverage | share of TRUTH's dishes saved (informational: the persona may not name all) |
| dish_slots | a saved dish is at (one of) its own meals |
| dish_frequency | a dish's `often` / `per_week` / `days` saved |
| meal_examples | a typical-meal example for each main meal the family described |

## Eval 2 — constraints → plan

```
cd apps/planner
bun evals/eval-plan.ts                                   # all 8 from TRUTH, with the judge
bun evals/eval-plan.ts --from-eval1 evals/results/<eval1 run>/results.json   # plan from Eval 1's saved setup (scored vs TRUTH)
bun evals/eval-plan.ts --perturb                         # robustness: h3, h1, h2 x 5 defects, one at a time
bun evals/eval-plan.ts --perturb lunch_restricted,no_examples --only h3,h6
bun evals/eval-plan.ts --compare evals/results/<a>/results.json evals/results/<b>/results.json   # pairwise judge
bun evals/eval-plan.ts --rescore evals/results/<run>/results.json   # a scorer change on the saved weeks, judge kept, no model
```

Flags: `--week` (default 2026-11-30), `--model`, `--no-think`, `--no-judge`, `--judge-model` (default
`anthropic/claude-sonnet-5.5`), `--concurrency`, `--out`, `--verbose`.
**Time: ~4–6 min for all 8 (each make_plan 1.5–3 min, 4 at a time). Cost: ~$0.05 planner + ~$0.25 judge.
`--perturb` (15 runs, no judge): ~8–10 min, ~$0.10.**

TRUTH is loaded through the planner's own routes (people, cook, slots, order-in, rules, dish book with eaters, meal
examples); fields the current code does not take (`often`, `per_week`, `days`) are sent and, if refused, sent again
without — they will be read once the planner has them.

Code scores:

| field | passes when |
|---|---|
| meals_planned | every meal the family eats at home has a dish (extra slots on their days; a meal where every diner fasts is not expected) |
| order_in_kept | nothing cooked at a meal eaten out / ordered in |
| no_stray_meals | nothing planned at a meal the family does not have (a tiffin on Saturday) |
| hard_rules | each hard rule held all week, person by person (avoid by name and ingredients, fasts, swaps) |
| everyone_fed | at each main meal every diner (not fasting) has a main dish, not only rice/roti/sides |
| personal_dish_freq | a one-person dish on at most its count (`rarely` 1, `sometimes` 2, `per_week` n, else 3 days) |
| personal_dish_eaters | a one-person dish is given to its person only (Tanya's oats are not Nikhil's breakfast) |
| dish_frequency | a dish with `often`/`per_week` within its count, `usually` on 3+ days, a day-bound dish only on its days |
| soft_frequency | a soft preference with a range (millets good for him) in that many of the person's meals |
| meal_shape | each meal of a slot with a typical meal: shared parts = their parts ±1, and their staple when their words name one (a one-pot dish like bisi bele bath counts as a miss here) |
| own_slot_dishes | no breakfast or tiffin-only dish at lunch or dinner |

Facts (not pass/fail): `family_dish_share` (% of planned dishes that are the family's), `unmet` (lines the planner itself
reported), `flagged` (the planner said something was off).

Judge (blind; sees TRUTH in words and the week with eaters): 1–5 for `fits_dishes`, `meal_shape`, `variety`, `per_person`,
`overall`, plus the single worst thing. 5: accept as is, 3: usable with changes, 1: reject.

### Robustness (`--perturb`)

TRUTH with one defect at a time; reported separately from the clean scores (no judge):

| defect | what is wrong in the setup |
|---|---|
| lunch_restricted | every Lunch dish restricted to two people (the live bug: all lunch dishes Ankita + Gowri Shankar) |
| thin_dishes | only two Lunch and two Dinner dishes known |
| no_examples | no typical-meal words at all |
| lunch_misfiled | half the Lunch dishes saved under Breakfast or Dinner |
| personal_dish | "Curd rice" for one person (a child), with no frequency |

Read: `own_slot_dishes` (lunch drawn from lunch's own dishes, not upma or a tiffin sandwich), `everyone_fed`,
`personal_dish_freq` and `meal_shape` under each defect, and `flagged` — whether the planner said the input was thin
instead of silently filling.

## Results

`results/` holds the runs (`results.json` with every setup, transcript and week, and `summary.md`). `results/before-257ef20-*`: the
planner before the how-often change (h3 fixture v1, without the rajma/chole/chapati counts); `results/cf9a391-*`: the
merged how-often planner, the scorecards to compare against.
