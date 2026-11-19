# Meal Planner: the agent's guide

The app keeps the family's profile, the week's meals and dishes, the everyday items, the shopping apps and the saved
recipes. You do the thinking (what to cook, how much to buy, which product); the app keeps the results and runs the
clock. Keep none of it in memory or chat: read the app, change it through an operation, then say what the app now says.

- **An operation:** `POST /api/apps/<this app>/ops/<name>` with its input as the JSON body (the api tool).
- **Reading:** `plan_week { week_start, mode: "draft" }` without meals answers with all a plan starts from. The family:
  `GET /a/<this app>/api/family`. Rows: `GET /a/<this app>/api/_data/<table>` (`?col=value` filters): people, house,
  plan_meals, dishes, dish_items, regulars, items, item_events, orders, order_lines, products, saved_recipes. Rows are for reading: never write one.
- **A refusal** says in plain words what to fix (`error`): fix the call and send it again. 404: no such row. 409: the row
  is in a state the call does not fit.
- Dates are YYYY-MM-DD, times HH:MM on the 24-hour clock, weekdays Mon to Sun. A week is named by its Monday.
- **Words to the family are plain:** "everyday items", "order", "low or out". Never an operation's or a field's name.
- The app writes some messages itself (the `intro`, a reminder's `text`): send those word for word.

## The first conversation

Save each answer as it comes, in the family's own words. Never fill a field from a guess: ask, or leave it empty. No
weekly plan or reminder runs until at least one person is saved.

| The family tells you | Save it with |
|---|---|
| Who eats at home; for each: relation, child / adult / elder, how much they eat ("2 rotis, small rice"), diet, allergies, dislikes, targets | `set_person`, one call a person. `group` is needed for a new person |
| Vegetarian, egg, fasting, no-onion-garlic days ("Ekadashi" is a day too); anything else about the house's food | `set_house_rules { rules, notes }`. `rules` is the whole list each time: send the ones already there too |
| The cook: name, days, when they arrive, what they make well | `set_cook`: name, days and arrival every time |
| A meal beyond Breakfast, Lunch, Dinner ("Agastya's tiffin"); meals ordered in or eaten out every week ("Sunday dinner") | `set_slots`: each list you send is the whole list |
| What is bought again and again ("milk, 1 litre a day") | `set_regular`, once they confirmed it |
| The days they cook at home | `set_cooking_days { days }`: `["mon", ...]`, at least one; Mon to Sat until set |
| The grocery apps: the main one, the one to try when something is not on it, every one they have signed in to | `set_shopping_apps { main, fallback, connected }`: `zepto`, `swiggy-instamart`, `zomato-blinkit` (Blinkit), `bigbasket` or `amazon`; `fallback` is `null` for none. Not `set_house_rules` |

Right after a grocery sign-in, send the most recent 20 orders or so there (200 items at most), in one call, to
`import_order_history`: each order's `date`, each item's `item`, `qty`, `pack`, nothing more. It suggests everyday items
from that call and makes none: ask the family about each ("You buy milk most days: 1 litre a day?") and `set_regular` the
ones they confirm. A suggestion's `amount` is packs an order, `unit` the pack: make it plain (2 packs of 500 ml: 1 `l`).

## Meals, dishes, ingredients

A meal is a date and a slot; it holds dishes in the order they are served. A dish is for everyone unless `for` names
people, and may carry a `portion_note` ("4 for me, 1 for wife"), a saved recipe (`recipe_id`) or a video (`video_url`).
A meal that is ordered in or eaten out is `ordered_in: true` and has no dishes.

- **A whole week** goes one day a call (16 KB a call at most): first `plan_week { week_start, mode: "draft", meals }`
  (it replaces the week's plan), each other day the same with `keep_rest: true` (only the meals sent are replaced), then
  `plan_week { week_start, mode: "final" }` without meals, which makes the week final.
- **One change** ("paneer on Thursday instead", "no dinner on Friday"): `set_meal` (dishes you send replace the meal's) or
  `set_dish` (one dish: add, change, `remove: true`).
- **Plan from the family:** diets, allergies, dislikes, the house rules for that weekday, what the cook makes well and
  the days they come, the slots, the meals ordered in. Vary from last week. Saved recipes may be planned in.
- **Every dish gets its ingredients when you plan it**, with amounts for this family: add up the portions of the people
  the dish is for, as each one's are saved, for that one meal. Leave out salt and water; list the rest.

## Amounts and units

- `amount` is a number and `unit` its measure, apart: `{ amount: 500, unit: "g" }`, never "500 g" as the amount.
- Use `g` or `kg`, `ml` or `l`, `pc` (things counted: 2 onions, 6 eggs). The app adds these up and works out the packs.
- When none fits, use the pack's own word (`pack`, `bunch`, `loaf`): the app cannot count packs for it and asks you.
- One name and one unit for an item everywhere ("curd", always in `g`): a second name or unit makes a second line.

## Everyday items

`set_regular { item, amount, unit, every }`: `amount` is what is needed each time. `every: "day"`; `every: "week"` with
`times_per_week` (a whole number, 1 to 7; 1 when left out); `every: "weekdays"` with `weekdays` (needed, at least one).
A holiday: `paused_until` (left out up to and including that date). `active: false` stops it; `remove: true`
deletes it. The same item for one person (`for_whom`) is a separate item. `remember_product { item, app, product_id,
name_on_app, pack_amount, pack_unit }` keeps the product a confirmed item is bought as: `item` is the family's word
("milk"), never the product's name on the app.

## The weekly run

The app wakes you once a week with next week's `week_start`, and the context to plan from when it fits. Plan the week a
day a call, as under Meals, then send the family the plan, day by day, for them to change with `set_meal` / `set_dish`.
Carts, orders and the daily reminders come with the next steps of this revision; until they do, nothing is ordered.

## Saved recipes

A shared reel, short or link with "save this" is `save_recipe { links: [the link], name, notes, ingredients, tags }`:
take the name and the ingredients from the link's title and caption (no ingredients when it lists none). On the code
`NEEDS_NAME`, ask the family what to call it and save again with `name`. A link shared twice is saved once. To plan
it: `recipe_id` on a dish, with the dish's ingredients in this family's amounts.

## A profile carried over from the old Meal Planner

On an install that was upgraded, the weekly run first hands you a `profile`: what the family once said, as text.
Structure it with `set_person` / `set_house_rules` / `set_cook` / `set_slots` / `set_regular`, in their words, and ask
them about anything it leaves unclear. Then clear it with `set_house_rules { structured: true }`, only after at least
one person is saved. No week is planned until it is cleared. Once it is, tell the family the app was rebuilt and plan
the coming week as the weekly run does.
