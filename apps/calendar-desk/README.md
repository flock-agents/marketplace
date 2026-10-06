# Calendar Desk

Keeps your calendar and the notes you leave on meetings, sends a prep note before a meeting, and plans what to do before upcoming events. Reminders and the owner's dated to-dos are Flock TODOs, not this app's; the steps it plans are its own tasks on the owner's list. It never writes to Google Calendar.

## What it is

A **companion app**: it runs in its own process, on its own port, with its own store. Flock
spawns it, and the two talk over two narrow seams:

| direction | how | what crosses |
|---|---|---|
| platform → app | HTTP `POST /lifecycle/initialize`, `/lifecycle/tick`, `GET /lifecycle/progress`, `POST /ops/:name` | "start", "do a pass", "how far along are you", agent operations |
| platform → app | HTTP `GET /api/widget/horizon` | the event feed Flock resolves `calendar-desk:<event id>` pointers through (labels, rail nesting, the todos skill's link check): today through the next 90 days (fact events are stored that far; Google only 7). It has no `removed` list; a deleted event's steps are withdrawn by the app |
| platform → app | HTTP `GET /api/widget/today` | the schedule widget (today through the next 7 days, each item dated); `connector` says whether Google is linked (`none` / `syncing` / `ok` / `attention`) |
| app → platform | `@flock/app-sdk`'s `PlatformContext` | `connectors.exec`, `memory.factsSince` (prep context), `memory.search` (planning facts), `agent.intent`, `tasks.publish` / `tasks.list` / `tasks.withdraw` (its own steps) |

Nothing else is shared. No Google Calendar event ever lands in a platform table — the app keeps its own
SQLite file under `APP_DATA_DIR` and hands the platform only intents and its own steps.

## Dated facts from memory

Calendar Desk also displays events extracted from your email (flights, hotels, meetings) via memory facts. These appear on Your Schedule marked as "memory" events, tagged with their source email account when known, and linked back to the mail. Duplicate events from Google Calendar are dropped.

## How it reads Google Calendar

The app calls the Google Calendar connector **itself**, through `platform.connectors.exec`. The platform resolves the credential and applies the per-account guard server-side, so the app never sees a token and cannot outrun the rate limit. There is no platform-side poll feeding this app — one read, made by the thing that needs it.

### Event identity

A Google event's `eventKey` is Google's own event id (`google_event_id`, the agenda's `data-eventid`); each recurring occurrence has its own. A moved or renamed event keeps its key, so it reads as changed, not removed and new. A row read before its id was known keeps a derived key (date + start + title) until its day passes. Memory events keep `fact:<id>`.

## The routines

Two routines, declared in `flock.app.json`:

### **Prepare me before meetings**

A recurring check every 30 minutes, in `app-relay` mode. The app's own minute loop evaluates the prep window every minute and fires when a meeting is within the window; this routine's enabled flag and config control the behavior.

Its config:
- `windowMinutes`: minutes before a meeting to send prep
- `skipAllDay`: skip all-day events
- `skipNoAttendees`: skip blocks with nobody else invited

### **Plan upcoming events**

`event-planning`, hourly at :30 in `app-relay` mode (or **Run now**). Flock runs it for the paired agent (the Personal Assistant); the planning rules ship with this app. After the tick's calendar read:

1. **Pick events**, today through 90 days, Google events and dated facts: new (no planned mark) or changed (date or start differs from the mark). An event whose details were never read waits up to 2 hours unless it is due by tomorrow. At most 20 per run (`PLAN_EVENTS_MAX`), nearest first. Nothing to plan, no wake.
2. **One plan at a time.** A plan waiting for its report blocks the next run; with no report after 2 hours it is given up and each of its events counts a failed try; after 2 failed tries (`SILENT_END_MAX`) an event is marked planned with no steps.
3. **Wake** the agent with the `plan_events` intent: `planId`, `today`, `nowLocal`, `timezone`, and per event its ref (`e1`…), title, date/time, all-day, location, guests, `new`/`changed` (a changed one also carries `was`, the date and time its steps were dated against), up to 3 memory facts (`memory.search`), and the steps already made, read back from Flock with `tasks.list` (`closed` marks one the owner closed, never to be proposed again). The planning rules ride on the intent's own instructions. While Claude usage is paused, the wake is refused (`USAGE_PAUSED`) and the next run tries again.
4. The agent links the owner's related TODOs to events itself, with the todos skill (`PATCH { event: "calendar-desk:<event id>" }`), and reports the steps with `plan_events_done`.

**Steps are this app's own tasks.** Each accepted step is published with `tasks.publish` as `step:<event id>:<key>`: title, due (timed when given), `showFrom` (it shows on the owner's list from that date), status Backlog, context `{ eventKey, why }` (a pointer only, no event title or date), and `maxDue` / `maxDueReason`. `maxDue` is the event's start (timed) or 23:59:59.999 of its day (all-day); `maxDueReason` reads like `Hampi stay, Sun 12 Oct`. Flock refuses any move past `maxDue`, from the owner, an agent or the morning sort, saying "This can't be due after <maxDueReason>". The app stores only bookkeeping: the planned mark per event and the step keys it published.

**A moved event** is offered again as changed; the agent re-dates its steps under the same keys and the app re-publishes them (new `maxDue` too). A step the owner closed is never re-published.

**Deletion withdraws.** When Google confirms an event deleted (a `getEvent` check), the app withdraws every step it published for it with `tasks.withdraw(ref, { reason })`. An agent working on one is told in its chat and decides what to do; a failed withdrawal is retried on the next tick. The owner's TODOs linked to the event keep their pointer and read as unlinked.

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

### `plan_events_done`

The report for a `plan_events` run: `{ planId, events: [{ event: "e1", steps: [{ key, title, dueDate, dueTime?, showFrom, why }] }] }`. Every offered event is listed; `steps: []` means planned, nothing needed. Checked inside the call: `planId` is the plan in flight, each ref belongs to it, at most 3 steps per event, key `^[a-z0-9-]{1,40}$`, `dueDate` and `showFrom` not before today, `showFrom` ≤ `dueDate`, not due after the event, not a step the owner closed. Answers `{ accepted: ["e1/pack"], refused: [{ item, reason }], done }` (`done` once every offered event is planned); the agent fixes refused items and calls again; 3 refused reports give the plan up.

```
Agent calls: plan_events_done({ planId: "p7", events: [{ event: "e1", steps: [
  { key: "pack", title: "Pack for Hampi trip", dueDate: "2026-10-11", showFrom: "2026-10-10", why: "Leaving on the 12th" }
] }] })
Returns: { accepted: ["e1/pack"], refused: [], done: true }
```

## The two clocks

The app has two time sources:

1. **The platform's hourly app-relay tick** (`POST /lifecycle/tick` every hour): syncs Google Calendar, withdraws the steps of events Google confirmed deleted, and runs Plan upcoming events when that routine is on. The tick is coarse because it is free — app-relay mode means the platform calls the app, not the agent, so it costs nothing beyond the calendar read, unless Plan upcoming events has events to plan and wakes the agent.

2. **The app's own minute loop** (every minute, in-process): evaluates the meeting-prep window. This loop is local and fast because it runs only the decision logic on the app's store, not against the platform or Google Calendar.

## The scrape budget

One browser-scrape `listEvents` call per sync via `connectors.exec` on the `google-calendar` skill. Cap: `DAILY_SCRAPE_CAP = 8` per account per day. Pre-prep refresh only when the last scrape is older than 2 hours (`FRESH_MS`). Scheduled scrapes on ticks at local hours 6 and 13 with a 50-minute guard. Window: today + 7 days (`KEEP_DAYS_AHEAD`).

## What it never does

- Write to Google Calendar
- Create reminders, or touch a TODO it did not publish (the owner's TODOs belong to the owner and the Personal Assistant)
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
  sync.ts            Google Calendar scrape: rate limits and window calculation; deleted events → withdrawals
  events.ts          Scrape normalization: eventKey = Google event id (derived key only without one)
  planner.ts         Plan upcoming events: pick events, build the bundle, wake plan_events
  plan-report.ts     plan_events_done: check, publish steps (showFrom, maxDue), answer
  planning-store.ts  planned marks, plans in flight, published step keys
  step-upkeep.ts     withdraw a deleted event's steps; retry failed withdrawals
  scheduler.ts       The minute loop: meeting prep; reads routine state from the hourly tick
  store.ts           calendar-desk.db — events, event_notes, preps, cursors, init_state
  widget.ts          The schedule widget: events, today through the next 7 days
  ops.ts             Agent operations: refresh the calendar, list upcoming events, set event notes, plan_events_done
```

Tables: `events, event_notes, preps, cursors, init_state, planned, plans, plan_steps`. A migration drops the old `reminders` and `fires` tables.

Everything that *decides* takes its inputs as arguments, so it is testable without Google Calendar or a platform.

## Building it

`bun install`. The `@flock/app-sdk` import is **supplied by the platform** at build time — its
correct version is whatever this Flock build speaks, so it is not fetched from a registry. That
is why it is declared as an *optional* peer dependency: `bun install` must not try to resolve it.
Working on this app outside Flock, you will not get a resolvable import until you copy an SDK
build into `node_modules/@flock/app-sdk` yourself.
