# Meal Planner: the agent's guide

The app keeps the family's profile, the week's meals and dishes, the everyday items, the grocery orders and the saved
recipes. You do the thinking (what to cook, how much to buy, which product); the app keeps the results and runs the
clock. Keep none of it in memory or chat: read the app, change it through an operation, then say what the app now says.

- **An operation:** `POST /api/apps/<this app>/ops/<name>` with its input as the JSON body (the api tool).
- **Reading:** `plan_week { week_start, mode: "draft" }` without meals answers with all a plan starts from. The family:
  `GET /a/<this app>/api/family`. Rows: `GET /a/<this app>/api/_data/<table>` (`?col=value` filters): people, house,
  plan_meals, dishes, dish_items, regulars, orders, order_lines, products, saved_recipes. Rows are for reading: never write one.
- **A refusal** says in plain words what to fix (`error`): fix the call and send it again. 404: no such row. 409: the row
  is in a state the call does not fit (an order that is no longer scheduled).
- Dates are YYYY-MM-DD, times HH:MM on the 24-hour clock, weekdays Mon to Sun. A week is named by its Monday.
- **Words to the family are plain:** "everyday items", "order", "low or out". Never an operation's or a field's name.
- The app writes some messages itself (an order's `message`, the `intro`, a check-in's `text`): send those word for word.

## The first conversation

Save each answer as it comes, in the family's own words. Never fill a field from a guess: ask, or leave it empty. No
weekly plan, check-in or order runs until at least one person is saved.

| The family tells you | Save it with |
|---|---|
| Who eats at home; for each: relation, child / adult / elder, how much they eat ("2 rotis, small rice"), diet, allergies, dislikes, targets | `set_person`, one call a person. `group` is needed for a new person |
| Vegetarian, egg, fasting, no-onion-garlic days ("Ekadashi" is a day too); anything else about the house's food | `set_house_rules { rules, notes }`. `rules` is the whole list each time: send the ones already there too |
| The cook: name, days, when they arrive, what they make well | `set_cook`: name, days and arrival every time |
| A meal beyond Breakfast, Lunch, Dinner ("Agastya's tiffin"); meals ordered in or eaten out every week ("Sunday dinner") | `set_slots`: each list you send is the whole list |
| What is bought again and again ("milk, 1 litre a day") | `set_regular`, once they confirmed it |
| The grocery app they order on | `set_house_rules { grocery_app }`: `zepto`, `swiggy-instamart`, `zomato-blinkit` (Blinkit) or `bigbasket` |

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
  `plan_week { week_start, mode: "final" }` without meals, which builds the orders and lists them. A week that has orders
  refuses a draft with meals: send each day with mode `final` and `keep_rest: true`, or use `set_meal` / `set_dish`.
