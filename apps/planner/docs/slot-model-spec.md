# Meal Planner: slot model — build spec

Status: for owner review, 23 Nov 2026. Source of truth for the design: the design page
(https://claude.ai/artifact/G6kUr6SWuXe75wQoCLNmHD). This file turns it into what to build.

Principle throughout: **the model reads words and fills slots; code stores, counts and checks rules.**
No model writes app payloads mid-chat; no code matches phrases ("Amma", "weekend") to decide meaning.

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
- No festival input at setup. The weekly plan message asks when a festival is near.
- Prep reminders ("soak rajma tonight") come after this lands, in the day-before 7pm reminder.
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
| status | text | `planned` \| `confirmed` (history) |
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
| note | text, null | only when this dish needs a specific change for someone |

**ingredients** — `dish_items` renamed; `slot_dish_id` instead of `dish_id`. Same item/amount/unit.

**library** — replaces `dish_book` (rows move; ratings/videos keep their columns).

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

**settings** (kit settings): `new_dishes_per_week` int, default 2 (choices 0, 2, 4, 7 shown as "none / 1–2 / 3–4 / surprise me").

**house** keeps: cook fields (name, days, visits as reminder data, limits as `cap`/`note` rules), shopping apps, reminder times, notes, intro flags. Drops: `rules`, `extra_slots`, `order_in`, `meal_examples`, `cooking_days`, `meal_parts`.

### 2.2 Derived, not stored

- **History** = past `slot_days` (+ the seed examples, `status = confirmed`, date null, from setup).
- **Staples** of a slot = dishes appearing in ≥ 60% of that slot's last 14 history rows with dishes (seed counts). Staples are exempt from the repeat window. Computed at plan time.
- **Looks like** examples for a slot = up to 6 recent rows: confirmed first, then seed, then planned.

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

The planner reads it through Flock (the Butler's app-to-app op call) at plan time. A model call turns events into attendance changes only when an event's effect on meals isn't obvious ("Ankita work trip" → away all meals those days; "Nani visiting" → add to all slots). The result is shown in the plan message.

---

## 3. Migration (existing installs and data)

Run once per install on upgrade (planner minor version bump), in a transaction; keep old tables renamed `_old_*` for one release.

| from | to |
|---|---|
| Breakfast/Lunch/Dinner (implicit) | `slots` rows kind `main`, usual_people = all active people |
| `house.extra_slots` | `slots` kind `custom`, `usual_people` = `for`, `days` |
| `house.order_in` | `slots.skip_days` on the matching slot: [{ day, skip: ordered_in \| eaten_out }] |
| `plan_meals` | `slot_days` (people = everyone eating then, status `confirmed` for past dates, `planned` for future) |
| `dishes` | `slot_dishes`; `for_people` restricted dishes: if the restriction is one person consistently on that slot → create an `addon` slot "<Name>'s <slot>" and move it there; otherwise drop the restriction (it was usually a bug) and keep the dish shared |
| `dish_items` | `ingredients` |
| `dish_book` | `library`: one row per (dish, each slot in `slots`); `eaten_by` single person on a main slot → library row on that person's add-on slot; `often`→`frequency`, `per_week`→`frequency "<n>/week"`, `days` kept; `contains` read by the batch tagger on first plan |
| `house.rules` | `rules` rows (hard = kind is a checked kind and no `often`; quote = `note` or "(from before)") |
| `house.meal_examples` | seed history rows (status confirmed, date null) per slot |
| `people` (planner) | stays as the planner's name list; on next setup/plan the Flock household is the source |

Existing installs with no setup transcript keep working: migration + the batch tagger + the first plan.

---

## 4. Setup — `apply_setup` v2

Op unchanged in name and input: `apply_setup { household, transcript }` (Flock sends all household facts incl. `household.people`, `household.weekly`, `household.speaker`; transcript = `Q:`/`A:` lines of the planner part).

### 4.1 Reads (model, balanced unless stated; in parallel, 150 s budget)

1. **home** → `{ slots: [{ name, kind, addon_of?, usual_people, days, skip_days }], cook: { name, days, visits, limits_words? } | null, family_cooks: [{ person, days }], apps, subscriptions, lunch_unclear?: [person] }`
   - Add-on slot only when one person's meal at a slot is always different ("father has two phulkas, no rice at night"); it holds only the difference.
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
Calendar: `get_events` for the week via Flock; events → people changes (code for "<name> visiting/staying/away" when `who` and dates are clear; a small fast call otherwise). Unclear → `asked` in the result, planned with usual people.

### 5.2 Feasibility pre-check (code, per slot)

Non-staple library dishes allowed this week (rules, days, frequency) vs non-staple places to fill (slot-days × typical non-staple count from history). If short: allow extra new dishes for that slot up to the setting, then widen the repeat window from 3 to 2 days, then note "only N lunch dishes known" in `unmet`. Order of relaxing is fixed and logged.

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
  "looks_like": ["Rice, Sambar, Beans poriyal, Curd", "Rajma chawal, Curd"],
  "staples": ["Rice", "Curd"],
  "library": [{ "dish": "Rajma chawal", "left": 2 }, { "dish": "Bisi bele bath", "days": ["Sat"] }, …],
  "already_this_week": { "Breakfast": {"2026-11-30": ["Idli","Chutney"]}, "Agastya's tiffin": {…} },
  "recent": { "2026-11-29": ["Bisi bele bath","Curd"] },
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

1. Every dish is in that slot's library, a staple, or listed in `new` within `new_dishes_allowed` (week budget across slots).
2. Hard rules for every person on that slot-day: rule `items` vs dish `contains`. **Fail closed**: a dish whose needed tag isn't in `contains_read` can't go to that person; new dishes get a contains read before the check.
3. `days` and `frequency` per dish, counted across all slots for the week.
4. Repeat window: non-staple dish not within 3 days of itself in this slot (or anywhere, for mains in main slots).
5. Soft rule counts within their range across the week (too many = problem; too few = soft problem).
Problems → one fix call for that slot with the exact list; still failing → that slot-day filled by rotation from allowed library dishes (code), noted. A failed call never retries in a loop; out-of-credits/daily budget stops the plan with the existing message.

### 5.5 Ingredients and save

Fast call per day (as today); remove items a person on that slot-day must avoid; save `slot_days` (status planned), `slot_dishes`, `ingredients` in one transaction; new dishes join the library with origin `planner_suggested` only when the family keeps them (end of week, not removed).

### 5.6 Message

Week by day; "All week:" standing notes said once (soft notes per person); `unmet`; "New this week: …"; festival question when a known festival falls in the week ("Navratri starts Thursday. Should I change anything for it?") — the festival list is a dated table in the planner (no setup input); calendar `asked` items.

---

## 6. Later changes (Butler → planner ops)

| op | payload | effect |
|---|---|---|
| `set_slot` | { name, kind?, addon_of?, usual_people?, days?, skip_days?, remove? } | add/change a slot; re-plan this week's affected slot-days |
| `set_slot_day` | { date, slot, people?, add_people?, remove_people?, guests?, occasion?, new_dishes_allowed?, skip?, dishes? } | one-off change; marks `edited`; re-plans only that slot-day unless `dishes` given |
| `add_dish` | { name, slot, frequency?, days?, quote? } | library add (origin family_added) + contains read |
| `set_rule` | { …rule fields, remove? } | add/change/remove; re-checks this week; re-plans failing slot-days only |
| `set_setting` | { new_dishes_per_week } | |
| `record_made` | { date, slot, dishes } | "we made khichdi instead" → slot-day dishes replaced, status confirmed |

Re-plans never overwrite `edited` slot-days. Old ops (`set_meal`, `set_family_dishes`, `set_slots`, `set_house_rules`, `plan_week`, `plan_menu`) are kept as thin adapters for one release, then removed.

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
| A. Schema + migration | planner | tables §2, migration §3, adapters for old ops | — | 1–1.5 d | migration test on a copy of a sim DB; suite green |
| B. Setup v2 | planner | reads, checks, write order, read-back, diff-apply §4 | A | 1.5 d | Eval 1 ≥ current on h1–h8; personal placement and day/frequency ≥ 85% |
| C. Plan v2 | planner | §5 incl. feasibility, ordered calls, checks, message | A | 2 d | Eval 2: hard rules 100%, filled 100%, frequency ≥ 95%, judge overall ≥ 3.0 on balanced |
| D. Later-change ops | planner | §6 | A, C | 0.5–1 d | unit tests; re-plan keeps edited slot-days |
| E. Flock household | flock | weekly patterns, nicknames, dated fallback, calendar op path §7 | — | 1 d | runner/household tests; facts visible to apps |
| F. Calendar read | family-calendar | `get_events` §2.4 | — | 0.25 d | op test |
| G. Evals | planner | §8, households h9–h12, guards | A (shapes) | 1 d | both evals run on new shapes; held-out set committed |

Parallel: A, E, F, G start together; B and C after A; D after C. Then the WhatsApp sim batch (5 mixed runs, two stacks) for acceptance.

## 10. Risks and open questions for the owner

1. Staple threshold (60% of the last 14 rows) — fine as a start?
2. Add-on slot naming shown to the family ("Grandfather's dinner") — or "Gowri Shankar's dinner"?
3. Repeat window scope: per slot, or across all main slots for mains (dosa at breakfast and dinner same day)?
4. `new_dishes_per_week` default 2, and whether new dishes join the library automatically when not removed by Sunday.
5. Festival list: a dated table in the planner for the family's region/tradition — which traditions to start with?
6. Calendar → attendance: allow a small model call for unclear events, or always ask?
7. Migration of per-dish eaters: auto-create add-on slots, or drop restrictions and let the next setup re-read decide?
8. Old ops kept as adapters for one release — OK to remove after?
9. Budget: ordered calls ≈ 5–6 balanced + 7 fast + fixes per week; within the 300/day app budget, but re-plans on every chat change add up — cap re-plans per day?
10. Cook limits (≤2 dishes, an hour) as `cap`/`note` rules: enough, or a cook entity with checked limits?
