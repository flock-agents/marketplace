---
name: Google Calendar
description: View and manage Google Calendar events
icon: 📅
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: google
  setup_instructions: "Log in to your Google account via the browser session manager to access Calendar."
tier: installable
---

# Google Calendar

You can view, create, and update events on the connected Google Calendar account.

## Available Functions

Run every function with the run_skill tool, skill `google-calendar` (**Usage** below).

### listEvents
List upcoming events. Params: `{ timeMin?: string, timeMax?: string, maxResults?: number, calendarId?: string, details?: { max: number, skipIds: string[] } }`
- timeMin/timeMax: ISO 8601 datetime (e.g. "2026-05-01T00:00:00Z")
- calendarId: defaults to "primary"
- details: also read up to `max` events' detail popovers (guests, location, description, Meet link) in the same session, skipping `skipIds`; used by Calendar Desk.

### getEvent
Get a specific event by ID. Params: `{ eventId: string, calendarId?: string }`, or `{ eid: string }` (Google's own event id). `{ eid, check: true }` only answers whether the event still exists: `{ ok: true, exists }` (Calendar Desk uses it after a blank read).

### createEvent
Create a new event. Params: `{ summary: string, start: string, end: string, description?: string, location?: string, attendees?: string[], calendarId?: string }`
- start/end: ISO 8601 datetime. Times can be provided with timezone offset (e.g. `2026-05-03T15:30:00+05:30` for IST) or in UTC with Z suffix.

### updateEvent
Update an existing event. Params: `{ eventId: string, summary?: string, start?: string, end?: string, description?: string, location?: string, calendarId?: string }`

## Authentication

This skill uses a **Google browser session**. The user logs in to their Google account via the Flock dashboard browser session manager. All read and write operations work through the browser session.

If the skill is not connected or the session has expired, guide the user to set it up in **Skills & Integrations** in their Flock app.

## Usage

To execute a function, call the run_skill tool with skill `google-calendar`, the
function's name, and its params as an object.

The run_skill tool is the only way to call a function: it picks the account (pass
`"accountHint"` in the params for a non-default one) and hands the function its
Google sign-in. Never run the per-function scripts in `scripts/` yourself —
outside the run_skill tool they have no sign-in and always answer `NO_AUTH` ("No
browser session available"), whatever is connected. If the run_skill tool cannot
find the google-calendar skill, tell the owner (the install is broken); do not search the
filesystem for the skill's scripts.

Example (the run_skill tool, skill `google-calendar`):
- function `listEvents`, params `{"maxResults": 5}`
- function `createEvent`, params `{"summary": "Team standup", "start": "2026-05-03T15:30:00+05:30", "end": "2026-05-03T16:00:00+05:30"}`
