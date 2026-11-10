# Changelog

## 1.3.4

- Grocery services are used the way Flock now offers them: a service with a connector is its own tool, named for it, and its actions are used directly; a service without one is used through its skill. The `curl` call to skill-exec on a fixed port is gone.
- Calls that don't need each other run together: comparing prices searches every connected service in one step, instead of one service at a time. Only calls that share one service's website session still go one at a time.
- A step no action covers goes to the service's website in the browser (the service tool's open-in-browser action where it has one), not `authenticated-crawl`, and the family is told. "Re-login" became "reconnect it or sign in again".

## 1.3.3

- The "Meal Planner" section no longer sends the butler to the planner's `/api/_data` routes and TEMPLATE.md (Meal Planner 2 has neither for the agent): it uses the app's operations and reads its `guide` operation first. The owner-data rules (the rows are the owner's, write only when asked or approved, never delete or tidy rows it did not add, ask when a request only resembles the planner) stay word for word.

## 1.3.2

- Places grocery orders in chat: the butler follows each service skill's `checkout` and the `payments` skill (items and grand total read back, one yes, then pay) and hands off only where a skill has no checkout. The old "never place orders" rule is gone.

## 1.3.1

- The Meal Planner app is referenced as an app (`apps: [{ "slug": "planner" }]`, was `template`): the ten kit apps are marketplace apps from Flock 0.15.0. Needs Flock 0.15.0.

## 1.3.0

- Adds the optional Meal Planner app, made from the planner kit app.
