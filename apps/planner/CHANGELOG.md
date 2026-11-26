# Changelog

## 4.1.1

- The kinds model: each meal is a set of templates of dish kinds (from the family's own words), filled by code with no model call per meal. The family's own dishes first; no dish again until every option has been used, never the next day; new dishes only of kinds the family has, asked about in the plan's one question and the day-before reminder.
- A catalog of Indian dish kinds (kinds.json) with ingredients (main / can be left out): rules checked on main ingredients; leave-out ingredients become "make without X for P" notes. Regional words read in context.
- Setup builds the meal templates, the family's cuisines and a read-back of "Your usual meals" in their own words; a fixed dish takes its nearest catalog name ("stew" → "Vegetable stew"); subscription milk is shopping, not a dish.

## 4.0.3

- The plan's message asks one question at most: the meals short of dishes are named together ("I know only a few dishes
  for dinner and Vihaan's tiffin, so I've added some new ones. What else do you make for these?"), and a calendar entry
  it could not read is folded into that question. A calendar entry that is part of someone's weekly routine (office,
  school, a weekly class on a day household.weekly has them out) is never read nor asked (a run asked 17 such lines).
  A new dish is said with the family's dish it stands in for ("Palak paneer (like your Sabzi)"), never the model's reason.
- The plan's message leaves out a note that explains the plan's own choices ("Idli is safe, Chutney avoided by him"):
  only a word for someone at the table is said. A person's fast is still said by code.
- A note that is only the cook's limit again ("Yes, she has two hours, so 3 to 4 dishes in all") stays with the cook,
  not under the family's notes or "All week".
- The how-it-works message that follows the first week opens "How it works:" (the week's message already says it is planned).
- make_plan reads the library dishes setup never read for a hard rule's tags (setup ran out of time) before planning,
  and keeps what it read: before, every such dish failed closed and the week came out with 65 unmet places.
- Setup reads the family's dishes on the fast tier (no reasoning): on balanced the reasoning ran into the token cap and
  cut the answer off, so the read was asked twice and used most of setup's time (setup eval: 3–11 s vs 18–146 s for
  that read, 94% vs 78% of checks).
- The bread, rice or curd on the family's own plates at a meal is a staple there, however few plates were told (two lunch
  plates "Roti, Sabzi" and "Dal, Rice, Sabzi, Curd" left roti a two-days-a-week dish and lunch came without it).
- make_plan checks whether each meal has enough dishes after it has read what the family's dishes contain, not before
  (before, every unread dish counted as nobody's and a meal got new dishes it did not need).
- The setup read-back lists the family's usual dishes per meal, so a meal read wrong or missing is seen before the plan.
- The week's prompt says what a good week is and reads the family's plates as parts. A kind of dish the family names
  ("Sabzi", "Dal", "Idli with chutney") is planned as a particular one each day ("Bhindi sabzi"), and the same dish with
  another accompaniment ("Idli with tomato chutney" for their "Idli with coconut chutney") is theirs too: neither is a new
  dish nor uses up the new-dish limit; its contents are read, and it is not saved to the library.
- One meal told for different people ("Divu and I carry roti sabzi to office, Amma has dal, rice and curd at home") is one
  example plate with every dish of it, by a worked example in the dishes read (setup eval 91% vs 89%, two runs each).
- A fast saved with no food said is asked about in the read-back ("What does Gowri Shankar eat on the Tuesday fast?"); the
  answer fills the fast's food, also when the reader quotes the first sentence.
- Builds again: rc3's contains read did not type-check (tsc), so the app failed to install.
- The week is planned with per-day lists (owner, 25 Nov). Each day in a meal's call carries the family's dishes allowed
  that day (on their days, with days left this week counting the meals already planned, someone there can eat them, not
  another meal's main that day) and the rice or bread it must have ("Roti or Rice", from the family's own lunch and dinner
  plates; at another meal only when every plate of theirs has one). A main comes at most twice a week unless the family's
  own words say more often; staples are free.
- One fast read a plan says each dish's part on the family's plates (rice or bread, a complete dish, a main, a side): the
  rice, bread and sides are the meal's staples. It replaces the fixed word list of staple dishes.
- The meal's call also names a few spare dishes for each part of the plate. Code then walks the week Monday to Sunday: a
  dish past its days a week, off its days, not allowed that day or that nobody there can eat is replaced by one of its part
  from that day's allowed dishes or the spares (a spare is new unless it is a particular way of a family dish, and counts
  toward its days); a person with nothing of their own gets a dish beside; the missing rice or bread is added. The fix call
  and the rotation in code are gone. Only a day still with a gap gets one small targeted call (that day, the part, who eats,
  their rules, what not to repeat); what it cannot fill takes the closest allowed dish, said as coming back sooner than
  usual. Nobody is left without food. A dish the family has on set days ("pongal on Sundays") that the call left
  out takes the place of any main on that day where it fits (one of its part first), keeping the day's rice or bread and
  everyone's own dish. A particular way of a family dish keeps its own days a week.
