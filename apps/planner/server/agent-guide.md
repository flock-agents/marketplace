# Meal Planner: the agent's guide

The app keeps the family's people, food rules, meals (slots) and dishes, the week's plan, the items they buy, one cart per shopping app and the saved recipes. You do the thinking (what to cook, how much, which product); the app keeps the results and runs the clock. Keep none of it in memory or chat: read the app, change it through an operation, then say what it now says.

- **An operation:** its own tool, `planner_<name>` (or `POST /api/apps/<this app>/ops/<name>` with its input as the JSON body).
- **Reading:** the family: `GET /a/<this app>/api/family`; a week: `GET /a/<this app>/api/weeks/<its Monday>`. Rows:
  `GET /a/<this app>/api/_data/<table>` (`?col=value` filters): people, house, slots, slot_days, slot_dishes,
  dish_ingredients, library, rules, items, item_events, orders, order_lines, products, saved_recipes. Never write one.
- **A refusal** says in plain words what to fix (`error`): fix the call and send it again. 404: no such row. 409: the
  row is in a state the call does not fit. Use only the operations and the fields their tools take. Dates YYYY-MM-DD, times HH:MM (24-hour), weekdays Mon to Sun; a week is its Monday.
- **Words to the family are plain:** "what you buy every day", "your cart", "running low", never an operation's or a field's
  name. Say "you"; the cook is "the cook" or their name. The app writes some messages itself (a plan's `message` and
  `intro`, a reminder's `text`, an order's `message`): send those word for word.

## The two problems and the loop

1. **What to eat.** Every Sunday at 11 the app plans next week, every day of it, and wakes you to send it. The plan is kept whether or not anyone replies; the family changes a meal by replying or on the Week page.
2. **What to order.** The app guesses from order history what is running out, and keeps one open cart per shopping app.
   At 15:00 (tonight's dinner) and 19:00 (tomorrow's meals) every day a reminder wakes you: the meals, the carts and
   the few items that may be running low.

**Nothing is ordered until the family replies or taps Order**, except with the setting Order without asking (off unless
turned on): the reminder then lists the carts in `ordered`, and you order those.

## Setting up, and what the family tells you

Setting up follows the `planner-setup` skill: `status` says what is known and missing; two grouped questions; the first plan (`make_plan { from, days }`, 3 days from today) in the same turn once `status` is ready; a feedback round; the rest of the week.
Save each fact the moment it is said, in the family's own words; never fill a field from a guess. No plan or reminder runs until one person is saved. Do not ask what is at home: the app works that out.
Answered with nothing to save ("no fasting days"): `set_answered { ids }`. A whole setup given at once (an older interview's transcript): `apply_setup { household, transcript }`, its `said` read back.

| The family tells you | Save it with |
|---|---|
| Who eats at home; for each: relation, child / adult / elder, how much they eat ("2 rotis, small rice"), diet, allergies, dislikes | `set_person`, one call a person. `group` is needed for a new person; `remove: true` takes someone out of the family. A diet or an allergy is a `set_rule` too (the plan checks rules) |
| A goal ("more protein", "less rice") | `set_person { name, targets }`: `{ protein: high, carbs: low, fat: low, note: their words }`; the plan leans towards dishes that fit |
| Someone who visits, and food that changes then ("no eggs when my parents are here") | `set_person { name, group, usually_home: false }`, then `set_rule { hard, what, when_present, quote }` with their names; on the days they come, add them to those meals with `set_slot_day` |
| The usual cuisine ("Punjabi", "mostly Tamil") | `set_cuisine { cuisine }`: new dishes keep to it |
| Who decides what is cooked, who cooks, who shops (separate; any may be someone who does not eat at home) | `set_roles { menu, cooking, shopping }`, each in their words. Ask, never assume; the plan goes to whoever decides, the carts to whoever shops |
| The cook: name, days, arrival; what they make well; what they do not make well or will not make; their time ("off to the next house: a dish or two in the morning"); new recipes from reels, or a set menu of familiar dishes | `set_cook { name, days, arrival, makes_well, wont_make, time_limit, new_recipes: "open" or "set_menu", note }`: name every time, days and arrival the first time. A cook who comes twice a day: `arrival: [{ at: "06:00", meals: ["Breakfast", "Lunch"] }, { at: "16:30", meals: ["Dinner"] }]` |
| **A cook's limit, said any time** (in chat, or fixing a plan: "swap the chole, the cook can't make it") | Its words in the cook's `wont_make` or `time_limit` at once. A plan correction keeps the limit, not only the swap. A vague limit ("no fancy stuff") stays words: ask "which dishes?" once when it matters |
| The shopping apps: the main one, the one to try when something is not on it, the ones they have signed in to | `set_shopping_apps { main, fallback, connected }`: `zepto`, `swiggy-instamart`, `zomato-blinkit` (Blinkit), `bigbasket` or `amazon`; `fallback` is `null` for none. `connected` is only the apps signed in to in Flock, `[]` when none yet (main and fallback are not added to it): send it again after each sign-in |
| How often something is bought, only when they say it or there are no orders to learn it from ("milk every day, 1 litre") | `set_item { item, group, usual_amount, unit, every_days }` (see Items and their cycles) |
| An item delivered outside the apps (a milkman, Country Delight) | `set_subscription { item, source, active: true }`: a subscription is a pantry item's setting (the family can turn it on or off on the item's page too); it stays in the Pantry as a subscription and is left out of every cart and every question |

