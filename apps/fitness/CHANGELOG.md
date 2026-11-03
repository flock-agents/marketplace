# Changelog

## 1.0.5

- Connect Zepp asks the coach instead of opening Flock's connector page: an account added there was not given to the coach, so the app could not read it. The coach asks the owner in Flock for this person's own account (`connect-tracker` intent), at most once every 3 minutes, and the button says where to approve it.

## 1.0.4

- The History page's event actions use the kit's `Row` instead of an inline style, so the app passes Flock's layout check unchanged and an installed copy is no longer edited (and flagged customized) to fix it.

## 1.0.3

- Does nothing until it knows who it is for (`person` and `timezone`): no tracker sync, no coach wakes, so no model runs. Until then the app shows that it is idle, with a button that opens the coach's chat to tell it who the dashboard is for; the coach saves both.
- The daily plan and weekly summary are now app routines (`daily-plan`, `weekly-review`) that wake the coach only once the app is set up. They replace `morning-plan` and `weekly-summary`, which an update removes; same times and prompts.

## 1.0.1

- With no tracker connected, the Sync button becomes Connect Zepp and opens Flock's Zepp page. A tracker that fails says "Zepp couldn't sync. Check the connection" with a link, instead of the connector's raw error.

## 1.0.0

- First release, generalised from a hand-built coach dashboard. Person, time zone and exercise note are settings, so nothing about one person is in the code.
- Trackers are optional adapters (Zepp first), run by the `tracker-sync` routine and the Sync button; each adapter runs on its own. Goals show only when their metrics have data, so the app also works with no tracker.
- Routines that wake the paired coach: Morning plan (07:00 daily) and Weekly summary (Sunday 19:00). Their times run on the Flock's clock.
- The Morning plan picks exercises for the person and adds new ones to the library with a GIF it finds on the web: `POST /api/exercises {name, notes?, gifUrl?}`. The app downloads the picture (http(s), GIF/WebP/MP4, up to 10 MB) into its data folder. Plan items link to exercises by slug, and the owner can remove an added exercise.
- A fresh install starts empty, with no sample rows.
- Needs Flock 0.22.0 (`connectors.list()`, optional connectors).