- Allergies (owner, 25 Nov): a family dish on the family's own plates at a meal the allergic person eats is safe for them
  by the family's word (no read); when it has the item, its note keeps their portion aside ("Ishaan's Poha without
  peanut") and its ingredients are bought as usual. Every other dish (new, a spare, a particular way of a family dish, a
  family dish only others eat) is read on the balanced tier, an unsure answer counting as having it. A house-wide allergy
  makes every family dish safe; new ones are still read.
- An allergy kept on one person is asked about once in the read-back ("Do you cook everything without peanuts, or only
  Ishaan's food?"). "Everything" makes it one house rule (no person, same items, hard, the allergy's own words kept);
  "only his food" or "his own food" keeps it on the person. Either way it is not asked again.
- The home read makes a box or tiffin whose food is not the home meal ("snack box: sandwiches, chivda") a slot, also when
  it is told in the lunch answer, by a worked example; someone who carries the home lunch gets no slot.
- "<person>'s breakfast" with no such slot of theirs is Breakfast, never another slot of theirs (a child's breakfast
  dishes went to their tiffin once a grandparent had their own breakfast).
- "Vegetarian, eggs okay for Vivaan and Varun" gives no eggs to everyone else at home: the rules read is shown it by a
  worked example, and setup adds any no-eggs rule it left out (a house vegetarian rule, no house egg rule, egg rules for
  named people). Before, Egg paratha was planned for the two who eat no eggs.
- A list of the week's breakfasts or tiffins ("Poha, idli, dosa, upma") is one example plate per dish, not one plate of
  all of them (the plan put six dishes on every breakfast); only one meal told for different people is joined into one
  plate. The same dish twice on one example plate is kept once.
- A dish the family gave a how often or days for keeps them whatever its part on the plate (luchi "on Sundays" only on
  Sundays, "1/week" once), also as the rice or bread a day must have. A rice, bread or side has no weekly count only beside
  a main on that day's plate (roti beside sabzi); alone as the plate (a paratha or idli breakfast) it is a dish like any
  other, twice a week. A main beside idli or dosa with no rice (sambar) is a side there; near rice it is a main (owner).
- Fewer days than the family said is fine (owner: "people want variety"): no least is asked for or pushed in; only a dish
  with its own days ("pongal on Sundays") is put on them.
- A box or tiffin with no dishes known no longer stops the plan: every other meal is planned, the box is left out and
  named in the plan's one question.
- Nobody without food (tier C): a dish of a meal that is only one person's (her own dinner) is made for her, so her rules
  hold for it by the family's word; a person with nothing of their own is fed past the week's new-dish budget; the
  targeted call and the spares name a family dish as made for them ("Dal without onion and garlic"); a daily dal or other
  daily main counts as a main when checking that each person has a dish of their own.
