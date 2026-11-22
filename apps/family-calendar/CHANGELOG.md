# Changelog

## 3.0.0

Needs Flock 0.19.0 or later.

- **The calendar holds events; to-dos come with them.** There is no Reminders page or reminders table any more. A due date (the school fee by the 10th, a form by Friday) is an event of kind *deadline* on that day. What someone must do before an event (pay the fee, buy the costume, sign the form) is a to-do tied to that event, on the family's to-do list in Flock, hidden until a few days before it is due. Each event shows its to-do count; a tap lists them and a tick settles one: on a Flock whose app SDK has `tasks.complete` (0.5.0) it is marked done on the family's list as the person who ticked it (one someone had already done says who), and on an older Flock it is taken off the list.
- **Events from the family's email and other sources** (`import_events`, called by Flock's own harvest): each comes in with where it came from ("from Shiva's email"). The same thing seen in two people's mail, or from two sources, is one event with two sources; when the app is not sure two items are the same, it keeps both. A re-send changes nothing. A source that calls an event off marks it cancelled: it stays on its day, struck through, and its open to-dos are taken off the list.
- **What to do before each imported event** (the *Plan what to do before events* routine, hourly): new or moved events from a source are handed to the family's agent, which decides what the family must physically do before each (buy, pay, sign and return, send, book, collect; usually nothing, at most 3 steps) and reports it with `plan_done`. Typed-in and repeating events are never planned. Nothing new: no wake, no model call.
- **Planned as Calendar Desk plans.** The hourly planning follows Calendar Desk's rules: the family's existing TODOs are read first and one that already covers the work is tied to the event instead of a new step; each event gets a type and each step a kind from one table (Calendar Desk's, with a `deadline` type and three family kinds: sign and return, buy for the event, send to school), which the app checks; a kind the family dismissed twice as not important is not proposed again (at a place too: a cab to the same clinic); long-lead work (a passport renewal) is due weeks ahead but shows only when it is time to start; a moved event's steps move with it under the same keys, a timed one keeping its lead; at most 3 steps, and the planner never asks. A step Flock finds an existing TODO for is covered by it.
- **In "Your Schedule".** The app serves Flock's schedule widget (`schedule`, Calendar Desk's format, `plansEvents: true`): the family's events from the day asked for through the next 7, repeating ones on each day they fall on, cancelled ones left out, each tagged with who it is for. Flock shows them to everyone who may open the app; the PA's morning sort shows them but never proposes steps for them.
- **A brief for the morning and the evening** (`brief`): today's or tomorrow's events with their sources and to-dos, the to-dos to do, and what came in, moved or was cancelled since the last brief. Family Butler's 8 am and 9 pm briefs read it.
- **Events can repeat every year** (a birthday, an anniversary; a 29 February falls on the 28th in other years). An event shows who added it.
- **Nudges.** A timed event is nudged 30 minutes before unless it says otherwise; a deadline is spoken of a week before. There is no "evening before" reminder: the 9 pm brief covers tomorrow.
- **Updating keeps everything.** On the first start after the update, each reminder becomes a deadline event on its due date (repeating as it did) with one to-do, due on its next day; a one-off already past comes across with no to-do, and the sample family's reminders are left behind. An event's reminder of exactly the old "evening before" value is cleared. The 2.x reminders stay in the app's database, untouched, as `v2_reminders_moved`. A 1.x install updated straight to 3.0 gets the same.

## 2.1.0

Needs Flock 0.19.0 or later.

- **Events can repeat.** An event has a Repeat (once, every day, every week, every month). One that happens every week is kept once and shown on the Week page in every week, and once on the Events page at the next day it falls on. An existing calendar keeps its events as they are.
- **A week in one go.** The agent adds a family's events in one step (`add_events`): each with who it is for, a date or the weekdays it happens on, its times, a note and a reminder. A person not in the family yet is added. A mistake refuses the whole step and says which event and which field. Until now it wrote one row at a time, and a child's classes ended up as reminders that the week did not show.
- **Reminders that are sent.** An event's reminder ("the evening before", or minutes before) and the reminders on the Reminders page are now handed to the agent when they come due, with the words to send. The app checks every 15 minutes.
- **A guide for the agent** (`guide`): what is an event and what is a reminder, and how to add them.

## 2.0.3

- The icon is the app's own illustration (`icon.svg`, the calendar drawn in its header), in place of the 1.x calendar tile.

## 2.0.2

- The move from 1.x holds up when an update does not go straight through:
  - an import left behind by an update that was rolled back is replaced with the 1.x rows as they are now, so a row added after that attempt comes across too;
  - when another import is already waiting, the 1.x tables are still set aside (kept), and their rows come across on the next start, once the other import is in;
  - when the kept names (`v1_members`, `v1_events`, `v1_reminders`) are already taken, the 1.x tables go to the next free names (`v1_members_2` and so on) and the app starts as usual instead of failing on every start.
- A 1.x reminder with any status other than pending (done, dismissed, cancelled…) whose time has not come is left out, as a done one already was; one whose time has passed comes across as before.
- Whether the 1.x rows have come across is now read from the kit's own record of applied imports, so a start interrupted at any point is finished by the next.

## 2.0.1

- An install updated from 1.x keeps its family's data. On the first start after the update, the 1.x members, events and reminders are carried into the new tables:
  - a member keeps its name and emoji, and its colour becomes the nearest theme tone;
  - an event keeps its title, date, start time, end time when it ends the same day, member (as `who`) and notes. An event that ran midnight to midnight becomes all-day. The category, a status other than confirmed, and the end of an event that runs past its day are written into its notes;
  - a reminder keeps its title and due time as a one-off, for its event's member. A reminder already marked done whose time has not come is left out.
- The 1.x tables stay in the app's database, untouched, as `v1_members`, `v1_events` and `v1_reminders`. Nothing is deleted. An install whose 1.x tables were empty starts with the sample family, like a new one.

## 2.0.0

- Rebuilt on the Flock component library as a kit app: a `week` page (this week's events as a Schedule, today and tomorrow big), an `events` page (every upcoming event, with add, edit and delete in place) and a `reminders` page (one-off, daily, weekly and monthly reminders, the one due soonest first), with the agent chat beside the page.
- New data model: `members` (name, colour, emoji), `events` (title, date, start and end time, who, location, notes, minutes before to remind) and `reminders` (title, when it is due, how it repeats, who), read and written through `/api/_data` like every kit app.
- Sample rows (a small family's week: the school run, football, the dentist, grandma's birthday) marked as samples the owner can clear.
- Needs Flock 0.15.0.

## 1.0.3

- The build installs the server's dependencies too (`bun install` at the app root, then the frontend). 1.0.2 only installed the frontend, so `bun run server/index.ts` failed on every start with `Cannot find package 'hono'`. The app now carries its own `package.json` and `bun.lock` for the server, as Meal Planner does.

## 1.0.2

- Builds with bun instead of npm.

## 1.0.1

- SVG icon served by the app and listed in the marketplace.

## 1.0.0

- First release.
