# Changelog

## 1.3.3

- The "Meal Planner" section no longer sends the butler to the planner's `/api/_data` routes and TEMPLATE.md (Meal Planner 2 has neither for the agent): it uses the app's operations and reads its `guide` operation first.

## 1.3.2

- Places grocery orders in chat: the butler follows each service skill's `checkout` and the `payments` skill (items and grand total read back, one yes, then pay) and hands off only where a skill has no checkout. The old "never place orders" rule is gone.

## 1.3.1

- The Meal Planner app is referenced as an app (`apps: [{ "slug": "planner" }]`, was `template`): the ten kit apps are marketplace apps from Flock 0.15.0. Needs Flock 0.15.0.

## 1.3.0

- Adds the optional Meal Planner app, made from the planner kit app.