- The plan call gets the family's own words for how often or on which days they have a dish, beside its count and days
  (`said: "rajma or chole twice a week"`), and the week's prompt says what such words mean ("on Sundays" only Sundays,
  "twice a week" at most twice, "sometimes" fewer is fine, "most days" may be more than twice). Setup keeps the words in
  a new `library.said` column (added by the schema sync); add_dish sets it from its quote when it changes how often or
  the days. Code's caps and days still win.
- A count or weekdays said over two dishes is each one's: "rajma or chole twice a week" is once a week each (the count
  shared, rounded up), "luchi with alur dom on Sunday" Sunday for both; two eaten together keep the whole count
  ("chapati and a kurma twice a week": twice each). By a worked example in the how-often read, and the same in the lint.
  "Usually", "sometimes" or "most days" over a list or a whole plate is still no dish's: sharing those too spread them
  over lists in the setup eval (no_unsaid_frequency 88% vs 96%, total down).
  Setup eval (10 households x 2, reused chats, prod tiers): 96.8% vs 96.1% of checks; dish_frequency 79% vs 67%;
  no_unsaid_frequency 91% vs 96%.
- A dish tied to a day keeps it: a dish the dishes read lists twice at one meal (once per sentence naming it) takes the
  how-often read on both rows (before, neither, and luchi lost its Sunday); one dish read at three meals is no longer
  "a whole list's" words; a dish's how-often words are placed in the sentence with its own quote first; and the lint
  matches a dish asked twice to each answer in turn.
- The family's dishes guide the week; they are not its whole menu (owner, 25 Nov: "we are overbiasing it with the user's
  existing meal plan"). Week one is guided by their answers (their dishes and example plates); later weeks also by what
  was planned and kept at each meal in the four weeks before. At least 30% of each week's mains at a meal are their own;
  the rest are new dishes for variety, with no weekly new-dish budget (the new-dishes-a-week setting no longer limits the
  plan). No main more than twice a week still holds.
- Every new dish names `like`: a dish of theirs at the same meal and the same part of the plate ("Moong dal usal" like
  their "Usal"). Code drops a new dish whose `like` is not one of theirs there (no pasta unless they have pasta at that
  meal) and takes the next spare; spares come with their `like` too. A meal with no dish of theirs at all is still asked
  about, or planned from new dishes when the family said "suggest some".
- Removed with the budget: the feasibility check (shortfall, its own new dishes, the narrowed repeat window,
  `short_of_dishes`, `relaxed` in the result) and the "I know only a few dishes for …" question for a thin meal.

## 4.0.2

Re-ask lines and fallbacks for Flock's code-worded interview (Flock sends every setup line as written; no model words a
question).

- **A simpler line when a reply is unclear.** Every setup question that asks has a `reask`, the owner-approved simpler line
  Flock sends after "Sorry, I didn't quite get that." Written generically ("the cook", "the children", "the adults",
  "the elders"); Flock puts the family's names in at send time.
- **A line for an empty value.** `people` (`{{householdPeople}}`, `{{householdMeals}}`), `cook` (`{{householdCook}}`) and
  `orderFindings` (`{{boughtSaid}}`) carry a `fallback`, sent when the value comes back empty, instead of a model wording
  the step.
- **No brackets.** The people and connectLater lines lose their brackets (Flock's guard reads "(…)" as an unfilled
  placeholder).
- An older Flock ignores `reask` and `fallback` (its interview parser copies only the keys it knows).

## 4.0.1

Fixes from the second onboarding live run (#21, #29).

- **A setup is read from the family's own replies.** `apply_setup` refuses a transcript with no `A:` lines (the live run's
  agent sent one line of its own, and the setup saved with no dishes).
- **No dishes, a question.** When no dish of theirs could be read, the read-back asks for a few per meal, never a quiet
  "noted" line; `make_plan` answers `reason: "no_dishes"` with that question instead of planning a week of invented,
  repeated dishes. `make_plan { suggest_new: true }` plans with new dishes when the family says "suggest some".
