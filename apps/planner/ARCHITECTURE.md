# Meal Planner: architecture

<!-- The part above "This app" is shared by every kit app and kept identical: its source is flock-agents/marketplace docs/marketplace-guide/kit-app-architecture.md. -->

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

1. **Assemble** (`"assemble": true`): copy the package to the app's source dir, copy the component library and the manifest's `objects` into `src/flock/`, add `scripts/bundle-server.ts`, and write the platform fields of `flock.app.json`. `@flock/app-kit` and `@flock/app-sdk` are supplied into `node_modules` by Flock, at the version this Flock speaks.
2. **Build** with `buildCommand` (`bun run app:build`): type-check, build the page to `dist/`, bundle the backend into one file. The result is `.flock-out/` (`dist/`, `server/index.js`, `flock.app.json`, `row-schema.json`), the only thing deployed (`deployDir`).
3. **Start** `bun server/index.js` in the deploy dir, wait for `/api/health`, pair the app with its agent (`config.requires.agent`), and commit the source into the paired agent's workspace as `hosted-apps/<app-id>`.

The app's id and name are not baked into the build: a kit runtime is built once per package version and shared by every copy of it. The page reads them at run time from the installed copy's `flock.app.json` through `GET /api/_app` (`useApp().name`), and Flock fills the `__APP_NAME__` token in `index.html`'s `<title>` each time it serves the page (`AppShell` never sets `document.title`; the title is the page's fallback name). A package with its own build command gets `FLOCK_APP_ID` / `FLOCK_APP_NAME` in the build's environment; the `__APP_ID__` placeholder in `package.json` is a legacy fallback for prebuilt packages that still carry it. A kit app names its package by its slug.

A bundled backend cannot load native modules or read files next to itself at run time (`import.meta.dir`); use neither.

An installed copy that nobody edited follows its package and the component library: a new package version, or a Flock upgrade with a newer library, rebuilds it. Once the owner or their agent has changed the copy, nothing moves until the owner asks for the update from the app's settings.

## How to add things

**A page.** Add `src/pages/<Name>Page.tsx`, list it in the `pages` array in `src/App.tsx` (id, `label("nav.<id>", fallback)`, icon) and render it on its hash route. Give it `label("title.<id>", fallback)` for its heading. Add the id to `pages` and the two labels to `labels` in `flock.app.json`. `nav: "auto"` shows no nav for one page, top tabs for two to four and a side nav for five or more.

**A table.** Add a `sqliteTable` in `server/db/schema.ts` spreading `kitColumns()`, export it, and add its name to `tables` in `flock.app.json`. It appears in `/api/_data` and `_schema` at the next start; the sync adds tables and columns without approval. Removing or renaming a table or column that holds rows goes to the owner's approval queue first (health says `schema: "blocked"` until they answer), so settle the shape before real rows exist. Put its sample rows in `seed.ts`, keep an allowed-value list in `constants.ts`, and regenerate `row-schema.json` and `catalog.json`. A table only the server may write goes in `mountKit`'s `privateTables` (hidden from `/api/_data`, with a route hint); a column the server derives goes in `serverColumns`.

**A setting.** Declare it in `SETTINGS` in `server/db/constants.ts` (`key`, `type`, `default`, `label`, `scope: "owner"`, and a `check` for anything beyond the type), passed to `mountKit` as `settings`. Repeat the declaration without the check in `flock.app.json` `settings`, then regenerate `settings.json` and `catalog.json`. Pages read it from `useApp().settings`, server code from `kit.settings.get(key)`; the owner or an agent changes it with `PATCH /api/_app/settings`. A bad value answers 400 naming the field; the default must pass its own check.

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

A household's week of meals, what the family needs to buy gathered into one cart per shopping app, a guess at what is running
out for each item, and saved recipes. The agent reasons (plans, answers the questions, copies carts to the apps, checks out);
the app stores, estimates, builds the carts and runs the clock.

**Files, one job each.** `server/index.ts` mounts the kit (`settings`, `routines`, `keepTables: OLD_TABLES`; no seed) and
the routes; `agentOps.ts` maps each operation to one of those routes, so the agent and the pages pass the same checks;
`agent-guide.md` is the `guide` text; `db/schema.ts` the twelve tables; `db/constants.ts` the closed lists, the settings,
the estimate's tuning and the 2.0 table names; `family.ts` people, the house row, the cooking days and shopping apps;
`meals.ts` the week, `plan_week`, `set_meal`, `set_dish`; `dishText.ts` a dish in one line; `regulars.ts` everyday items;
`items.ts` items, their events, order history and the answers; `estimate.ts` the estimate as pure functions; `cart.ts` carts
and their life; `cartRoutes.ts` the cart operations and keeping each app's own cart in step; `reminder.ts` what a reminder
says and does; `products.ts` remembered products and pack arithmetic (g, ml, pc); `recipes.ts` saved recipes;
`messages.ts` the texts the agent sends word for word; `dates.ts` local dates; `gate.ts` the family gate and the 2.0 profile;
`routines/` the four routines; `testkit.ts` boots the app for tests. Pages (`src/pages/`): `WeekPage` + `DishPanel`;
`ShoppingPage` with `CartPanel` (one cart per app) and `OrdersList`; `PantryPage` and `ItemPage`; `RecipesPage`;
`FamilyPage` with `RowsEditor`; `EverydayItems`; `shared.ts` and `format.ts`.

