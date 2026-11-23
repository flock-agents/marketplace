# Meal Planner: slot model — build spec

Status: owner decisions folded in, 23 Nov 2026 (see §10), incl. "plans are suggestions" (§5.7). Source of truth for the design: the design page
(https://claude.ai/artifact/G6kUr6SWuXe75wQoCLNmHD). This file turns it into what to build.

Principle throughout: **the model reads words and fills slots; code stores, counts and checks rules.**
No model writes app payloads mid-chat; no code matches phrases ("Amma", "weekend") to decide meaning.

**A plan is a suggestion, not a record of what was eaten** (owner, 23 Nov). The family can ignore it, cook
something else and never say so. So a planned slot-day is never treated as eaten: only what the family tells
us (a correction, or the next-day answer about a dish they hadn't had before, §5.7) confirms anything. There are no general
"did you cook it / was the week as planned" check-ins.

---

## 1. Goals and non-goals

Goals
- A week planned slot by slot: each slot on each day has the people it is for and the dishes made in it.
- Plates shaped like the family's own meals, learned from their own past meals (history), not a template.
- Hard rules always kept, checked in code; soft preferences kept to their frequency.
- One-off and recurring changes (eating out, office lunches, guests, stays, festivals) without re-asking setup.
- Two evals that test setup and planning separately, on households we did not tune on.

Non-goals (for this build)
- Weekly plans stay on the **balanced** tier. The Sol / "best" run was an experiment to see the model's ceiling.
- **No code check on the number of dishes in a slot.** Shape is a tracked score in Eval 2 only.
- No festival table, list or setup input. The weekly plan routine's prompt asks when a festival is near (§5.6).
- Prep reminders ("soak rajma tonight") come after this lands, in the day-before 7pm reminder.
- No general check-ins on whether the plan was followed. The only feedback ask is the next-day question about an untried dish (§5.7).
- Shopping, carts, regulars and reminders keep working on the new tables but are not redesigned here.
- Per-app scoping of household facts (all facts are sent) stays as decided; revisit when third-party apps publish.

---

## 2. Data model

### 2.1 Planner tables (new or changed)

All tables keep the kit columns (`id`, `created_at`, `updated_at`, `updated_by`).

**slots** — new; replaces `house.extra_slots` and the fixed Breakfast/Lunch/Dinner list.

| field | type | meaning |
|---|---|---|
| name | text, unique | "Breakfast", "Lunch", "Dinner", "Agastya's tiffin", "Grandfather's dinner" |
| kind | text | `main` \| `custom` \| `addon` |
| addon_of | text, null | for `addon`: the main slot it adds to ("Dinner") |
| usual_people | json string[] | names; empty = everyone at home |
| days | json weekday[] | empty = every day |
| skip_days | json [{ day, skip }] | recurring "Sunday lunch eaten out", "Saturday dinner ordered in" |
| order | int | planning order: Breakfast 10, custom-from-breakfast (tiffin) 20, Lunch 30, snacks 40, Dinner 50, add-ons 60+ |
| active | int | 1/0 |

Add-on slots exist so per-person needs (grandfather's 2 phulkas and no rice at night; a child's different dinner) are planned with their own constraints. Setup creates them from what the family said. Named by the person's name, or the family's own word for them ("Papa's dinner").

**slot_days** — replaces `plan_meals`. One row per slot per date in a planned week.

| field | type | meaning |
|---|---|---|
| date | text YYYY-MM-DD | |
| slot | text | slot name |
| people | json string[] | who it is for that day (computed, editable) |
| guests | json [{ count, rules?: string[] }] | unnamed guests for this meal only |
| occasion | text, null | "dinner party", in their words |
| new_dishes_allowed | int, null | override of the setting for this slot-day |
| skip | text, null | `eaten_out` \| `ordered_in` \| null |
| status | text | `planned` (a suggestion the family was shown; never read as eaten) \| `confirmed` (the family said what was made: a correction, `record_made`, or a "made it" answer, §5.7) |
| edited | int | 1 when the family changed it (never overwritten by a re-plan) |
| note | text, null | "Millet rice for Gowri Shankar only" |

Unique (date, slot).

**slot_dishes** — replaces `dishes`. The dishes made in a slot-day.

| field | type | meaning |
|---|---|---|
| slot_day_id | ref slot_days | |
| position | int | |
| dish | text | dish name (library key) |
| new | int | 1 when this was a new suggestion |
| feedback_asked | int | 1 once the next-day untried-dish question (§5.7) was sent for this placement; never asked twice for it |
| note | text, null | only when this dish needs a specific change for someone |

**ingredients** — `dish_items` renamed; `slot_dish_id` instead of `dish_id`. Same item/amount/unit.

**library** — replaces `dish_book` (ratings/videos keep their columns).

| field | type | meaning |
|---|---|---|
| key | text | normalised dish name (dishKey) |
| slot | text | the slot it is eaten at; one row per (dish, slot) |
| name | text | display name |
| frequency | text, null | `usually` \| `sometimes` \| `rarely` \| `"<n>/week"`; null = default (≤2 days) |
| days | json weekday[], null | only these days ("lemon rice on Friday") |
| contains | json string[] | open tag list: every item any rule names (`egg`, `meat`, `fish`, `onion_garlic`, `nuts`, `peanut`, `sugar`, `white_rice`, `dairy`, `root_veg`, `millet`, `mushroom`, `chicken`…) |
| contains_read | json string[] | which tags have been read for this dish (a rule tag not in here = unknown) |
| origin | text | `setup_named` \| `family_added` \| `planner_suggested` |
| suggested | int | 1 = a planner suggestion not yet kept; offered only as a new dish, not as a library dish |
| untried | int | 1 = the family hasn't eaten it yet: every `planner_suggested` dish, and `family_added` dishes saved from a reel or recipe link the family sent (Instagram/YouTube; link in `video_url`). 0 for dishes named in the interview (`setup_named`) or that the family says they already eat. Cleared by a "made it, liked it, again" answer (§5.7) |
| offers | int | times this untried dish was put on a plan; an untried dish with `offers ≥ 2` and no "made it" answer is dropped (never planned again) |
| disliked | int | 1 = the family made it and didn't like it; never suggested or planned again (kept so the planner doesn't re-invent it) |
| prep | text, null | later: "soak overnight", "ferment batter 8h" |
| video_url, rating, ratings… | as today | |

Unique (key, slot).

**rules** — replaces the `house.rules` JSON list with rows.

| field | type | meaning |
|---|---|---|
| hard | int | 1 hard (allergy, veg, avoid, fast, no sugar, Jain), 0 soft |
| what | text | `veg` \| `egg` \| `no_eggs` \| `avoid` \| `only` \| `swap` \| `require` \| `fasting` \| `cap` \| `note` |
| who | text, null | a person; null = everyone at that slot-day |
| slots | json string[], null | null = all slots |
| days | json weekday[], null | null = every day |
| items | json string[], null | tags/categories, e.g. ["white_rice"], ["@nuts"] |
| to | text, null | swap target ("millets") |
| frequency | text, null | soft only: `sometimes` (2–3/wk), `usually` (4–5/wk), `rarely` (≤1/wk), `"<n>/week"` |
| per_meal | int, null | cap: dishes per meal (cook limits) |
| fasting_food | json string[], null | fasting: what they may eat ("fruit", "sabudana") — empty = nothing |
| quote | text | the family's own words (required) |

**settings** (kit settings): `new_dishes_per_week` int, default 2 (decided default, tunable) (choices 0, 2, 4, 7 shown as "none / 1–2 / 3–4 / surprise me").

**house** keeps: cook fields (name, days, visits as reminder data; limits are `cap`/`note` rules attached to the cook's days, no separate cook entity for now), shopping apps, reminder times, notes, intro flags. Drops: `rules`, `extra_slots`, `order_in`, `meal_examples`, `cooking_days`, `meal_parts`.

### 2.2 Derived, not stored

- **History** = past `slot_days` (+ the seed examples, `status = confirmed`, date null, from setup). Past `planned` slot-days are what the family was **shown**, not what they ate.
- **Staples** of a slot = dishes appearing in ≥ 60% of that slot's last 14 history rows with dishes (seed counts; decided default, tunable). Staples are exempt from the repeat window. Computed at plan time.
- **Looks like** examples for a slot = up to 6 rows from the seed and **confirmed** slot-days only (recent confirmed first, then seed). Planned-only slot-days are never used as shape examples.
- **Recent** (repeat avoidance, §5.4 check 4) = past slot-days of any status, planned included: it avoids repeating what the family was shown.

### 2.3 Flock household additions (Flock owns; sent to apps)

| fact | shape | filled by |
|---|---|---|
| `household.people` (existing) | [{ name, group, age?, relationship?, nicknames?: [{ name, by?: speaker }] }] | household read (h1) + any chat |
| `household.weekly` (new) | [{ person, where: "office" \| "school" \| "college" \| "home" \| text, weekdays: weekday[], from?: "HH:MM", to?: "HH:MM", lunch?: "away" \| "carries" \| "home" \| null }] | household read of h4 (weekday answer); `lunch` filled when said |
| `household.dated` (new, fallback) | [{ person?, what, from: date, to?: date, slots?: string[] }] | chat, when no Family Calendar is installed |

No new household question: h4 ("What does a normal weekday look like?…") already asks it; only the read is structured.

### 2.4 Family Calendar read (new, minimal)

The Family Calendar app today has `add_events` only. Add one read op:

`get_events { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }` → `{ events: [{ title, date, end_date?, repeat, start_time?, end_time?, who?, notes? }] }` with repeats expanded inside the range.

The planner reads it through Flock (the Butler's app-to-app op call) at plan time. A small model call turns events into attendance changes only when an event's effect on meals isn't obvious ("Ankita work trip" → away all meals those days; "Nani visiting" → add to all slots). The family is asked only when that call is unsure. The result is shown in the plan message.

---

## 3. Replacing the old tables

No migration: the new interview format is unreleased and no family has it. The new tables replace the old ones (`plan_meals`, `dishes`, `dish_items`, `dish_book`, `house.rules`, `house.extra_slots`, `house.order_in`, `house.meal_examples`) outright; dev and test data can be reset. The old operations are removed now, with no adapters and no one-release transition.

---

## 4. Setup — `apply_setup` v2

Op unchanged in name and input: `apply_setup { household, transcript }` (Flock sends all household facts incl. `household.people`, `household.weekly`, `household.speaker`; transcript = `Q:`/`A:` lines of the planner part).

### 4.1 Reads (model, balanced unless stated; in parallel, 150 s budget)

1. **home** → `{ slots: [{ name, kind, addon_of?, usual_people, days, skip_days }], cook: { name, days, visits, limits_words? } | null, family_cooks: [{ person, days }], apps, subscriptions, lunch_unclear?: [person] }`
   - Add-on slot when one person's meal at a slot is always different ("father has two phulkas, no rice at night", a child's different dinner), so it is planned with its own constraints; it holds only the difference and is named by the person's name or the family's word for them.
   - Weekday lunch attendance from `household.weekly` + replies; `lunch_unclear` lists people whose weekday lunch can't be told.
2. **rules** → `{ rules: [{ hard, what, who?, slots?, days?, items?, to?, frequency?, per_meal?, fasting_food?, quote }], unplaced: [{ text, quote }] }`
3. **dishes** → `{ library: [{ name, slot, frequency?, days?, quote }], seed: [{ slot, dishes: string[], quote }] }`
   - `seed` = each "past week" answer turned into example slot-days ("Rice, Sambar, Beans poriyal, Curd").
   - A dish belongs to an add-on slot only when the family's sentence names the person.
4. **contains** (fast, after 1–3, batched ≤40 dishes per call) → `{ "<dish>": { "<tag>": true|false } }` for every tag any rule names + the base tags.

All prompts use a made-up example family (name guard test). Nicknames: the reads get `household.people[].nicknames` and return names, never nicknames.

### 4.2 Code checks (structure only, no word lists)

- Every rule's `quote` is in the family's replies or household facts (normalised substring), else dropped.
- Hard `what` never carries `frequency`; `no sugar` → hard `avoid ["sugar"]`.
- Names in `who`/`usual_people` must be in `household.people` (or a named guest); unknown → read-back asks.
- Slot names in rules/library must exist; a word naming exactly one slot resolves to it.
- Library `frequency`/`days` must be backed by the dish's `quote` containing a day or count (the **lint**: a quote with a day word or a number and nothing saved → one re-read of that dish).
- `contains_read` records which tags were read; missing → unknown (blocks, see 5.4).

### 4.3 Write order

people (names only) → slots (incl. add-ons, skip_days) → rules → library → seed history → cook → apps/subscriptions → settings defaults.

### 4.4 Read-back (`said`)

Plain words, one message, then "Anything to change?":
- People at home; the cook and days ("The family cooks on Sunday").
- Slots per day, with who: "Each day: Breakfast, Lunch, Dinner, plus Agastya's tiffin Mon–Fri, and phulkas for Gowri Shankar at dinner."
- **Weekday lunch line**: "Weekday lunch is for Ankita, Agastya and Gowri Shankar; Shiva's at the office."
- Meals eaten out / ordered in.
- Rules per person; soft ones with their frequency ("millets 2–3 times a week").
- "Noted, not checked" list.
- If `lunch_unclear`: one question instead of "Anything to change?" ("Does Shiva take lunch to work?").

### 4.5 Corrections — diff-apply

A reply that changes something re-runs the reads with the reply appended. Code diffs the new result against what is saved and applies only items whose quote is in the **new** reply (or that the new reply contradicts by name/slot). Unrelated differences are discarded and logged. The read-back says only what changed.

---

## 5. Weekly plan — `make_plan` v2

Op unchanged: `make_plan { week_start }` → `{ ok, message, intro?, unmet?, asked? }`.

### 5.1 Build slot-days (code)

For each active slot × each date of the week (skipping `slots.days`):
`people = usual_people (or all) − weekly absences (household.weekly: away at that slot that weekday) ± calendar/dated events − fasting (rules what=fasting with no fasting_food) ; skip = slots.skip_days for that weekday`.
A person fasting **with** `fasting_food` stays and gets a fasting note. One-off changes already saved on a slot-day (`edited`) are kept as is.
Calendar: `get_events` for the week via Flock; events → people changes (code for "<name> visiting/staying/away" when `who` and dates are clear; a small fast call otherwise). Still unsure after that call → `asked` in the result, planned with usual people.

### 5.2 Feasibility pre-check (code, per slot)

Non-staple library dishes allowed this week (rules, days, frequency) vs non-staple places to fill (slot-days × typical non-staple count, taken from the interview seed and confirmed slot-days only, never planned-only ones, owner 23 Nov). If short: allow extra new dishes for that slot up to the setting, then widen the repeat window from 3 to 2 days, then note "only N lunch dishes known" in `unmet`. Order of relaxing is fixed and logged.

### 5.3 Ordered slot calls (model, balanced)

Order by `slots.order`; breakfast → tiffin → lunch → snacks → dinner → add-ons. Calls for slots that don't depend on each other may overlap, never more than 3 at once. Each call covers the whole week for that slot.

Request (JSON user message):
```json
{
  "slot": "Lunch",
  "days": [
    { "date": "2026-11-30", "for": ["Ankita","Agastya","Gowri Shankar"] },
    { "date": "2026-12-03", "for": ["Ankita","Agastya"], "why": "Gowri Shankar fasts till evening" },
    { "date": "2026-12-06", "skip": "eaten_out" }
  ],
  "looks_like": ["Rice, Sambar, Beans poriyal, Curd", "Rajma chawal, Curd"],   // seed + confirmed only
  "staples": ["Rice", "Curd"],
  "library": [{ "dish": "Rajma chawal", "left": 2 }, { "dish": "Bisi bele bath", "days": ["Sat"] }, …],
  "already_this_week": { "Breakfast": {"2026-11-30": ["Idli","Chutney"]}, "Agastya's tiffin": {…} },
  "recent": { "2026-11-29": ["Bisi bele bath","Curd"] },   // planned or confirmed: what they were shown
  "rules": ["Gowri Shankar: no sugar", "Gowri Shankar: millets in place of white rice, 1 more this week in this slot", "everyone: vegetarian, no eggs, no mushrooms"],
  "notes_for_people": ["less spicy for Agastya"],
  "new_dishes_allowed": 1,
  "occasion": null
}
```
Response schema:
```json
{ "days": { "2026-11-30": ["Rice","Sambar","Beans poriyal","Curd"], … },
  "new": [{ "dish": "Cabbage poriyal", "why": "a dry sabzi like Beans poriyal" }],
  "notes": { "2026-12-03": "Millet rice for Gowri Shankar only" } }
```
Add-on calls also get their main slot's dishes per day.

### 5.4 Code checks (after each slot call)

1. Every dish is in that slot's library, a staple, or listed in `new` within `new_dishes_allowed` (week budget across slots). A `disliked` dish is never allowed; a dropped untried dish (`untried = 1`, `offers ≥ 2`) is not planned again.
2. Hard rules for every person on that slot-day: rule `items` vs dish `contains`. **Fail closed**: a dish whose needed tag isn't in `contains_read` can't go to that person; new dishes get a contains read before the check.
3. `days` and `frequency` per dish, counted across all slots for the week.
4. Repeat window: non-staple dish not within 3 days of itself in this slot; for mains it applies across main slots (no same main twice in a day across slots). Staples are exempt.
5. Soft rule counts within their range across the week (too many = problem; too few = soft problem).
Problems → one fix call for that slot with the exact list; still failing → that slot-day filled by rotation from allowed library dishes (code), noted. A failed call never retries in a loop; out-of-credits/daily budget stops the plan with the existing message.

### 5.5 Ingredients and save

Fast call per day (as today); remove items a person on that slot-day must avoid; save `slot_days` (status planned), `slot_dishes`, `ingredients` in one transaction; new dishes are saved with origin `planner_suggested`, `suggested = 1`, `untried = 1`; each placement of an untried dish (new or from a reel) adds 1 to `offers`. Nothing is promoted at the end of the week: an untried dish becomes a regular library dish only through the next-day answer (§5.7).

### 5.6 Message

Week by day; "All week:" standing notes said once (soft notes per person); `unmet`; "New this week: …"; calendar `asked` items; a festival question when one is near.

Festivals are handled by the weekly plan routine's prompt, not by a table or list. The routine knows the date and the household (people's names and anything the family said about fasts or observances; inferring tradition from names is fine). If a festival or observance this family likely keeps falls in the coming week, the message asks whether to change anything ("Navratri starts around Thursday. Want any changes?"). It checks the date with a calendar or search tool when the routine has one, and always phrases it as a question, because lunar dates can be off. The family's answer comes back as ordinary later changes (§6).

---

### 5.7 Next-day question about an untried dish (the only feedback ask)

The plan is a suggestion (§1), so the planner never asks whether the plan was followed. It asks about one thing only:
**dishes the family hasn't eaten before** (`untried = 1`): the planner's own new suggestions (`planner_suggested`) and
dishes the family sent as an Instagram/YouTube reel or recipe link (`family_added` from a saved link). Dishes named in
the interview are never asked about. In the next day's message (the existing day reminder), for each untried dish on
**yesterday's** plan whose placement has `feedback_asked = 0`, it adds one line:

> planner suggestion: "Yesterday's plan had <dish>, which was new. Did you make it, did you like it, and should I suggest it again?"
>
> from a reel/link: "Yesterday's plan had <dish> from the reel you sent. Did you make it, did you like it, and should I keep suggesting it?"

Several untried dishes from yesterday → one line each in the same message. `feedback_asked = 1` once sent. The Butler
reads the reply and calls `record_feedback` (§6). Outcomes (code applies them, same for both kinds):

| answer | effect |
|---|---|
| made + liked + suggest again | regular library dish (`untried = 0`, `suggested = 0`); that slot-day `confirmed` |
| made + didn't like | `disliked = 1`; never suggested or planned again; that slot-day `confirmed` |
| made + liked, but not again | dropped (`offers` set to 2), so not planned again unless the family asks for it; that slot-day `confirmed` |
| not made | stays untried; may be planned once more later (`offers < 2`), then dropped |
| no reply | stays untried; nothing assumed; slot-day stays `planned`; not asked again for that placement |

Corrections the family volunteers in chat ("we made khichdi instead") still mark that slot-day confirmed (`record_made`).

---

## 6. Later changes (Butler → planner ops)

| op | payload | effect |
|---|---|---|
| `set_slot` | { name, kind?, addon_of?, usual_people?, days?, skip_days?, remove? } | add/change a slot; re-plan this week's affected slot-days |
| `set_slot_day` | { date, slot, people?, add_people?, remove_people?, guests?, occasion?, new_dishes_allowed?, skip?, dishes? } | one-off change; marks `edited`; re-plans only that slot-day unless `dishes` given |
| `add_dish` | { name, slot, frequency?, days?, quote?, link? } | library add (origin family_added) + contains read; with `link` (a reel/recipe the family sent) the dish is saved `untried = 1`, link in `video_url` |
| `set_rule` | { …rule fields, remove? } | add/change/remove; re-checks this week; re-plans failing slot-days only |
| `set_setting` | { new_dishes_per_week } | |
| `record_made` | { date, slot, dishes } | volunteered correction ("we made khichdi instead") → slot-day dishes replaced, status confirmed |
| `record_feedback` | { date, slot, dish, made, liked?, again? } | answer to the next-day untried-dish question (§5.7), planner suggestions and reel dishes alike: regular library dish / `disliked` / stays untried, per the §5.7 table |

Re-plans never overwrite `edited` slot-days. A change typically re-plans only the next day or only the touched slot-days. There is no re-plan cap; the app's existing daily model budget is the only guard against runaway loops. Old ops (`set_meal`, `set_family_dishes`, `set_slots`, `set_house_rules`, `plan_week`, `plan_menu`) are removed now (§3).

---

## 7. Flock changes

- **Household read**: h1 also returns `nicknames` per person when said; h4 is read into `household.weekly` (structured). Nicknames said anywhere later are saved by the Butler (`remember` into household facts).
- **Dated facts** fallback: the Butler saves "Nani is staying 1–14 Dec" as `household.dated` when no Family Calendar is installed; with the calendar, it adds the event there.
- **apply_setup / make_plan**: already send all household facts; no change beyond the new keys.
- **Calendar read path**: Flock's app-to-app op call lets the planner call `family-calendar:get_events` (owner's paired agent identity); if the calendar isn't installed the planner uses `household.dated`.
- Interview runner: unchanged (setupApply path).

