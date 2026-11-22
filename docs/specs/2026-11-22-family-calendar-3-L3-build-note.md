# Family Calendar 3.0.0: L3 build note

Lane L3 of docs/specs/2026-11-22-family-calendar-3-contract.md. Branch `feat/family-calendar-3`. Built as written; the choices below
are internal (they change no other lane's side) unless marked **for the owner** or **for a lane**.

## What is where

- Data, migration: `apps/family-calendar/server/db/schema.ts`, `migrate-v2.ts` (2.x to 3.0), `migrate-v1.ts` (1.x), `reminder-events.ts`.
- `import_events`, `plan_done`, `brief`, plan-prep, the to-do outbox: `server/calendar.ts`. `due-reminders`: `server/routines.ts`.
- Planning prompt: `server/plan-prep-prompt.md`, copied into `flock.app.json` `routines[plan-prep].prompt` (manifest test keeps them equal).
- Eval: `tests/evals/plan-cases.ts` (expectations committed before the prompt), `tests/evals/plan-prep.ts` (runner).

## Internal choices

- `event_sources` and `todos` are kit tables marked private (hidden from `/api/_data`; the pages read `GET /api/events/extras`).
  The manifest's `tables` lists only `members` and `events` (Flock's schema generator requires the public ones only).
- The brief's mark, the open plan and the change log live in two tables of the app's own (`fc_meta`, `fc_log`, kept by the kit).
- To-dos are written locally first and sent to Flock after (`synced = 0` until Flock takes them), so an import or a report never
  fails because Flock is away; the hourly plan-prep run retries. A to-do ticked on Flock's Home is read back as done each hour.
- Ticking on the page: marked done on Flock's list with `tasks.complete(ref, { by })` (flock feat/group-todos, SDK 0.5.0); `by` is
  "owner" when X-Flock-Role is owner, else the proxy's X-Flock-User ("user:<id>"). 409: done here too, Flock's words kept and
  shown. 403: completed again without `by` (as the app's). 404 or an SDK without `complete`: withdrawn, as before.
- Matching: "unsure" = more than one event fits rule 2 or rule 3, or both sides name a different `who`. Rules 2 and 3 look at
  cancelled events too (a second source's cancellation of the same thing cancels it). An import never un-cancels an event.
- A field the item leaves out is never cleared by a re-send. A date or time change from the event's own source is `moved`.
- Import to-dos: key = slug of the title; a bad to-do (due after the event, show_from after due) refuses its whole item.
- plan_done: `due` before today is refused; `show_from` before today is moved to today; a re-report with the same planId is
  accepted (fixing refused steps); open steps due after a moved event's new day are pulled back to that day.
- plan-prep: at most 15 events a wake and under 18,000 characters of data (Flock refuses over 20,000); a plan not answered is
  waited for 3 hours before the same events are offered again. Hourly at minute 20.
- Due-reminders: a deadline's week-before line goes at 9:00; the nudge's `who` is the event's member (empty: everyone), as 2.1.
- `add_events` also takes `kind` (so the agent and the interview can add a due date) and `added_by` both per call and per event.
  `reminder: "evening before"` is refused with why (no silent drop). A new timed event gets 30 minutes (orchestrator, 22 Nov),
  also one typed on the page; existing events keep what they have.
- Migration: a 2.x reminder becomes a deadline event at its due time with a nudge at that time (`reminder_minutes` 0, so it is
  still said when it was due); its to-do is due on its next day from today; a one-off already past gets no to-do; the sample
  family's reminders are left behind (they would otherwise become real to-dos on the owner's Home).
- A brief's `changed` lists date moves; a time-only move is not listed (the contract's `was` is a date).

## Found while building (for the owner / Flock)

- **Where a group app's routine wake lands** (read in flock `feat/personal-mail-rules`, which has PR #355): an app-relay routine
  is created for the app's paired agent with no session (`routine-instances.ts` ensureAppRoutinesForAgent). Its wake runs in a
  run session of its own and its result line goes to the **owner's DM with that agent** (`cron.ts` reportsToChat / routineDmOf),
  not to the group room. Only an app moved into a group by `groups/app-move.ts` gets its routines bound to the room. So for a
  Family Calendar installed straight into the family group, due-reminders' lines are posted by the agent in the owner's DM
  unless the agent sends them to the group itself. (Read from the code, not run; the pairing path of an install straight
  into a group was not traced.) **For a lane (Flock):** bind a group app's routines to its group room at
  install, as app-move does. `agent.intent` likewise never uses the group room.
- `due-reminders` has no manifest `prompt` (as in 2.1); Flock's contract check flags a waking routine without one. Its words
  are in the wake's message.
