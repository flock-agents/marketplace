# Tracker

For rows with a status that move through stages: vendors, candidates, applications, leads, quotes.
Start here when the owner says "keep track of…". It has a list with filters and search, and a page per row.

## Data
One table, `items` (server/db/schema.ts), plus the kit's `id`, `created_at`, `updated_at`, `updated_by`.
`title` (required), `status` (New, In progress, Waiting, Done), `owner`, `due` (ISO date), `priority` (Low, Normal, High),
and `notes`.

## Pages
- `list` (src/pages/ListPage.tsx): the numbers (open, waiting, overdue, due this week), search, a status filter, open rows first,
  the table with load-more, and an Add form.
- `detail` (src/pages/DetailPage.tsx, route `#/item/<id>`): every field, an inline edit form, and Delete with a confirm and an Undo that restores the very same row (through the kit's change log).
- The agent chat sits beside the page. The open row is sent as its context.

## What to change first
1. The schema: rename `items`, drop the columns you don't need, change the statuses (also in src/pages/shared.ts).
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.
2. The seed rows in server/db/seed.ts: replace the renovation vendors with the owner's real kind of rows.
3. The page titles (`label("title.list", "Tracker")` in ListPage.tsx), the nav name and the starter prompts in App.tsx.
4. The accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour; none means coral) and the object (`clipboard`; find others with find-object.sh).

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
