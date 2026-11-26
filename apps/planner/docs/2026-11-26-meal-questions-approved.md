# Meal questions: owner-approved wording (26 Nov)

Overrides the draft table in Task 11 of the plan. Placeholders in [brackets] here are the contract's `{{...}}` values.
Rules the owner set: "over the past week" stays; meal questions do not ask "anyone who has something different"
(the `differently` question owns that); a child is never "he"/"she"/"their" — use `{{children}}` or no pronoun.

| id | ask | recall |
|---|---|---|
| lunchWhere | `{{lunchKnown}} Who carries lunch from home, and who eats out?` | `About weekday lunch you said: {{heard}}. Anything to add?` |
| cook | `Which meals does {{cookName}} make, and when does she come?` | `About the cook you said: {{heard}}. Anything to add?` |
| cookTime | `Is {{cookName}} short of time, so only a few dishes?` | — |
| otherDays (cook Mon–Sat) | `On Sunday, when {{cookName}} doesn't come, who cooks, and is any meal eaten out or ordered in?` | `You said: {{heard}}. Anything else about eating out or ordering in?` |
| otherDays (cook Mon–Fri) | same with `On Saturday and Sunday` | same |
| otherDays (other cook days) | `On her days off, who cooks, and is any meal eaten out or ordered in?` | same |
| otherDays (no cook) | `Who cooks at home, and is any meal eaten out or ordered in, on which days?` | same |
| childSame | `Does {{children}} eat what the family eats, or something else at some meals? Does {{children}} carry a box to school?` | `You said: {{heard}}. Anything else about what {{children}} eats?` |
| familyBreakfast | `What did the family have for breakfast over the past week? Tell me the dishes.` | `You mentioned {{heard}} for breakfast. Anything else?` |
| familyLunch | `What did the family have for lunch over the past week? Tell me the dishes.` | `You mentioned {{heard}} for lunch. Anything else?` |
| familyDinner | `What did the family have for dinner over the past week? Tell me the dishes.` | `You mentioned {{heard}} for dinner. Anything else?` |
| childMeals | `What does {{children}} have at those meals, and what goes in the box?` | `You mentioned {{heard}}. Anything else in the box?` |
| differently | `Does anyone eat differently: something they don't eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?` | `You mentioned {{heard}}. Anything else, for anyone, like an allergy or a fasting day?` |

Note: the contract lint says a `recall` names only `{{heard}}`; childSame's recall above also names `{{children}}`
(owner-approved wording). Ruling for the build: allow `{{children}}` in a recall when the question's `when` guarantees
children (`household.children`); Flock lane's recall lint must allow it too. `reask`/`fallback` per the plan's draft,
adjusted to the same rules (past week, no he/she).
