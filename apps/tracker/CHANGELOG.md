# Changelog

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries what `template.json` did plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`, which stays as a pointer for one release. `template.json` is kept, identical in the shared fields, until the Flock tooling reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: Add opens the new-row form right under the page header (above the numbers), with the first field focused; Escape closes it. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
