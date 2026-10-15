# Checklist

For one list of things to tick off together: a house move, a trip, an event, a launch. Start here when the owner says
"make me a checklist for…". It is one page: items grouped under headings, a progress bar, a filter by person and an add row.

## Data
One table, `tasks` (server/db/schema.ts), plus the kit's `id`, `created_at`, `updated_at`, `updated_by`.
`label` (required), `group_name` (the heading it sits under), `done` (true or false), `who` (a person), `due` (ISO date).

## Pages
- One page, `list` (src/pages/ListPage.tsx). `nav` is `none`, so there is no navigation, only the list.
  Items are grouped by `group_name` in the order the groups first appear (oldest item first), with a "N of M" line and a progress bar.
  The "Who" filter lists the people on the items and narrows both the list and the progress.
  Ticking an item saves at once. The add row at the end adds an item to the last group, or to "General" on an empty list.
- "Edit items" swaps the list for a table where each item can be edited or deleted (Delete asks first, then offers Undo).
- The agent chat sits beside the page.

## What to change first
1. The seed rows in server/db/seed.ts: replace the house move with the owner's own list and groups.
2. The page title (`label("title.list", "Checklist")` in ListPage.tsx) and the starter prompts in App.tsx.
3. The accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour) and the object (`notebook`; find others with find-object.sh).
4. To add a column (a link, a cost), add it in server/db/schema.ts and show it in the `meta` line in ListPage.tsx.
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
