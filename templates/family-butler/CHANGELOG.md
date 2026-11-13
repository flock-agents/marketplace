# Changelog

## 1.6.0

- **No tag needed in the group.** Flock now wakes the butler on every message in a group where it is the only agent. The SOUL says: answer what's meant for you, tagged or not, and stay quiet when people are just talking to each other; with the group's "answers only when tagged" switch on, it is only woken when tagged or replied to. Whoever asked is the person it acts for (was: answers only when tagged or replied to).

## 1.5.0

- **The family's shared assistant, not only a grocery one.** The role at the top of the SOUL says the butler lives in the family group chat and anyone in the family can ask it there: it plans trips, birthdays, weekend outings and other family plans (search, compare, book after the asker's yes, set reminders), keeps shared lists, builds shared apps for the family (a grocery list, meal planner or chore chart) by delegating to the Flock Assistant with its delegate skill, does the groceries, and lists who is in the family with its family-members skill. It answers in the group only when tagged or replied to, and acts with the permissions of whoever tagged it. Before, it told a family planning a trip that trips were "outside my area".
- The first-interaction intro names the same jobs. Two starter prompts are added: "Plan a weekend outing for the family" and "Build us a chore chart".
- Building an app: a simple app from a template is built right away; anything bigger is built once the family says yes (was: every app waited for a yes).
- First interaction: in the family group chat Flock already posts the butler's welcome, so the butler sends no intro of its own there; the intro stays for a direct chat, once per chat.
- Every grocery section (skills, comparing, cart, checkout, tracking, memory, dietary rules) is unchanged word for word.
- Skips 1.4.0, which is taken by the `release/10-nov` branch's tag.

## 1.3.3

- The "Meal Planner" section no longer sends the butler to the planner's `/api/_data` routes and TEMPLATE.md (Meal Planner 2 has neither for the agent): it uses the app's operations and reads its `guide` operation first. The owner-data rules (the rows are the owner's, write only when asked or approved, never delete or tidy rows it did not add, ask when a request only resembles the planner) stay word for word.

## 1.3.2

- Places grocery orders in chat: the butler follows each service skill's `checkout` and the `payments` skill (items and grand total read back, one yes, then pay) and hands off only where a skill has no checkout. The old "never place orders" rule is gone.

## 1.3.1

- The Meal Planner app is referenced as an app (`apps: [{ "slug": "planner" }]`, was `template`): the ten kit apps are marketplace apps from Flock 0.15.0. Needs Flock 0.15.0.

## 1.3.0

- Adds the optional Meal Planner app, made from the planner kit app.