- **Enough new dishes for the week.** A main meal with no dish or plate of theirs counts as a full plate (3), so the
  shortfall's new dishes cover the week without breaking the repeat rule (was 4 for 21 places).
- **Whole meals.** The slot prompt asks for one main with its rice or bread at lunch and dinner, never three curries.
- **Who eats which meal (#21).** With the household's weekday pattern known, the people question proposes who eats at
  home at which meal (`{{householdMeals}}`, filled by Flock) for them to confirm.

## 4.0.0

The slot model (`docs/slot-model-spec.md`). The old plan tables and operations are replaced outright, with no migration: no
family has the new setup interview yet. Calendar stays and the fresh household need a Flock with `ctx.apps.op` and
`ctx.household.get`; on an older Flock the plan uses the household facts it was sent.

- **A week is slots filled day by day.** Breakfast, Lunch, Dinner, the family's own slots (a child's tiffin, an evening
  snack) and a person's add-on (his phulkas at dinner, her fish twice a week) are each planned for the people eating that
  day: the usual people, less who is at the office or school that weekday, plus or minus the Family Calendar's stays and
  trips (or the household's dated facts), less a fast. Guests and an occasion can be set on one meal.
- **Setup reads, code checks.** `apply_setup` reads the household facts and the family's replies in four parallel model
  reads (home, rules, dishes, how often) and one fast read of each dish's tags; code keeps only what the family's own words
  back (a frequency needs their sentence), saves slots, rules with quotes, the dish library per slot and last week's meals
  as examples, and reads it back in plain words. A correction applies only what the new reply names.
- **The plan keeps their shape and their rules.** One model call per slot in order (breakfast first, add-ons last, at most
  3 at once), shown the family's own plates as the template. Code checks every person's hard rules (a dish someone cannot eat
  is "not for" them, as long as they have something of their own), days and how often across slots, a 3-day repeat window
  (staples, from at least 3 confirmed meals or dishes they said to have every day, are exempt), and swaps a rejected dish
  for another of theirs, never leaving a plate thinner. A short slot is asked about ("I only know 2 dinners for Ba…") and
  gets new dishes like theirs.
- **Changes later, without setup again.** `set_slot`, `set_slot_day` (people, guests, occasion, eaten out, dishes),
  `add_dish` (with a reel or recipe link), `set_rule`, `set_setting`, `record_made`, `record_feedback`. A change re-plans
  only the meals it touches and never overwrites one the family changed.
- **New dishes are asked about once, the next day.** The 15:00 reminder asks about yesterday's new dishes (made it? liked
  it? again?), at most 3 a day; a kept dish joins the library, a disliked one never comes back. The evening "how was today's
  food" check-in is gone.
- **Shopping follows the slot model.** Ingredients come from the planned meals (eaten out and ordered in bring none); the
  15:00 reminder covers tonight's dinner and anyone's own dinner; an everyday item ordered for tomorrow is not put on again
  while that order still covers it (curd every 2 days was being bought every day).
- **Removed:** `set_meal`, `set_family_dishes`, `set_slots`, `set_house_rules`, `plan_week`, `plan_menu`, `set_dish`,
  `set_cooking_days`, `rate_today`, and the tables `plan_meals`, `dishes`, `dish_items`, `dish_book`.
- **Evals:** `evals/` scores setup (Eval 1) and the plan (Eval 2) separately on 8 households, with 4 held out.

## 3.5.0

