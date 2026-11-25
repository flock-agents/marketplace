# Meal Planner offline evals (slot model)

Two independent evals, scored against TRUTH written in slot-model terms (docs/slot-model-spec.md §2.1, §8), so setup and
planning are measured separately and on families other than the one a change was made for. No sim stack, no Flock: the
planner runs in-process and models are called over OpenRouter with Flock's app-model contract (key read from
`~/Developer/flock/flock-web-services/.env`, never printed).

Everything under `lib/` except `adapter.ts` is pure and imports no code from `server/` (`lib/catalog.ts` reads
`server/kinds.json` as data: kinds are the catalog's by definition, but the eval places dish names in it its own way): the scorers, the truth types and
the eval's own food vocabulary are written from the spec alone, with unit tests on a hand-made household
(`bun test evals/`). **`lib/adapter.ts` is the only file that touches the app** (spec §2.1 table/column names; ops
`apply_setup`, `make_plan`, `set_slot_day`, `add_dish`): adjust it there if lanes A–D name something differently.

| | Eval 1: input → constraints | Eval 2: constraints → plan |
|---|---|---|
| tests | `apply_setup` | `make_plan` |
| input | a simulated interview per household + Flock's household facts (incl. `household.weekly`) | TRUTH loaded as rows (slots, library with contains, rules, seed), the week's dated facts and guests |
| scored | `lib/score-setup.ts`, field by field | `lib/score-plan.ts`, plus two-vendor blind judges (`lib/judge.ts`) |

## Households

`households/h1–h8` (tuning set) and `households/heldout/h9–h12` (held out: never used to tune, run only with `--heldout`,
at milestones, on fresh chats). Each holds Flock's `household.*` facts (with structured `household.weekly`; nicknames on
`household.people`), the persona's facts and one correction, and TRUTH (`lib/truth.ts`):

- `slots`: main / custom / addon, `usual_people` (empty = everyone), `days`, `skip_days`; `optional` slots are accepted, not required
- `away`: weekly absences by slot and weekday (a person who carries the home lunch is *not* away); `lunchUnclear`
- `library`: one row per dish and slot, `frequency` (`daily` | `usually` | `sometimes` | `rarely` | `n/week`), `days`, `contains` overrides, `alsoSlots`, `unsaid`, `aka` (other names the family uses, Eval 1 only)
- `rules`: hard/soft, `what`, who/slots/days/items/to/frequency/per_meal/fasting_food, a `quote` pattern of the family's words; `noted` for what no weekday rule holds (Ekadashi)
- `seed`: past meals per slot; `week`: stays, trips and guests for Eval 2; `familyCooks`, `cook`