---

## 8. Evals

- **Eval 1 (setup)**: score slots (incl. add-ons) and usual people; weekday attendance; library per slot with **personal-vs-shared placement** and **days/frequency per dish**; rules (hard/soft, quote, no unsaid rules); seed history present per main slot; contains accuracy on a labelled dish set.
- **Eval 2 (plan)**: true setup loaded as slots/library/rules/seed; score every slot-day filled, hard rules per person (fail-closed respected), frequency/days, repeat window (staples exempt), cross-slot counts, attendance (office lunch, fasts, guests, stays); **shape tracked** (dish count vs history, not gating); blind judges (2 vendors) + pairwise.
- **Perturbations**: thin library, no seed, misfiled dishes, a person's dishes on the wrong slot, missing contains tags.
- **Held-out households h9–h12**, written separately, run only at milestones. Scored runs use fresh chats.
- **Guards (tests)**: no eval household name in any model-facing text; **no new word lists** in setup/plan code (a test fails on new regexes of day names, kinship words or "less/more" inside setup.ts/makePlan.ts outside an allowlisted constants file); the day/count lint (4.2).

---

## 9. Build lanes

| lane | repo | content | depends on | effort | acceptance |
|---|---|---|---|---|---|
| A. Schema | planner | tables §2, old tables and ops removed §3 | — | 0.5–0.75 d | fresh install creates the new tables; old ops gone; suite green |
| B. Setup v2 | planner | reads, checks, write order, read-back, diff-apply §4 | A | 1.5 d | Eval 1 ≥ current on h1–h8; personal placement and day/frequency ≥ 85% |
| C. Plan v2 | planner | §5 incl. feasibility, ordered calls, checks, message (festival question in the routine prompt) | A | 2 d | Eval 2: hard rules 100%, filled 100%, frequency ≥ 95%, judge overall ≥ 3.0 on balanced; unit test: `looks_like` holds only seed + confirmed rows, `recent` includes planned; disliked/dropped dishes never planned |
| D. Later-change ops + untried-dish question | planner | §6, §5.7 (line in the next-day reminder) | A, C | 0.75–1 d | unit tests; re-plan keeps edited slot-days and touches only the changed slot-days; next-day message asks only about yesterday's untried dishes (planner suggestions and reel/link dishes, never interview-named ones), once per placement, with the reel wording for reel dishes; each §5.7 outcome applied; no other "did you cook it" prompt anywhere |
| E. Flock household | flock | weekly patterns, nicknames, dated fallback, calendar op path §7 | — | 1 d | runner/household tests; facts visible to apps |
| F. Calendar read | family-calendar | `get_events` §2.4 | — | 0.25 d | op test |
| G. Evals | planner | §8, households h9–h12, guards | A (shapes) | 1 d | both evals run on new shapes; held-out set committed |

