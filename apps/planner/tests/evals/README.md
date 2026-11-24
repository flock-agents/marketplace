# Meal Planner evals

Two evals that test the planner's rules without a WhatsApp run. They are not part of the app's test run (`bun test server src`):
run them by hand, from the repo root. Both call the real model through the Claude CLI (no API key), sequentially.

## Fixtures (`fixtures/*.json`)

One household each. The `expect` lists were written from what the family said, as a parent would judge the plan, BEFORE
the planning prompt was read (commit 9270f46); the scorer (`lib/score.ts`, word lists in `lib/terms.ts`) is the eval's own
and imports nothing from the app's rule code.

| fixture | who | assertions |
|---|---|---|
| `run11` | Shiva's household exactly as told in live run 11 | 32 |
| `jain-celiac-lowsalt` | Jain every day, celiac child + tiffin, low-salt soft-food grandfather, paneer cap | 14 |
| `nonveg-eggallergy` | non-veg except Tue/Thu/Sat, egg-allergic child + tiffin, protein at every meal, lactose-intolerant grandfather, Sunday biryani | 13 |
| `renal-nuts-pickyeater` | renal-diet grandmother, nut-allergic boy (whole house), a girl who eats only 5 dishes, pregnant mother | 8 |
| `colliding-rules` | low-carb dad, vegan mum, soy-allergic dal-hating boy, no-onion/garlic/egg grandmother: needs separate dishes | 11 |

Each fixture: `people`, `cook`, `cooking_days`, `slots`, `absent` (who is away for which meal), `last_week`, `told` (the
answers as said, by setup question id; `said_later`: what the family says afterwards in chat, such as the cook's limits), `rules` (the contract-shape rules a correct interview saves, by hand) and `expect`
(`{ id, says, check }`; `heuristic: true` = judged from dish-name lists, e.g. "under 20 minutes"; `soft: true` = nice to have).

## Model access

- Config: a real, already signed-in Claude config dir. Default
  `~/.flock-wa-onboarding-test/run1/a/data/claude-config`; override with `--config-dir <dir>` or `EVALS_CLAUDE_CONFIG`.
  Pass the REAL directory, never a symlink to one (the scripts refuse a symlink).
- Model: `--model claude-sonnet-5` (default, what the Butler runs on).
- CLI: `claude` on PATH, or `FLOCK_CLAUDE_BIN=<path>`.

## 1. Plan eval

Boots a real planner (assembled as Flock's app tests do: `~/Developer/flock-wa-onboarding/flock-app`'s `assembleApp` and
the cached node_modules in `~/.flock-wa-onboarding-test/helpers/mp-apps/nm`; override with `FLOCK=` / `NM_CACHE=`), seeds
it through the agent's operations (set_person, set_slots, set_cook, set_cooking_days, set_house_rules with the fixture's
rules — if the app refuses the contract shape they go in as legacy kinds + `other` notes and the run says so — and last
week as the owner), reads `plan_week draft` for the context, asks the model for the week's `plan_week` meals with the
agent guide as the system prompt, sends `plan_week final` (meals, then the closing call) as the agent, feeds any refusal
back, up to `--rounds` model calls, then scores the saved week.

```sh
bun apps/planner/tests/evals/plan.ts --fixtures run11,colliding-rules --repeats 2 2>&1 | grep -v "Pulling schema"
bun apps/planner/tests/evals/plan.ts                       # every fixture, 3 repeats, 3 rounds
bun apps/planner/tests/evals/plan.ts --dry --repeats 1     # no model: a one-meal stub, checks seeding + scoring
```

Flags: `--fixtures a,b` `--repeats N` (3) `--rounds N` (3) `--model M` `--config-dir D` `--dry`.
Output: one line per run (pass count, rounds, accepted, refusals, each failed assertion with the breaks), a per-assertion
pass-rate table per fixture, and `results/plan-<time>/` (summary.md + per-run JSON with the saved week and transcript).

## 2. Interview-capture eval

Gives the model the app's guide, the operations' fields and the setup questions (ask + help + the operation each answer
is saved with, from `flock.app.json`), then each `told` answer in order; it replies with the calls it would make. Its last
`set_house_rules` rules are compared with the fixture's `rules` (`lib/capture.ts`: synonyms and a category vs a listing
are fine; kind, who, days, slots, `per_week`, `to` must match; a legacy kind counts as its meaning, so `veg` = avoid
@meat/@fish). Per rule: captured / wrong (found, a field off) / note_only (only in an `other` rule or a person's text: no
code can check it) / missed; plus extra rules saved.

```sh
bun apps/planner/tests/evals/interview.ts                          # every fixture, once
bun apps/planner/tests/evals/interview.ts --fixtures run11 --repeats 3
```

Results: `results/interview-<time>/`.

## Re-scoring saved weeks

After changing a fixture's `expect` or the scorer, re-score the weeks a plan run saved (no model, no app):

```sh
bun apps/planner/tests/evals/rescore.ts apps/planner/tests/evals/results/plan-<time>
```