Held-out: h9 Jain joint family with a morning cook and the grandmother's own early dinner; h10 single mother + toddler
(hybrid office days, the toddler's own dinner); h11 couple with alternate-week office days (lunch unclear), non-veg
weekends, lactose intolerance; h12 Bengali–Marwari home with a fish add-on for two and a diabetic vegetarian elder.

## Eval 1 — setup

```
cd apps/planner
bun evals/eval-setup.ts                          # h1–h8, new persona chats (~$0.02)
bun evals/eval-setup.ts --reuse-transcripts evals/results/<run>
bun evals/eval-setup.ts --rescore evals/results/<run>/results.json
bun evals/eval-setup.ts --self-test              # TRUTH vs itself, all 12 households, no model, no app
bun evals/eval-setup.ts --contains               # contains accuracy on the 40 labelled dishes (lib/contains-labels.ts)
bun evals/eval-setup.ts --heldout                # h9–h12
```

Fields: `slots_present`, `slot_kind` (incl. `addon_of`), `slot_people`, `slot_days`, `skip_days`, `no_extra_slots`,
`attendance` (weekday attendance, when the adapter can read it), `lunch_unclear`, `cook_days`, `cook_times`,
`family_cooks`, `placement` (each dish on its slot), `personal_placement` (a person's dish on their add-on/custom slot, not
the shared one), `no_wrong_personal`, `rows_on_right_slot`, `dish_frequency` (frequency + days per dish, `daily` too),
`no_unsaid_frequency`, `hard_rules`, `soft_rules`, `hard_soft`, `rule_frequency`, `no_unsaid_rules`, `rule_quotes`
(quote in the family's words), `hard_no_frequency`, `noted`, `seed_present` (per seeded slot), `seed_on_slot`.
Informational: `dish_coverage`. Contains: `accuracy`, `recall` (a missed yes lets a hard rule through), `read`, per tag.

## Eval 2 — plan

```
bun evals/eval-plan.ts                           # h1–h8 from TRUTH, judges anthropic/claude-sonnet-5.5 + openai/gpt-5
bun evals/eval-plan.ts --baseline                # code-only rotation of the seed: the floor, and the scorer's self-check
bun evals/eval-plan.ts --perturb [kinds]         # thin_library, no_seed, misfiled, person_wrong_slot, missing_contains
bun evals/eval-plan.ts --from-eval1 <results.json> | --compare a b | --rescore <results.json> | --heldout
```

Gating fields: `filled` (every expected slot-day), `skips_kept`, `no_stray`, `attendance` (usual − weekly absences ±
stays/trips − fasts without fasting food), `guests`, `hard_rules` (per person on each slot-day, items vs contains,
**fail-closed**: a tag the loaded library never read counts as a break; the eval's vocabulary of the planned name always
counts), `guest_rules`, `from_library` (library, staple, or an allowed new dish), `new_budget`, `dish_frequency` (only the
family's own words limit a dish: its frequency in days across all slots, its named days), `daily_dishes` (a `daily` dish on
every slot-day of its slot), `soft_frequency` (cross-slot counts), `cap_rules`.
Kinds model (owner, 25 Nov; the twice-a-week cap and the 3-day window are gone): `no_early_repeat` (an item back in its slot,
Lunch and Dinner counted together for a kind the family has at both, while another of the family's items of that kind went
unused that week, unless their words on the dish allow it), `not_next_day` (the same item on consecutive days in its slot
group, or at lunch and dinner the same day), `real_dish` (no bare kind or sub-kind word: "Sabzi", "Dal", "Curry", "Poriyal",
except the family's own dish they fixed to a day or to every day), `no_new_kind` (a dish not the family's is of a kind their
own dishes at that slot are of; one the catalog cannot place fails), `own_share` (≥ 30% of the week's non-staple items).
Kinds come from `lib/catalog.ts`: `server/kinds.json` read as data (no server code), placed by the eval's own matcher, with
TRUTH's `kind`/`sub` on a dish the catalog cannot place ("Bhindi").
Staples (exempt from rotation): ≥ 60% of a slot's last 14 seed + confirmed rows, `daily` dishes, and the catalog's staple
kinds (roti, rice, curd, bhakri). Tracked, not gating: `shape` (dish count per slot-day within ±1 of the slot's history).
Facts: hard_breaks, new_dishes, family_dish_share, unmet, flagged.

## Guards (`bun test server/`)

`server/evalGuards.test.ts`: (a) no eval household person/family name in model-facing text (server strings and templates,
`server/**/*.md`, the manifests); (b) no regex of weekdays, kinship words or less/more in `server/setup.ts`,
`server/makePlan.ts` (or `server/setup/`, `server/plan/`), outside the allowlisted `server/quoteLint.ts` and
`server/db/constants.ts`; today's 2.x regexes are listed in `GRANDFATHERED` for lanes B/C to delete as they rewrite.
`server/quoteLint.ts`: spec §4.2's day/count lint (`needsReread`, `lintLibrary`), tested in `quoteLint.test.ts`.

## Results (slot model)

`results/` holds the runs (`results.json` with every setup, transcript and week, and `summary.md`). The 2.x runs from before
the slot model were removed (they scored tables that no longer exist).
`results/setup-2026-11-231555`: setup v2 before tuning (the baseline); `results/setup-tuned-fresh` and
`results/setup-heldout-tuned`: after the how-often read and the scorer/persona fixes of 23 Nov (a whole-house avoid kept per
person counts; any row of a dish on its slot may carry its frequency; "veg" = "vegetable" and `aka` in dish names; the persona
never adds a how often the facts don't give).
