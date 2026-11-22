# Family Calendar: architecture

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

## This app: Family Calendar

For a household's calendar: who is where and when, the one-offs (the dentist, a school trip) beside the things that happen every week (the school run, football) and every year (grandma's birthday), the days things are due by, and what the family must do before them.
Start here when the owner says "our week", "the family calendar", "remind everyone…", "what do we need for the trip" or "who is picking up…". It opens on a Schedule (today and tomorrow big, the rest of the week compact), with every upcoming event as a list. The shared contract with Flock and Family Butler is docs/specs/2026-11-22-family-calendar-3-contract.md (marketplace repo).

### Data

Four tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`. The first two are on `/api/_data`; the last two are the app's own (mountKit `privateTables`, server/calendar.ts `PRIVATE_TABLES`): written only by its routes, read by the pages through `GET /api/events/extras`.
- `members`: the family. `name` (required), `colour` (a theme tone: accent, info, success, warning, danger; never a hex colour) and `emoji`.
- `events`: one row per event. `title` and `date` (required), `repeat` (none, daily, weekly, monthly, yearly; a 29 February falls on the 28th in other years), `monthly_by` (a monthly event: empty or `date` for its day of the month, `weekday` for its weekday of the month, the 1st Sunday, or `last_weekday` for the last such weekday; a 5th weekday is refused by add_events, and one typed in falls only in the months that have one), `start_time` and `end_time` ("16:30"; both empty for all day), `who` (a member's `name`, or empty for everyone), `location`, `notes`, `reminder_minutes` (the nudge before the start; 30 for a new timed event unless it says), `kind` (event, or deadline: a day something is due by), `status` (active, or cancelled: kept, struck through), `added_by` (the member who typed it in; empty for an import), `imported` (1 for an event `import_events` made: only these are planned), `planned_at` and `plan_basis` (when its prep was planned, and the date and time it was planned for).
  Something that happens every week is one row with `repeat` weekly; the pages work out its days (`occurrences` in src/pages/dates.ts).
- `event_sources`: where an imported event was seen, one row per source and item: `event_id`, `source` ("email:<personId>"), `ref` (the source's stable item ref), `label` (shown: "Shiva's email"), `match` (JSON identifiers: Message-ID, PNR, invoice number), `first_seen_at`, `last_seen_at`. Two people's copies of one mail are one event and two rows.
- `todos`: an event's to-dos as the app published them to Flock's to-do list (`tasks.publish`, sourceRef `event:<event id>:<key>`, `due`, `showFrom`): `key`, `title`, `due`, `show_from`, `why`, `status` (open, done, withdrawn), `closed_at`, `done_by` (who ticked it in the app), `done_note` (Flock's words when someone else had done it) and `synced` (0 until Flock has this version; a write never waits on Flock, and what Flock did not take goes on the next run).
- The app's bookkeeping, outside the kit (`keepTables`): `fc_meta` (the open plan, the brief's mark, the update's marks) and `fc_log` (what imports added, moved or cancelled, for the brief).

Updates keep everything: a 2.x `reminders` table is renamed `v2_reminders` before the kit starts (so its sync never asks to delete it) and its rows become deadline events with one to-do each, after which it is `v2_reminders_moved` (server/db/migrate-v2.ts). A 1.x install keeps `v1_*` tables (server/db/migrate-v1.ts). The pages and `/api/_data` never read the kept tables.

### The agent's operations

Declared in flock.app.json `agentInterface.operations` and served by server/agentOps.ts; the guide is server/agent-guide.md; server/manifest.test.ts holds them to the code.
- `add_events` (server/events.ts, `POST /api/events/add`): a family's week in one call, checked whole. `weekdays` makes one weekly row per weekday; `repeat` yearly for a birthday; `monthly_by` weekday or last_weekday for the first Sunday or the last Friday of every month (a monthly event sent again matches on the weekday of the month as the call reads it, so one first kept by date is changed, not doubled); `kind` deadline for a due date; `added_by` who asked; `reminder` minutes or null (there is no "evening before").
- `import_events` (server/calendar.ts): Flock's harvest pushes a source's items. Matching, in order: the same source and ref; a shared `match` identifier on the same date; the same date with alike titles (one word set inside the other, or Jaccard 0.5 or more) and times within an hour. Rules 2 and 3 look only at events that do not repeat, and match only when exactly one event fits and a set `who` agrees: when unsure, both are kept. A match adds a source row; only the event's own source changes its fields (a date change from it is a move, `plan_basis` kept); another source only fills empty fields; an import never un-cancels. Idempotent; per-item refusal; 50 items and 32 KB per call.
- `plan_done` (server/calendar.ts): the agent's report for a plan-prep wake, checked as Calendar Desk checks plan_events_done. Each event needs a type (server/kinds.ts `EVENT_TYPES`: Calendar Desk's with `deadline`); each step a kind from the table (server/kinds.ts `KINDS`: Calendar Desk's with `sign-and-return`, `buy-for-event`, `send-to-school`) that fits the type; a kind the family dismissed the last two of (server/tally.ts, from Flock's `tasks.list`) is refused, at a place too; a step must be due on or before its event (before its start, with a `due_time`) and not before today, show from on or before its due, keep an event at 3 open steps at most, and never re-make a closed or covered key. A tier 1 or 2 step goes to Flock with `cover`: when the family already has that TODO, Flock ties it and the step is `covered`. Every event listed with a type is marked planned for the date and time it was offered on.
- `brief` (server/calendar.ts): morning (today) or evening (tomorrow): the day's events with sources and open to-dos, the to-dos to do, and the imports added, moved or cancelled since the last brief of either kind (the call moves that mark).

### The routines

- `due-reminders` (every 15 minutes, server/routines.ts): what came due since its last run (an event's `reminder_minutes` before each day it falls on; a deadline a week before its day at 9 am; never a cancelled event) is handed to the agent with the words to send, `{ reminders: [{ who, text }] }`. Nothing due: no wake. A run looks back an hour at most.
- `plan-prep` (hourly, `prompt` in flock.app.json, its source server/plan-prep-prompt.md with the kinds table rendered in by `bun tests/embed-prompt.ts`; Calendar Desk's planning instructions for a family): imported, active events from today to 90 days ahead, never planned or no longer on the date and time they were planned for, are handed to the agent (at most 15 a wake, under Flock's 20,000-character data limit). Nothing to plan, or a plan still waiting (3 hours): no wake. Each run first reads back what the family ticked on Flock's list and sends any to-do Flock has not got. The prompt's eval: tests/evals/plan-prep.ts with tests/evals/plan-cases.ts.

### The schedule widget

`GET /api/widget/schedule?from=YYYY-MM-DD` (server/widget.ts; flock.app.json `widgets`: `{ id: "schedule", kind: "schedule", plansEvents: true }`): Flock's "Your Schedule" feed, in Calendar Desk's wire format (`{ template: "schedule", date, connected, fault, connector, items }`, each item a ScheduleItemWire of kind `event`), from `from` (else today) through the next 7 days. A repeating event is an item per day it falls on (`<id>@<date>`), a one-off keeps its event id (the id a TODO's pointer `<appId>:<id>` names); cancelled events are left out; `calendar` carries who it is for; no item has a link (Flock gives every item the app agent's chat). `plansEvents: true` tells Flock the app plans its own events (plan-prep).

### Pages

- `week` (src/pages/WeekPage.tsx): the Schedule, seven days from today, each event with its time, who, where, a small line saying where it came from ("from Shiva's email") or who added it, and its open to-do count. A cancelled event stays on its day, struck through. A tap opens the event in place: its to-dos with ticks (src/pages/EventTodos.tsx) above the editor (src/pages/EventEditor.tsx). The family sits under the week (src/pages/FamilyList.tsx).
- `events` (src/pages/EventsPage.tsx): every event from today on as a Table (what with its source line, when, time, who, where, to-dos), a repeating one once at its next day; Add under the header, a tap opens the event in place with its to-dos.
- A tick settles the to-do in the app and marks it done on Flock's list as the person who ticked it (`POST /api/todos/done`, then the SDK's `tasks.complete` with `by`: "owner", or the proxy's X-Flock-User). Already settled there (409): done here too, with Flock's words for who did it. A 404, or an SDK without `complete`: taken off the list instead (an older Flock).

### What to change first

1. The family in server/db/seed.ts: replace it with the owner's real household.
2. The colours a member can have: `COLOURS` in server/db/constants.ts.
3. The page titles and nav names, the starter prompts in src/App.tsx and the accent.
4. The object is `calendar`; the icon is the package's own `icon.svg`.
Renaming a column or table needs the owner's approval, so do it before the app has real rows.

### Honest limits

- A repeating event is one row, so it has no exceptions: one week cannot be skipped or moved, and it has no last day.
- The app decides what is due and wakes the agent with the words; with no agent paired, or on a Flock older than 0.19.0, nothing is sent.
- A nudge is said within 15 minutes after it is due, in the time of the machine Flock runs on.
- On a Flock older than `tasks.complete`, a to-do ticked on the page is taken off Flock's list, not marked done there. One ticked on Flock's list is read back as done within the hour.
- The brief's `changed` lists a move of date; a move of time on the same day is not listed.
- The week view lists up to 500 events for its seven days, and up to 500 repeating ones.
