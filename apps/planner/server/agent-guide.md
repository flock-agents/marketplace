# Meal Planner — the agent's guide

The Meal Planner app owns meals, recipes, the shopping list, drafts and orders, kitchen stock and every shopping
preference. You never keep any of that in memory or chat, never guess quantities, and never build a cart from a chat
message alone. Every meal/grocery/pantry request, in every chat, starts by reading the app; every change goes through an
operation; then tell the family what the app now says, not what you think it says.

Call an operation: `flock-api POST /api/apps/<this app>/ops/<name> '<json>'`. Read rows (never write them) at
`/a/<this app>/api/_data/<table>` (`?col=value` filters; fields at `/_schema`). Write a row directly only when no
operation makes that change (e.g. a meal's coach_check, a diner's targets).

## How the family wants this to work

- **Lazy by design.** Nothing needs their input; silence means "carry on as planned". Infer, then let them correct.
- **Few messages.** You message the family only when a shopping-window wake asks you to (at most 3 per window), or when
  they talk to you. Background work never messages anyone.
- **Never ask about background facts** (shelf life, recipe ingredients, pack sizes, which recipe a dish is): make an
  informed guess and save it in the app. A correction from them is data for next time.
- **Only a family member's explicit yes places an order.** Never answer your own question; silence, a routine wake or
  your own message is never a yes.

## Meals = recipes + a note

Each meal links to one or more recipes and may carry a free-text `note`; `dish` is only the label. The app computes the
rough shopping need from the recipes; you review it against the note (the `review_meal` job).

- `save_meal` `{meal_id?, date, slot, dish, note?, time?, outcome?, outcome_source?, coach_check?, coach_notes?}` — creates
  (no meal_id) or changes a meal. `remove_meal` `{meal_id}`.
- `set_meal_recipes` `{meal_id, recipes:[{recipe_id, servings?}]}` — the meal's recipe set, in order.
- When the plan changes (leftovers, eating out, a swap, guests), change the **recipes and note**, not just the dish text —
  e.g. Fri lunch → recipes `[Puri aloo sabzi]`, note `"leftovers from tonight"`.
