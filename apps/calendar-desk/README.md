# Calendar Desk

Keeps what has a date — your calendar, reminders you ask for, and the dates your agents find in email and Slack — and acts at the right moment: a to-do on the morning it is due, a message at the minute, a prep note before a meeting. It never writes to Google Calendar.

## What it is

A **companion app**: it runs in its own process, on its own port, with its own store. Flock
spawns it, and the two talk over two narrow seams:

| direction | how | what crosses |
|---|---|---|
| platform → app | HTTP `POST /lifecycle/initialize`, `/lifecycle/tick`, `GET /lifecycle/progress`, `POST /ops/:name` | "start", "do a pass", "how far along are you", agent operations |
| platform → app | HTTP `GET /api/widget/today` | the schedule widget; `connector` says whether Google is linked (`none` / `syncing` / `ok` / `attention`); reminders list in every state |
| app → platform | `@flock/app-sdk`'s `PlatformContext` | `tasks.publish/withdraw/snooze`, `connectors.exec`, `memory.factsSince`, `agent.intent` |

Nothing else is shared. No Google Calendar event ever lands in a platform table — the app keeps its own
SQLite file under `APP_DATA_DIR` and hands the platform only the to-do rows it publishes.

## How it reads Google Calendar

The app calls the Google Calendar connector **itself**, through `platform.connectors.exec`. The platform resolves the credential and applies the per-account guard server-side, so the app never sees a token and cannot outrun the rate limit. There is no platform-side poll feeding this app — one read, made by the thing that needs it.

### The reminder source

Reminders come from three sources: ones you ask for directly (via `add_reminder`), recurring dates the app stores (birthdays, anniversaries, travel, deadlines), and **found dates** — dates your agents extract from email and Slack through `memory.factsSince`. The app ingests these daily during the hourly tick and publishes them as to-do rows the morning they are due.

### Event identity

Event identity is a derived `eventKey` (date + start + title) because the scrape has no stable IDs. Task rows use `sourceRef = rem|<reminderId>|<occurrence>` to tie reminders back to their published rows.

## The routines

Two routines, declared in `flock.app.json`:

### **Add today's reminders to your list**

A daily publication (default 6am in your timezone), in `app-relay` mode. The hourly tick checks whether the time has come, and if so, publishes all reminders due today as to-do rows. Reminders with a specific time (not just a date) are sent as a message instead. Routine config reaches the minute loop through the state the hourly tick stores; a routine the tick has not named for 2 hours counts as off.

Its config:
- `publishHour`: which hour (0-23) to publish each morning
- `includeFound`: include dates your agents found in email and Slack
- `leadDaysBirthday`: days before a birthday/anniversary to remind
- `leadDaysTravel`: days before travel to remind
- `leadDaysDeadline`: comma-separated days before deadlines to remind (e.g. "14,3" for two weeks before and three days before)

### **Prepare me before meetings**

A recurring check every 30 minutes, in `app-relay` mode. The app's own minute loop evaluates the prep window every minute and fires when a meeting is within the window; this routine's enabled flag and config control the behavior.

Its config:
- `windowMinutes`: minutes before a meeting to send prep
- `skipAllDay`: skip all-day events
- `skipNoAttendees`: skip blocks with nobody else invited

## Operations the agent can call

The agent can manage reminders and attach prep notes to meetings:

### `add_reminder`

Store a reminder: `{ title, dueDate: 'YYYY-MM-DD', dueTime?: 'HH:MM', body?, recurrence?: 'yearly' }`.

```
User: "Remind me to call Sarah on Monday."
Agent calls: add_reminder({ title: 'Call Sarah', dueDate: '2026-10-06', dueTime: '09:00' })
Agent replies: "I'll remind you to call Sarah on Monday at 9 AM."
```

### `cancel_reminder`

Cancel a reminder by id or by matching text in the title: `{ id? | match?, ... }`.

```
User: "Cancel the call with Sarah."
Agent calls: cancel_reminder({ match: 'Sarah' })
Agent replies: "Done — the reminder to call Sarah is cancelled."
```

### `snooze_reminder`

Move a reminder to another day: `{ id? | match?, untilDate: 'YYYY-MM-DD' }`. Works for reminders already on the to-do list.

```
User: "Push that call to Wednesday."
Agent calls: snooze_reminder({ match: 'Sarah', untilDate: '2026-10-08' })
Agent replies: "Moved to Wednesday."
```

### `refresh_calendar`

Re-read Google Calendar now: `{ force?: true }`. Without `force` it honours the 2-hour freshness window; the daily scrape cap always applies. Returns `{ ok, accounts: [{ accountId, ok, events, skipped?: 'fresh' | 'cap', fault }] }`. Besides the 06:00 and 13:00 reads, every tick also does a light re-read of any account whose last scrape is over 2 hours old, so a meeting added mid-afternoon is seen the same day.

```
User: "Check my calendar again."
Agent calls: refresh_calendar({})
```

### `list_upcoming`

Reminders and calendar events in the next days (default 14). Returns `{ from, to, items: [...] }`.

```
User: "What's coming up?"
Agent calls: list_upcoming({ days: 14 })
Returns: { from: "2026-10-03", to: "2026-10-17", items: [
  { kind: "event", date: "2026-10-05", title: "Team standup", time: "09:30" },
  { kind: "reminder", date: "2026-10-06", title: "Call Sarah", time: "09:00", source: "user" }
] }
Agent replies with the calendar and list.
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

1. **The platform's hourly app-relay tick** (`POST /lifecycle/tick` every hour): syncs Google Calendar, ingests found dates from memory, publishes due reminders as to-do rows. The tick is coarse because it is free — app-relay mode means the platform calls the app, not the agent, so the routine costs nothing beyond the calendar read and the extraction.

2. **The app's own minute loop** (every minute, in-process): fires timed reminders and meeting-prep notes. This loop is local and fast because it runs only the decision logic on the app's store, not against the platform or Google Calendar.

## The scrape budget

One browser-scrape `listEvents` call per sync via `connectors.exec` on the `google-calendar` skill. Cap: `DAILY_SCRAPE_CAP = 8` per account per day. Pre-prep refresh only when the last scrape is older than 2 hours (`FRESH_MS`). Scheduled scrapes on ticks at local hours 6 and 13 with a 50-minute guard. Window: today + 7 days (`KEEP_DAYS_AHEAD`).

## What it never does

- Write to Google Calendar
- Create to-do rows for calendar events (only for reminders)
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
  ingest.ts          Memory ingestion: found dates from email and Slack
  rules.ts           Lead days and recurrence: which reminders are due today
  scheduler.ts       The minute loop: fires timed reminders and prep notes; reads routine state from the hourly tick
  store.ts           calendar-desk.db — events, event_notes, reminders, fires, preps, cursors, init_state
  widget.ts          The schedule widget: today's reminders and events
  ops.ts             Agent operations: add/cancel/snooze reminders, refresh the calendar, set event notes
  migrate-legacy.ts  Legacy reminder migration
```

Tables: `events, event_notes, reminders, fires, preps, cursors, init_state`.

Everything that *decides* takes its inputs as arguments, so it is testable without Google Calendar or a platform.

## Building it

`bun install`. The `@flock/app-sdk` import is **supplied by the platform** at build time — its
correct version is whatever this Flock build speaks, so it is not fetched from a registry. That
is why it is declared as an *optional* peer dependency: `bun install` must not try to resolve it.
Working on this app outside Flock, you will not get a resolvable import until you copy an SDK
build into `node_modules/@flock/app-sdk` yourself.
