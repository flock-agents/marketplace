# Changelog

## 1.1.1

- Declares itself an app template (`"usage": "template"` in `flock.app.json`), so Flock offers it as a starting point to make apps from, not as an app of its own. 1.1.0's installed copy had no `usage` and read as an app. Nothing else changed.

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries the kit fields `template.json` held, plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`. `template.json` and `TEMPLATE.md` are gone: Flock 0.15.0 reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: "+ Add" on a meal, a dish, or an empty day opens the meal editor right there in the week, under the row tapped (it opened above the week and scrolled up). Escape closes it and focus goes back to what was tapped. Edit item on the grocery list opens under that item; a new recipe opens right under the page header. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace kit app (moved from the Flock repo).
