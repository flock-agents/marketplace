# Calendar Desk

Keeps what has a date — your calendar, reminders you ask for, and the dates your agents find in email and Slack — and acts at the right moment: a to-do on the morning it is due, a message at the minute, a prep note before a meeting. It never writes to Google Calendar.

## What it is

A **companion app**: it runs in its own process, on its own port, with its own store. Flock
spawns it, and the two talk over two narrow seams:

Install the app — that is the whole unit. It is not owned by a skill and there is no separate
skill to install: the manifest declares the connector it needs (`config.requires.skills`) and the
two routines it owns, and pairing the app to an agent grants that agent the connector. A template
names the app directly (`apps: [{ slug: "calendar-desk" }]`).

| direction | how | what crosses |
|---|---|---|
| platform → app | HTTP `POST /lifecycle/initialize`, `/lifecycle/tick`, `GET /lifecycle/progress` | "start", "do a pass", "how far along are you" |
| app → platform | `@flock/app-sdk`'s `PlatformContext` | `progress.report`, `tasks.publish/withdraw/snooze`, `connectors.exec`, `memory.factsSince`, `agent.intent` |

Nothing else is shared. No Google Calendar event ever lands in a platform table — the app keeps its own
SQLite file under `APP_DATA_DIR` and hands the platform only the extracted memory items and the to-do rows it publishes.

## How it reads Google Calendar

The app calls the Google Calendar connector **itself**, through `platform.connectors.exec`. The platform resolves the credential and applies the per-account guard server-side, so the app never sees a token and cannot outrun the rate limit. There is no platform-side poll feeding this app — one read, made by the thing that needs it.

### The reminder source

Reminders come from three sources: ones you ask for directly (via `add_reminder`), recurring dates the app stores (birthdays, anniversaries, travel, deadlines), and **found dates** — dates your agents extract from email and Slack through `memory.factsSince`. The app ingests these daily during the hourly tick and publishes them as to-do rows the morning they are due.

### The link back to Google Calendar

Every event carries `eventKey` — a unique identifier built from the calendar and event's internal IDs.
That field becomes the `sourceRef` on published to-do rows, so a reminder's withdrawal is tied back
to the right event. A meeting's prep note includes a reference to the event.

Two things worth knowing about Google Calendar here:

- The app syncs the **primary calendar only**. Extended properties and the full attendee list are fetched only for events with a meeting within the next 24 hours, conserving quota.
- A recurring event (yearly birthday, Monday weekly) is fetched once and expanded locally to the dates it falls on within the lease window, avoiding redundant API calls.

## The routines

Two routines, declared in `flock.app.json`:

### **Add today's reminders to your list**

A daily publication (default 6am in your timezone), in `app-relay` mode. The hourly tick checks whether the time has come, and if so, publishes all reminders due today as to-do rows. Reminders with a specific time (not just a date) are sent as a message instead.

Routine is always visible on the agent's routines page, configurable and pausable there, but not deletable — deleting it would leave the app with no way to publish reminders.

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

### `list_upcoming`

Reminders and calendar events in the next days (default 14).

```
User: "What's coming up?"
Agent calls: list_upcoming({ days: 14 })
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

Google Calendar quota is consumed only during the hourly tick:

- One `calendarList` call to list your calendars (primary only is read).
- One `events.list` call per day in the lease window (30–60 days, depending on config), returning event summaries, start/end times, and attendee counts, **not** full details or extended properties.
- One `events.get` per event with a meeting time in the next 24 hours, to fetch the full attendee list and custom fields (prep note).

Total: ~2–8 calls per tick, depending on event density and prep load.

## What it never does

- Write, create, update or delete anything in Google Calendar
- Send data to Google Calendar or any other service
- Invent events or reminders not in your calendar or explicitly stored
- Read calendar streams other than the primary calendar
- Trigger on events that have not been synced in the current lease window

## Initialization

`POST /lifecycle/initialize` is fire-and-acknowledge: the app answers 202 immediately and does
the first full sync of your calendar in the background, reporting progress through `progress.report`. It is idempotent
and decides from **its own records** whether it has already run — the platform keeps no cache of
the app's initialization state, so a platform restart never re-runs a finished sync and never shows stale progress.

## Layout

```
server/
  index.ts       createFlockApp — wires lifecycle + scheduler, listens on loopback only
  lifecycle.ts   initialize / tick / progress
  sync.ts        Google Calendar read: sync windows, events, attendee expansion
  ingest.ts      Memory ingestion: found dates from email and Slack
  rules.ts       Recurrence: expand yearly/recurring dates to the lease window
  store.ts       calendar-desk.db — reminders, events, cursors, sync_state
  scheduler.ts   The minute loop: fires timed reminders and prep notes
  widget.ts      The schedule widget: today's reminders and events
  ops.ts         Agent operations: add/cancel/snooze reminders, set event notes
```

Everything that *decides* takes its inputs as arguments, so it is testable without Google Calendar or a platform.

## Building it

`bun install`. The `@flock/app-sdk` import is **supplied by the platform** at build time — its
correct version is whatever this Flock build speaks, so it is not fetched from a registry. That
is why it is declared as an *optional* peer dependency: `bun install` must not try to resolve it.
Working on this app outside Flock, you will not get a resolvable import until you copy an SDK
build into `node_modules/@flock/app-sdk` yourself.
