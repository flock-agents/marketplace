# Family Calendar: the agent's guide

The app keeps a family's calendar: the members and their events, and the to-dos that go with some events. Read the app
before you answer, change it through an operation, then say what the calendar now shows. Keep none of it in memory or chat.

- **An operation:** `POST /api/apps/<this app>/ops/<name>` with its input as the JSON body (the api tool).
- **Reading:** `GET /a/<this app>/api/_data/events` (`?who=Agastya`, `?repeat[ne]=none`, `?date[gte]=2026-11-23&date[lte]=2026-11-29`,
  `?kind=deadline`, `?status=cancelled`, `?q=birthday`), `/members`; each event's sources and to-dos: `GET /a/<this app>/api/events/extras`.
- **A refusal** says in plain words what to fix (`error`), naming each event and field. Nothing of a refused call is kept:
  fix it and send the whole call again. Dates YYYY-MM-DD, times 24-hour HH:MM ("4:30 pm" is read too), weekdays Mon to Sun,
  all in the family's own time.

## The calendar holds events

- **An event** is anything with a day: a class, the school run, a pick-up, the dentist, a birthday, a holiday. Events are what
  the Week page and the Events page show, for the whole family.
- **A weekly event** (skating every Tuesday and Thursday, chess on Saturday and Sunday) is still one event per weekday: give
  its `weekdays` and the app shows it every week from then on. Never add a row for each week. A birthday or an anniversary is
  one event with `repeat: "yearly"` (a 29 February falls on the 28th in other years).
- **A due date** (the school fee by the 10th, a form by Friday, a renewal) is an event of `kind: "deadline"` on that day.
- **To-dos** (pay the fee, buy the costume, sign the form) are not rows you write. They come from the plan-prep routine (see
  below) and from what a source itself asked for, each tied to its event and shown on the family's to-do list from a few days
  before it is due. There is no reminders table and never a reminder row.
- **A cancelled event** stays on its day, struck through (`status: "cancelled"`); an import never deletes one.
- **Sources:** events that came from a school portal, an email or a group show where they came from ("from Shiva's email");
  the ones the family typed show who added them (`added_by`).

## Putting events on the calendar: `add_events`

One call takes the whole week, however many events. Use it for every event you add, also a single one; never write events
or members through `/api/_data`, one row at a time.

```
add_events { events: [
  { title: "Skating class", who: "Agastya", weekdays: ["Tue", "Thu"], start_time: "16:00", end_time: "17:30",
    notes: "Gowri Shankar drops and picks up" },
  { title: "Art class", who: "Agastya", weekdays: ["Fri"], start_time: "17:00", notes: "Gowri Shankar drops and picks up", reminder: null },
  { title: "Dentist", who: "Ankita", date: "2026-11-27", start_time: "11:00", location: "Smile Dental", reminder: 60 },
  { title: "Grandma's birthday", date: "1950-11-28", repeat: "yearly" } ],
  members: [{ name: "Agastya", emoji: "🧒" }, { name: "Gowri Shankar", emoji: "👴" }], added_by: "Shiva" }
```

- `title` is needed. `who` is the one family member the event is for, by name; leave it out for everyone. A name not in the
  family yet is added as a member, so no separate step is needed. Who drops, picks up or comes along goes in `notes`.
- **When:** `date` for an event on one day, or `weekdays` for one that happens every week (it starts on the first such day
  from today, or from `date` when you give one). From a date on: `date` with `repeat: "daily"`, `"weekly"`, `"monthly"` or
  `"yearly"`.
- `start_time` and `end_time`; neither for an all-day event (a birthday, a holiday). `location` and `notes` are free text.
- `reminder`: whole minutes before the start (`60`). A timed event is nudged 30 minutes before unless you say; `null` for
  none. There is no "evening before": the 9 pm brief already tells the family about tomorrow.
- `kind`: `"deadline"` for a day something is due by; leave it out for an event.
- `added_by`: the family member who asked you, for the whole call or on one event; the page shows "added by" them.
- `members` is optional: each `{ name, emoji?, colour? }` is added, or changed when the name is there (colours: accent, info,
  success, warning, danger). Use it for people with no event of their own yet, or to give someone an emoji.
- The same event sent again (same title, person, start time and day) changes the one there instead of adding a second.
- The first call also clears the sample family and its sample week, which a new calendar starts with.
- A call carries 16 KB at most: about 60 events. Answers `{ added, updated, members_added, samples_cleared, events }`.

To change or remove one event later, tell the family to open it on the Week page, or change that one row
(`/api/_data/events/<id>`). A repeating event is one row: changing it changes every week.

## What the app sends on its own

- **Nudges, every 15 minutes.** The app looks for what has come due: an event's `reminder` before it starts, and a due date
  a week before its day. It wakes you with the lines to send (`reminders: [{ who, text }]`): send each `text` as it is to
  the person in `who`, or to everyone when `who` is empty. So do not set up reminders, timers or routines of your own for
  what is on the calendar. Tell the family plainly what each of them will be nudged about and when.
- **Plan-prep, every hour.** When events came in from a source and are new or have moved, the app wakes you with them and
  its planning instructions (Calendar Desk's planning rules, for a family). Read the family's TODOs first and tie one that
  already covers the work; then give each event its type and decide its steps, each with a kind from the instructions'
  table (usually nothing), and report them with `plan_done`. Each step becomes a to-do on the family's list.
- **Briefs.** The morning and evening briefs read the day with `brief` (`kind: "morning"` for today, `"evening"` for
  tomorrow): the day's events, the to-dos to do, and what came in, moved or was cancelled since the last brief.
- **Imports.** Flock's own harvest puts events from the family's email and other sources on the calendar (`import_events`);
  you never call it. The same thing seen in two people's mail is one event with two sources.
