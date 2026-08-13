# Family Calendar

Family events, schedules, and reminders at a glance.

## Features

**Calendar Views**
- Week view with 7-day grid showing event chips
- Day view with detailed timeline
- Navigate between weeks/days with arrow buttons
- Quick "Today" button to jump to current date

**Family Members**
- Add family members with name, color, and emoji
- Filter calendar by member
- Color-coded events per member

**Events**
- Create events with title, start/end time, category, and notes
- Categories: School, Work, Social, Medical, Household, Other
- Status tracking: Confirmed, Tentative, Done
- Multi-day event support

**Reminders**
- Reminders linked to events or standalone
- Toggle done/pending status
- Due time display with relative formatting

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Hono on Bun
- **Database:** SQLite (bun:sqlite)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events?from=&to=&memberId=` | List events in date range |
| POST | `/api/events` | Create an event |
| PUT | `/api/events/:id` | Update an event |
| DELETE | `/api/events/:id` | Delete an event |
| GET | `/api/members` | List family members |
| POST | `/api/members` | Add a family member |
| PUT | `/api/members/:id` | Update a family member |
| DELETE | `/api/members/:id` | Delete a family member |
| GET | `/api/reminders?from=&to=&status=` | List reminders |
| POST | `/api/reminders` | Create a reminder |
| PUT | `/api/reminders/:id` | Update a reminder |
| DELETE | `/api/reminders/:id` | Delete a reminder |
