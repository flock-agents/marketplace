# Meal Planner: architecture

<!-- The part above "This app" is shared by every kit app and kept identical: its source is docs/marketplace-guide/kit-app-architecture.md. -->

## What a kit app is

A private `fullstack` app: a React page built with Vite (`src/`), a Hono backend run by bun (`server/`), one SQLite database per app, and a copy of Flock's component library in `src/flock/`. The backend mounts the Flock app kit (`@flock/app-kit`), which gives every kit app the same data routes, settings, samples, change log and chat hooks, so an agent that knows one kit app knows them all.

## Request lifecycle

1. The browser opens `/a/<app-id>/` on Flock. Flock serves the built page from `dist/` and adds the viewer's identity to every request; the page never sees a cookie or token.
2. The page calls its backend with relative paths (`./api/...`). Flock proxies `/a/<app-id>/api/*` to the app's own port; the backend is `server/index.ts`, bundled to `server/index.js` at build time, started as `bun server/index.js` and watched at `/api/health`.
3. `createFlockApp()` (`@flock/app-sdk`) gives the backend its Hono router and environment; `mountKit(flock, { schema, seed, ... })` opens `$APP_DATA_DIR/app.db`, syncs the Drizzle schema, runs the boot import or the seed on a first start, and mounts the kit routes:
   - `/api/_data/<table>` (GET with `?field=value&sort=-created_at&limit=&cursor=&q=`, POST, PATCH `/:id`, DELETE `/:id`), `/api/_data/_schema` (tables, columns, allowed values, route hints for private tables), `/api/_data/_events` (server-sent change events), `/api/_data/_changes/...` (undo), `/api/_data/_samples/clear`;
   - `/api/_app` (name, icon, `display`, `settings`) and `PATCH /api/_app/settings`;
   - `/api/health`, `/api/_me`, and the chat and approval relays the paired agent uses.
   The app's own routes (`server/*-routes.ts`) are mounted on the same router beside them.
4. Every write is stamped `updated_by` (`user:<id>` or `agent:<id>`), recorded in the kit's `_changes` table so the page can offer Undo, and announced on `_events` so open pages update live.

Agents write through the same routes with `curl` and an `X-Flock-Agent` header; the per-app section says which routes and values each app expects.

## Where things live

| Layer | Where | Notes |
|---|---|---|
| Page shell | `src/App.tsx` | `AppShell` with the page list, nav, the side `AgentChat` and its starter prompts; reads name, object, accent, starters and labels with `useApp()` |
| Pages | `src/pages/*.tsx` | One file per page; shared helpers and tone maps in `src/pages/shared.ts` |
| App CSS | `src/App.css` | The app's own styles and accent override, with theme tokens only (no raw colours) |
| Component library | `src/flock/` | `ui/`, `theme/`, `objects/`, `COMPONENTS.md`, `CHANGELOG.md`, `VERSION`: written by the assemble step, never by hand |
| Backend entry | `server/index.ts` | `createFlockApp()` + `mountKit()` + the app's own routes |
| Tables | `server/db/schema.ts` | Drizzle tables, each spreading `kitColumns()` (`id`, `created_at`, `updated_at`, `updated_by`) |
| Allowed values, settings, people | `server/db/constants.ts` | Statuses, stages, slots, categories; `SETTINGS` declarations with their checks |
| Sample rows | `server/db/seed.ts` | Runs once on a first boot with empty tables and no import |
| Own routes | `server/*-routes.ts` | Totals, derived values and rules `/api/_data` cannot enforce; tested in `server/*.test.ts` |
| Manifest | `flock.app.json` | Name, icon, description, version; the platform fields; the kit fields (`pages`, `tables`, `objects`, `nav`, `chat`, `labels`, `settings`, `privateTables`, `titleFromName`); `useCases` |
| Generated catalogue | `catalog.json`, `row-schema.json`, `settings.json` | Written by Flock's `gen-schemas` from `schema.ts`, `constants.ts` and the manifest: the planner's view of the app (tables, columns, allowed values, settings and their rules), the JSON Schema an import is checked against, and each setting's declarative rule. Regenerate, never edit |
| Fixtures and tests | `e2e-rows.json`, `tests/`, `server/*.test.ts` | The end-to-end import fixture; pure tests runnable from the package; server tests run inside the built app |
| Build | `package.json` `app:build` | `bun install && tsc --noEmit && vite build && bun scripts/bundle-server.ts` |

## Build and deploy

Flock builds an installed copy, never the package in place:

1. **Assemble** (`"assemble": true`): copy the package to the app's source dir, copy the component library and the manifest's `objects` into `src/flock/`, fill `__APP_ID__` / `__APP_NAME__`, add `scripts/bundle-server.ts`, and write the platform fields of `flock.app.json`. `@flock/app-kit` and `@flock/app-sdk` are supplied into `node_modules` by Flock, at the version this Flock speaks.
2. **Build** with `buildCommand` (`bun run app:build`): type-check, build the page to `dist/`, bundle the backend into one file. The result is `.flock-out/` (`dist/`, `server/index.js`, `flock.app.json`, `row-schema.json`), the only thing deployed (`deployDir`).
3. **Start** `bun server/index.js` in the deploy dir, wait for `/api/health`, pair the app with its agent (`config.requires.agent`), and commit the source into the paired agent's workspace as `hosted-apps/<app-id>`.

