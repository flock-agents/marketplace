# Family Calendar: the agent's guide

The app keeps a family's calendar: the members, their events and a few reminders. Read the app before you answer, change it
through an operation, then say what the calendar now shows. Keep none of it in memory or chat.

- **An operation:** `POST /api/apps/<this app>/ops/<name>` with its input as the JSON body (the api tool).
- **Reading:** `GET /a/<this app>/api/_data/events` (`?who=Agastya`, `?repeat[ne]=none`, `?date[gte]=2026-11-23&date[lte]=2026-11-29`,
  `?q=birthday`), `/members`, `/reminders`.
- **A refusal** says in plain words what to fix (`error`), naming each event and field. Nothing of a refused call is kept:
  fix it and send the whole call again. Dates YYYY-MM-DD, times 24-hour HH:MM ("4:30 pm" is read too), weekdays Mon to Sun,
  all in the family's own time.

## Events and reminders are different things

- **An event** is something that happens at a time: a class, the school run, a pick-up, the dentist, a birthday, a holiday.
  Events are what the Week page and the Events page show. Anything the family does on a day goes here.
- **A weekly event** (skating every Tuesday and Thursday, chess on Saturday and Sunday) is still an event. Give its
  `weekdays`: the app keeps one event per weekday and shows it every week from then on. Never add a row for each week.
- **A reminder for an event** is not a row of its own: it is the event's `reminder` ("evening before", or minutes before
  the start). The app works out when it is due, every week for a weekly event.
- **The Reminders page** is only for a nudge with no event behind it ("pack the PE kit every Monday 7:30", "pay the school
  fee by the 10th"). A class, a drop or a pick-up put there shows nowhere on the week: it is an event.

## Putting events on the calendar: `add_events`

One call takes the whole week, however many events. Use it for every event you add, also a single one; never write events,
members or their reminders through `/api/_data`, one row at a time.

```
add_events { events: [
  { title: "Skating class", who: "Agastya", weekdays: ["Tue", "Thu"], start_time: "16:00", end_time: "17:30",
    notes: "Gowri Shankar drops and picks up", reminder: "evening before" },
  { title: "Art class", who: "Agastya", weekdays: ["Fri"], start_time: "17:00", notes: "Gowri Shankar drops and picks up" },
  { title: "Dentist", who: "Ankita", date: "2026-11-27", start_time: "11:00", location: "Smile Dental", reminder: 60 } ],
  members: [{ name: "Agastya", emoji: "🧒" }, { name: "Gowri Shankar", emoji: "👴" }] }
```

- `title` is needed. `who` is the one family member the event is for, by name; leave it out for everyone. A name not in the
  family yet is added as a member, so no separate step is needed. Who drops, picks up or comes along goes in `notes`.
- **When:** `date` for an event on one day, or `weekdays` for one that happens every week (it starts on the first such day
  from today, or from `date` when you give one). From a date on: `date` with `repeat: "daily"`, `"weekly"` or `"monthly"`.
- `start_time` and `end_time`; neither for an all-day event (a birthday, a holiday). `location` and `notes` are free text.
- `reminder`: `"evening before"` (7 pm the day before) or whole minutes before the start (`60`). Leave it out for none.
- `members` is optional: each `{ name, emoji?, colour? }` is added, or changed when the name is there (colours: accent, info,
  success, warning, danger). Use it for people with no event of their own yet, or to give someone an emoji.
- The same event sent again (same title, person, start time and day) changes the one there instead of adding a second.
- The first call also clears the sample family and its sample week, which a new calendar starts with.
- A call carries 16 KB at most: about 60 events. Answers `{ added, updated, members_added, samples_cleared, events }`.

To change or remove one event later, tell the family to open it on the Week page, or change that one row
(`/api/_data/events/<id>`). A repeating event is one row: changing it changes every week.

## What the app sends on its own

Every 15 minutes the app looks for what has come due: an event's `reminder`, and the Reminders page's own rows. When
something is due it wakes you with the lines to send (`reminders: [{ who, text }]`): send each `text` as it is to the
person in `who`, or to everyone when `who` is empty. So do not set up reminders, timers or routines of your own for what is
on the calendar, and do not add a reminder row for an event: give the event its `reminder`. Tell the family plainly what
each of them will be reminded of and when.
