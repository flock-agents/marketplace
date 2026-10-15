# Changelog

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries what `template.json` did plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`, which stays as a pointer for one release. `template.json` is kept, identical in the shared fields, until the Flock tooling reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: a picked transaction or holding opens under its row, and a goal's Edit opens under that goal (they opened above the list). Add a transaction opens right under the page header. Escape closes them. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
- Overview leads with this month's spending for a budget or running-costs use, and with net worth for an investments use: the new `overviewLead` setting (`auto` by default: net worth once real holdings exist, the sample holdings not counted). The income/saved strip is hidden when no income is recorded.