- **Only you add recipes.** `search` `{q}` first for the same dish under another spelling ("Poori aloo sabzi" = "Puri aloo
  sabzi"); only if none exists, `write_recipe` `{name, method?, lines:[{ingredient_id, item, qty_per_adult, unit,
  category}]}` (one regular adult portion; reuse catalog ingredients — search them too). `write_recipe` `{recipe_id,
  lines}` adds lines to an existing recipe.
- **What happened to a meal:** the app assumes a meal was cooked once its latest time passes (breakfast 11:00, lunch 15:00,
  dinner 23:00 by default). When the family says otherwise ("we ate out", "skipped lunch"), `save_meal` `{meal_id,
  outcome:"skipped", outcome_source:"owner"}` (or change its recipes and note for a swap).

## Background jobs: answer, never ask

The app's **Background jobs** routine wakes you with the open jobs (`list_jobs` lists them; a job with `facts_at` has its
facts at that path). Answer each: `answer_job` `{job_id, answer:{…}}`, then any `more_jobs` the reply lists. A 400 says
what to fix; a 409 means the job went stale — skip it. Never message the family about a job.

- **review_meal** — dish, note and recipe lines are in the facts. Answer `{adjustments:[{ingredient_id, action:
  "drop"|"scale"|"add", factor?, qty?, unit?, reason}], recipes?:[{recipe_id, servings?}]}`. `recipes` only when the set is
  wrong for the dish (required when the meal has none yet); `adjustments: []` when the recipes are right as they are.
- **fill_recipe** — a planned recipe has no ingredient lines: `write_recipe` `{recipe_id, lines}`, then answer `{}`. The app
  refuses until every line has a catalog ingredient and a quantity.
- **find_patterns** — recent choices, learned prefs, meals and orders. Answer `{patterns:[{id?, kind:
  drop_item|add_item|service|swap|meal_latest|order_window|taste|engagement_time, subject?, summary (one line), rule,
  confidence 0..1, evidence:[choice ids], auto_apply}], retire?:[learned_pref ids]}`. Rule shapes the app applies:
  `service` → `{service, unless_cheaper_by}` (₹); `engagement_time`, `meal_latest`, `order_window` → `{time:"HH:MM", …}`.
  Set `auto_apply` only when the evidence clearly agrees; never re-add a pattern the owner switched off.

Background facts the same way: an ingredient's **shelf life in this home** — `set_shelf_life` `{ingredient_id,
shelf_life_days, note}` from the city, its weather and season, and how the family stores it.

## The shopping window

Each window has one **draft** that stays live until a yes: it follows the meals and the family's edits. A yes freezes it;
it becomes ordered, or is let go quietly when no yes comes (or skipped by the family). Its items move to the next draft
only if a meal they're for is still after that order arrives; the family's own additions always move.

`get_draft` → `{draft:{id, order_at, span:{label:"Thu breakfast → Sat dinner"}, lines, removed, quotes, best, yes,
next_message, …}}`. Always quote the span when sharing a list.

The app's **Shopping timeline** routine wakes you for exactly these messages; each wake names its slot and a message id.
Send that one message, then `ack_message` `{message_id}`. Send nothing else.

1. **reminder** (evening before): what's due and when, with the span. If `data.pantry_check` lists items, add ONE short
   question about the few that matter for the coming meals ("For this week's dal tadka and rajma — enough toor dal and
   rajma?"). Post their answer: `pantry_answer` `{items:[{ingredient_id, have:"yes"|"low"|"out"}]}` (unmentioned = yes).
2. **heads_up** (15 min before): post `data.card` as is (a Checklist of the draft, all ticked) with "Anything to cancel or
   add?". Unticked ids → `edit_draft` `remove`; named items → `add`.
3. **price** (at the order time): fill a cart on each service in `data.services` (below), post each with `add_quote`
   `{cart_id, service, total, fees?, lines?, screenshot_url?}`, then share the app's `best` service, the rough total and the
   screenshot, and ask once for a yes.

Chat edits, any time before the yes — then reply with the draft as the app now has it:

- add / drop / restore: `edit_draft` `{add:[{item:"curd"}], remove:["onion"], restore:[…]}`
- move the window: `move_window` `{order_at:"2026-11-01T18:00"}` (the reply lists meals it can't reach in time)
- "we already have X": `have_item` `{ingredient_id, item, use_by?}`
- "we're out of X" / "running low": `pantry_answer` `{items:[{ingredient_id, have:"out"}]}`
- what's at home: `pantry`

**On a yes** (from chat): `record_yes` `{cart_id, service, by}`, place the order, then record it immediately:
`record_order` `{cart_id, service, total, order_ref, delivery_eta}`. When the page's "Order with …" wakes you, the yes is
already recorded: place it with that service and record it; don't ask again. An order placed on a service but missing
from the app is a bug, not done. "Skip this order" from chat: `skip_order` `{cart_id}`.

## Building a service cart

For each draft line, use the ingredient's `prefs`, falling back to the `prefs.category_defaults` setting for its category:

- **Pack:** the pack(s) whose total lands in the line's range and within `pack_min…pack_max` (`pack_unit`); convert with
  `unit_conversions`. Never exceed the top of the range "to be safe".
- **Price:** `cheapest` = lowest ₹/unit; `balanced` = cheapest among `brands_preferred`, else mid-priced; `premium` =
  best-rated / preferred brand. Never pick from `brands_avoid`.
- **Substitutions:** `allowed` — swap and mark `substituted: true`; `ask` — leave it out and say so; `never` — leave it out.
- **service:** if not `any`, only that service may supply the line. **never_auto_add:** only if named in this conversation.
- Flag (don't add) a price more than `price.jump_pct` above usual; say when the cart crosses `spend.weekly_limit`.
- Follow the ingredient's free-text `notes`.

**Verify after adding:** run `view-cart` on the service and compare line by line with what you meant. A connector's
`success` is not proof. Report every mismatch before asking for the yes; never present an assumed cart. A connector error
that is only `skill-sandbox: WARN: failed to set memory limit …` is noise — read the script's own result code.

**Paying:** after the yes, `checkout` and the payments skill for UPI. Ask again only if the total changed.
