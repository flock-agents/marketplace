# Changelog

## 2.0.0

- Rebuilt on the Flock component library as a kit app: a `week` page (this week's events as a Schedule, today and tomorrow big), an `events` page (every upcoming event, with add, edit and delete in place) and a `reminders` page (one-off, daily, weekly and monthly reminders, the one due soonest first), with the agent chat beside the page.
- New data model: `members` (name, colour, emoji), `events` (title, date, start and end time, who, location, notes, minutes before to remind) and `reminders` (title, when it is due, how it repeats, who), read and written through `/api/_data` like every kit app. Earlier events are not migrated automatically: ask your agent to move them.
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
