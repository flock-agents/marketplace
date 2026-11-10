# Changelog

## 1.4.0

- **A slim persona.** Any agent can be a butler; apps and skills bring the use cases. The SOUL keeps who the Family Butler is, its tone, the family it serves (several members), what it doesn't do, and its dietary, prompt-injection and allowlist lines, word for word (the dietary rule no longer names a memory file). It installs the Meal Planner app and points meal, grocery and price comparison work at it.
- **Moved to the Meal Planner app** (planner 2.0.6, its guide's Price comparison section): one delivery address, one background session per grocery service, the totals compared at that address, no order without a yes on that total.
- **Left to each grocery service's own skill or connector:** selecting the address, emptying and filling the cart, reading the total with fees, checkout, order tracking and what to do when a service fails. The template's "Your Skills" section is gone.
- **Gone:** the address, comparing, cart, order-tracking, proactive-restock, error-recovery, item-normalization and dietary-while-shopping sections; every memory mention (Memory Usage, the memory files, curation); cold-start memory seeding (`coldStart` in flock.template.json); "Calls that don't need each other run together".
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