Parallel: A, E, F, G start together; B and C after A; D after C. Then the WhatsApp sim batch (5 mixed runs, two stacks) for acceptance.

## 10. Decided defaults (owner, 23 Nov; tunable)

1. Staple = a dish in ≥ 60% of a slot's last 14 meals.
2. Add-on slots named by the person's name, or the family's own word for them ("Papa's dinner").
3. Repeat window applies across main slots for mains (no same main twice in a day across slots); staples exempt.
4. New dishes default 2 a week. A plan is a suggestion: a dish the family hasn't eaten (a planner suggestion, or a dish from a reel/recipe link they sent) becomes a regular library dish only when the family answers the next-day question "made it, liked it, again"; made and disliked → never again; not made → planned once more later, then dropped; no reply → stays untried, nothing assumed (§5.7). Interview-named dishes are never asked about.
5. Calendar events with unclear meal effect → a small model call; ask the family only if it's unsure.
6. Cook limits are rules attached to the cook's days; no separate cook entity for now.
7. Festivals: no table or list; the weekly plan routine's prompt asks (§5.6).
8. No migration; old tables and ops removed now (§3).
9. No re-plan cap; the daily model budget is the guard (§6).
10. Planned slot-days are suggestions: shape examples (`looks_like`) use only the seed and confirmed slot-days; repeat avoidance may use planned ones. No general check-ins; volunteered corrections confirm a slot-day (§1, §2.2).

Open questions: none.
