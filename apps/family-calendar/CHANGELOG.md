# Changelog

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
