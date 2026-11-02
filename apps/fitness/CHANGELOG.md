# Changelog

## 1.0.0

- First release, generalised from a hand-built coach dashboard. Person, time zone and exercise note are settings, so nothing about one person is in the code.
- Trackers are optional adapters (Zepp first), run by the `tracker-sync` routine and the Sync button; each adapter runs on its own. Goals show only when their metrics have data, so the app also works with no tracker.
- Routines that wake the paired coach: Morning plan (07:00 daily) and Weekly summary (Sunday 19:00). Their times run on the Flock's clock.
- The Morning plan picks exercises for the person and adds new ones to the library with a GIF it finds on the web: `POST /api/exercises {name, notes?, gifUrl?}`. The app downloads the picture (http(s), GIF/WebP/MP4, up to 10 MB) into its data folder. Plan items link to exercises by slug, and the owner can remove an added exercise.
- A fresh install starts empty, with no sample rows.
- Needs Flock 0.22.0 (`connectors.list()`, optional connectors).
