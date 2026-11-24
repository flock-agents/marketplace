# Changelog

## 1.9.0

- **The briefs come from the Family Calendar and go to the family group.** The template sets up the Family Calendar app (`family-calendar`, required) beside the Meal Planner, paired with Family Butler. Morning Briefing (8 AM) reads the calendar's `brief` operation with `{"kind":"morning"}`: today's events with their notes and who drops or picks up, anything cancelled or moved, new dates imported from email or school portals, the to-dos now showing, and the weather. Evening Reminder (9 PM) reads it with `{"kind":"evening"}`: tomorrow's events and the to-dos due tomorrow, and any change or new date since the morning (the call moves the calendar's mark, so nobody would hear of them otherwise). It replaces the calendar's per-event "evening before" reminder. Short, WhatsApp-style lines; when every list in the brief is empty the brief replies NOTHING_NEW and the family gets no message. Both post into the family group: Flock binds Family Butler's routines to the Family group (`deliverTo` stays null). Needs Family Calendar 3.0.0 (the `brief` operation).
- **google-calendar is gone** from the template's skills, its suggestions and the README; the briefs no longer read it.
- **The briefs run on Family Butler's own model.** Both tasks lose their `model` pin (was `claude-sonnet-4-6`), so Flock falls through to the agent's model (routine choice > agent pinned > agent tier); the agent's own `model` setting is unchanged. `thinkingLevel: "none"` stays.
- Task names and schedules are unchanged.
- **The briefs include the group's own TODOs.** Besides the calendar's brief, each brief reads the family group's open TODOs (`GET /api/internal/todos?upcoming=1`, from the brief's run, a thread of the group). Morning: those due today or overdue join the calendar's to-dos in "To do:", once each, at most 5 in all. Evening: those due tomorrow join "Due tomorrow:". With nothing in the brief and no such TODO, still NOTHING_NEW. A failed TODO read leaves them out; the brief still goes.
- **Reminders are group TODOs.** The `reminders` skill is gone; the `todos` skill is in its place. The SOUL's new Reminders section: "remind us about X" in the family group is a group TODO made from the group chat (`POST /api/internal/todos`), at the time asked; a day with no time is set for 9 am and the butler says so; no date at all, it asks once "When?". Never the Family Calendar for a reminder: the calendar is for events, and its to-dos come from its planning. README and SUGGESTIONS say the same. Needs Flock's group TODOs (feat/group-todos).
- **The morning brief's weather line says where the weather comes from.** A live 8 AM brief had no weather: the prompt asked for it but named no way to get it, and the `weather` skill SUGGESTIONS.json pointed at no longer exists (Flock removed its bundled weather MCP). The morning prompt now says: one WebSearch (every Flock agent has the tool; the template adds nothing) for today's weather in the city the family lives in, as the butler knows it from the family's chats and its memory, never guessed from the brief's timezone; no known city or nothing found, the line is left out without a word. The `weather` suggestion is gone.
- Installed Butlers keep their own tasks and apps until Flock applies the template to them again.
- **Needs Flock 0.25.0-beta.1** (`minFlockVersion`, was 0.15.0 in the template and 0.24.0-beta.1 in the catalog): group TODOs and
  the internal TODO route the briefs read are not in Flock 0.24.0.

## 1.8.0

- **Zepto and Swiggy Instamart through their official connections.** Their browser skills are gone from the template and its suggestions; the "Connect a grocery service" step counts the Zepto and Swiggy Instamart connections (`zepto-mcp`, `swiggy-instamart-mcp`) beside BigBasket and Blinkit.

## 1.7.0

- **Both lines together.** The `release/10-nov` slim persona (1.4.0) and the shared family assistant (1.5.0, 1.6.0) in one template. The role at the top and the group rules come from 1.5.0/1.6.0; its Groceries bullet now points at the Meal Planner app, as 1.4.0 does. The Cold-Start section that 1.5.0 kept is gone, as in 1.4.0. Example prompts are 1.4.0's generic ones plus "Plan a weekend outing for the family" and "Build us a chore chart".

