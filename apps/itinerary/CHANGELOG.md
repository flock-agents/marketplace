# Changelog

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries what `template.json` did plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`, which stays as a pointer for one release. `template.json` is kept, identical in the shared fields, until the Flock tooling reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: a picked plan item opens under it in its day and a picked booking under its row (they opened above the list). Add opens right under the page header. Escape closes them. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