A bundled backend cannot load native modules or read files next to itself at run time (`import.meta.dir`); use neither.

An installed copy that nobody edited follows its package and the component library: a new package version, or a Flock upgrade with a newer library, rebuilds it. Once the owner or their agent has changed the copy, nothing moves until the owner asks for the update from the app's settings.

## How to add things

**A page.** Add `src/pages/<Name>Page.tsx`, list it in the `pages` array in `src/App.tsx` (id, `label("nav.<id>", fallback)`, icon) and render it on its hash route. Give it `label("title.<id>", fallback)` for its heading. Add the id to `pages` and the two labels to `labels` in `flock.app.json`. `nav: "auto"` shows no nav for one page, top tabs for two to four and a side nav for five or more.

**A table.** Add a `sqliteTable` in `server/db/schema.ts` spreading `kitColumns()`, export it, and add its name to `tables` in `flock.app.json`. It appears in `/api/_data` and `_schema` at the next start; the sync adds tables and columns without approval. Removing or renaming a table or column that holds rows goes to the owner's approval queue first (health says `schema: "blocked"` until they answer), so settle the shape before real rows exist. Put its sample rows in `seed.ts`, keep an allowed-value list in `constants.ts`, and regenerate `row-schema.json` and `catalog.json`. A table only the server may write goes in `mountKit`'s `privateTables` (hidden from `/api/_data`, with a route hint); a column the server derives goes in `serverColumns`.

**A setting.** Declare it in `SETTINGS` in `server/db/constants.ts` (`key`, `type`, `default`, `label`, `scope: "owner"`, and a `check` for anything beyond the type), passed to `mountKit` as `settings`. Repeat the declaration without the check in `flock.app.json` `settings` (and `template.json` while it exists), then regenerate `settings.json` and `catalog.json`. Pages read it from `useApp().settings`, server code from `kit.settings.get(key)`; the owner or an agent changes it with `PATCH /api/_app/settings`. A bad value answers 400 naming the field; the default must pass its own check.

**A routine.** The paired agent does the recurring work and writes the result through `/api/_data` (a dashboard reading, a reminder drafted from overdue invoices): set the routine up on the agent, and point it at the routes and values the per-app section names. An app that needs its own scheduled work can declare `routines` in `flock.app.json` (see `apps/slack-desk`); pairing installs them on the agent.

**An object** (the sticker in the header or on a card). Pick one from the library with `find-object.sh`, add it to `objects` in `flock.app.json` so the assemble step copies it, and use it by name.

## Samples and import

- **Samples.** On the first start with empty tables the kit runs `seed.ts` and marks every row it wrote: `/api/_data` returns them with `"_sample": true`, pages show them lighter with a Sample chip and a banner offers **Clear samples** (`POST /api/_data/_samples/clear`). Editing a sample makes it the owner's; clearing keeps a sample that a real row points at. Keep the seed as it is and never put an owner's data in it.
- **Import.** When Flock installs the app with the owner's details already known, it writes `data/.flock/import.json` (`{ importId, by, settings?, rows, samples?, noSeed? }`) before the first start. `mountKit` applies it in one transaction after the schema sync and before any route answers: every row (parents first, `$ref` following the links `schema.ts` declares with `.references()`), the settings, and `samples` marked as samples instead of the seed. A failed import leaves the tables empty and is reported on `/api/health`. `row-schema.json` is what the request is checked against, and `e2e-rows.json` is the fixture the end-to-end flow imports.

## What must not be edited

- `src/flock/` is the component library's: the assemble step and every library update overwrite `ui/`, `theme/`, `COMPONENTS.md`, `CHANGELOG.md` and `VERSION`. App-only objects added to `src/flock/objects/` are kept. Put the app's own CSS in `src/App.css` with theme tokens.
- The platform fields of `flock.app.json`: `type`, `access`, `spa`, `apiPrefix`, `buildCommand`, `buildDir`, `deployDir`, `processConfig`, `config.requires`, `assemble`. The deploy is a bundle; do not add a prune step or a `--watch`.
- `scripts/bundle-server.ts`, the generated `catalog.json`, `row-schema.json` and `settings.json`, and the kit's own `_` tables in the database.
- The name, object, accent, starters and labels are read at run time from `display` in the installed copy's `flock.app.json` (`GET /api/_app`); what `App.tsx` passes after `??` and the second argument of each `label(key, fallback)` are only fallbacks. When `display` sets a value, change it there, or the change in code never shows.

## This app: Meal Planner

For a household's meals over the week: what's for Breakfast, Lunch and Dinner each day, the grocery list and the family's recipe book.
Start here when the owner says "plan our week…". It opens on a Schedule (today and tomorrow big, the rest of the week compact), plus a grouped shopping list and the family's own recipe book.

### Data

