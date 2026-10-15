# Itinerary

For a trip reference: the day-by-day plan, bookings, packing and what it all costs.
Start here when the owner says "plan our trip", "holiday itinerary", or "what have we booked".

## Data
Four tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`. Amounts are whole rupees.
- `plan`: `day` (ISO date), `time` (24h HH:MM), `kind` (flight | stay | food | do), `title`, `detail`.
- `bookings`: `what`, `ref`, `when` (ISO date), `status` (Confirmed | Pending | Cancelled), `cost`, `plan_id` (the plan item it books, or empty).
  `plan_id` is declared with `.references(() => plan.id)`: foreign keys are off, so nothing is enforced, but the boot import's `$ref` and Clear samples follow it
  (a sample plan item that a real booking points at is kept).
- `packing`: `item`, `who` (Shared or a traveller), `packed`.
- `trip_budget`: `category`, `spent`, `limit_amount`.

## Pages
- `plan`: a timeline grouped by day; picking a row points the chat at it and opens it above the timeline to edit or delete (with Undo).
- `bookings`: a table with a status colour per row; click a row to edit or delete it (with Undo).
- `packing`: a checklist grouped by who is packing, with progress.
- `budget`: totals, then a bar per category, red when over.
- Four pages mean the nav is on top. The agent chat sits beside the page.

## What to change first
1. The travellers (`PEOPLE` in server/db/constants.ts) and the budget categories.
   Renaming a column or table needs the owner's approval, so do it before the app has real rows.
2. The sample trip in server/db/seed.ts: replace it with the owner's real dates, bookings and packing list.
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The object is `plane` (find others with find-object.sh).

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
