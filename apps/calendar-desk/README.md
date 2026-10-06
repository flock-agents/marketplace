# Calendar Desk

Keeps your calendar and the notes you leave on meetings, and sends a prep note before a meeting. Reminders and dated to-dos are Flock TODOs, not this app's. It never writes to Google Calendar.

## What it is

A **companion app**: it runs in its own process, on its own port, with its own store. Flock
spawns it, and the two talk over two narrow seams:

| direction | how | what crosses |
|---|---|---|
| platform → app | HTTP `POST /lifecycle/initialize`, `/lifecycle/tick`, `GET /lifecycle/progress`, `POST /ops/:name` | "start", "do a pass", "how far along are you", agent operations |
| platform → app | HTTP `GET /api/widget/horizon` | the event planner's feed: the same events and items, today through the next 90 days (fact events are stored that far; Google only 7), plus `removed: [{ id, date }]` — Google events a clean read that saw rows found gone (a blank read hides the day but is not listed), so the planner drops their steps at once |
| platform → app | HTTP `GET /api/widget/today` | the schedule widget (today through the next 7 days, each item dated); `connector` says whether Google is linked (`none` / `syncing` / `ok` / `attention`) |
| app → platform | `@flock/app-sdk`'s `PlatformContext` | `connectors.exec`, `memory.factsSince` (prep context), `agent.intent` |

Nothing else is shared. No Google Calendar event ever lands in a platform table — the app keeps its own
SQLite file under `APP_DATA_DIR` and hands the platform nothing but prep intents.

## Dated facts from memory

Calendar Desk also displays events extracted from your email (flights, hotels, meetings) via memory facts. These appear on Your Schedule marked as "memory" events, tagged with their source email account when known, and linked back to the mail. Duplicate events from Google Calendar are dropped.

## How it reads Google Calendar

The app calls the Google Calendar connector **itself**, through `platform.connectors.exec`. The platform resolves the credential and applies the per-account guard server-side, so the app never sees a token and cannot outrun the rate limit. There is no platform-side poll feeding this app — one read, made by the thing that needs it.

### Event identity

Event identity is a derived `eventKey` (date + start + title) because the scrape has no stable IDs.

## The routines

One routine, declared in `flock.app.json`:

### **Prepare me before meetings**

A recurring check every 30 minutes, in `app-relay` mode. The app's own minute loop evaluates the prep window every minute and fires when a meeting is within the window; this routine's enabled flag and config control the behavior.

Its config:
- `windowMinutes`: minutes before a meeting to send prep
- `skipAllDay`: skip all-day events
- `skipNoAttendees`: skip blocks with nobody else invited

## Operations the agent can call

The agent can read the calendar and attach prep notes to meetings:

### `refresh_calendar`

Re-read Google Calendar now: `{ force?: true }`. Without `force` it honours the 2-hour freshness window; the daily scrape cap always applies. Returns `{ ok, accounts: [{ accountId, ok, events, skipped?: 'fresh' | 'cap', fault }] }`. Besides the 06:00 and 13:00 reads, every tick also does a light re-read of any account whose last scrape is over 2 hours old, so a meeting added mid-afternoon is seen the same day.

```
User: "Check my calendar again."
Agent calls: refresh_calendar({})
```

### `list_upcoming`

Calendar events in the next days (default 14). Returns `{ from, to, items: [...] }`.

```
User: "What's coming up?"
Agent calls: list_upcoming({ days: 14 })
Returns: { from: "2026-10-03", to: "2026-10-17", items: [
  { kind: "event", date: "2026-10-05", title: "Team standup", time: "09:30" }
] }
Agent replies from the list.
```

### `set_event_note`

Attach what you should do before a meeting: `{ match: { date: 'YYYY-MM-DD', titleContains: '...' }, note }`.

```
User: "Prepare talking points for the product review on Monday."
Agent calls: set_event_note({ match: { date: '2026-10-06', titleContains: 'product review' }, note: '...' })
Agent replies: "I've attached that to the meeting."
```

## The two clocks

The app has two time sources:

1. **The platform's hourly app-relay tick** (`POST /lifecycle/tick` every hour): syncs Google Calendar. The tick is coarse because it is free — app-relay mode means the platform calls the app, not the agent, so it costs nothing beyond the calendar read.

2. **The app's own minute loop** (every minute, in-process): evaluates the meeting-prep window. This loop is local and fast because it runs only the decision logic on the app's store, not against the platform or Google Calendar.

## The scrape budget

One browser-scrape `listEvents` call per sync via `connectors.exec` on the `google-calendar` skill. Cap: `DAILY_SCRAPE_CAP = 8` per account per day. Pre-prep refresh only when the last scrape is older than 2 hours (`FRESH_MS`). Scheduled scrapes on ticks at local hours 6 and 13 with a 50-minute guard. Window: today + 7 days (`KEEP_DAYS_AHEAD`).

## What it never does

- Write to Google Calendar
- Create reminders or to-do rows (those are Flock TODOs)
- Post anything itself (the Personal Assistant speaks)

## Initialization

`POST /lifecycle/initialize` is fire-and-acknowledge: the app answers 202 immediately and does
the first full sync of your calendar in the background, reporting progress through `progress.report`. It is idempotent
and decides from **its own records** whether it has already run — the platform keeps no cache of
the app's initialization state, so a platform restart never re-runs a finished sync and never shows stale progress.

## Layout

```
server/
  index.ts           createFlockApp — wires lifecycle + scheduler, listens on loopback only
  lifecycle.ts       initialize / tick / progress
  sync.ts            Google Calendar scrape: rate limits and window calculation
  events.ts          Scrape normalization: eventKey derivation from date/start/title
  scheduler.ts       The minute loop: meeting prep; reads routine state from the hourly tick
  store.ts           calendar-desk.db — events, event_notes, preps, cursors, init_state
  widget.ts          The schedule widget: events, today through the next 7 days
  ops.ts             Agent operations: refresh the calendar, list upcoming events, set event notes
```

Tables: `events, event_notes, preps, cursors, init_state`. A migration drops the old `reminders` and `fires` tables.

Everything that *decides* takes its inputs as arguments, so it is testable without Google Calendar or a platform.

## Building it

`bun install`. The `@flock/app-sdk` import is **supplied by the platform** at build time — its
correct version is whatever this Flock build speaks, so it is not fetched from a registry. That
is why it is declared as an *optional* peer dependency: `bun install` must not try to resolve it.
Working on this app outside Flock, you will not get a resolvable import until you copy an SDK
build into `node_modules/@flock/app-sdk` yourself.