## 1.6.0

- **No tag needed in the group.** Flock now wakes the butler on every message in a group where it is the only agent. The SOUL says: answer what's meant for you, tagged or not, and stay quiet when people are just talking to each other; with the group's "answers only when tagged" switch on, it is only woken when tagged or replied to. Whoever asked is the person it acts for (was: answers only when tagged or replied to).

## 1.5.0

- **The family's shared assistant, not only a grocery one.** The role at the top of the SOUL says the butler lives in the family group chat and anyone in the family can ask it there: it plans trips, birthdays, weekend outings and other family plans (search, compare, book after the asker's yes, set reminders), keeps shared lists, builds shared apps for the family (a grocery list, meal planner or chore chart) by delegating to the Flock Assistant with its delegate skill, does the groceries, and lists who is in the family with its family-members skill. It answers in the group only when tagged or replied to, and acts with the permissions of whoever tagged it. Before, it told a family planning a trip that trips were "outside my area".
- The first-interaction intro names the same jobs. Two starter prompts are added: "Plan a weekend outing for the family" and "Build us a chore chart".
- Building an app: a simple app from a template is built right away; anything bigger is built once the family says yes (was: every app waited for a yes).
- First interaction: in the family group chat Flock already posts the butler's welcome, so the butler sends no intro of its own there; the intro stays for a direct chat, once per chat.
- Skips 1.4.0, which is taken by the `release/10-nov` branch's tag.

## 1.4.0

- **A slim persona.** Any agent can be a butler; apps and skills bring the use cases. The SOUL keeps who the Family Butler is, its tone, the family it serves (several members), what it doesn't do, and its dietary, prompt-injection and allowlist lines, word for word (the dietary rule no longer names a memory file). It installs the Meal Planner app and points meal, grocery and price comparison work at it.
- **Moved to the Meal Planner app** (planner 2.0.6): its guide's Price comparison section (one delivery address, one background session per grocery service, the totals compared at that address, no order without a yes on that total), and the rule that the rows are the owner's (never delete or "tidy" rows the agent did not add). The SOUL's Meal Planner section is now one pointer line.
- **Left to each grocery service's own skill or connector:** selecting the address, emptying and filling the cart, reading the total with fees, checkout, order tracking and what to do when a service fails. The template's "Your Skills" section is gone.
- **Gone:** the address, comparing, cart, order-tracking, proactive-restock, error-recovery, item-normalization and dietary-while-shopping sections; every memory mention (Memory Usage, the memory files, curation); cold-start memory seeding (`coldStart` in flock.template.json); "Calls that don't need each other run together".
- SUGGESTIONS.json names the app `planner` (was `meal-planner`). The Grocery Stock Check and Weekly Summary tasks, which the template never defined, are gone from SUGGESTIONS.json, the README and the setup checklist. The example prompts no longer name one service's cart or orders.
- Installed Butlers keep their own SOUL until updated.

## 1.3.6

- Drops the "under 30 seconds" target: a price comparison runs one background session per service, so it usually takes longer. Slow or down services are still reported without waiting.

## 1.3.5

- Tools only: the butler uses each service's own tool (a connector's actions, or a website skill's functions through `run_skill`) or the service's website in the browser, never Flock's API, a script, `curl` or a local port.
- One delivery address for a comparison: the butler agrees one address with the family first, finds that same address (by the address itself, not its label) among every service's saved addresses, and passes its id wherever a connector action takes one, or selects it once where the connector selects per session; never "default". An address missing on some services is added after one owner yes that covers all of them, or those services are left out.
- One background session per service: each selects the agreed address, empties the cart, adds the items and reads the full total with every fee; the butler compares those totals. A cart read must be the cart itself, not the home page or suggestions.
- Checkout reads back the delivery address too. family-profile.md keeps the agreed address. Everything else is unchanged.

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
