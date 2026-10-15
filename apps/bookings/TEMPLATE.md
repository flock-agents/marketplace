# Bookings

For appointments in time slots: a clinic, a salon, a tutor, a studio.
Start here when the owner says "appointments", "bookings", "slots", "who is coming today" or "let people book a time".

## Data
Two tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`.
- `services`: `name`, `minutes` (how long it takes), `price` (whole rupees). Read and write through `/api/_data/services` like any other table.
- `bookings`: `customer_name`, `phone`, `service_id`, `start`, `minutes`, `status` (booked, done, no_show, cancelled), `notes`.
  **This table is private.** It is not in `/api/_data`, so nothing can write a booking around the overlap rule. Use the routes below.
- `start` is a local date-time with no zone, `2026-10-09T10:30`, always in the shop's own time (IST). Never convert it through UTC and never add a `Z`.
- `minutes` is copied from the service when the booking is made, so changing a service later does not move old bookings. Changing a booking's `service_id` re-measures it.

## Opening hours and slot length
These are app settings, not code. `GET /api/_app` shows them under `settings`; change them with `PATCH /api/_app/settings` (needs the owner's or an agent's identity header), for example `{"hours": {...}, "slot_minutes": 20}`.
- `hours`: one key per weekday, `"0"` (Sunday) to `"6"` (Saturday), each `["HH:MM", "HH:MM"]` (24-hour, close up to `"24:00"`) or `null` for a closed day. All seven days must be there. The default is Mon-Fri 9-6, Sat 9-2, Sun 10-1.
- `slot_minutes`: minutes between the start times offered, a whole number from 5 to 240. The default is 30.
- A bad value answers `400` naming the `field`, and nothing changes; a boot import with a bad value fails. The defaults and checks live in `SETTINGS` in server/db/constants.ts, which template.json repeats (without the checks).
- A new booking must lie inside the day's hours; one that would end after closing is refused. `/api/slots` and the Book page follow a change at once.
- **Existing bookings stay valid when the hours change.** A booking now outside the hours (or on a day that is now closed) is kept, listed and shown, can be marked done, no-show or cancelled and edited, and still holds its time against new bookings. Only moving it (a new `start` or service) or bringing it back from cancelled is judged by the new hours.

## Routes agents use (no `/api/_data` for bookings)
- `GET /api/bookings?from=2026-10-09&to=2026-10-15&status=booked&limit=100&cursor=...` lists bookings in start order, each with `service_name`. `from` and `to` are dates and both are included. Paged: pass back `nextCursor`.
- `GET /api/slots?date=2026-10-09&service_id=<id>` says which start times are taken (`taken`, as `HH:MM`), with the day's `open`, `close` and `slotMinutes`. Use it to answer "when is the next free hour on Friday".
- `POST /api/bookings` with `customer_name`, `service_id`, `start` (and optionally `phone`, `notes`, `status`).
- `PATCH /api/bookings/:id` with any of those fields. To move a booking, send a new `start`.
- `DELETE /api/bookings/:id`. Prefer `PATCH` with `status: "cancelled"`: it frees the slot and keeps the record.
- The kit shows these routes to agents: `/api/_data/_schema` lists `bookings` with a `routes` hint (no columns) and the chat framing repeats it. Clicking a booking sends its record to the chat.
- A clash answers `409 { error: "slot_taken", message }` naming the booking in the way; a bad value answers `400` naming the `field`. Done, no-show and booked bookings all hold their time; only cancelled ones free it.

## Pages
- `today`: today and tomorrow big, then the next days compact, one block per day (Schedule). Click a booking to mark it done (this never re-checks opening hours) or no-show, edit, move, cancel or delete it (cancel and delete ask first, with Undo). The `+` on a day opens Book on that day. Cancelled bookings are hidden here.
- `book`: pick a day and a service, tap a free time, then say who is coming. Taken times stay visible but cannot be picked, and times already past today count as taken.
- `services`: the list, an Add form and an Edit/Delete panel.
- The agent chat sits beside the page; the booking or service last clicked is sent as its context.

## Honest limits
- **Keep this app private.** It holds customer data; do not make it public until Flock supports public write rules (today a public app lets any visitor read and change its data).
- It books one thing at a time: there is one calendar, not one per staff member or room. Two stylists working in parallel need a `resource` column and the overlap check in `server/bookings-routes.ts` (`holding`) scoped to it.
- Customers do not book themselves: the app is private. The owner or staff book, or an agent does when asked.
- The Today page lists up to 500 bookings for the week; it says so if there are more.
- Deleting a booking cannot use the kit's change log (the table is private), so Undo books the same details again. If the time was taken in between, Undo says it could not.

## What to change first
1. The hours and slot length: the `hours` and `slot_minutes` settings (`PATCH /api/_app/settings`), no code change needed.
2. The sample services and bookings in server/db/seed.ts (a small clinic in Indiranagar): replace them with the owner's real services.
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The object is `calendar` (find others with find-object.sh).
Renaming a column or table needs the owner's approval, so do it before the app has real rows.

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
