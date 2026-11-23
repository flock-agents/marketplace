# Slot model — build state and resume notes (24 Nov 2026)

Built and merge-ready, not pushed, no PR (owner tests first). Spec: `slot-model-spec.md` (owner decisions through 24 Nov folded in).

## Branches (merge together; Flock first)
| Repo | Branch | Worktree | What |
|---|---|---|---|
| marketplace (planner) | `feat/planner-slot-model` | `~/Developer/mp-slot-model` | Tables, setup v2, plan v2, later-change ops, next-day untried-dish question, evals (h1–h8 + held-out h9–h12), 7-day shopping simulation. 585 tests. |
| flock | `feat/household-weekly` | `~/Developer/flock-household` | `household.weekly` (from h4), nicknames, `household.dated` + Butler tool, make_plan gets household, `ctx.household.get`, `ctx.apps.op` (app→app read ops) |
| marketplace (family-calendar) | `feat/famcal-get-events` | `~/Developer/mp-famcal-events` | `get_events {from,to}` (3.1.0) |
Merged lane branches (can delete): feat/planner-slot-schema, -setup-v2, -plan-v2, -slot-evals, -later-changes.

## Last measured (DeepSeek v4 flash = live balanced)
- Eval 1 (setup): h1–h8 95%, held-out 91%; hard rules 100%.
- Eval 2 (plan): h1–h8 filled/attendance/hard rules 100%, dish_frequency 97%; judges 3.4. Held-out judges 3.3 (`evals/results/plan-truth-heldout-short-new/`).
- Shopping week simulation: all checks pass (`server/shoppingWeek.test.ts`).

## Open — optimise later
1. **Short slots don't get new dishes in practice.** Code gives a short slot its own new-dish allowance (owner 24 Nov), but DeepSeek proposed none for h9/h12 dinners: it reuses lunch's dishes from `looks_like`. Next: show the model the used-up dishes explicitly as "used up", and/or require `new` entries when `short_of_dishes` and the library is empty; capture raw answers.
2. **Short-slot repeats are hard problems now** → many `unmet` lines when no new dish is placed (h9 1→10). Cheapest fix: keep them soft unless the slot has accepted new dishes.
3. Lunch runs before dinner and uses up shared dishes under the 2-days default cap; dinner then repeats lunch (same_day_repeat 23/28 held-out).
4. Eval scorer's default_cap doesn't know add-on standing dishes (dea3b74) — scorer fix.
5. Setup: a person's own meals on new families (held-out personal placement 57%); dish frequency/days 70%; dishes read occasionally passes 150 s.
6. h4 make_plan ≈325 s vs 330 s limit.
7. Shopping: the family's message says "Your cart: milk" not "I've added milk"; unanswered low items ride into orders at qty 0.
8. Cleanup: delete `server/legacy.ts`; regenerate catalog.json/row-schema.json/settings.json; CHANGELOG; trim committed eval results before PR; Week page not run in a browser.
9. Owner decision pending: ingredient stripping (distrust reads that tag most of a dish; keep ingredients for people a dish is not_for) — recommended keep.

## Acceptance still to do
WhatsApp sim batch on two stacks (`~/Developer/flock-sim`), then the owner reads two real weeks. Owner instances 35626/35850 were down on 23 Nov (not touched by this work).

## Working rules
Plan before build; no PR before the owner tests; never push unless asked. Never the full Flock server suite. `git -C`, add by path. No eval family names in prompts; no word lists for meaning (guard tests). OpenRouter key has a $20/day limit (hit 24 Nov).