Needs a Flock that gives apps a model call (the manifest's new top-level `"model": true`); on one without it the Sunday
run keeps the agent-planned week of 3.4.0.

- **The week is planned in steps the app drives.** One long agent session failed in every simulated run (a week cut off
  half sent, repeats not fixed, meals with no dish). Now the app works out every meal itself (who eats it, that meal's
  family dishes, the rules that hold there, the cook), asks the model once for the week's menu, and checks it in code with
  plan_menu's checks plus "every meal and extra slot has a dish"; only the meals that fail go back, with why, up to 5 times.
  What is still wrong is fixed in code with a family dish that keeps every rule; when the rules cannot all be kept (two
  breakfast dishes for six days) a dish repeats, and the message says so ("Idli repeats on 3 days (Mon, Wed, Fri): only 2 breakfast dishes
  known"). Each day's ingredients come from one cheap call, tried once more on its own. The week is saved final and closed
  as before (`message`, and `intro` the first time). Calls are metered by Flock; no credits, the day's limit or too many
  calls stop the plan with a plain line for the family.
- **`make_plan { week_start }`**, a new operation, does exactly that (Flock's first plan and "plan the week" in chat), inside
  Flock's 6 minutes. The Sunday run does the same and wakes the agent only to send the message word for word.
- **Extra meals are never wiped.** `set_slots { add: true }` adds a slot (the same name replaces it) and an order-in meal;
  each past-week meal question can save one (a child's tiffin, an evening snack), and the meals part ends by reading every
  slot back ("Each day we'll plan Breakfast, Lunch and Dinner, plus Agastya's tiffin Mon–Fri... Anything to add or change?").
- **A fast is checked.** `{ kind: "fasting", who, days, slots }` ("fasts Thursday till evening": Breakfast, Lunch) refuses any
  dish that person would eat then; without slots it stays a note.
- **A cook's limit is a checked rule, whenever it is said.** The setup no longer asks it; a limit said in chat or while
  fixing a plan is saved as avoid / cap rules (`@baked` for "no oven", now covering what needs an oven) plus the cook's
  words. A vague one stays words.

## 3.4.0

- **The setup interview, for Flock's interview runner.** Flock sends each setup question as written and reads each reply
  in one call, writing every answer into the app itself; the Butler no longer makes the calls. So each question's
  `answer` names every operation it writes (a list: the cook's limits save `set_cook` and `set_house_rules`), every
  `help` says how to read the reply into those payloads (the food-rule examples stay), and every question is the exact
  line a person reads. Needs a Flock with the interview runner (a list `answer`, and `show` values; see below).
- **No question repeats the household answer.** A new first step saves everyone at home with `set_person`, read from
  the household answer, before any rule names them. The cook's name, days and visits (each with its meals) are read
  from the household answer when it said them, so the cook question is asked only for what is missing; the
  cooking-days question then asks only what the cook's days leave ("Is food cooked at home on Sunday too?"). The
  elders question no longer asks what the diet question covered ("Besides that diet, ...", and no sugar-free).
- **Rules are added, not replaced, one answer at a time.** `set_house_rules { add: true, rules }` adds the rules sent
  to the ones there (a rule already there is not added twice); without `add` the list sent is the list kept, as
  before. It answers `said`, every rule in plain words, which the read-back shows (`{{rulesSaid}}`, Flock's `show`).
  `import_order_history` answers `said`, what the house buys most often, which the order findings show.
- Past-week meals no longer write `set_person` notes; what each person eats is in the family's dishes (`for`).

## 3.2.0

- **The setup interview lives in the app.** The questions the Butler asks when the Meal Planner is set up are now the
  app's own `setup` (with `setupJoiner`, `setupMenu` and `setupOptions`), in the same words as before: the hardest part,
  the grocery apps and why, the main app, the cook, the cooking days, last week's meals, any diet, the draft week, elders,
  house rules, ordering in, subscriptions, what the orders show and the final plan ("Give me a few minutes, I'm putting
  your week together."). Each answer is written into the app through its operation. Flock (with the interview engine)
  asks them one at a time, skips what the family already said, and lets a person skip a question or the rest (each has
  a default, said as an assumption). A second person the app is shared with is asked to connect their own grocery apps.
  An older Flock ignores these fields.

## 3.1.0

3.0.0 was a build that was never released; this is the release. It replaces the 2.0 Meal Planner. Needs Flock 0.24.0 (its
betas included) and library 1.10.11.

- **Family.** The Family page is only about the family: who eats at home, the cook, the days you cook (Monday to Saturday
  until you change them), the extra meals and the house rules. Tell the agent or edit it yourself.
- **How we order.** The app's Settings tab (Flock's Settings & routines) has a "How we order" group: your main grocery
  app, the one to try when something is not on it, and "Order without asking".
- **The week, planned and kept.** The week is planned on Sunday at 11 am, on your cooking days only, and each day is kept
  as soon as it is planned: you do not need to reply. The Sunday message is Monday's meals plus a link to the Week page.
  Nothing is bought by the plan.
- **Two reminders a day.** At 3 pm (tonight's dinner) and 7 pm (tomorrow's meals), each one complete in one message: the
  meals, what you buy every day put on your cart as it comes due, and anything that may be running low. Nothing is ordered until you reply or
  tap Order. A setting, "Order without asking" (off), lets the agent order the items it is sure about on its own.
- **Running low, estimated per item.** The app reads the last 3 months of your orders on every connected shopping app and
  works out how long each item lasts for you, from the amounts and the gaps between buys. Early or one-off buys are not
  counted and your own answers are. When something may be running low, you are asked together in one message, at most 5
  items at a time. An item you have never bought with a size is estimated from the gaps alone.
- **One cycle per item, for the whole house.** There is no separate list of everyday items: each item has its cycle, how
  much you buy and how often ("500 ml every day", "30 pc about once a week"), shown on the Pantry page. It is worked out
  from the orders of everyone in the house, each on their own account of a shopping app, counted together and never twice
  (one agent holding two accounts of an app reads each one apart).
  What you buy every day or two goes on the cart by itself when it is due; the rest is asked about. With no orders to
  learn from, tell the agent ("milk every day, 1 litre") and that is kept until your orders show their own. Everyday
  items an installed copy already had become item cycles.
- **A meal is planned once.** A meal has one dish for everyone who eats it; one person's variation is a note on that dish
  ("two eggs for Shiva"), and a second dish is only for someone who eats something else. The same dish sent once per
  person is kept as one, and the Week page names each dish once.
- **One cart per app.** What you need is gathered into one cart for each shopping app. Each cart has its own Order button,
  and the app's own cart is kept in step with it as you change it (Amazon's cart is built when you order). The agent
  orders it only on your yes. An order that was not paid within 24 hours goes back to the cart, and you are told once.
- **A plan the cart can use.** Every planned dish carries its ingredients, in amounts for your family: the agent's plan is
  refused until it does, so the cart fills from it. A child's school tiffin is its own meal on school days, and a dish is
  not repeated in the week unless you asked for it. The plan follows what you told the agent about the cook: what the cook
  does not make, how much time the cook has, and whether the cook tries new recipes or keeps to familiar ones. A cook
  who comes twice a day has both visits, each with the meals it makes.
- **House rules read right.** "No eggs on Tuesday" shows as "Tue · No eggs". A rule can hold every day ("mostly
  vegetarian"), and anything else about how the house eats is kept as notes.
- **The Week page** says when the week was really planned, and the Sunday link opens the week it planned.
- **Pantry page.** Each item with its cycle and status (in stock, low or snoozed), when it was last bought, how long it usually
  lasts, and what the app learned from each order and each answer of yours.
- **A subscription is a pantry item's setting.** On an item's page, "Comes on subscription", with who delivers it if you
  like (the milkman, Country Delight): the item stays in the Pantry as "Subscription · the milkman" and is never put in a
  cart or asked about, until you turn it off there ("Not on subscription"). There is no separate list of subscriptions;
  telling the agent works too.
- **Saved recipes with videos.** Share a reel, a short or any link and say "save this": it is kept on the Recipes page, now
  a gallery, and can be planned into the week.
- **A video for a dish.** Ask "find a video for rajma", or share a recipe reel for a dish: the dish keeps that one video
  (a link, never a download), and every week it is planned it shows as a small play button on the Week page and its
  link goes in the cook's message for that day.
- **How the food went.** The 7 pm reminder asks once how today's home-cooked food went: good, okay or didn't work, and what
  went well or didn't. A day with nothing eaten at home asks nothing. The next time a dish is planned, last time's note shows
  under it ("Bhindi, last time: too oily") and is in the cook's message, and dishes that didn't work are planned less often.
- **Product pictures.** The Pantry and the cart show each item's picture from the shopping app (from your orders, or the
  first time it went into a cart), or its first letter when there is none. Pictures stay in the app, never in a message.
- **For the agent.** There are 28 operations. Kept from 2.0: `guide` and `record_order` (now about a cart). New: `set_person`,
  `set_house_rules`, `set_cook`, `set_slots`, `set_cooking_days`, `set_shopping_apps`, `plan_week`, `set_meal`, `set_dish`,
  `set_regular` (now another way to state an item's cycle, as `set_item` does), `import_order_history`, `record_bought_outside`, `set_item`, `set_subscription`, `answer_running_low`,
  `get_reminder`, `get_cart`, `set_cart_line`, `order_cart`, `sync_cart`, `cancel_order`, `remember_product`, `save_recipe`,
  `set_dish_video`, `rate_dishes` and `get_dish`. Gone:
  `get_draft`, `edit_draft`, `move_window`, `add_quote`, `record_yes`, `skip_order`, `ack_message`, `list_jobs`,
  `answer_job`, `pantry`, `pantry_answer`, `have_item`, `search`, `save_meal`, `remove_meal`, `set_meal_recipes`,
  `write_recipe` and `set_shelf_life`. Past orders are read in calls of about 8 orders and 80 items. The Sunday run ends
  with a `plan_week` call that carries the message. The reminders read your order history first, copy the carts to the
  shopping apps, then send.

Existing installs: the 2.0 tables are kept and not read, and your household profile is carried over; the agent turns it into
the new Family page on its next Sunday run, then plans the week. Until then no week is planned and nothing is ordered. Old
meals, recipes and shopping lists are not shown in the new pages.

## 2.0.7

- **Zepto and Swiggy Instamart are their official connections.** The agent's guide says to read their cart and bill only
  from the connection (Zepto's full total is the "Order Total" from `get_payment_methods`), never from their websites,
  and never to place an order just to see a price. BigBasket and Blinkit still use their skills.

## 2.0.6

- **Price comparison** (moved here from the Family Butler template): the agent's guide says how the price step, or a
  family member asking which service is cheapest, compares services: one delivery address for all of them, one
  background session per connected grocery service with the family's own words for each item, each using that service's
  own skill or connector, then the totals compared at that address. No order without a yes on that exact total.
- The guide keeps to the app's own data. Checking the cart with `view-cart` after adding moved to the grocery skills
  (bigbasket, zepto, zomato-blinkit, swiggy-instamart); paying after the yes is each skill's `checkout` and the payments
  guide; the `skill-sandbox` WARN note is gone (Flock reports a script's own error). From the Family Butler template: the
  rows are the owner's, so never delete or "tidy" rows the agent did not add.
- **Price comparison:** each session picks a product matching every word the family used for the item (another kind,
  such as a brown coconut for "tender coconut", is not the item) and reports it unavailable rather than substituting;
  every service gets the same quantity in the family's unit, so the totals compare like for like.

## 2.0.5

- The agent's guide calls operations, reads rows and changes settings with the api tool, not `flock-api`.

## 2.0.4

- The week page keeps working when a readiness reply carries no `statuses`: each meal falls back to the local rows instead of the page failing.

## 2.0.3

- **The agent is never woken about the same thing twice.** A background job is asked about once. One left unanswered
  falls back to the app's plain rule at its expiry instead of being re-asked every 30 minutes. A job whose meal or recipe
  was deleted (a re-planned day) closes itself, and answering it is a 409, so it is never a 404 that leaves it open.
  The boot pass and the recipe-fill sweep no longer re-queue work that was already asked.
- The nightly check hands each item (an empty slot, a link, a quantity, a likely duplicate, a shelf life) to the agent
  once. What the agent or the family left alone stands, and is not asked again. Nothing new means no model call.
- The shopping reminder, the heads-up and the near days' menus go out straight from the app, with no model call. Only
  the price step (filling carts on the services) and placing an order wake the agent. Silence means the plan stands.

## 2.0.2

- The "waiting to hear about your household" notice is inset like the samples banner above it, and no longer repeats it.

## 2.0.1

- **Nothing runs until the family has told the agent about themselves.** The new `household.profile` setting holds what the
  family said in their first conversation (who eats, food habits, meals to plan, where they shop); the agent saves it in
  their words, never from guesses. Until it is set every routine is a silent no-op, no job reaches the agent, the shopping
  list is not rebuilt, and every page says the app is waiting and what to tell the agent. When it arrives the samples are
  cleared (one undoable change) and the work starts from the family's own rows.
- **Installs without a profile stop generating.** At the first start of 2.0.1, what the app and its agent generated before
  is marked as samples (cleared with the template's), the owner's own rows and the install import's stay, and an install
  that already holds its family's diners carries on.
- Layout-lint fixes on the Recipes, Ingredients, Pantry and grocery pages.

## 2.0.0

- **The app owns how its agent works.** `agentInterface` declares 20 operations and the agent's instructions; Flock 0.22.0
  puts them in the paired agent's context, so any agent paired with the app can run it (no skill to install). The full guide
  is the `guide` operation. Needs Flock 0.22.0.
- **A meal is a set of recipes plus a note.** The shopping need comes from the recipes; the agent reviews it against the note
  ("leftovers from tonight") in a background job. Only the agent creates recipes, and fills a planned recipe's lines at once.
- **Shopping windows.** One live draft per window with its span ("Thu breakfast → Sat dinner"): an evening reminder, a
  heads-up Checklist 15 minutes before, a price check across services with the best pick, then "Order with <service>". No yes
  in 3 hours lets the draft go quietly; "Skip this order" asks first, and only still-useful items move to the next order. At
  most three messages per window.
- **Stock and Pantry.** What was bought, drawn down by the meals cooked; long-shelf-life items assumed at home and checked by
  the agent now and then (one question about the coming meals). The Pantry page shows what is in the kitchen.
- **Learning.** Every choice is recorded; the agent finds patterns in a background job and the app applies the ones it marks.
- Groceries is now **Shopping**; a meal's chip appears only when it says something, and links to the items.
- New tables `ingredients`, `recipe_ingredients`, `diners`, `diner_portions`, `staples`, `carts` and private ones (stock,
  jobs, choices, learned prefs); existing rows are kept (additive schema).

## 1.1.2

- The icon is the app's own illustration (`icon.svg`, the grocery bag drawn in its header), in place of the 🍽️ emoji.

## 1.1.1

- Declares itself an app template (`"usage": "template"` in `flock.app.json`), so Flock offers it as a starting point to make apps from, not as an app of its own. 1.1.0's installed copy had no `usage` and read as an app. Nothing else changed.

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries the kit fields `template.json` held, plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`. `template.json` and `TEMPLATE.md` are gone: Flock 0.15.0 reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: "+ Add" on a meal, a dish, or an empty day opens the meal editor right there in the week, under the row tapped (it opened above the week and scrolled up). Escape closes it and focus goes back to what was tapped. Edit item on the grocery list opens under that item; a new recipe opens right under the page header. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace kit app (moved from the Flock repo).