## Reading order history

After a sign-in, and at the start of every reminder, read each connected app's orders placed since the wake's `since[app]` (3 months back only for an app not yet in `since`) and give them to `import_order_history`: the oldest first, about 8 orders and 80 items a call, one app a call, delivered or paid orders only (never a cancelled or failed one).
Each order has its `date` and `order_ref`; each item its `item` (the family's word: "atta"), `group`, `product`, `product_id`, `pack`, `count` and `image`: the product's picture link exactly as the order's details give it (Zepto's order detail, Instamart's order items), never one you made or searched for. The same order sent twice is recorded once. Which connectors can read orders:
- **BigBasket and Blinkit:** `view-order-history`, then `track-order` for each order to get its items.
- **Zepto and Instamart:** the order tools of their own connection, when it has them; when it has none, skip the app.
- **Amazon:** cannot. Skip it.

Take the pack from the product name ("Aashirvaad Atta 5 kg") when the app gives none. Send every item's `group` too:
`daily` (milk, curd), `few_days` (vegetables, eggs, bread), `monthly` (atta, oil, cleaning). The app works out each item's cycle from the purchases by itself: ask the family to confirm nothing, and add nothing as an everyday item.
**More than one person may order,** each on their own account of an app: each person's agent gives that person's orders, all count for the one house, and `since` and the answer's `read_until` are how far you yourself have read.
**Holding more than one account of an app** ("Zepto (Arjun)", "Zepto (Meera)"): read each account and send each with its `account` (its account id, else its label; always the same one). Read it from `since["zepto:<account>"]`, else 3 months back. Each account's `read_until` is its own.

## The week's plan

The week is planned slot by slot: each slot (Breakfast, Lunch, Dinner, a child's tiffin, one person's add-on) on each day
has the people it is for and the dishes made in it, each with its ingredients. A plan is a suggestion, not a record of
what was eaten. A slot-day eaten out or ordered in has no dishes, so nothing is bought for it. Every day is planned.

- **The weekly run:** the app plans the week itself on Sunday and wakes you only to send the family its `message` (and
  `intro` once) word for word: plan nothing then.
- **Some days, or a week, on request** ("plan the next 3 days", "redo the week"): `make_plan { from, days }`, or `make_plan { week_start }` for a whole week (`keep_edited: false` plans the family's own picks again too). Send its `message` (and `intro`) word for word as its `instructions` say, or its `say` when it could not plan.
  `reason: "no_dishes"`: `say` asks for the family's dishes: add them with `add_dish`, then `make_plan` again, or `make_plan { from, days, suggest_new: true }` when they say to suggest some.
- **Food rules are checked by the app** against what each dish contains: a plan it makes keeps every hard rule.

**Later changes** (a change plans again only the meals it touches, never one the family changed; send its `message`
word for word, or `say` when it answers `planned: false`):
- One meal, one day (guests, someone away or visiting, "we're eating out on Friday", "make poha on Tuesday"): `set_slot_day`.
- For good: a meal slot (`set_slot`), a food rule (`set_rule`, with the family's `quote`; its `id` to change or take one
  away), a dish they have (`add_dish`; a reel or recipe link for a dish they have not made yet goes in its `link`), how
  many new dishes a week (`set_setting`). The app reads what a dish contains itself.
- "We made khichdi instead" (said by them, never asked): `record_made { date, slot, dishes }`.

- **A plan's question** (at most one, also in its `asked`): a meal with no dishes known at all, left out of the week ("I know only a few dishes for Kabir's tiffin. What else do you make for Kabir's tiffin, or should I suggest a few?"), and any calendar entry it could not read ("does "Dinner out" (Ravi, Thu) change who eats at home?") in the same question. Dishes named → `add_dish { name, slot, quote }` each, at the meal they were named for; "suggest" → `set_slot_day { date, slot, new_dishes_allowed }` on that slot's next days, or `set_setting { new_dishes_per_week }` for more variety everywhere. An add-on (one person's own beside the family's meal) is planned only as often as its dishes are had; its other days have none, which is not a missing meal.

## Amounts and units

- `amount` is a number and `unit` its measure, apart: `{ amount: 500, unit: "g" }`, never "500 g" as the amount.
- Use `g` or `kg`, `ml` or `l`, `pc` (things counted: 2 onions, 6 eggs); the app adds these up and works out the packs. When none fits, use the pack's own word (`pack`, `bunch`, `loaf`): the app cannot count packs for it and asks you.
  One name and one unit for an item everywhere ("curd", always in `g`): a second makes a second line.

## Items and their cycles

Every item has one cycle for the house: how much is bought and how often ("500 ml every day", "30 pc about once a week"), worked out from everyone's purchases and shown on the Pantry page. A `daily` item goes on the cart by itself when it is due; the others are asked about.
Only when the family says it, or there are no orders: `set_item { item, group, usual_amount, unit, every_days }` ("milk every day, 1 litre": `usual_amount: 1, unit: "l", every_days: 1`; once a week is 7); `set_regular` is its older name. A holiday: `snooze_days`. Never by itself or asked: `dont_ask: true`. `remember_product { item, app, product_id, name_on_app, pack_amount,
pack_unit }` keeps the product an item is bought as: `item` is the family's word ("milk"), never the name on the app.

## A reminder

The wake gives `which`, `date`, `connected` and `since`. In this order:
1. Read each connected app's new orders and `import_order_history` them (above), so nothing bought already is asked about.
2. `get_reminder { which, date }` with the wake's `date`. When it is `empty`, stop and send nothing.
3. Copy each cart in `carts` with `sync: true` to its app with its connector, then `sync_cart` what the app's cart now
   holds (the delivery gap included).
4. `get_reminder` again, same `which` and `date`: nothing is asked or added twice, and its `delivery_gap` is now the
   app's cart. Send that answer: its `text` on WhatsApp word for word, or its `app_text` with its `block` in the app chat.
5. Check out every cart in `ordered` (see the next section), and send its `message` first.

## What the family replies

- **To "still in stock?":** `answer_running_low { answers: [{ item, answer: "low" | "in_stock", days? }] }`. The options are the app's `STOCK_OPTIONS`: "Low, add it" is `low`; "Fine for 3 days" is `in_stock` with `days: 3`; "Fine for a week" is 7;
  "Fine for 2 weeks" is 14; "Fine, not sure how long" is `in_stock` without `days`. A numbered reply ("1 low, 2 fine for 2 weeks") numbers the items in the order asked: one call with every answer.
- **To "Yesterday's plan had <dish>..."** (the afternoon reminder's only question about cooking, for a dish new to them):
  `record_feedback { date, slot, dish, made, liked, again }` per dish, from the reminder's `feedback`. No reply: no call.
- **To a new dish's "OK to try it, or should I swap it?"** (the week's message, "<dish> on Tue": that day of the week) **or "Tomorrow's new dish: ... OK to make it, or swap?"** (the evening's `new_dishes`): `record_feedback { date, slot, dish, answer }` per dish, no `made`. `answer: "ok"`: it becomes theirs; `"swap"`: that meal planned again, nothing new; `"dont_like"`: never suggested again (a day to come planned again). A plain "ok" is every dish asked; send a re-plan's `message` word for word.
- **How a dish went, said by them:** `rate_dishes { ratings: [{ dish, rating: "good" | "okay" | "didnt_work", note, said_by }] }`
  (`again: false` in a rating: never planned again). Never ask whether the plan was cooked: a plan is a suggestion.
- **`proposed_rule` in an answer:** a dish turned down twice. Ask its `say` once; on a yes, call its `op` with its `body`.
- **"Add dal":** `set_cart_line { item, qty }`. **"Got atta at the kirana":** `record_bought_outside`. **"Don't ask about
  ghee", "rajma follows the plan":** `set_item`.
- **A yes to a cart,** or "Order my <App> cart" (the Order button on the Shopping page): the yes to that app's cart.

## The cart and ordering

Each shopping app has one open cart (`get_cart`), shown on the Shopping page.
- **Add, change, take off:** `set_cart_line { item, qty }` (qty 0 takes it off); the app picks the shopping app. Put the
  same change on that app's own cart with its connector and `sync_cart` what it holds, in the same turn. With a product you
  picked, send its `image` link as the app gives it: the Pantry and Shopping pages show it (never in a message).
- **A cart being ordered:** only lower or remove one of its lines ("remove the ghee"); anything else goes to the open
  cart, which `set_cart_line` does for you. **The `sync-cart` ask** (edits on the Cart page): make the app's cart hold
  exactly its lines, then `sync_cart`.
- **Not on the app today** (`in_stock: false` in `sync_cart`): with a fallback app set, take the line off its app with
  `set_cart_line { item, qty: 0, app }`, move it with `set_cart_line { item, qty, app: <fallback> }`, copy both carts. Else leave it marked.

To order: `get_cart`, make the app's cart match it, then `order_cart { app }` and send its `message` word for word.
Check out with the app's connector, and ask the family again only if something changed (out of stock, a substitute, a
higher total):
- **Zepto:** read the total with `get_payment_methods`; never `create_order` to read a price.
- **BigBasket and Blinkit:** `checkout` to review, then pay.
- **Amazon** cannot edit a cart: build it at order time from its lines.

Then `record_order { order_id, placed: true, app_order_ref }`, and later `paid: true`, or `paid: false` when it was not paid (its items go back on the open cart; you tell the family, the clock will not).
`cancel_order` stops one: before it was placed nothing was bought; once placed it counts as not paid, and you tell the family. A late `paid: true` may answer `taken_off`: take those items off that checkout on the app too. An order nobody paid in 24 hours is closed by the clock, which tells the family once.

## Saved recipes and a dish's video

A shared reel, short or link with "save this" is `save_recipe { links: [the link], name, notes, ingredients, tags }`:
take the name and ingredients from the link's title and caption (none when it lists none). On the code `NEEDS_NAME`,
ask the family what to call it and save again with `name`. A link shared twice is saved once. When it is for a dish, it is that dish's video too.
**A dish's video is its own,** kept by its name: `set_dish_video { dish, url, title, thumbnail }` once (a dish of the
family's, or one planned before), and every week the dish is planned shows it (the Week page, the cook's message). "Find a video for rajma": search yourself (YouTube), pick one and
attach it; a link only, never a file. `get_dish { dish }` reads a dish's video and how it went last time.

## A profile carried over from the old Meal Planner

On an upgraded install the weekly run first hands you a `profile`: what the family once said, as text. Structure it with `set_person` / `set_cook` / `set_item`, everyone at home first, in their words, and ask about anything unclear.
No week is planned until someone at home is saved. Once they are, tell the family the app was rebuilt and plan the coming week with `make_plan { week_start }`.
