# Invoices: architecture

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

## This app: Invoices

For a small business that bills customers with GST: invoices with line items, who has paid, who is late.
Start here when the owner says "invoices", "bill my clients", "GST invoice", "who hasn't paid" or "send a payment reminder".

### Data

Four tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`. Money is rupees (decimals allowed, rounded to paise).
- `customers`: `name`, `gstin` (optional, 15 characters), `email`, `phone`, `address`.
- `invoices`: `number` (unique, like `INV-2026-0042`), `customer_id`, `issue_date`, `due_date` (ISO dates), `status`, `notes`, `bill_to`, `seller`.
- `bill_to` is the app's copy of the customer as billed (name, address, GSTIN, place of supply, IGST or not), taken by the server the moment an invoice leaves `draft`. An issued invoice is printed and taxed from this copy, so editing or deleting the customer never rewrites it; a draft follows the live customer. Never write `bill_to` by hand: the server drops one sent with a POST or PATCH. Undo does not bring an old copy back: undoing an earlier move to another customer (or undoing "Mark as sent" and sending again) takes a fresh copy from the customer as they are at that moment.
- `seller` is the app's copy of the business as it issued the invoice (name, GSTIN, address, email, payment details, state code), taken from the settings the moment an invoice leaves `draft`. Changing the settings later never rewrites an issued invoice; a draft shows the settings as they are now. Never write `seller` by hand: the server drops it like `bill_to`. Back to `draft` (only through an Undo of "Mark as sent") drops both copies, and issuing again takes fresh ones.
- `customer_id` and `invoice_id` are declared links (`.references()`): metadata only (foreign keys are off), used by the boot import's `$ref` and by Clear samples.
- `invoice_lines`: `invoice_id`, `description`, `qty`, `unit_price` (before GST), `gst_rate` (percent: 0, 5, 18 or 40, the slabs since 22 Sep 2025, or a custom rate from 0 to 100 with at most two decimals, such as 3 for gold). A line stored at an older rate (12, 28) keeps it and is taxed at it; never re-map stored rates.
- `payments`: `invoice_id`, `date`, `amount`, `method` (`upi`, `bank`, `cash` or `card`), `ref` (UTR or cheque number).

Totals are never stored. `server/db/invoice-math.ts` is the one place they are worked out: the server routes and the browser both import it.
- Tax is worked out per GST slab on the taxable total. A customer whose GSTIN starts with a different state code than the `seller_state` setting is billed IGST; everyone else (same state, or no GSTIN) gets CGST + SGST halves.
- Status is derived. `draft` and `void` are stored. An invoice that is `sent` is shown as `paid` once the payments cover the total, and as `overdue` once the due date is past and money is still owed. A hand-written `overdue` or `paid` status does not stick: record the payment instead.

### Settings: your business

These are app settings, not code. `GET /api/_app` shows them under `settings`; change them with `PATCH /api/_app/settings` (needs the owner's or an agent's identity header), for example `{"business.name": "Asha Tuition Centre", "seller_state": "32"}`.
An import (or a planned app) whose rows include a sent, paid, overdue or void invoice must give every `business.*` setting and `seller_state` (`""` for one the owner does not have): an issued invoice keeps them for good, and the defaults are the sample business. The kit refuses such an import otherwise.
- `business.name` (not empty), `business.address`, `business.email`, `business.pay` (UPI id, bank account and IFSC, printed at the foot): printed on every invoice.
- `business.gstin`: 15 characters like `29AAEPB4172K1ZB` in capitals, or `""` when the business is not registered. Checked for shape only. **An unregistered seller cannot collect GST:** with an empty GSTIN the invoice carries no tax at all (tax 0, total = subtotal, no CGST/SGST/IGST rows, no rate column on screen or in print, the editor hides the rate pickers), and the sheet is titled "Invoice", not "Tax invoice". The lines keep their stored `gst_rate`. An issued invoice keeps the registration it was issued under (its `seller` copy); a draft follows the setting. `/api/invoice/<id>` says so in `gst_registered`, and every total the routes give already leaves the tax out.
- `seller_state`: the business's two-digit GST state code, `01` to `38` or `97` (29 is Karnataka). It decides CGST + SGST versus IGST. Keep it the same as the first two digits of `business.gstin`; nothing checks that the two agree.
- `number_prefix`: 1 to 6 letters or digits, with `/` allowed after the first (GST Rule 46(b); the number adds its own dashes, and 6 keeps `PREFIX-2026-0042` within the 16 characters allowed). No spaces, dashes or other marks. A new prefix numbers new invoices only (`KS-2026-0001` onwards); issued numbers never change. Past 9,999 invoices in a year the number grows a digit, so keep the prefix short if that is likely.
- A bad value answers `400` naming the `field`, and nothing changes; a boot import with a bad value fails. The defaults and checks live in `SETTINGS` in server/db/constants.ts, which the `settings` of flock.app.json repeats (without the checks).

### Pages

- `Invoices`: money strip (outstanding, overdue, paid this month), search, a Status filter and the list with load more. Opening a row shows the invoice.
- Invoice: the printable document (your details, the customer, lines, CGST/SGST or IGST, total, received, balance due), then Payments. Buttons: Edit (drafts only), Mark as sent, Record payment, Void, Delete (drafts only, asks first, with Undo; an issued invoice is voided so its number is never reused), Print / Save as PDF.
- New invoice and Edit use the `LineItems` component: add, change and remove lines with live totals. Saving an edit that removed lines offers Undo, which brings them back.
- `Customers` (its name and the word customer follow the labels `noun.one` / `noun.many`, so a tuition app can say student / students; set both, and the nav and title follow unless `nav.customers` / `title.customers` are set): search, add, edit, delete (asks first, with Undo). A GSTIN is checked for shape only, not against the GST portal.
- Print / Save as PDF uses the browser's print dialog; the stylesheet in src/App.css prints only the invoice sheet on A4. Choose "Save as PDF" as the printer.
- The agent chat sits beside the page; the invoice or customer last opened is sent as its context.

### For an agent

Read rows through `/api/_data/<table>`; the app's own routes add up the money (pass the viewer's date as `today=YYYY-MM-DD`):
- `GET /api/invoice-list?status=overdue&today=2026-10-09` gives each invoice with `total`, `paid`, `balance`, `days_overdue` and the derived `status`. Also `q=` (number or customer name), `limit=`, `cursor=`.
- `GET /api/invoice/<id>?today=...` gives the invoice, `seller` (as issued, or the live settings for a draft), customer as billed (with the live `email` and `phone`), `place_of_supply`, lines, payments and the totals rows.
- `GET /api/invoice-summary?today=...` gives `outstanding`, `overdue`, `paid_this_month`.
- `GET /api/next-number` gives the next free invoice number.

To chase what is overdue: list `status=overdue`, read each invoice and its customer, and draft a short, polite reminder that names the invoice number, the balance and the due date. Show the draft in chat and wait for the owner's plain "yes" before anything is sent. This app has no way to send email or messages itself, so never claim a reminder went out; the owner (or an email agent they approve) sends it.
Delete only drafts: `DELETE /api/_data/invoices/<id>` on a sent, paid or void invoice answers 409 `issued`; void it instead (`PATCH` `status: "void"`), so its number is never reused.
An issued invoice is a record: a `PATCH` may change only its `status` (on to paid, back to sent when a payment is removed, or to void; never back to `draft`, and a void invoice stays void) and its `notes`. Its number, customer, dates and lines are fixed: any other change, and any `invoice_lines` write on it, answers 409 `issued`. To correct one, void it and issue a new invoice.
Create an invoice by POSTing the `invoices` row (status `draft`, a fresh number from `next-number`) and then one `invoice_lines` row per line. Record a payment by POSTing to `payments`; when it covers the balance also PATCH the invoice to `status: "paid"` so raw rows agree with the screen.

### Writing rows directly

`/api/_data` checks types, not business rules: it does not check that `gst_rate` is one of 0, 5, 18, 40 (or a deliberate custom rate) or that `status` is one of the listed values. An invoice with another rate is taxed at that rate; an unknown status is treated as `sent`. Agents must use exactly the listed values, and a custom GST rate only when the owner names it. A duplicate invoice `number` answers 409 with `field: "number"`.

### What to change first

1. Your business: the `business.*`, `seller_state` and `number_prefix` settings (`PATCH /api/_app/settings`), no code change needed. They are printed on every invoice and decide CGST/SGST versus IGST.
2. The sample rows in server/db/seed.ts: replace them with the owner's real customers and invoices (or delete the invoices and keep the customers).
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The objects are `receipt` and `handshake` (find others with find-object.sh).

### Limits

- **Keep this app private.** It holds customer data; do not make it public until Flock supports public write rules (today a public app lets any visitor read and change its data).
- Not a GST filing tool: it does not produce GSTR returns, e-invoices (IRN / QR) or e-way bills, and it does not check a GSTIN against the portal.
- One currency (INR), one tax regime (GST), no HSN/SAC column, no discounts or TDS lines; add them as columns on `invoice_lines` before the app has real rows.
- Renaming a column or table needs the owner's approval, so settle the shape before real data goes in.
- The list and totals read every invoice each time; that is fine for thousands of invoices, not for hundreds of thousands.
- Tax is rounded to the paise per slab, with CGST and SGST always equal. Rounding the total to the whole rupee (a "round off" line) is not built in; add a line at 0% GST if the owner wants one (the editor takes only prices of zero or more; a negative round-off is written through `/api/_data`).
- Email and phone are not copied: an issued invoice shows the customer's current contact details. The edit form shows the live customer, so after changing a customer's GSTIN the form's IGST/CGST note can differ from the issued copy; an issued invoice cannot be edited, so its copy stays.
- Saving an edited invoice is several writes (the invoice, then each changed line). If the connection drops half-way, the invoice can be saved with some lines not yet updated; open it again and save.
- Deleting an invoice leaves its lines and payments in place (so Undo restores everything); they are not shown anywhere without it.
