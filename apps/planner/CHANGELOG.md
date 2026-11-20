# Changelog

## 3.1.0

3.0.0 was a build that was never released; this is the release. It replaces the 2.0 Meal Planner. Needs Flock 0.24.0 (its
betas included) and library 1.10.11.

- **Family.** The Family page holds who eats at home, the house rules, the cook, the days you cook (Monday to Saturday
  until you change them), the shopping apps you use (a main one, one to try when something is not on it, and the ones you
  are signed in to: choosing an app does not mark it signed in, and nothing is read from or copied to an app until it is) and the items delivered to you by someone else, such as milk from a milkman, which are left out of
  running low. Tell the agent or edit it yourself.
- **The week, planned and kept.** The week is planned on Sunday at 11 am, on your cooking days only, and each day is kept
  as soon as it is planned: you do not need to reply. The Sunday message is Monday's meals plus a link to the Week page.
  Nothing is bought by the plan.
- **Two reminders a day.** At 3 pm (tonight's dinner) and 7 pm (tomorrow's meals), each one complete in one message: the
  meals, the everyday items put on your cart, and anything that may be running low. Nothing is ordered until you reply or
  tap Order. A setting, "Order without asking" (off), lets the agent order the items it is sure about on its own.
- **Running low, estimated per item.** The app reads the last 3 months of your orders on every connected shopping app and
  works out how long each item lasts for you, from the amounts and the gaps between buys. Early or one-off buys are not
  counted and your own answers are. When something may be running low, you are asked together in one message, at most 5
  items at a time. An item you have never bought with a size is estimated from the gaps alone.
- **One cart per app.** What you need is gathered into one cart for each shopping app. Each cart has its own Order button,
  and the app's own cart is kept in step with it as you change it (Amazon's cart is built when you order). The agent
  orders it only on your yes. An order that was not paid within 24 hours goes back to the cart, and you are told once.
- **A plan the cart can use.** Every planned dish carries its ingredients, in amounts for your family: the agent's plan is
  refused until it does, so the cart fills from it. A child's school tiffin is its own meal on school days, and a dish is
  not repeated in the week unless you asked for it. The plan follows what you told the agent about the cook: what the cook
  does not make, how much time the cook has, and whether the cook tries new recipes or keeps to familiar ones. A cook
  who comes twice a day has both visits, each with the meals it makes.