Three tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`.
- `meals`: one row per dish: `date` (ISO), `slot` (Breakfast, Lunch, Dinner), `dish`, and `recipe_id` (the `recipes` row it was planned from, or null for a typed dish). No tags, cook or notes.
  A meal is usually several dishes: the rows sharing a `date` and `slot` are that meal (Monday lunch = three rows: Rice, Sambar, Bhindi fry).
- `recipes`: `name` (required), `ingredients` (text, one per line, "Rajma, 1 cup"), `method` (how the family makes it, free text) and `notes`. The owner adds them; they are not derived from past meals.
- `groceries`: `item`, `aisle` (Vegetables, Dairy, Staples, Spices, Other), `done` (boolean, bought or not) and `for_dish`.

For the agent: a meal with several dishes is several `meals` rows on the same `date` and `slot`, one dish each; never "Rice, sambar, bhindi" in one `dish`. To add a dish to a meal, add a row; to change or drop one dish, change or delete only its row.
Plan a dish from the book by writing the recipe's `name` as `dish` and its `id` as `recipe_id`. To put a recipe's ingredients on the list, add one `groceries` row per ingredient line with `for_dish` set and `aisle` "Other", skipping any item already on the list and not done (match on the name before the comma). Slots are Breakfast, Lunch and Dinner: don't remove or rename them unless the owner asks.

### Pages

- `week` (src/pages/WeekPage.tsx): the **Schedule** component only, one line per date and slot with all its dishes (`LUNCH  Rice · Sambar · Bhindi fry`, wrapping on a phone; grouped by src/pages/slots.ts, tested by server/slots.test.ts).
  Each dish is its own button that opens that dish; "+ Add" at the end of a line adds another dish to that meal. Seven days from today, Today and Tomorrow large with an "+ Add breakfast" row for every empty slot,
  later days compact, empty days folded into one line, days already gone behind "Earlier". Use Schedule for any dated plan: a seven-column grid squeezes the items that matter most today.
  Previous/next 7 days (loaded by date range). Adding or changing a dish opens src/pages/MealEditor.tsx: the dish field offers the recipe book first (never planned, then furthest from that day), any dish can still be typed, and "Save as a recipe" keeps a typed dish in the book.
  A dish from a recipe offers "Add ingredients to groceries" (new items go under the Other aisle), and "Add all for this meal" when the meal's other dishes have recipes too (an item two dishes share goes on once).
  Removing a dish offers an Undo and leaves the meal's other dishes. The open dish is sent to the chat as context.
- `groceries` (src/pages/GroceriesPage.tsx): a Checklist grouped by aisle, with progress and an add row per aisle, and an "Edit items" mode to change or delete any item (with Undo).
- `recipes` (src/pages/RecipesPage.tsx): the book, searchable by name or ingredient, with Add; `#/recipe/<id>` (src/pages/RecipePage.tsx) shows one recipe's ingredients, how we make it and notes, with Edit and Delete (with Undo). The open recipe is sent to the chat as context.
  The matching, suggestion and grocery rules are plain functions in src/pages/recipes.ts, tested by server/recipes.test.ts.

### What to change first

1. The slots and aisles: server/db/constants.ts (the schema and the pages both read it). Slots are the rows of each day; keep Breakfast, Lunch and Dinner unless the owner asks.
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.
2. The seed rows in server/db/seed.ts: the sample family's recipes, two weeks of meals, most of them several dishes (so today and tomorrow are never empty) and list; replace them with the owner's real dishes and recipes.
3. The starter prompts in src/App.tsx, the page titles (each `label("title.<page>", …)`) and the nav names (`label("nav.<page>", …)` in App.tsx).
4. The accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour) and the object (`grocery-bag`; find others with find-object.sh).

### Other weekly plans (school runs, chores, appointments): only on the owner's ask

This app is for meals: a school-run rota, chores or appointments are a `checklist` (who and by when) or a `tracker`, not a planner.
Adapt the planner only when the owner asks for this week view for something else. That is a hand change (a build, or a change after the app is live), never the install: the install keeps `meals`, its Breakfast, Lunch and Dinner slots and a required `dish`.
The week is generic underneath: each row is a date, a slot and a title, and the rows sharing a date and slot show on one line. To adapt it, before the app has real rows:
1. `SLOTS` in server/db/constants.ts become the rows of the day: `["Morning drop", "Afternoon pickup"]` for school runs, `["Morning", "Evening"]` for chores, `["Morning", "Afternoon", "Evening"]` for appointments.
2. Rename in server/db/schema.ts and the pages: `meals` → `plans`, `dish` → `title`, and drop `recipe_id`. Add a column only when the job needs it: for appointments an optional `time` (text, "16:30") and `place`, shown with the title ("16:30 Dentist, Meera").
3. In src/pages/WeekPage.tsx and src/pages/MealEditor.tsx, swap the words "meal", "dish" and "breakfast" in titles and buttons (all plain strings), and take the recipe suggestions out of the editor.
4. Drop the pages that do not fit: remove `groceries` and `recipes` from `PAGES` in src/App.tsx (and their files and tables) unless a shopping list helps, and set `nav="none"` on AppShell when one page is left.
5. Rewrite the seed rows in server/db/seed.ts with the owner's real week.
