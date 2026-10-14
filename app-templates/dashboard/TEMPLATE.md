# Dashboard

For a page the owner glances at: a few key numbers, how one of them has moved, and what happened lately. Start here when the owner says
"show me how … is going" or "keep an eye on …". It is one page, and an agent keeps it current: the page reads, the agent writes.

## Data
Two tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`.
- `metrics`: one row per **reading**, never edited in place. `label` (what is measured, for example "Orders today"), `value` (a number),
  `unit` (`₹` shows as money, `min` as minutes, `%` as a percent like "64%", and any other unit is added after the number, for example "132 orders").
  The change shown under each number is worked out from the label's previous reading; it is never stored.
  The page shows the newest reading of each label as a number (the first five labels) and plots a label's readings over time as the trend.
  So to update a number, add a new reading; do not overwrite the old one, or the trend loses its history.
- `events`: things that happened. `title`, `at` (ISO date or date-time, for example `2026-10-08T14:30`), `kind` (Sale, Alert, Milestone or Note).
  The page lists the newest first.

## Keeping it current (agents)
Agents use the uniform kit routes under the app's `/api/_data`, sending `X-Flock-Agent` so each write is stamped `agent:<id>` and the page updates live:

    curl -X POST "$APP_URL/api/_data/metrics" -H "Content-Type: application/json" -H "X-Flock-Agent: $AGENT_ID" \
      -d '{"label":"Orders today","value":132,"unit":"orders"}'
    curl -X POST "$APP_URL/api/_data/events" -H "Content-Type: application/json" -H "X-Flock-Agent: $AGENT_ID" \
      -d '{"title":"Bulk order from Infosys Electronic City","at":"2026-10-08T12:15","kind":"Sale"}'

`GET /api/_data/metrics?sort=-created_at&limit=20` reads the latest readings back. A wrong value gets a 400 that names the field.
Set up a routine that posts one reading per label each time the source changes (hourly or daily is plenty), and post an event for anything worth a line.

## Pages
- `overview` (src/pages/OverviewPage.tsx): the numbers (StatStrip), a trend for one label (Chart, picked with tabs when there are several),
  the chosen label's recent readings (each with a Delete that asks first and offers Undo), and the recent events (RowList, each with an Edit and a Delete that asks first and offers Undo). `nav` is `none`: there is only this page. The agent chat sits beside it.

## What to change first
1. The seed rows in server/db/seed.ts: replace the tiffin kitchen's readings and events with the owner's own, or delete them once the agent posts real ones.
2. The page title (`label("title.overview", "Dashboard")` in OverviewPage.tsx) and the starter prompts in App.tsx.
3. The event kinds (`KINDS` in server/db/constants.ts, and `KIND_TONES` in src/pages/shared.ts), the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour) and the object (`globe`; find others with find-object.sh).
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
