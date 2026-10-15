# Money

For a household's money: what came in and went out, monthly budgets, investments and savings goals.
Start here when the owner says "track our money", "budget", or "where does it all go".

## Data
Four tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`. Amounts are whole rupees.
- `transactions`: `date` (ISO), `merchant`, `category`, `amount` (negative = spent, positive = received).
- `budgets`: `category`, `month` (YYYY-MM), `limit_amount`. What was spent is never stored; it is summed from the transactions.
  A month with no limits uses the latest earlier month's.
- `holdings`: `name`, `kind`, `value` (worth today), `invested`. The Change column is worked out from these on the page, never stored.
- `goals`: `goal`, `saved`, `target`, `by` (ISO date).

## Pages
- `overview`: net worth, this month's income / spent / saved, six months of income against spending, recent transactions.
- `transactions`: date range, category filter, search, load more, and an Add form. Click a row to edit or delete it (Undo puts the same row back).
- `budgets`: one bar per category, red when over. Reads the app's own route `GET /api/budget-status?month=YYYY-MM`.
- `investments`: a share bar by kind and a table of holdings; click a holding to edit or delete it.
- `goals`: a bar per goal with its date; Edit opens a goal to edit or delete.
- Five pages mean the nav is on the left. The agent chat sits beside the page; the row last clicked is sent as its context.

## The app's own routes (server/money-routes.ts, tested in server/budget-status.test.ts)
`GET /api/budget-status` and `GET /api/monthly-totals`, both with `?month=YYYY-MM` (the viewer's own current month).
Income is money in under `INCOME_CATEGORIES` (server/db/constants.ts: Salary, Freelance, Interest & dividends, Other income); investments (and their redemptions) count as saved, not spent. Any other money in, such as a refund, nets against its own category, so a category's spent never goes below zero.

## Settings
`overviewLead` (`PATCH /api/_app/settings`, no code change): what the Overview leads with. `spending` for a budget or running-costs app, `netWorth` for investments and wealth, `auto` (the default) = net worth once the owner has real holdings, spending before that (the sample holdings do not count). When the app is made, set it from what it is for.

## What to change first
1. The categories and holding kinds, all in server/db/constants.ts (new kinds of income also go in `INCOME_CATEGORIES`).
   Renaming a column or table needs the owner's approval, so do it before the app has real rows.
2. The sample rows in server/db/seed.ts: replace them with the owner's real salary, rent, budgets, holdings and goals.
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The object is `receipt` (find others with find-object.sh).

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
