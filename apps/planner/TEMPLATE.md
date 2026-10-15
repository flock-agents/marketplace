# Planner

For a household's meals over the week: what's for Breakfast, Lunch and Dinner each day, the grocery list and the family's recipe book.
Start here when the owner says "plan our week…". It opens on a Schedule (today and tomorrow big, the rest of the week compact), plus a grouped shopping list and the family's own recipe book.

## Data
Three tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`.
- `meals`: one row per dish: `date` (ISO), `slot` (Breakfast, Lunch, Dinner), `dish`, and `recipe_id` (the `recipes` row it was planned from, or null for a typed dish). No tags, cook or notes.
  A meal is usually several dishes: the rows sharing a `date` and `slot` are that meal (Monday lunch = three rows: Rice, Sambar, Bhindi fry).
- `recipes`: `name` (required), `ingredients` (text, one per line, "Rajma, 1 cup"), `method` (how the family makes it, free text) and `notes`. The owner adds them; they are not derived from past meals.
- `groceries`: `item`, `aisle` (Vegetables, Dairy, Staples, Spices, Other), `done` (boolean, bought or not) and `for_dish`.

For the agent: a meal with several dishes is several `meals` rows on the same `date` and `slot`, one dish each; never "Rice, sambar, bhindi" in one `dish`. To add a dish to a meal, add a row; to change or drop one dish, change or delete only its row.
Plan a dish from the book by writing the recipe's `name` as `dish` and its `id` as `recipe_id`. To put a recipe's ingredients on the list, add one `groceries` row per ingredient line with `for_dish` set and `aisle` "Other", skipping any item already on the list and not done (match on the name before the comma). Slots are Breakfast, Lunch and Dinner: don't remove or rename them unless the owner asks.

## Pages
- `week` (src/pages/WeekPage.tsx): the **Schedule** component only, one line per date and slot with all its dishes (`LUNCH  Rice · Sambar · Bhindi fry`, wrapping on a phone; grouped by src/pages/slots.ts, tested by server/slots.test.ts).
  Each dish is its own button that opens that dish; "+ Add" at the end of a line adds another dish to that meal. Seven days from today, Today and Tomorrow large with an "+ Add breakfast" row for every empty slot,
  later days compact, empty days folded into one line, days already gone behind "Earlier". Use Schedule for any dated plan: a seven-column grid squeezes the items that matter most today.
  Previous/next 7 days (loaded by date range). Adding or changing a dish opens src/pages/MealEditor.tsx: the dish field offers the recipe book first (never planned, then furthest from that day), any dish can still be typed, and "Save as a recipe" keeps a typed dish in the book.
  A dish from a recipe offers "Add ingredients to groceries" (new items go under the Other aisle), and "Add all for this meal" when the meal's other dishes have recipes too (an item two dishes share goes on once).
  Removing a dish offers an Undo and leaves the meal's other dishes. The open dish is sent to the chat as context.
- `groceries` (src/pages/GroceriesPage.tsx): a Checklist grouped by aisle, with progress and an add row per aisle, and an "Edit items" mode to change or delete any item (with Undo).
- `recipes` (src/pages/RecipesPage.tsx): the book, searchable by name or ingredient, with Add; `#/recipe/<id>` (src/pages/RecipePage.tsx) shows one recipe's ingredients, how we make it and notes, with Edit and Delete (with Undo). The open recipe is sent to the chat as context.
  The matching, suggestion and grocery rules are plain functions in src/pages/recipes.ts, tested by server/recipes.test.ts.

## What to change first
1. The slots and aisles: server/db/constants.ts (the schema and the pages both read it). Slots are the rows of each day; keep Breakfast, Lunch and Dinner unless the owner asks.
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.
2. The seed rows in server/db/seed.ts: the sample family's recipes, two weeks of meals, most of them several dishes (so today and tomorrow are never empty) and list; replace them with the owner's real dishes and recipes.
3. The starter prompts in src/App.tsx, the page titles (each `label("title.<page>", …)`) and the nav names (`label("nav.<page>", …)` in App.tsx).
4. The accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour) and the object (`grocery-bag`; find others with find-object.sh).

## Other weekly plans (school runs, chores, appointments): only on the owner's ask
This template is for meals: a school-run rota, chores or appointments are a `checklist` (who and by when) or a `tracker`, not a planner.
Adapt the planner only when the owner asks for this week view for something else. That is a hand change (a build, or a change after the app is live), never the template make: the make keeps `meals`, its Breakfast, Lunch and Dinner slots and a required `dish`.
The week is generic underneath: each row is a date, a slot and a title, and the rows sharing a date and slot show on one line. To adapt it, before the app has real rows:
1. `SLOTS` in server/db/constants.ts become the rows of the day: `["Morning drop", "Afternoon pickup"]` for school runs, `["Morning", "Evening"]` for chores, `["Morning", "Afternoon", "Evening"]` for appointments.
2. Rename in server/db/schema.ts and the pages: `meals` → `plans`, `dish` → `title`, and drop `recipe_id`. Add a column only when the job needs it: for appointments an optional `time` (text, "16:30") and `place`, shown with the title ("16:30 Dentist, Meera").
3. In src/pages/WeekPage.tsx and src/pages/MealEditor.tsx, swap the words "meal", "dish" and "breakfast" in titles and buttons (all plain strings), and take the recipe suggestions out of the editor.
4. Drop the pages that do not fit: remove `groceries` and `recipes` from `PAGES` in src/App.tsx (and their files and tables) unless a shopping list helps, and set `nav="none"` on AppShell when one page is left.
5. Rewrite the seed rows in server/db/seed.ts with the owner's real week.

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
