# Changelog

## 1.0.3

- Adds the Morning plan (07:00 daily) and Weekly summary (Sunday 19:00) routines, moved from the fitness-coach template; they wake the paired coach. Cron times run on the Flock's clock: the routine format has only a fixed `trigger.timezone`, not the app's `timezone` setting.

## 1.0.2

- A fresh install starts empty: the dashboard kit's sample rows (a tiffin kitchen's orders and events) are gone, and so are the leftover `Sale` kind and money formatting.

## 1.0.1

- Declares its settings in `flock.app.json` and ships the generated `catalog.json`, so the template can install and adopt it.

## 1.0.0

- First release, generalised from a hand-built coach dashboard: person, time zone and exercise note are settings; trackers
  are adapters (Zepp first, optional) run by the `tracker-sync` routine and the Sync button, each isolated; goals show
  when their metrics have data. Needs Flock 0.20.0 (`connectors.list()`).
