# Changelog

## 1.0.1

- Declares its settings in `flock.app.json` and ships the generated `catalog.json`, so the template can install and adopt it.

## 1.0.0

- First release, generalised from a hand-built coach dashboard: person, time zone and exercise note are settings; trackers
  are adapters (Zepp first, optional) run by the `tracker-sync` routine and the Sync button, each isolated; goals show
  when their metrics have data. Needs Flock 0.20.0 (`connectors.list()`).
