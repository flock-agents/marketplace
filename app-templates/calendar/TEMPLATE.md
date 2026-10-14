# Calendar

A plain calendar of events: what, when, and a note. Start here when the owner says "a family calendar", "keep our events",
"put this on a calendar". It has no reminders, members, categories or bookings: for clients booking slots use `bookings`, for
a trip use `itinerary`, for the week's meals use `planner`.

## Data
One table, `events` (server/db/schema.ts), plus the kit's `id`, `created_at`, `updated_at`, `updated_by`.
- `title` (required): what it is.
- `start` (required): an ISO date `YYYY-MM-DD` for an all-day event, else a local date-time `YYYY-MM-DDTHH:MM` (24h, the owner's
  own time, no `Z` and no offset).
- `end` (optional): same forms as `start`; empty for an event with no set end. A date alone (`YYYY-MM-DD`) is the last day of a
  multi-day event. Never before `start`.
- `all_day` (true or false, default false): true when `start` is a date. A timed event has a time in `start`.
- `notes` (optional): anything else, as written.
A multi-day event shows on its start day, with "until <day>" under its title.

## Pages
- One page, `calendar` (src/pages/CalendarPage.tsx). `nav` is `none`. Month and Week tabs, with Previous, Today and Next.
  - Month: the month grid (up to three events a day, then "+N more"); a click on a day lists that day's events under the grid.
    A picked event opens under itself in that list to see, edit or delete (with Undo). "Add on <day>" opens the form under the list.
  - Week: the week strip and the picked day's events; a picked event opens under itself; the "+" opens the form under the week.
  - The header's Add opens the form right under the header.
- The page reads up to 500 events (sorted by start). The agent chat sits beside the page, pointed at the picked event.

## What to change first
1. The sample events in server/db/seed.ts (dated around today, marked as samples; Clear samples removes them).
2. The page title (`label("title.calendar", "Calendar")`; a made app shows its own name there), the starter prompts in src/App.tsx
   and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
3. The object is `calendar` (find others with find-object.sh).
4. To add a column (a place, a link), add it in server/db/schema.ts, to `EVENT_FIELDS` in src/pages/shared.ts and to the panel's
   detail in CalendarPage.tsx. Renaming a column or table needs the owner's approval, so do it before the app has real rows.

## Moving from the old Family Calendar app
The Family Calendar marketplace app (`family-calendar`) is replaced by this template. When Flock hands you the move, read every
old event with `GET /a/<old-id>/api/events` (no `from`/`to`: it then returns all of them, each with `memberName`). Map each one:
- `title` → `title`.
- `startTime` → `start`, `endTime` → `end`, in the owner's local time as `YYYY-MM-DDTHH:MM` (convert a `Z` or offset time to the
  owner's time zone; drop seconds). Leave `end` empty when it equals `start`. An event from 00:00 to 23:59 (or to 00:00 a later day)
  is all day: `all_day: true`, `start` its first date, `end` its last date (empty for one day).
- `notes` → `notes`, with the member's name first when the event has one: `"Aarav: bring the football kit"`, or just `"Aarav"`
  when there are no notes. Category is not kept.
- `status`: `confirmed` and `done` move as they are; `tentative` moves with `"Tentative."` at the start of `notes`. A `cancelled`
  event (not an old-app status, but an agent may have written one) is skipped and named to the owner.
Reminders are not moved, and member colours and emoji are not kept: say so when you ask to retire the old app
("Your new Calendar shows your 12 events; the 4 reminders and the member colours are not in it.").

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