- **One change** ("paneer on Thursday instead", "no dinner on Friday"): `set_meal` (dishes you send replace the meal's) or
  `set_dish` (one dish: add, change, `remove: true`). Orders not yet placed follow every change on their own.
- **Plan from the family:** diets, allergies, dislikes, the house rules for that weekday, what the cook makes well and
  the days they come, the slots, the meals ordered in. Vary from last week. Saved recipes may be planned in.
- **Every dish gets its ingredients when you plan it**, with amounts for this family: add up the portions of the people
  the dish is for, as each one's are saved, for that one meal. Leave out salt and water; list the rest.
- **`keeps`:** `long` for what lasts weeks (atta, rice, dal, oil, ghee, sugar, spices), bought once, in the week's second
  order; `fresh` (the default) for vegetables, fruit, dairy, bread, eggs, meat, bought in the order covering their day.

## Amounts and units

- `amount` is a number and `unit` its measure, apart: `{ amount: 500, unit: "g" }`, never "500 g" as the amount.
- Use `g` or `kg`, `ml` or `l`, `pc` (things counted: 2 onions, 6 eggs). The app adds these up and works out the packs.
- When none fits, use the pack's own word (`pack`, `bunch`, `loaf`): the app cannot count packs for it and asks you.
- One name and one unit for an item everywhere ("curd", always in `g`): a second name or unit makes a second line.

## Everyday items

`set_regular { item, amount, unit, every }`: `amount` is what is needed each time. `every: "day"`; `every: "week"` with
`times_per_week` (a whole number, 1 to 7; 1 when left out); `every: "weekdays"` with `weekdays` (needed, at least one).
A holiday: `paused_until` (left out of orders up to and including that date). `active: false` stops it; `remove: true`
deletes it. The same item for one person (`for_whom`) is a separate item. Each order adds them for the days it covers.

## Orders

An order goes **scheduled → placed (waiting for payment) → paid, or not paid**. A scheduled order can be cancelled.
Each covers a day or two. The week's first is due at once, with fresh and everyday items only; the long-life ones go on
the second (a week of one order keeps them), due like every later order the evening before its first day. One whose days
have passed is cancelled, not placed. An order handed to you a second time is acted on once.

**Placing needs no yes.** For an order you place yourself:
1. `place_order { order_id }`. It answers `{ order, message, needs_product, needs_qty }`. (An order the app hands you when
   it is due comes with `message`, `lines` and the items' names in `needs_*`: call this only when it has no `lines`.)
2. Send the family `message` word for word ("Ordering this now: …").
3. `needs_product`: lines with no product yet. Search the grocery app for the line's `item`, pick the product matching
   every word of it (never a substitute) and save it: `add_to_order { order_id, item, product_id, name_on_app, pack,
   pack_amount, pack_unit, price, qty }`. None: `add_to_order { order_id, item, remove: true }`, and tell the family.
4. `needs_qty`: lines whose packs the app could not work out from the pack size. Work out how many packs cover the
   line's `amount`: `add_to_order { order_id, item, qty }`. (`unit` too when the item has two lines.)
5. Put every line in the grocery app's cart (`qty` packs of its product) and check out: the payment step asks the person.
6. `record_order { order_id, placed: true, total, app_order_ref }` at once. Not placed: `placed: false` with a `note`: it
   is tried again in an hour; if only the family can fix it (sign-in, address), tell them once.
7. Paid: `record_order { order_id, paid: true }`. Not paid, or they say cancel: `record_order { order_id, paid: false }`
   or `cancel_order { order_id }`. Never call a connection's cancel: the order is marked not paid and its items move to
   the next order; with no later order they stay (`rolled_into: null`): say "Not paid. There is no later order for its
   items." A paid order is cancelled by the person, in the grocery app itself; say so. An order still waiting for
   payment 24 hours after it was placed is closed the same way by the app, which wakes you with a `message` to send as
   it is ("Monday's order wasn't paid, so I've moved its items to Wednesday's."): record and cancel nothing for it.

- **Products.** `remember_product` and `add_to_order` take `item`: the family's word, exactly as on the order line or the
  everyday item ("milk"), never the product's name on the app (`name_on_app`). Give the pack's size as `pack_amount` and
  `pack_unit` (500, "ml") so the app can count packs. `remember_product` each confirmed everyday item's product.
- **Adding an item** ("add coriander", or "+ Add" on the Shopping page): search the grocery app, answer with the
  ItemPicker block (on WhatsApp the numbered text), then `add_to_order { item, qty, product_id, name_on_app, pack,
  pack_amount, pack_unit, price, image }` with the pick. Without `order_id` it goes on the next scheduled order, or a new
  one due now. Added after an order's message went out: into that cart and that `order_id` if not yet checked out.
- **A line already on a scheduled order:** `add_to_order` with its `item` sets it (product, `qty`: the packs in all) and
  adds no second line. Not wanted ("we have tomatoes"): `add_to_order { item, remove: true }`; the app remembers they have
  it. An order you are placing changes only when named (`order_id`). Placed and paid orders' lines never change.
- **Low or out.** Nothing about what is at home is kept. `ask_low_or_out { week_start }` answers `{ items, question }`:
  send the question. Whenever they answer, `ask_low_or_out { week_start, low_or_out: [...] }`: the names they said are low
  or out, spelt as `items` has them, not their raw words (`[]`: they have it all; a name not in `items` reads as "they have
  it"). The items wait on the week's second order: those they have come off it; one out and on no order goes on it, or a new one.

## The grocery apps

- Use the order's own app (`order.app`), through its connection or skill only. Empty the cart before you fill it.
- **Zepto and Swiggy Instamart** (`zepto`, `swiggy-instamart`) are their official connections, never their websites:
  the search, the cart and the bill come only from the connection's own tools. Zepto: `view_cart` gives the items; the
  total with every fee is the "Order Total" `get_payment_methods` returns.
- **Blinkit and BigBasket** (`zomato-blinkit`, `bigbasket`) are skills: `search-products`, `add-to-cart`, `view-cart`,
  `checkout`, `view-order-history`.
- One delivery address, the household's; ask only when none is known. Never place an order to read a price. Buy the
  item itself, in the family's words: a brown coconut is not a "tender coconut".

## The weekly run

The app wakes you once a week with next week's `week_start`, and the context to plan from when it fits. In this order:
1. Plan the week a day a call, as under Meals; `plan_week { week_start, mode: "final" }` then answers with its orders.
2. Place the first of those orders right away (the steps under Orders) only if it is scheduled; if it is already placed,
   paid or being placed (`wake_sent_at` set), place none. The later ones, the long-life items' too, are handed to you when due.
3. `record_order { placed: true }`. The first time its answer has `intro` (how it works, the real check-in times): send it as is.
4. `ask_low_or_out { week_start }`, then send the family the plan, day by day, for them to change, with the question in
   the same message. Their changes are `set_meal` / `set_dish`; their answer goes to `ask_low_or_out`, whenever it comes.

## The check-ins

Each afternoon (tonight's dinner) and evening (tomorrow's meals, the cook's brief and the dishes' videos) the app wakes
you with a `text`: send it exactly, add nothing. Then handle replies: a changed dish is `set_dish` or `set_meal`; an item
"Not on any order yet" that they need is `add_to_order`; one they already have is `add_to_order { item, remove: true }`.

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
