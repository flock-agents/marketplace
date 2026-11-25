# Kinds model: build contract (owner-approved 25 Nov 2026)

The meal planner moves from "the model plans each slot's week from the family's dishes" to **templates of kinds filled by
code**. Owner rules are in `scripts/kinds/decided.md` (1–19); this file is the contract the four build lanes share.
Storage is done (commit 62e5fa4): read `server/kinds.ts`, `server/kinds.test.ts`, `server/slotStore.ts` (Slot.kinds,
Slot.templates, LibraryDish.kind/sub/catalog_item), `server/family.ts` (HouseView.cuisines).

## The model in one paragraph

A meal (slot) is a set of **templates** (`MealTemplate`): ways the plate is made, e.g. Lunch [Rice, Sambar, Rasam, Poriyal,
Curd], Dinner [Roti, Sabzi] or [Roti, Dal, Sabzi]. A template **part** is a catalog kind (`{kind}`), one sub-kind of it
(`{kind, sub}`), or a fixed list of the family's own dishes (`{items}`, nothing new suggested). The slot's `kinds` list says
which kinds it uses, the family's own sub-kinds of each (`subs`, preferred in rotation), whether the kind is a **staple**
(roti, rice, curd: every time its template has it, the family's usual item, never rotated) and `own` (a kind only this
family has; nothing new is ever suggested for it). Each library dish carries `kind` / `sub` / `catalog_item`.

## Owner rules the code must hold (from decided.md and the 25 Nov notes)

1. **Templates**: spread evenly over the week unless a template has a `share` ("2/week", usually/sometimes/rarely/daily;
   FREQUENCY_DAYS in constants.ts) from the family's words; the read-back shows the mix.
2. **Pinned dish** ("rajma every Sunday": a library row with `days`) is that item on its day, in a template that has a part
   for its kind (or the template it came in); no rotation for it.
3. **Rotation per part**: the family's items of that kind (preferring the slot kind's `subs`, then the part's `sub` if
   given) come first, least-recently-used first (history: `slotHistory`, `recent`). **No item repeats until every option is
   used**; the count is shared across Lunch and Dinner for a kind both use. After that, the item used longest ago comes
   back, **never on the next day** (nor the same item at lunch and dinner the same day). The old twice-a-week cap
   (DEFAULT_DISH_DAYS, `main_twice`) is REMOVED. What still limits: the family's own words on a dish (library
   `frequency` / `days` / `said`: "once a week", "on Sundays", "poha twice").
4. **Brand-new variants** (catalog `suggestable(kind, {sub, cuisines})`, items the family never had) are a **last resort**:
   used for a part only when no family item of it fits that day (all used this week, or the day's food rules exclude them).
   At least **30% of the week's non-staple items are the family's own** (OWN_SHARE). Never replace a pinned dish or a
   staple. Regional items only within the family's cuisines (house.cuisines). Never a new kind. A placed new variant is a
   library row `origin: planner_suggested`, `suggested: true`, `untried: true`, and the slot_dish `new: 1` (existing
   fields; `offers` counts placements, 2 offers never made → dropped; `disliked` → never again).
5. **Same plate**: no item twice; two parts of one kind get different items (from different sub-kinds where the template
   names them: sambar and rasam).
6. **Food rules and allergies**: an item's contents are the catalog's (`catalogContains`, tags with parents; map the
   catalog's `seafood` parent to the planner's `fish` tag and apply constants `TAG_PARENT`) for catalog items, else the
   library's `contains`. A hard rule is never broken for a person at the table: pick another item, or keep the item with
   `not_for` that person AND make sure that person has something they can eat at that meal (their own item for that part).
   Nobody at the table is ever left with nothing. The family's own dishes are safe for their allergies (vouched, existing);
   new items are read carefully (existing `carefulTags`).
7. **Onion/garlic** never blocks a dish: plan it with a note "make without onion and garlic, or keep <person>'s portion
   aside", unless the dish is mostly onion (its name says onion / pyaaz / kanda / vengaya / ulli).
8. Unchanged: kids eat their box at school; sambar counts as a main only beside rice; days eaten out / ordered in; guests,
   fasts, stays from planDays.ts; ingredients call; the message's structure.

## Lanes (one git worktree each, off `fix/planner-onboarding-run` @ the commit that adds this file)

| Lane | Worktree / branch | Owns (only these files) |
|---|---|---|
| S setup | `~/Developer/mp-kinds-setup` / `kinds-setup` | `server/setup.ts`, `server/setup.test.ts`, `server/kinds.ts` (additions only) |
| P planner | `~/Developer/mp-kinds-planner` / `kinds-planner` | `server/makePlan.ts`, `server/planChecks.ts`, new `server/fillWeek.ts` (+ tests), `server/db/constants.ts` |
| M messages | `~/Developer/mp-kinds-messages` / `kinds-messages` | `server/messages.ts`, `server/reminder.ts`, `server/routines/*`, their tests |
| E eval | `~/Developer/mp-kinds-eval` / `kinds-eval` | `evals/**` |

Interfaces between lanes are only the stored fields above and `server/kinds.ts`'s exports. A lane that needs another lane's
file changed writes the need in its final report instead of editing it.

Standing rules: never put eval household names (Sharma, Iyer, Reddy, …) or their dishes-as-examples in any prompt; every
prompt example is a made-up family. Run `bun test server/` and `bun test evals/` (planner only; this is not the Flock
server suite). `git -C <your worktree>` for every git command; never `commit -a`, `add -A` or `add .`; commit only your
files; never push.