**Tables** (all public; lists are JSON text, dates `YYYY-MM-DD`, times `HH:MM`, local). `people` (child | adult | elder;
portions, diet, allergies in their own words) · `house` (one row: rules, the cook, extra slots, meals ordered in, cooking
days, connected apps, `history_synced` per app, `sync_session_id`, `profile_to_structure`, `intro_sent_at`, the check-in
times) · `plan_meals` (date, slot, draft | final, `ordered_in`) · `dishes` (in order, for everyone or named people, optional
recipe or video) · `dish_items` (item, amount, unit) · `regulars` (everyday items, `paused_until`) · `items` (one per thing
bought: group daily | few_days | monthly, unit, `subscription`, `dont_ask`, `snoozed_until`, and the cached estimate: usual
amount, lasts days, product, app, last bought, run-out, confident) · `item_events` (a purchase, an answer, an ask or an
unanswered ask, each tagged counted | early_buy | your_answer | one_off | not_counted) · `orders` (a cart; `reminder_key`)
and `order_lines` (source everyday | meal | low | added | returned) · `products` (one per item and app) · `saved_recipes`.

**Operations** (25). `guide`; the family: `set_person`, `set_house_rules`, `set_cook`, `set_slots`, `set_cooking_days`,
`set_shopping_apps`; the plan: `plan_week` (draft | final; without meals it answers the context to plan from), `set_meal`,
`set_dish`, `set_regular`; items: `import_order_history` (about 8 orders and 80 items a call, one app a call),
`record_bought_outside`, `set_item`, `set_subscription`, `answer_running_low`, `remember_product`; the reminder and carts:
`get_reminder` (afternoon | evening, with an optional date), `get_cart`, `set_cart_line`, `order_cart`, `sync_cart`,
`record_order`, `cancel_order`; `save_recipe`. The `sync-cart` intent asks the agent to make an app's own cart match a cart.

**Routines and the gate.** `weekly-plan` (Sunday 11:00) wakes the agent to plan next week on the cooking days one day a call,
each kept as planned, and to close with a `plan_week { week_start, mode: "final" }` call without meals, which carries the
Sunday message and, once, the intro. `afternoon-reminder` (15:00) and `evening-reminder` (19:00) check as a dry run whether
there is anything to say and wake the agent only then (the evening one also when an app is connected, for the day's read of
its history); each records the time it really runs at, which the intro names. The woken agent reads the order history first,
calls `get_reminder` (which puts everyday items on the carts and chooses what to ask), copies the carts to the apps
with the connectors (`sync_cart`), calls `get_reminder` again with the same date (nothing is counted twice), then sends the
message the app wrote. `order-clock` (every 15 min) closes a placed order nobody paid within
24 hours as not paid and wakes the agent with the one line to send (`unpaid_notice`, not repeated when the agent itself
recorded the order unpaid or cancelled it), and reopens a cart left `ordering` for an hour with nothing recorded. The gate
(`gate.ts`): nothing runs until one person is saved. On an upgrade, boot copies `household.profile` to
`house.profile_to_structure`; until cleared, the weekly run asks only to structure it, then plan. 2.0's 18 tables stay, unread.

**A cart's life.** One `open` cart per app collects lines: everyday items, a meal's items, an item that may be running low, what
the family added and what came back from a closed order. The family's yes (a reply, or the Order button, which sends "Order my
<App> cart"; with "Order without asking" on, the reminder's yes for the items it is sure about) moves it to `ordering`; the
agent checks out and records it `placed` (its lines are then purchases and restart their items' cycles), then `paid` or
`not_paid`. A cart not paid for 24 hours, or recorded unpaid, is `not_paid`: its purchases stop counting and its lines go
back on the app's open cart as `returned`; a late payment undoes both. `cancelled` is a cart being ordered that went back, or
a placed one let go. Lines added while a cart is `ordering` go to a new open cart of that app. The page sends the lines it
showed (`seen`) with its picks and its order, so a line added after it loaded is neither zeroed nor lost. After the family
edits a cart the app asks the agent, through the `sync-cart` intent, to copy it to the app (once per burst of edits,
SYNC_DEBOUNCE_SEC after the last, one at a time, never for Amazon, whose cart is built when the family orders).

**An item's estimate.** Events are tagged in date order. A purchase is `counted`, or `early_buy` when it came before the
usual cycle with no ask in between (both enter the pattern). It is `one_off` when its amount is under half or over twice the
usual, or its gap from the last restock under half or over twice the usual cycle; a one-off under half the usual amount is a
top-up and does not restart the item; two one-offs in a row in the same direction both count. An answer with days closes the
cycle it is in (`your_answer`); an answer before any purchase, and an ask that went unanswered, are `not_counted`. An item
never bought with a size is estimated from gaps alone. The pattern is the median of the last 5 sized amounts and cycles; the
run-out is the last restock plus the cycle (scaled when the last amount was not the usual) times the item's wait factor, or
the day the plan's amounts use up what was bought, when sooner. An item is asked about when confident (one cycle seen), not
daily, not a subscription or `dont_ask`, not snoozed, and its run-out less a lead (0, 1 or 3 days by group) has come; at most 5
asks a reminder, soonest run-out first. Two unanswered asks snooze the item; repeated misses stretch its wait factor.

**Deliberately not stored or done.** No stock count: a status is a guess from the item's events. The app never calls a
connector itself: it asks the agent (a wake, or the `sync-cart` intent). The Pantry and the item page never show which app an
item is bought on.
