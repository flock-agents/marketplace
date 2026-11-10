# Changelog

## 2.0.6

- **Price comparison** (moved here from the Family Butler template): the agent's guide says how the price step, or a
  family member asking which service is cheapest, compares services: one delivery address for all of them, one
  background session per connected grocery service with the family's own words for each item, each using that service's
  own skill or connector, then the totals compared at that address. No order without a yes on that exact total.
- The guide keeps to the app's own data. Checking the cart with `view-cart` after adding moved to the grocery skills
  (bigbasket, zepto, zomato-blinkit, swiggy-instamart); paying after the yes is each skill's `checkout` and the payments
  guide; the `skill-sandbox` WARN note is gone (Flock reports a script's own error). From the Family Butler template: the
  rows are the owner's, so never delete or "tidy" rows the agent did not add.

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
