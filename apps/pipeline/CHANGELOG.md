# Changelog

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries what `template.json` did plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`, which stays as a pointer for one release. `template.json` is kept, identical in the shared fields, until the Flock tooling reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: a picked deal opens under its row on the table and under its card in its column on the board (it opened above them). Add opens right under the page header. Escape closes either. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