- **House rules read right.** "No eggs on Tuesday" shows as "Tue · No eggs". A rule can hold every day ("mostly
  vegetarian"), and anything else about how the house eats is kept as notes.
- **The Week page** says when the week was really planned, and the Sunday link opens the week it planned.
- **Pantry page.** Each item with its status (in stock, low or snoozed), when it was last bought, how long it usually
  lasts, and what the app learned from each order and each answer of yours.
- **Saved recipes with videos.** Share a reel, a short or any link and say "save this": it is kept on the Recipes page, now
  a gallery, and can be planned into the week.
- **For the agent.** There are 25 operations. Kept from 2.0: `guide` and `record_order` (now about a cart). New: `set_person`,
  `set_house_rules`, `set_cook`, `set_slots`, `set_cooking_days`, `set_shopping_apps`, `plan_week`, `set_meal`, `set_dish`,
  `set_regular`, `import_order_history`, `record_bought_outside`, `set_item`, `set_subscription`, `answer_running_low`,
  `get_reminder`, `get_cart`, `set_cart_line`, `order_cart`, `sync_cart`, `cancel_order`, `remember_product` and `save_recipe`. Gone:
  `get_draft`, `edit_draft`, `move_window`, `add_quote`, `record_yes`, `skip_order`, `ack_message`, `list_jobs`,
  `answer_job`, `pantry`, `pantry_answer`, `have_item`, `search`, `save_meal`, `remove_meal`, `set_meal_recipes`,
  `write_recipe` and `set_shelf_life`. Past orders are read in calls of about 8 orders and 80 items. The Sunday run ends
  with a `plan_week` call that carries the message. The reminders read your order history first, copy the carts to the
  shopping apps, then send.

Existing installs: the 2.0 tables are kept and not read, and your household profile is carried over; the agent turns it into
the new Family page on its next Sunday run, then plans the week. Until then no week is planned and nothing is ordered. Old
meals, recipes and shopping lists are not shown in the new pages.

## 2.0.7

- **Zepto and Swiggy Instamart are their official connections.** The agent's guide says to read their cart and bill only
  from the connection (Zepto's full total is the "Order Total" from `get_payment_methods`), never from their websites,
  and never to place an order just to see a price. BigBasket and Blinkit still use their skills.

## 2.0.6

- **Price comparison** (moved here from the Family Butler template): the agent's guide says how the price step, or a
  family member asking which service is cheapest, compares services: one delivery address for all of them, one
  background session per connected grocery service with the family's own words for each item, each using that service's
  own skill or connector, then the totals compared at that address. No order without a yes on that exact total.
- The guide keeps to the app's own data. Checking the cart with `view-cart` after adding moved to the grocery skills
  (bigbasket, zepto, zomato-blinkit, swiggy-instamart); paying after the yes is each skill's `checkout` and the payments
  guide; the `skill-sandbox` WARN note is gone (Flock reports a script's own error). From the Family Butler template: the
  rows are the owner's, so never delete or "tidy" rows the agent did not add.
- **Price comparison:** each session picks a product matching every word the family used for the item (another kind,
  such as a brown coconut for "tender coconut", is not the item) and reports it unavailable rather than substituting;
  every service gets the same quantity in the family's unit, so the totals compare like for like.

## 2.0.5

- The agent's guide calls operations, reads rows and changes settings with the api tool, not `flock-api`.

## 2.0.4

- The week page keeps working when a readiness reply carries no `statuses`: each meal falls back to the local rows instead of the page failing.

## 2.0.3

- **The agent is never woken about the same thing twice.** A background job is asked about once. One left unanswered
  falls back to the app's plain rule at its expiry instead of being re-asked every 30 minutes. A job whose meal or recipe
  was deleted (a re-planned day) closes itself, and answering it is a 409, so it is never a 404 that leaves it open.
  The boot pass and the recipe-fill sweep no longer re-queue work that was already asked.
- The nightly check hands each item (an empty slot, a link, a quantity, a likely duplicate, a shelf life) to the agent
  once. What the agent or the family left alone stands, and is not asked again. Nothing new means no model call.
- The shopping reminder, the heads-up and the near days' menus go out straight from the app, with no model call. Only
  the price step (filling carts on the services) and placing an order wake the agent. Silence means the plan stands.

## 2.0.2

- The "waiting to hear about your household" notice is inset like the samples banner above it, and no longer repeats it.

## 2.0.1

- **Nothing runs until the family has told the agent about themselves.** The new `household.profile` setting holds what the
  family said in their first conversation (who eats, food habits, meals to plan, where they shop); the agent saves it in
  their words, never from guesses. Until it is set every routine is a silent no-op, no job reaches the agent, the shopping
  list is not rebuilt, and every page says the app is waiting and what to tell the agent. When it arrives the samples are
  cleared (one undoable change) and the work starts from the family's own rows.
- **Installs without a profile stop generating.** At the first start of 2.0.1, what the app and its agent generated before
  is marked as samples (cleared with the template's), the owner's own rows and the install import's stay, and an install
  that already holds its family's diners carries on.
- Layout-lint fixes on the Recipes, Ingredients, Pantry and grocery pages.

## 2.0.0

- **The app owns how its agent works.** `agentInterface` declares 20 operations and the agent's instructions; Flock 0.22.0
  puts them in the paired agent's context, so any agent paired with the app can run it (no skill to install). The full guide
  is the `guide` operation. Needs Flock 0.22.0.
- **A meal is a set of recipes plus a note.** The shopping need comes from the recipes; the agent reviews it against the note
  ("leftovers from tonight") in a background job. Only the agent creates recipes, and fills a planned recipe's lines at once.
- **Shopping windows.** One live draft per window with its span ("Thu breakfast → Sat dinner"): an evening reminder, a
  heads-up Checklist 15 minutes before, a price check across services with the best pick, then "Order with <service>". No yes
  in 3 hours lets the draft go quietly; "Skip this order" asks first, and only still-useful items move to the next order. At
  most three messages per window.
- **Stock and Pantry.** What was bought, drawn down by the meals cooked; long-shelf-life items assumed at home and checked by
  the agent now and then (one question about the coming meals). The Pantry page shows what is in the kitchen.
- **Learning.** Every choice is recorded; the agent finds patterns in a background job and the app applies the ones it marks.
- Groceries is now **Shopping**; a meal's chip appears only when it says something, and links to the items.
- New tables `ingredients`, `recipe_ingredients`, `diners`, `diner_portions`, `staples`, `carts` and private ones (stock,
  jobs, choices, learned prefs); existing rows are kept (additive schema).

## 1.1.2

- The icon is the app's own illustration (`icon.svg`, the grocery bag drawn in its header), in place of the 🍽️ emoji.

## 1.1.1

- Declares itself an app template (`"usage": "template"` in `flock.app.json`), so Flock offers it as a starting point to make apps from, not as an app of its own. 1.1.0's installed copy had no `usage` and read as an app. Nothing else changed.

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries the kit fields `template.json` held, plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`. `template.json` and `TEMPLATE.md` are gone: Flock 0.15.0 reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: "+ Add" on a meal, a dish, or an empty day opens the meal editor right there in the week, under the row tapped (it opened above the week and scrolled up). Escape closes it and focus goes back to what was tapped. Edit item on the grocery list opens under that item; a new recipe opens right under the page header. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace kit app (moved from the Flock repo).
