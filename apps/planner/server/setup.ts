// apply_setup { household, transcript } v2, on the slot model (docs/slot-model-spec.md §4). The model reads words, code stores
// and checks. Flock sends every household fact it holds (household.people with nicknames, household.weekly, household.dated,
// household.speaker) and the planner part of the interview as Q:/A: lines. Four balanced reads run at once (the home: slots,
// the cook, who of the family cooks, shopping; the food rules; the dishes: a library per slot and seed slot-days from the past
// week's answers; how often: the words that say how often or on which days the family has a dish, for the few dishes that have
// them), then a fast "contains" read of every dish for every tag a rule names and the base tags.
//
// Code checks structure only (§4.2), never what a word means: a quote must be in the family's replies or facts; a hard rule
// never carries a frequency; names must be people at home (unknown: the read-back asks); slot names must resolve to a slot; a
// dish's days or count must be backed by its quote (the lint: a quote with a day word or a number and nothing saved gets one
// re-read); which tags were read is recorded (contains_read). Writes go in a fixed order (§4.3) in one transaction; the
// read-back (§4.4) is built from the rows. A later call with more replies is a correction (§4.5): the reads run again, and
// only what the new replies said (by quote, or by naming the slot, dish or person) is applied; the read-back says only that.
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { house, people as peopleTable } from "./db/schema";
import { APP_NAMES, appOf, BASE_TAGS, FREQUENCY_WORDS, GROUPS, LINT_COUNT_WORDS, LINT_DAY_WORDS, RULE_WHATS, SKIPS, SLOT_ORDER, SLOTS, INSTEAD_STEP,
  type Frequency, type GroceryApp, type RuleWhat, type Skip, type SlotKind } from "./db/constants";
import { WEEKDAYS, clockText, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import { cookVisits, daysSaid, getHouse, houseView, isObject, LONG_DAY, refuse, writeRoutes, type Db, type Emit } from "./family";
import { addRule, commit, deleteSeedSlotDays, getLibraryDish, listLibrary, listRules, listSlots, removeLibrary, removeRule, renameDish, saveSlotDay, seedSlotDays,
  upsertLibrary, upsertSlot, type Change, type LibraryDish, type Rule, type RuleInput, type Slot } from "./slotStore";
import { bareDish, CATALOG, catalogItem, catalogKind, catalogSub, checkMealShape, matchDish, norm, plannerTags, regionalDish, regionalIn, regionalMeaning, regionalWordOf, suggestMeals, type CatalogKind, type RegionalMeaning, type RegionalWord, type MealTemplate,
  isKindPart, isLinkedPart, type ItemsPart, type KindPart, type LinkedPart } from "./kinds";
import { resolveGives, targetsOf, targetText, type RuleTarget } from "./targets";
import type { ModelCall, ModelResult } from "./model";
import { isAllergyRule } from "./allergy";

// ── The prompts: one made-up example family for every part (never a test family: the name guard checks) ──

const STR = { type: "string" }, STRS = { type: "array", items: STR };
const DAYS = { type: "array", items: { type: "string", enum: [...WEEKDAYS] } };

const COMMON = `You read an Indian family's setup chat with their meal planner and write down ONE PART of their household for the planner, as JSON. Code saves what you write; you only read. Other readers write the other parts at the same time: write only the part asked for here.

You get:
- household: facts the family gave earlier. household.people is everyone who eats at home; a person may have nicknames (what someone in the family calls them; "by" is who). Always write a person by their name exactly as in household.people[].name, never a nickname or a family word: when the speaker says "Amma" and Lalitha has the nickname "Amma", write "Lalitha". household.speaker is the person writing the A lines: their "I", "me", "my" is that person. household.weekly: who is away from home on which weekdays (office, school, college), with their weekday lunch when known.
- transcript: the planner's questions (Q:) and the family's replies (A1:, A2:, ... numbered), in order. Only A lines and household facts are the family's words. A Q: line is the app talking: never take a rule, a dish or a time from a question's examples or from the app's own read-back.

Read it all first, then write. A later reply wins over an earlier one ("actually she comes at 8:30" changes the time); when a later reply changes something, quote the later reply. "Looks right" / "no changes" adds nothing; off-topic lines add nothing.
quote: the family's exact words a thing comes from, copied character for character from one A line or household fact (a short span). Never from a Q: line, never your own words. No quote, no entry.
Days are Mon, Tue, Wed, Thu, Fri, Sat, Sun. Answer at once, compactly: no prose, and leave out any field that is empty or null.`;

const EXAMPLE = `Example (another family, not this one). household: speaker "Rahul"; people Rahul (adult), Kavya (adult, wife; nickname "Kavu" by Rahul), Tara (8, daughter), Lalitha (72, Kavya's mother; nicknames "Amma" by Kavya, "Paati" by Tara); help: cook Savita Mon-Fri 8am; weekly: Rahul office Mon-Fri (lunch not known), Tara school Mon-Fri (lunch "carries").
Q: Savita cooks Breakfast and Lunch at 8am. Is that right? A1: yes, and she comes back at 5 for dinner
Q: Is food cooked at home on weekends? A2: Saturday Kavu cooks everything. Sunday we go to my in-laws for lunch, dinner we order from Zomato. We all have a snack at 5
A3: oh and Savita comes at 8:30 actually
Q: Any food rules? A4: we're eggetarian, eggs fine but no meat. Amma is pure veg, no eggs, and she doesn't eat onion or garlic; she fasts on Saturdays till sunset, only fruit. Brown rice is better for her, and less oil.
Q: Does anyone eat differently at dinner? A5: Paati has just two phulkas at night, no rice. Tara has the same as us, just less spicy
Q: Tara's tiffin? A6: Mon-Fri, sandwiches or poha, school says no peanuts.
Q: What did you have for lunch last week? A7: Most days rice, rasam or dal, a poriyal, curd. Pulao twice, puri on Sundays. Lemon rice every Friday. Salad every day.
Q: And breakfast? A8: usually idli or dosa, upma once, bread toast on busy days. Kavu has ragi dosa too. Paati has her own ragi porridge.
Q: Which grocery app? A9: Blinkit. Milk comes from Country Delight every morning`;
const NOT_THE_EXAMPLE = "That family is only an example: write what THIS family said, nothing from the example.";

const HOME_SCHEMA = {
  type: "object", required: ["slots"],
  properties: {
    slots: { type: "array", items: { type: "object", required: ["name", "kind"], properties: {
      name: STR, kind: { type: "string", enum: ["main", "custom", "addon"] }, addon_of: STR, after: { type: "string", enum: [...SLOTS] },
      usual_people: STRS, days: DAYS, skip_days: { type: "array", items: { type: "object", required: ["day", "skip"], properties: { day: STR, skip: { type: "string", enum: [...SKIPS] } } } },
      instead_of: { type: "string", enum: [...SLOTS] }, extras: { type: "boolean" }, quote: STR } } },
    cook: { anyOf: [{ type: "null" }, { type: "object", properties: {
      name: STR, days: DAYS, visits: { type: "array", items: { type: "object", required: ["meals"], properties: { at: STR, meals: STRS } } }, limits_words: STR, quote: STR } }] },
    family_cooks: { type: "array", items: { type: "object", required: ["person", "days"], properties: { person: STR, days: DAYS, quote: STR } } },
    apps: { type: "object", properties: { main: STR, fallback: STR } },
    subscriptions: { type: "array", items: { type: "object", required: ["item"], properties: { item: STR, source: STR, note: STR } } },
    weekday_lunch: { type: "array", items: { type: "object", required: ["person", "lunch"], properties: { person: STR, lunch: { type: "string", enum: ["away", "carries", "home"] }, quote: STR } } },
    lunch_unclear: STRS,
  },
};
const HOME_PART = `Write this part: the meals (slots), the cook, who of the family cooks, shopping.
- slots: every meal planned at home. Always Breakfast, Lunch and Dinner (kind "main"), each with skip_days when the family said that meal is eaten out or ordered in on a weekday every week ({ day, skip: eaten_out | ordered_in }; "Sunday lunch we eat out" is Lunch skip_days [{ Sun, eaten_out }] only: Sunday's other meals are still cooked) and a quote for that. Said for some of the family ("I order in for myself on Saturdays"), it is that meal's skip all the same when the others at home have their own meal in its place that day (instead, below): their own meal is still cooked.
  kind "custom": a meal the family names besides those: a child's school tiffin, lunch box or snack box ("<child>'s tiffin", or the family's word for a box two children share; usual_people [those children], days the school days), an evening snack ("Evening snack"). after: the main meal it comes after (an evening snack: Lunch). Each box the family names is its own slot: a breakfast box and a lunch box are two slots, also for one child. usual_people: the people the family names for it; a meal said without names is everyone's: usual_people empty. days: the weekdays it is eaten, empty for every day.
  A box or tiffin the family names its own food for, food that is not the home meal ("snack box: sandwiches or pasta", "lunch box: pulao, curd rice"), is always a custom slot, also when it is told in an answer about lunch: its people are the ones it is said of (a box told in answer to a question about the children is the children's). Someone who carries the home meal ("takes roti sabzi from home", "carries his lunch") has no slot: Lunch is cooked for them.
  kind "addon": one person's own plate at a main meal: the family names a dish made for that person at that meal, in place of or beside the shared dishes ("father has two phulkas, no rice at night", "bajra roti for her at night", "her own ragi porridge", "his own soup", a child's different dinner): name "<person>'s <meal>" ("Lalitha's dinner"), addon_of the main meal, usual_people [that person]. It holds only the difference; the person still eats the main meal's shared dishes. Someone who has a dish the others have too ("Kavu has ragi dosa too", "same as us, less spicy") has no add-on.
  instead_of: the main meal such a meal is eaten in place of, when the person does not eat that meal at all, only their own, at its time or another ("she eats at six, on her own", "he doesn't eat our dinner", "she doesn't sit with us at night", "the baby has his own food every night"): that meal is theirs alone and the main meal is cooked for the others. Left out when they also eat the shared dishes.
  A box a child eats in place of a meal is kind "custom", instead_of that meal, its days the school days: a school tiffin or lunch box is instead_of Lunch, unless the family calls it a breakfast box (instead_of Breakfast); a box packed with the home meal's own dish is such a box too. A snack box the child has besides a lunch at home has no instead_of.
  extras: true on an add-on that is food the person has beside the home meal, the home meal still theirs ("I take 4 eggs and some salad with my lunch": "<person>'s lunch box", addon_of Lunch, extras true, days the days they carry it). Left out otherwise.
  quote: the family's words that name a custom or add-on meal (one the family never named is no slot).
- cook: the paid cook, or null. name: only the name the family gives her (never "cook" or another role word); left out when none is said. days. visits: each time they come, with the meals that visit makes; at: "HH:MM" 24-hour only when a clock time is said, left out for "morning" or "twice a day". limits_words: the cook's time or skill limits in the family's words. quote: the family's latest words about the cook's days or times.
- family_cooks: on days the cook does not come, who of the family cooks ({ person, days, quote }), only when said.
- apps: the grocery app (main) and the one used when something is missing (fallback), as the family names them.
- subscriptions: what comes on a subscription: { item, source, note }.
- weekday_lunch: for someone away on weekdays (household.weekly), where they have lunch when the replies say it: away (eats out or at work), carries (takes lunch from home), home. Only from the family's words.
- lunch_unclear: the people away on weekdays whose weekday lunch neither household.weekly nor the replies tell.
Food rules and dishes are not this part: other readers write them.`;
const HOME_EXAMPLE = `gives slots [{ Breakfast, main }, { Lunch, main, skip_days [{ Sun, eaten_out }], quote "Sunday we go to my in-laws for lunch" }, { Dinner, main, skip_days [{ Sun, ordered_in }], quote "dinner we order from Zomato" }, { "Tara's tiffin", custom, instead_of Lunch, usual_people [Tara], days Mon..Fri, quote "Mon-Fri, sandwiches or poha" }, { "Evening snack", custom, after Lunch, quote "We all have a snack at 5" (said for everyone: no usual_people) }, { "Lalitha's dinner", addon, addon_of Dinner, usual_people [Lalitha], quote "Paati has just two phulkas at night" }, { "Lalitha's breakfast", addon, addon_of Breakfast, usual_people [Lalitha], quote "Paati has her own ragi porridge" }] (no add-on for Kavya: her ragi dosa is shared; none for Tara: same dinner), cook { name "Savita", days Mon..Fri, visits [{ at "08:30", meals [Breakfast, Lunch] }, { at "17:00", meals [Dinner] }], quote "Savita comes at 8:30 actually" }, family_cooks [{ person "Kavya", days [Sat], quote "Saturday Kavu cooks everything" }] (who cooks on Sunday was not said: left out), apps { main "Blinkit" }, subscriptions [{ milk, Country Delight, every morning }], lunch_unclear ["Rahul"] (at the office on weekdays, his lunch never said; Tara has her tiffin).
And "Q: The children's lunch, or their school tiffin? A: Snack box Monday to Friday: sandwiches, pasta or chivda, and fruit. Lunch at home after school, same as ours." with "Q: Rahul's lunch? A: He takes roti sabzi from home" gives the slot { "Snack box", custom, after Breakfast, usual_people [Tara], days Mon..Fri, quote "Snack box Monday to Friday" } (the children's box: Tara is the child; no instead_of: lunch is at home) and weekday_lunch [{ person "Rahul", lunch carries, quote "He takes roti sabzi from home" }], no slot for Rahul: he carries the home lunch.`;

const RULES_SCHEMA = {
  type: "object", required: ["rules"],
  properties: {
    rules: { type: "array", items: { type: "object", required: ["hard", "what", "quote"], properties: {
      hard: { type: "boolean" }, what: { type: "string", enum: [...RULE_WHATS] }, who: STR, slots: STRS, days: DAYS, items: STRS, to: STR,
      frequency: STR, per_meal: { type: "number" }, fasting_food: STRS, quote: STR } } },
    unplaced: { type: "array", items: { type: "object", required: ["text", "quote"], properties: { text: STR, quote: STR } } },
  },
};
const RULES_PART = `Write this part: the family's food rules, one per thing they said: what must or must not be eaten. What someone usually eats is no rule (another reader writes dishes).
Rules are said in any reply, the meals' answers too ("same dinner, just less spicy for her").
- what is one of: veg { who? } (vegetarian: no meat or fish; eggs are their own rule) | egg { who? } (eats eggs, no meat or fish) | no_eggs { who? } (no eggs: "pure veg, no eggs" is two rules, veg and no_eggs; so is vegetarian said with no eggs in the same sentence or reply: "she's vegetarian and won't touch eggs", "pure veg") | avoid { items, who?, days?, slots? } (no dish with these) | only { who, items, slots? } | swap { who, items, to } (who has "to" in place of items) | require { items, slots, who? } (one of items at those meals) | fasting { who, days, slots, fasting_food } (who eats nothing at those meals on those days but fasting_food; "till sunset" is slots [Breakfast, Lunch]) | cap { per_meal, slots?, days? } (at most per_meal dishes to cook in a meal: a cook's time limit; a cook short of time with a number of dishes is cap { per_meal: the larger number said, slots: that visit's meals }, "3-4 dishes in the morning" is per_meal 4 with slots the morning visit's meals and days the cook's days; never a dish she won't make) | note { who? } (anything else, kept in the family's words: "less oil", "less spicy for the child", "high protein").
- An egg exception to a vegetarian house ("vegetarian, eggs okay for Tara") is veg for the house, egg for each person named, and no_eggs for every other person at home, one rule each.
- hard: true for what holds at every meal: allergies, vegetarian, eggs, no eggs, avoid, only, fasts, caps, "no sugar", "never". A note is never hard. false for a wish said loosely ("X is good for her", "better", "more fruit", "try to", "sometimes"): give it frequency: usually (most days) | sometimes (a few times a week; any "good for" / "better" / "try to") | rarely | "<n>/week" when they gave a number. A hard rule never has a frequency. "No sugar" / "no sweets" is always hard avoid ["sugar"]. "Less X" is a note, never avoid.
- items: tags, lower case with underscores: a plain food ("mushroom", "chicken", "paneer") or one of egg, meat, fish, onion_garlic, nuts, peanut, sugar, white_rice, dairy, root_veg, millet. "No nuts" is nuts (peanuts too); peanut only when peanuts alone are named. "No rice at night" is avoid ["white_rice"] at slots ["Dinner"]. Meat on some days only ("chicken only on weekends") is avoid ["meat", "fish"] on the other days, one rule for each person it is said of (left out when said of the whole house).
- who: one person's name (household.people), left out for the whole house. days left out for every day; slots are meal names (Breakfast, Lunch, Dinner, "<child>'s tiffin", "Evening snack", "<person>'s <meal>"), left out for every meal.
- An allergy is a hard avoid for that person, quoting the words that say allergy. When the family says the whole kitchen goes without it ("everything at home is without it", "we don't use it at all"), add a hard avoid with no who, quoting those words; "only his food" or "he has his own food" adds nothing.
- unplaced: a food wish that is no rule and no dish, cook or shopping matter: { text, quote }. Usually none.`;
const RULES_EXAMPLE = `gives rules [{ hard, egg, quote "eggs fine but no meat" }, { hard, veg, who "Lalitha", quote "Amma is pure veg" }, { hard, no_eggs, who "Lalitha", quote "Amma is pure veg, no eggs" }, { hard, avoid, who "Lalitha", items ["onion_garlic"], quote "she doesn't eat onion or garlic" }, { hard, fasting, who "Lalitha", days [Sat], slots [Breakfast, Lunch], fasting_food ["fruit"], quote "fasts on Saturdays till sunset, only fruit" }, { soft, swap, who "Lalitha", items ["white_rice"], to "brown rice", frequency "sometimes", quote "Brown rice is better for her" }, { soft, note, who "Lalitha", quote "less oil" }, { hard, avoid, who "Lalitha", items ["white_rice"], slots ["Dinner"], quote "no rice" }, { hard, avoid, items ["peanut"], slots ["Tara's tiffin"], quote "no peanuts" }, { soft, note, who "Tara", quote "just less spicy" }].
And "A: Kavu is vegetarian. She won't touch eggs either." gives [{ hard, veg, who "Kavya", quote "Kavu is vegetarian" }, { hard, no_eggs, who "Kavya", quote "She won't touch eggs either" }]: both, every time.
And "A: Vegetarian. Eggs okay for Tara and Rahul." gives [{ hard, veg, quote "Vegetarian" }, { hard, egg, who "Tara", quote "Eggs okay for Tara and Rahul" }, { hard, egg, who "Rahul", quote "Eggs okay for Tara and Rahul" }, { hard, no_eggs, who "Kavya", quote "Eggs okay for Tara and Rahul" }, { hard, no_eggs, who "Lalitha", quote "Eggs okay for Tara and Rahul" }] (Kavya and Lalitha are not named for eggs: no eggs for them).
And "A: Tara is allergic to sesame" with "Q: Do you cook everything without sesame, or only Tara's food? A: We don't use sesame at home at all" gives [{ hard, avoid, who "Tara", items ["sesame"], quote "Tara is allergic to sesame" }, { hard, avoid, items ["sesame"], quote "We don't use sesame at home at all" } (the whole house: no who)]; had they said "only her food", only the first.`;

/** Short rows, the fewest tokens per item: the dishes are the longest answer. */
const DISHES_SCHEMA = { type: "object", required: ["library"], properties: {
  library: { type: "array", items: { type: "array", items: STR } }, seed: { type: "array", items: { type: "array", items: STR } },
  links: { type: "array", items: { type: "array", items: STR } } } };
const DISHES_PART = `Write this part: the family's own dishes, from their answers (the past week's meals, a child's tiffin, what someone has for a meal). No everyday tea or coffee; a drink someone has as part of a meal is a dish of that meal ("a glass of milk at night" for one person's dinner, buttermilk with lunch). What comes on a subscription or delivery (milk from a dairy every morning) is shopping, never a dish. How often they have each is not this part: another reader writes it.
- library: each dish the family eats, one row per dish and meal: [name, slot, quote].
  name: plain ("Idli", "Rajma chawal"); keep a quantity in the name when said with it ("4 eggs"). A meal told as its parts ("rice, dal, a dry sabzi, curd") is each part a dish; "sambar or dal" is two dishes.
  slot: the meal it is eaten at. A reply is about the meal its question asks for: a breakfast answer is Breakfast, also when said of a child. A child's tiffin ("<child>'s tiffin", or the family's word for the box) holds only what the family says goes in the tiffin or box. One person's own plate "<person>'s <meal>" ONLY when the family's sentence names that person and a dish made for them at that meal (their own dish, "for Amma", "instead of"). A dish someone has that the others have too stays on the shared meal.
  quote: the family's words naming the dish.
- seed: each "past week" answer as example meals: [slot, "dish, dish, dish", quote], one row per kind of plate they described, for every meal they described: a child's tiffin and one person's own plate too ("rice, rasam or dal, a poriyal, curd" is ["Lunch", "Rice, Rasam, Poriyal, Curd", quote] and ["Lunch", "Rice, Dal, Poriyal, Curd", quote]). Only the parts of one meal make one row; a list of what was had on different days ("idli, dosa, upma once, bread toast on busy days"; a tiffin's "sandwich, pasta, curd rice") is one row per dish: each one is a whole meal. Every seed dish is also in library.
- links: a box or meal that has the home meal's own dish: [slot, from_meal, kind_words, quote]. from_meal: the meal whose dish it has (Breakfast, Lunch, Dinner); kind_words: the family's words for the part it takes ("sabzi"), or "" when it has that whole meal ("he has what we make for breakfast").
- A box with the home meal's dish names a link, not a dish: the home meal's dish is no dish of the box's, its other dishes are.
- A filling said with a kind is an item of that kind: paratha rolled with egg or cheese inside is Egg paratha roll, Cheese paratha roll (one row each, at the box's meal).
- A dish someone has in place of another ("pancakes for him when we make upma") is their rule's (a swap), never a dish of the meal.
- A meal the person has beside the home meal is their add-on's ("<person>'s lunch box": the eggs and salad they take with the home lunch), never the shared meal's.`;
const DISHES_EXAMPLE = `gives library [["Sandwich", "Tara's tiffin", "sandwiches or poha"], ["Poha", "Tara's tiffin", "sandwiches or poha"], ["Phulka", "Lalitha's dinner", "Paati has just two phulkas at night"], ["Rice", "Lunch", "Most days rice"], ["Rasam", "Lunch", "rasam or dal"], ["Dal", "Lunch", "rasam or dal"], ["Poriyal", "Lunch", "a poriyal"], ["Curd", "Lunch", "curd"], ["Pulao", "Lunch", "Pulao twice"], ["Puri", "Lunch", "puri on Sundays"], ["Lemon rice", "Lunch", "Lemon rice every Friday"], ["Salad", "Lunch", "Salad every day"], ["Idli", "Breakfast", "usually idli or dosa"], ["Dosa", "Breakfast", "usually idli or dosa"], ["Upma", "Breakfast", "upma once"], ["Bread toast", "Breakfast", "bread toast on busy days"], ["Ragi dosa", "Breakfast", "Kavu has ragi dosa too"] (the others have it too: shared), ["Ragi porridge", "Lalitha's breakfast", "Paati has her own ragi porridge"]], seed [["Lunch", "Rice, Rasam, Poriyal, Curd", "Most days rice, rasam or dal, a poriyal, curd"], ["Lunch", "Rice, Dal, Poriyal, Curd", "Most days rice, rasam or dal, a poriyal, curd"], ["Breakfast", "Idli", "usually idli or dosa"], ["Breakfast", "Dosa", "usually idli or dosa"], ["Breakfast", "Upma", "upma once"], ["Breakfast", "Bread toast", "bread toast on busy days"] (a breakfast list: one row per morning's dish, never one row of all), ["Tara's tiffin", "Sandwich", "sandwiches or poha"], ["Tara's tiffin", "Poha", "sandwiches or poha"], ["Lalitha's dinner", "Phulka", "Paati has just two phulkas at night"], ["Lalitha's breakfast", "Ragi porridge", "Paati has her own ragi porridge"]].
And "Kavu and I carry chapati sabzi to office, Paati has rice, dal and curd at home" (one lunch, cooked once, for different people) gives library [["Chapati", "Lunch", "chapati sabzi"], ["Sabzi", "Lunch", "chapati sabzi"], ["Rice", "Lunch", "rice, dal and curd"], ["Dal", "Lunch", "rice, dal and curd"], ["Curd", "Lunch", "rice, dal and curd"]], seed [["Lunch", "Chapati, Sabzi, Rice, Dal, Curd", "Kavu and I carry chapati sabzi to office, Paati has rice, dal and curd at home"]]: one row, never one per person, because it is the same day's one lunch. This joins only one meal told per person, never dishes had on different days.
And a bare list of the week's breakfasts or tiffins, "Q: The adults' breakfast? A: Upma, idli, pongal, dosa. Puri on Sunday." gives seed [["Breakfast", "Upma", "Upma, idli, pongal, dosa"], ["Breakfast", "Idli", "Upma, idli, pongal, dosa"], ["Breakfast", "Pongal", "Upma, idli, pongal, dosa"], ["Breakfast", "Dosa", "Upma, idli, pongal, dosa"], ["Breakfast", "Puri", "Puri on Sunday"]]: each a different morning, never one row "Upma, Idli, Pongal, Dosa".
And "Q: What goes in Tara's boxes? A: Her lunch box is chapati rolled with the sabzi we make for lunch, sometimes with paneer inside. Her breakfast box has what we have for breakfast. Rahul takes the home lunch and 2 eggs with it." gives library [["Chapati", "Tara's lunch box", "chapati rolled with the sabzi we make for lunch"], ["Paneer chapati roll", "Tara's lunch box", "sometimes with paneer inside"], ["2 eggs", "Rahul's lunch box", "2 eggs with it"]], seed [["Tara's lunch box", "Chapati", "chapati rolled with the sabzi we make for lunch"], ["Tara's lunch box", "Paneer chapati roll", "sometimes with paneer inside"], ["Rahul's lunch box", "2 eggs", "2 eggs with it"]], links [["Tara's lunch box", "Lunch", "sabzi", "chapati rolled with the sabzi we make for lunch"], ["Tara's breakfast box", "Breakfast", "", "Her breakfast box has what we have for breakfast"]]: the sabzi and the breakfast are the home meal's, no dish of the boxes.`;

const OFTEN_SCHEMA = { type: "object", required: ["often"], properties: { often: { type: "array", items: { type: "array", items: STR } } } };
const OFTEN_PART = `Write this part: how often the family has a dish, or the weekdays they have it, for every dish whose own words say so. Another reader lists the dishes: leave out a dish with no such words.
- often: one row per such dish and meal: [name, slot, quote, often, frequency, days].
  name, slot: the dish ("Lemon rice") and the meal it is eaten at (Breakfast, Lunch, Dinner, "<child>'s tiffin", "<person>'s <meal>"). quote: the family's words naming the dish.
  often: the family's exact words, copied from the same sentence, that say how often or on which weekdays they have THIS one dish ("twice", "on Sundays", "every Friday", "most nights", "every day"; "sometimes appam", "bread toast on busy days", "pasta if it's late", "khichdi when someone is unwell" are about that one dish: sometimes). A count or weekdays said over two dishes, the one or the other ("chole or kadhi twice a week") or one eaten with the other ("puri with aloo on Sundays"), are both dishes': a row for each, with the same often and quote. Other words said over a list or a whole meal are about none of its dishes alone, so give no row for them: "usually idli or dosa", "sometimes pesarattu or upma", "most days rice, dal and a sabzi", "sambar or rasam with rice most days", "that's our usual", "mostly", "on weekdays it's poha or upma". The meal's own days (a tiffin's school days, the days the cook comes) are no dish's days. A count of the dish itself ("two phulkas") is not how often. A dish joined to a list with its own words, at any meal and for anyone ("upma or poha, and an apple every day", "his own dinner of roti or rice, and buttermilk every night"), has them: the apple and the buttermilk every day, the others none.
  frequency: from often: daily (every day), usually (most days, most nights), sometimes (sometimes, "when she's unwell", "on busy days", now and then), rarely (once in a while), "<n>/week" for a count ("twice": "2/week", "once": "1/week"), else "". A count said over the one or the other of two dishes is shared between them, rounded up: "chole or kadhi twice a week" is "1/week" each, "once" over the two is "1/week" each, "four times a week" over the two is "2/week" each. Two dishes eaten together as one meal each keep the whole count ("chapati and a kurma twice a week": "2/week" each).
  days: from often: the weekdays the dish is tied to every week ("every Friday": "Fri"; "pancakes at the weekend": "Sat, Sun"; "on Sunday mornings": "Sun"), else "". Days said over two dishes are each one's days. A list of what was eaten on which day last week is no days.`;
const OFTEN_EXAMPLE = `gives often [["Pulao", "Lunch", "Pulao twice", "twice", "2/week", ""], ["Puri", "Lunch", "puri on Sundays", "on Sundays", "", "Sun"], ["Lemon rice", "Lunch", "Lemon rice every Friday", "every Friday", "", "Fri"], ["Salad", "Lunch", "Salad every day", "every day", "daily", ""], ["Upma", "Breakfast", "upma once", "once", "1/week", ""], ["Bread toast", "Breakfast", "bread toast on busy days", "on busy days", "sometimes", ""]]]. No row for rice, rasam, dal, poriyal or curd ("Most days" is said of the whole plate), none for idli or dosa ("usually" is said of the list, and is no count or day), none for the tiffin's dishes (Mon-Fri are the tiffin's days), none for the phulkas ("two" is how many).
And "Dinner is roti, dal and a sabzi most nights, chole or kadhi twice a week. Puttu with kadala curry on Sunday mornings." gives often [["Chole", "Dinner", "chole or kadhi twice a week", "twice a week", "1/week", ""], ["Kadhi", "Dinner", "chole or kadhi twice a week", "twice a week", "1/week", ""], ["Puttu", "Breakfast", "Puttu with kadala curry on Sunday mornings", "on Sunday mornings", "", "Sun"], ["Kadala curry", "Breakfast", "Puttu with kadala curry on Sunday mornings", "on Sunday mornings", "", "Sun"]]: twice between chole and kadhi is once each; both Sunday dishes keep Sun. No row for roti, dal or sabzi ("most nights" is said of the whole plate).`;

const systemOf = (part: string, example: string) => `${COMMON}\n\n${part}\n\n${EXAMPLE}\n${example}\n${NOT_THE_EXAMPLE}`;

/** The four readers. `need`: the setup fails without this part; the dishes and how often may come back empty (said, not saved).
 *  `tier`: the dishes read copies the family's words out, so it reads on fast (no reasoning): on balanced its reasoning ran into
 *  the token cap and cut the JSON off, twice in some setups (eval 2026-11-25: 3–11 s on fast vs 18–146 s, 94% vs 78% overall). */
export const SETUP_PARTS = [
  { id: "home", tier: "balanced", purpose: "setup: the home", system: systemOf(HOME_PART, HOME_EXAMPLE), schema: HOME_SCHEMA, maxTokens: 6000, need: true },
  { id: "rules", tier: "balanced", purpose: "setup: the food rules", system: systemOf(RULES_PART, RULES_EXAMPLE), schema: RULES_SCHEMA, maxTokens: 6000, need: true },
  { id: "dishes", tier: "fast", purpose: "setup: the dishes", system: systemOf(DISHES_PART, DISHES_EXAMPLE), schema: DISHES_SCHEMA, maxTokens: 8000, need: false },
  { id: "often", tier: "balanced", purpose: "setup: how often each dish", system: systemOf(OFTEN_PART, OFTEN_EXAMPLE), schema: OFTEN_SCHEMA, maxTokens: 6000, need: false },
] as const;

export const CONTAINS_SYSTEM = `For each dish, say for each tag whether the dish as usually cooked in an Indian home has it: true or false, for every tag asked, for every dish. Answer as { "<dish name as given>": { "<tag>": true | false } }.
Tags: egg (egg in any form) · meat (chicken, mutton or any meat) · fish (fish or seafood) · onion_garlic (onion or garlic) · nuts (any nut, peanuts too) · peanut (peanuts) · sugar (added sugar, jaggery or honey, or a sweet dish) · white_rice (white rice, or a batter, flour or flakes of it: idli, dosa, poha) · dairy (milk, curd, paneer, ghee, butter, cream) · any other tag: its plain meaning ("millet": made of a millet; "root_veg": potato, carrot, beetroot, radish, yam).
Example: dishes ["Masala dosa", "Fruit salad"], tags ["onion_garlic", "white_rice", "sugar"] gives { "Masala dosa": { "onion_garlic": true, "white_rice": true, "sugar": false }, "Fruit salad": { "onion_garlic": false, "white_rice": false, "sugar": false } }.`;
const CONTAINS_SCHEMA = { type: "object", additionalProperties: { type: "object", additionalProperties: { type: "boolean" } } };

export const LINT_SYSTEM = `Each dish below comes with the family's words naming it (quote) and their whole reply (line). Read from the line only how often the family has THIS one dish, or the weekdays they have it every week. Answer { "dishes": [{ "name", "often", "frequency", "days" }] }, one entry per dish:
often: the exact words of the line that say it, about this dish, else "". A count or weekdays said over this dish and one other, the one or the other ("chole or kadhi twice a week") or one eaten with the other ("puri with aloo on Sundays"), are this dish's too. Words about another dish of the line, or other words said over a list or a whole meal ("usually idli or dosa", "most days rice, dal and a sabzi", "that's our usual", a tiffin's "Mon-Fri"), are not this dish's: "". A dish joined to a list with its own words ("upma or poha, and an apple every day") has them: the apple every day. A count of something else ("two phulkas") or a list of last week's days is neither.
frequency (from often only): daily (every day) | usually (most days) | sometimes | rarely | "<n>/week" for a count ("twice": "2/week"); a count said over the one or the other of two dishes is shared, rounded up ("chole or kadhi twice a week": "1/week"), while two eaten together each keep it ("chapati and a kurma twice a week": "2/week"), else "". days (from often only): weekdays (Mon..Sun) the dish is tied to every week ("on Fridays", "on Sunday mornings": ["Sun"]), else [].`;
const LINT_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "object", required: ["name"],
  properties: { name: STR, often: STR, frequency: STR, days: DAYS } } } } };

/** The kinds read (fast, one call): where each dish code could not place sits in the dish-kinds catalog. */
export const KINDS_SYSTEM = `Each dish below is one an Indian family named for a meal (breakfast, lunch, dinner; tiffin: a school or office box; snack), with their words for it (words). Place each in the dish-kinds catalog given: one line per kind, "Kind [the meals it is usually had at]: its sub-kinds". Answer { "dishes": [{ "name", "meal", "kind", "sub", "own", "named", "parts" }] }, one entry per dish, name and meal as given.
- kind, sub: the catalog kind the dish is one of, and its sub-kind, copied exactly from the catalog. A vegetable said alone is that vegetable's dry sabzi: kind Sabzi (said with gravy or as a curry: Gravy). A dish no kind holds goes under a nearby kind only when it plays the same part on the plate (a millet flatbread at breakfast with the breakfast flatbreads; savoury oats with Porridge). Otherwise own: true, with no kind or sub: a dish only this family has (a plain boiled or steamed thing had as a meal is its own).
- named: "category" when the family's words mean any dish of a kind or sub-kind ("any dry veg", "a different dosa each time", "some dal or other"); "dish" when they name one dish. A dish's name said alone is a dish.
- parts: for a dish that is rice mixed with a curry or with curd, its two parts as [{ "kind", "sub" }]: the rice and the other. Else leave it out.
- known: a dish that comes with known (its kind and sub-kind, already found) needs only named; copy its kind and sub.
- regional: some words mean different dishes by region; each comes with its meaning in each region. For a dish named with one, read the family's region from their other dishes (family_dishes) and their words, and place it as that region's meaning; a dish named with the word and a vegetable ("carrot curry") is that vegetable's dish of the meaning's kind. Nothing tells the region: the dish's own words decide (said with gravy: Gravy; dry or fried: Sabzi).
Example (another family, not this one): dishes [{ "name": "Tondli", "meal": "lunch", "words": "rice, dal and tondli" }, { "name": "Parwal", "meal": "dinner", "words": "parwal with gravy" }, { "name": "Dry veg", "meal": "dinner", "words": "roti with any dry veg" }, { "name": "Dahi chawal", "meal": "lunch", "words": "dahi chawal when it's hot" }, { "name": "Sambar sadam", "meal": "lunch", "words": "sambar sadam" }, { "name": "Masala oats", "meal": "breakfast", "words": "masala oats" }, { "name": "Steamed sweet potato", "meal": "breakfast", "words": "steamed sweet potato" }, { "name": "Upma", "meal": "lunch", "known": "Upma", "words": "upma when we're rushed" }, { "name": "Dosa", "meal": "lunch", "known": "Dosa", "words": "a different dosa every Saturday" }] gives [{ "Tondli", lunch, kind "Sabzi", sub "Sabzi", named "dish" }, { "Parwal", dinner, kind "Gravy", sub "Curry", named "dish" }, { "Dry veg", dinner, kind "Sabzi", sub "Sabzi", named "category" }, { "Dahi chawal", lunch, kind "Curd", sub "Curd", named "dish", parts [{ "Rice" }, { "Curd" }] }, { "Sambar sadam", lunch, kind "Rice curry", sub "Sambar", named "dish", parts [{ "Rice" }, { "Rice curry", "Sambar" }] }, { "Masala oats", breakfast, kind "Porridge", named "dish" }, { "Steamed sweet potato", breakfast, own true, named "dish" }, { "Upma", lunch, kind "Upma", named "dish" }, { "Dosa", lunch, kind "Dosa", named "category" }]. Another family: family_dishes ["Rice", "Mor kuzhambu", "Curry", "Pachadi", "Carrot curry"], regional curry and pachadi, dishes [{ "name": "Pachadi", "meal": "lunch", "words": "rice with mor kuzhambu, a curry and pachadi, the curd one" }, { "name": "Carrot curry", "meal": "lunch", "words": "curry is mostly carrot curry" }] gives [{ "Pachadi", lunch, kind "Raita", named "category" }, { "Carrot curry", lunch, kind "Sabzi", sub "Poriyal/Thoran", named "dish" }] (mor kuzhambu and the curd pachadi tell a Tamil kitchen).`;
const KINDS_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "object", required: ["name"], properties: {
  name: STR, meal: STR, kind: STR, sub: STR, own: { type: "boolean" }, named: { type: "string", enum: ["dish", "category"] },
  parts: { type: "array", items: { type: "object", required: ["kind"], properties: { kind: STR, sub: STR } } } } } } } };

/** Every prompt the setup sends, for the checks on model-facing text. */
export const SETUP_SYSTEM = [...SETUP_PARTS.map((p) => p.system), CONTAINS_SYSTEM, LINT_SYSTEM, KINDS_SYSTEM].join("\n\n");

/** The question when no dish of theirs could be read: the plan needs their own dishes to start from. */
export const DISHES_ASK = "I couldn't read your dishes from that. What do you usually have for breakfast, lunch and dinner? A few dishes for each is enough.";

/** The whole setup's wall clock: under Flock's wait for the op (3 min). A second try starts only with RETRY_FLOOR_MS left. */
export const SETUP_BUDGET_MS = 150_000;
const RETRY_FLOOR_MS = 30_000;
/** The model calls end this long before the budget: the saving after them is inside it too. */
const SAVE_MARGIN_MS = 2_000;
/** The how-often lint's own time at most. */
const LINT_MS = 30_000;
/** The kinds read's own time: at most KINDS_MS, and done KINDS_MARGIN_MS before the setup's budget ends. */
export const KINDS_MS = 45_000;
const KINDS_MARGIN_MS = 3_000;
/** At most this many dishes in one contains call. */
export const CONTAINS_BATCH = 40;
const RETRY_CODES: string[] = ["invalid_output", "unavailable", "timeout"];

// ── Lenient reading of the model's JSON ──

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s*[,;]\s*/) : arr(v)).map(str).filter(Boolean);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** A weekday as the model wrote it ("Mon", "monday", "FRI"), or null. Format only: the model was asked for Mon..Sun. */
const weekdayOf = (v: string): Weekday | null => {
  const w = v.trim().slice(0, 3).toLowerCase();
  return WEEKDAYS.find((d) => d.toLowerCase() === w) ?? null;
};
/** Weekdays from the model's list or string; a range written "Mon-Fri" is its days. */
export function daysOf(v: unknown): Weekday[] {
  const out = new Set<Weekday>();
  for (const part of strs(v).flatMap((x) => x.replace(/\s*[-–]\s*/g, "-").split(/\s+/))) {
    const ends = part.split("-").map(weekdayOf);
    if (ends.length === 2 && ends[0] && ends[1]) {
      for (let i = WEEKDAYS.indexOf(ends[0]); ; i = (i + 1) % 7) { out.add(WEEKDAYS[i]); if (WEEKDAYS[i] === ends[1]) break; }
    } else if (ends.length === 1 && ends[0]) out.add(ends[0]);
  }
  return WEEKDAYS.filter((d) => out.has(d));
}
/** A time as "HH:MM" from how the model wrote it: "7", "7am", "7:30", "6pm", "18:00". */
export function clockOf(v: unknown): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(str(v));
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0), ap = (m[3] ?? "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}
/** A frequency as stored: daily | usually | sometimes | rarely | "<n>/week" (1–7), or null. */
export function frequencyOf(v: unknown): Frequency | null {
  const t = str(v).toLowerCase();
  if ((FREQUENCY_WORDS as readonly string[]).includes(t)) return t as Frequency;
  const n = /^(\d+)\s*(?:\/\s*w(?:ee)?k|(?:times )?(?:per|a) week|x)?$/.exec(t)?.[1];
  return n && Number(n) >= 1 && Number(n) <= 7 ? `${Number(n)}/week` as Frequency : null;
}
/** A rule's tag as stored: lower case, underscores, no "@". */
export const tagOf = (v: string): string => v.trim().toLowerCase().replace(/^@/, "").replace(/[\s-]+/g, "_");

export type ReadSlot = { name: string; kind: SlotKind; addon_of: string | null; after: string | null; usual_people: string[]; days: Weekday[];
  skip_days: { day: Weekday; skip: Skip }[]; quote: string;
  /** The read: the main meal the person eats this one of theirs in place of (they do not eat that meal at all). After the
   *  checks, a main meal's name (the slot is custom, at its place; the main meal is cooked for the others), else null. */
  instead_of?: string | null;
  /** An add-on of food the person has beside the home meal (§5.4: "4 boiled eggs and salad" with the carried lunch). */
  extras?: boolean };
/** A box or meal that has another meal's dish (§5.4): `words` the family's words for the part it takes ("sabzi"), "" the whole plate. */
export type ReadLink = { slot: string; from: string; words: string; quote: string };
/** One time the cook comes: its clock time when said, the meals it makes when said; never neither (spec §6.3, §9.3: "morning"
 *  is no clock time, and the visit is still hers with its meals). */
export type Visit = { at?: string; meals?: string[] };
/** The paid cook: `name` null when the family never named her (a role is never a name: "your cook"). */
export type Cook = { name: string | null; days: Weekday[]; visits: Visit[]; limits_words: string | null; quote: string };
export type FamilyCook = { person: string; days: Weekday[]; quote: string };
export type WeekdayLunch = { person: string; lunch: "away" | "carries" | "home"; quote: string };
/** `often`: the family's words saying how often or on which days they have this dish (none: ""); frequency and days stand only
 *  on them. `said`: the family's phrase they sit in ("rajma or chole twice a week"), kept for the plan call. */
export type ReadDish = { name: string; slot: string; frequency: Frequency | null; days: Weekday[] | null; quote: string; often: string; said?: string;
  /** Set by the checks: the family sentence (index) that backs `often`; `shared`: its words were dropped as a whole list's. */
  oftenAt?: number; shared?: boolean };
export type ReadSeed = { slot: string; dishes: string[]; quote: string };
export type ReadRule = RuleInput;
/** What the four reads give, merged; after the checks, every name and slot is known. */
export type SetupRead = { slots: ReadSlot[]; cook: Cook | null; family_cooks: FamilyCook[]; apps: { main: string | null; fallback: string | null };
  subscriptions: { item: string; source: string; note?: string }[]; weekday_lunch: WeekdayLunch[]; lunch_unclear: string[];
  rules: ReadRule[]; unplaced: { text: string; quote: string }[]; library: ReadDish[]; seed: ReadSeed[]; links: ReadLink[] };

/** The three answers as one read: every list a list, every field its type, nothing thrown away for being a little off. */
export function readOf(home: unknown, rules: unknown, dishes: unknown, often: unknown = null): SetupRead {
  const h = isObject(home) ? home : {}, r = isObject(rules) ? rules : {}, d = isObject(dishes) ? dishes : {}, o = isObject(often) ? often : {};
  // A cook is kept without a name (D10: "your cook" by contract) when the read says anything of her: a name, days or a visit.
  const cook = isObject(h.cook) && (str(h.cook.name) || daysOf(h.cook.days).length || arr(h.cook.visits).length) ? h.cook : null;
  const kind = (v: unknown): SlotKind => (v === "addon" || v === "custom" || v === "main" ? v : "custom");
  return {
    slots: arr(h.slots).filter(isObject).filter((s) => str(s.name)).map((s) => ({ name: str(s.name), kind: kind(s.kind), addon_of: str(s.addon_of) || null,
      after: str(s.after) || null, usual_people: strs(s.usual_people), days: daysOf(s.days),
      skip_days: arr(s.skip_days).filter(isObject).flatMap((x) => {
        const skip = str(x.skip) as Skip;
        return (SKIPS as readonly string[]).includes(skip) ? daysOf(x.day).map((day) => ({ day, skip })) : [];
      }), quote: str(s.quote), ...(str(s.instead_of) ? { instead_of: str(s.instead_of) } : {}), ...(s.extras === true ? { extras: true } : {}) })),
    cook: cook ? { name: str(cook.name) || null, days: daysOf(cook.days), limits_words: str(cook.limits_words) || null, quote: str(cook.quote),
      visits: arr(cook.visits).flatMap((v): Visit[] => {
        // Free text in the clock slot ("morning") is no time: the visit keeps its meals, never a made-up time.
        const at = clockOf(isObject(v) ? v.at : v), meals = isObject(v) ? strs(v.meals) : [];
        return at || meals.length ? [{ ...(at ? { at } : {}), ...(meals.length ? { meals } : {}) }] : [];
      }) } : null,
    family_cooks: arr(h.family_cooks).filter(isObject).filter((x) => str(x.person)).map((x) => ({ person: str(x.person), days: daysOf(x.days), quote: str(x.quote) })),
    apps: { main: isObject(h.apps) ? str(h.apps.main) || null : null, fallback: isObject(h.apps) ? str(h.apps.fallback) || null : null },
    subscriptions: arr(h.subscriptions).filter(isObject).filter((s) => str(s.item)).map((s) => ({ item: str(s.item), source: str(s.source), ...(str(s.note) ? { note: str(s.note) } : {}) })),
    weekday_lunch: arr(h.weekday_lunch).filter(isObject).flatMap((x) => {
      const lunch = str(x.lunch) as WeekdayLunch["lunch"];
      return str(x.person) && ["away", "carries", "home"].includes(lunch) ? [{ person: str(x.person), lunch, quote: str(x.quote) }] : [];
    }),
    lunch_unclear: strs(h.lunch_unclear),
    rules: arr(r.rules).filter(isObject).map((x): ReadRule => {
      const what = (RULE_WHATS as readonly string[]).includes(str(x.what)) ? str(x.what) as RuleWhat : "note";
      const list = (v: unknown) => (strs(v).length ? strs(v) : null);
      const n = typeof x.per_meal === "number" ? Math.round(x.per_meal) : Number(str(x.per_meal)) || null;
      return { hard: x.hard === true || x.hard === "true", what, quote: str(x.quote), who: str(x.who) || null, slots: list(x.slots),
        days: daysOf(x.days).length ? daysOf(x.days) : null, items: list(x.items)?.map(tagOf) ?? null, to: str(x.to) || null,
        frequency: frequencyOf(x.frequency), per_meal: n && n > 0 ? n : null, fasting_food: Array.isArray(x.fasting_food) ? strs(x.fasting_food) : null };
    }),
    unplaced: arr(r.unplaced).filter(isObject).filter((u) => str(u.text)).map((u) => ({ text: str(u.text), quote: str(u.quote) || str(u.text) })),
    library: withOften(arr(d.library).flatMap((row): ReadDish[] => {
      const [name, slot, quote] = Array.isArray(row) ? row : isObject(row) ? [row.name, row.slot, row.quote] : [];
      return str(name) && str(slot) ? [{ name: str(name), slot: str(slot), frequency: null, days: null, quote: str(quote), often: "" }] : [];
    }), arr(o.often).flatMap((row): ReadDish[] => {
      const [name, slot, quote, words, frequency, days] = Array.isArray(row) ? row : isObject(row) ? [row.name, row.slot, row.quote, row.often, row.frequency, row.days] : [];
      const ds = daysOf(days);
      return str(name) && str(slot) ? [{ name: str(name), slot: str(slot), frequency: frequencyOf(frequency), days: ds.length ? ds : null, quote: str(quote), often: str(words) }] : [];
    })),
    seed: arr(d.seed).flatMap((row): ReadSeed[] => {
      const [slot, dishes, quote] = Array.isArray(row) ? row : isObject(row) ? [row.slot, row.dishes, row.quote] : [];
      const list = Array.isArray(dishes) ? strs(dishes) : str(dishes).split(/\s*,\s*/).filter(Boolean);
      return str(slot) && list.length ? [{ slot: str(slot), dishes: list, quote: str(quote) }] : [];
    }),
    links: arr(d.links).flatMap((row): ReadLink[] => {
      const [slot, from, words, quote] = Array.isArray(row) ? row : isObject(row) ? [row.slot, row.from, row.words, row.quote] : [];
      return str(slot) && str(from) ? [{ slot: str(slot), from: str(from), words: str(words), quote: str(quote) }] : [];
    }),
  };
}

/** The how-often read laid on the dishes read: the rows of the same dish and meal take its words (the dishes read may list one
 *  dish twice at a meal, once per sentence naming it: both), else the one row of that dish; a dish the dishes read does not
 *  list is left out (its name may be another's). By name and meal as written. */
function withOften(library: ReadDish[], often: ReadDish[]): ReadDish[] {
  const out = library.map((d) => ({ ...d }));
  // The same name, else a name one holds as whole words ("Cornflakes" in "Cornflakes with milk"; "Parathas" for "Paratha").
  const words = (n: string) => ` ${plainWords(n).replace(/\b(\w{4,})s\b/g, "$1")} `;
  const holds = (a: string, b: string) => words(a).includes(words(b)) || words(b).includes(words(a));
  const pick = (xs: ReadDish[], f: ReadDish) => { const at = xs.filter((x) => same(x.slot, f.slot)); return at.length ? at : xs.length === 1 ? xs : []; };
  for (const f of often) {
    const exact = out.filter((d) => dishKey(d.name) === dishKey(f.name));
    for (const d of exact.length ? pick(exact, f) : pick(out.filter((x) => holds(x.name, f.name)), f))
      Object.assign(d, { frequency: f.frequency, days: f.days, often: f.often, said: saidOf(f.often, [f.quote, d.quote]) });
  }
  return out;
}
/** The family's phrase a dish's how-often words sit in: the first of `quotes` that holds them ("rajma or chole twice a week"),
 *  else the words alone. */
export const saidOf = (often: string, quotes: string[]): string => quotes.find((q) => q && wordsIn(plainWords(q), often))?.trim() || often;

// ── What the family said: the quote check ──

/** Lower case, letters and digits only, one space between words ("Kabir's" is "kabirs"). */
export const plainWords = (s: string): string => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The family's replies (A lines), as written. */
export const repliesOf = (transcript: string[]): string[] => transcript.filter((l) => /^A\d*:/i.test(l)).map((l) => l.replace(/^A\d*:\s*/i, ""));
/** Every line the family said, in plain words: the replies and every text value of the household facts. */
export function familyLines(transcript: string[], household: unknown): string[] {
  return rawFamilyLines(transcript, household).map(plainWords).filter(Boolean);
}
/** The family's lines cut at sentence ends (. ! ? ;), in plain words: where a dish's how-often words must sit with it. */
export const familySentences = (transcript: string[], household: unknown): string[] =>
  rawFamilyLines(transcript, household).flatMap((l) => l.split(/[.!?;]+/)).map(plainWords).filter(Boolean);
function rawFamilyLines(transcript: string[], household: unknown): string[] {
  const out = repliesOf(transcript);
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  walk(household);
  return out;
}
/** Is a quote the family's own words: inside one of their lines (normalised substring). */
export function saidByFamily(quote: string, lines: string[]): boolean {
  const q = plainWords(quote);
  return q.length >= 3 && lines.some((l) => ` ${l} `.includes(` ${q} `) || (q.length >= 6 && l.includes(q)));
}
/** Does one of the lines name `name` (a slot, a dish, a person, a tag), as whole words, a plural "s" allowed. */
export function namedIn(name: string, lines: string[]): boolean {
  const n = plainWords(name.replace(/_/g, " "));
  return !!n && lines.some((l) => ` ${l} `.includes(` ${n} `) || ` ${l} `.includes(` ${n}s `));
}

/** The transcript as lines "Q: …" / "A: …": a string of lines, a list of lines, or a list of { q, a }. */
export function transcriptLines(v: unknown): string[] {
  if (typeof v === "string") return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return arr(v).flatMap((x) => (typeof x === "string" ? [x.trim()] : isObject(x)
    ? [...(str(x.q) ? [`Q: ${str(x.q)}`] : []), ...(str(x.a) ? [`A: ${str(x.a)}`] : [])] : [])).filter(Boolean);
}

// ── The household facts ──

export type HPerson = { name: string; group: string; age?: number; relationship?: string; nicknames: string[] };
export type WeeklyEntry = { person: string; where: string; weekdays: Weekday[]; lunch: "away" | "carries" | "home" | null };
export type Household = { people: HPerson[]; weekly: WeeklyEntry[] | null; speaker: string };

const fact = (h: unknown, key: string): unknown => (isObject(h) ? h[`household.${key}`] ?? h[key] : undefined);
/** The facts Flock sent, in the planner's shape. `weekly` that is not a list is unknown (null). */
export function householdOf(h: unknown): Household {
  const people = arr(fact(h, "people")).filter(isObject).filter((p) => str(p.name)).map((p): HPerson => ({ name: str(p.name), group: str(p.group).toLowerCase(),
    ...(typeof p.age === "number" ? { age: p.age } : {}), ...(str(p.relation ?? p.relationship) ? { relationship: str(p.relation ?? p.relationship) } : {}),
    nicknames: arr(p.nicknames).map((n) => (isObject(n) ? str(n.name) : str(n))).filter(Boolean) }));
  const w = fact(h, "weekly");
  const weekly = Array.isArray(w) ? w.filter(isObject).filter((x) => str(x.person)).map((x): WeeklyEntry => {
    const lunch = str(x.lunch);
    return { person: str(x.person), where: str(x.where) || "home", weekdays: daysOf(x.weekdays),
      lunch: lunch === "away" || lunch === "carries" || lunch === "home" ? lunch : null };
  }) : null;
  // The speaker is a person (§5.5, contract §10): the one Flock marks "self", else the name it sends.
  const self = people.filter((p) => same(p.relationship ?? "", "self"));
  return { people, weekly, speaker: self.length === 1 ? self[0].name : str(fact(h, "speaker")) };
}

/** The person a name the model wrote is: the name itself, one of their nicknames, or their first name when only one person
 *  has it. Data only (the household's names and nicknames): no word is given a meaning here. */
export function personOf(word: string, people: HPerson[]): string | null {
  const w = word.trim();
  if (!w) return null;
  const hit = people.find((p) => same(p.name, w)) ?? null;
  if (hit) return hit.name;
  const nick = people.filter((p) => p.nicknames.some((n) => same(n, w)));
  if (nick.length === 1) return nick[0].name;
  const first = people.filter((p) => same(p.name.split(/\s+/)[0], w) || same(w.split(/\s+/)[0], p.name));
  return first.length === 1 ? first[0].name : null;
}

/** A slot name as written resolved to one of `slots`: the same name, else the one slot a word of it names alone ("tiffin" is
 *  "Kabir's tiffin"; "Kavya's breakfast" with no such slot is "Breakfast"). Null when none or several. */
export function resolveSlot(word: string, slots: string[]): string | null {
  const hit = slots.find((s) => same(s, word));
  if (hit) return hit;
  const words = (s: string) => plainWords(s.replace(/['’]s\b/gi, "")).split(" ").filter(Boolean);
  // "<person>'s <meal>" is that meal: the person's own slot of it when there is one, else the main meal; never another slot of
  // theirs (eval h4: "Karan's breakfast" went to "Karan's tiffin" once "Sarojini's breakfast" made "breakfast" name two slots).
  const ws = words(word), last = ws[ws.length - 1], meal = SLOTS.find((m) => m.toLowerCase() === last);
  if (meal && ws.length > 1) {
    const own = slots.filter((s) => !same(s, meal) && words(s).includes(last) && ws.slice(0, -1).some((w) => words(s).includes(w)));
    return own.length === 1 ? own[0] : slots.find((s) => same(s, meal)) ?? null;
  }
  // A word naming a main meal ("lunch box") never lands on a slot named for another meal ("Agastya's breakfast box"): with
  // no slot of its own the row is asked about, never moved (eval h18: the lunch box's dishes went to the breakfast box).
  const meals = SLOTS.map((m) => m.toLowerCase()).filter((m) => ws.includes(m));
  // A packed meal ("lunch box") is only ever a packed meal: never the main meal it is named for, nor a person's own plate.
  const isBox = (s: string) => words(s).some((w) => BOX_WORDS.includes(w)), box = isBox(word);
  const other = (s: string) => (meals.length > 0 && words(s).some((w) => SLOTS.some((m) => m.toLowerCase() === w) && !meals.includes(w)))
    || (box && !isBox(s));
  const named = new Set<string>();
  for (const w of ws) {
    const has = slots.filter((s) => words(s).includes(w) && !other(s));
    if (has.length === 1) named.add(has[0]);
  }
  if (named.size) return named.size === 1 ? [...named][0] : null;
  // A packed meal by another name ("school tiffin" for the "Snack box", "dabba" for "Nila's lunch box"): the one slot that is a
  // packed meal.
  if (box) {
    const boxes = slots.filter((s) => isBox(s) && !other(s));
    if (boxes.length === 1) return boxes[0];
  }
  return null;
}
/** The words a family names a packed meal by. */
const BOX_WORDS = ["tiffin", "box", "lunchbox", "dabba", "tiffinbox"];

// ── The checks (§4.2): structure only ──

const DAY_TOKENS = new Set<string>(LINT_DAY_WORDS), COUNT_TOKENS = new Set<string>(LINT_COUNT_WORDS);
const hasDayWord = (q: string) => plainWords(q).split(" ").some((w) => DAY_TOKENS.has(w));
const hasCount = (q: string) => /\d/.test(q) || plainWords(q).split(" ").some((w) => COUNT_TOKENS.has(w));
/** The day/count lint: a quote with a day word or a number. */
export const quoteHasDayOrCount = (q: string): boolean => hasDayWord(q) || hasCount(q);

/** Words inside a line, whole words (both in plain words). */
const wordsIn = (line: string, words: string): boolean => { const w = plainWords(words); return !!w && ` ${line} `.includes(` ${w} `); };
/** A dish's how-often words checked (§4.2): they are said in one sentence of the family's together with the dish (its quote or its name);
 *  days need a day word in them, a count a number, "daily" a day word; days that are the dish's meal's own days say nothing of
 *  the dish. What is not backed is dropped (logged in `dropped`). Structure only: which words mean what is the model's read. */
export function backHowOften(d: ReadDish, said: string[], slotDays: Weekday[], dropped: string[]): void {
  if (!d.frequency && !d.days) return;
  const what = () => JSON.stringify({ frequency: d.frequency, days: d.days });
  // The sentence with the dish's own quote first, else one naming it: "luchi with alur dom on Sunday" is not "luchi on Sunday".
  const withQuote = d.often ? said.findIndex((l) => wordsIn(l, d.often) && wordsIn(l, d.quote)) : -1;
  const at = withQuote >= 0 ? withQuote : d.often ? said.findIndex((l) => wordsIn(l, d.often) && namedIn(d.name, [l])) : -1;
  d.oftenAt = at >= 0 ? at : undefined;
  if (at < 0) { dropped.push(`how often for ${d.name} ${what()}: ${d.often ? `"${d.often}" is not said with it` : "no words of the family say it"}`); d.frequency = null; d.days = null; return; }
  if (d.days && !hasDayWord(d.often)) { dropped.push(`days for ${d.name} (${d.days.join(", ")}): no day in "${d.often}"`); d.days = null; }
  if (d.days && slotDays.length && d.days.length === slotDays.length && d.days.every((x) => slotDays.includes(x))) { dropped.push(`days for ${d.name}: the meal's own days`); d.days = null; }
  if (d.frequency === "daily" && !hasDayWord(d.often)) { dropped.push(`daily for ${d.name}: "${d.often}" says no day`); d.frequency = null; }
  if (d.frequency?.endsWith("/week") && !hasCount(d.often)) { dropped.push(`${d.frequency} for ${d.name}: no count in "${d.often}"`); d.frequency = null; }
}

/** How many dishes may share one how-often phrase of one sentence before it is the whole list's, not each dish's: "rice, dal,
 *  a sabzi and curd most days" says what the meal is, not that each dish comes most days (the seed keeps that shape). */
export const SHARED_OFTEN_MIN = 3;
/** Drop how often from the dishes that share one sentence's how-often words with SHARED_OFTEN_MIN or more others (structure:
 *  the same words at the same place, given to many dishes). */
export function dropShared(library: ReadDish[], dropped: string[]): void {
  const groups = new Map<string, ReadDish[]>();
  for (const d of library) if ((d.frequency || d.days) && d.oftenAt !== undefined) {
    const k = `${d.oftenAt}|${plainWords(d.often)}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  // Counted by dish, not by row: "paratha on Sunday" read at three meals is one dish's days.
  for (const g of groups.values()) if (new Set(g.map((d) => dishKey(d.name))).size >= SHARED_OFTEN_MIN) {
    dropped.push(`how often for ${g.map((d) => d.name).join(", ")}: "${g[0].often}" is said of the whole list`);
    for (const d of g) Object.assign(d, { frequency: null, days: null, shared: true });
  }
}

/** The whats a rule is always hard in; swap, require and note may be soft (with a frequency). */
const HARD_ONLY: RuleWhat[] = ["veg", "egg", "no_eggs", "avoid", "only", "fasting", "cap"];
/** What a checked rule needs besides its what; without it, it is kept as a note (not checked). */
const NEEDS: Partial<Record<RuleWhat, (r: ReadRule) => boolean>> = {
  avoid: (r) => !!r.items?.length, only: (r) => !!r.items?.length && !!r.who, swap: (r) => !!r.items?.length && !!r.to,
  require: (r) => !!r.items?.length, cap: (r) => !!r.per_meal, fasting: (r) => !!r.who && !!r.days?.length,
};
export const ruleKey = (r: Pick<ReadRule, "what" | "who" | "items" | "slots" | "days" | "to">): string =>
  JSON.stringify([r.what, r.who?.toLowerCase() ?? null, [...(r.items ?? [])].sort(), [...(r.slots ?? [])].map((s) => s.toLowerCase()).sort(), [...(r.days ?? [])].sort(), r.to?.toLowerCase() ?? null]);

/** Words that say no eggs: "no eggs", "doesn't eat eggs", "won't touch anda", "without egg", "eggless", "pure veg". Only to
 *  back a no_eggs rule the reader left out beside a person's vegetarian rule. */
export function saysNoEggs(line: string): boolean {
  const l = plainWords(line);
  return /\bpure (?:veg|vegetarian)\b|\beggless\b/.test(l)
    || /\b(?:no|not|without|never|nor|doesnt|dont|wont|cant|avoids?)(?: (?:eat|eats|eating|have|has|take|takes|touch|touches|even|any|like|likes))* (?:eggs?|anda|ande|andaa)\b/.test(l)
    // "no fish, meat, eggs, onion or garlic": eggs in the list after the no.
    || /\b(?:no|not|without|never)(?: (?:fish|meat|chicken|mutton|seafood|prawns?|beef|pork|non veg|nonveg|onions?|garlic|or|and|nor|any))+ (?:eggs?|anda|ande)\b(?! (?:are|is) (?:fine|ok|okay|allowed))/.test(l);
}

export type Checked = { read: SetupRead; dropped: string[]; asks: string[]; noted: string[]; lint: ReadDish[]; slotDays: Map<string, Weekday[]> };

/** Whether a note's words are the cook's own limit or words about the cook (its words hold the cook's limit, or the other way round). */
function aboutTheCook(quote: string, cook: SetupRead["cook"]): boolean {
  const norm = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = norm(quote);
  if (!q || !cook) return false;
  return [cook.limits_words, cook.quote].map(norm).some((c) => c.length >= 8 && (q.includes(c) || c.includes(q)));
}

/** The read made safe to store: what the family did not say is dropped, unknown names are asked, slots resolved. */
export function checkRead(read: SetupRead, ctx: { household: Household; said: string[]; sentences?: string[] }): Checked {
  const dropped: string[] = [], asks: string[] = [], noted: string[] = [], lint: ReadDish[] = [];
  const people = ctx.household.people, said = ctx.said;
  const ask = (name: string) => { const a = `Who is ${name}? I don't have them among the people at home.`; if (!asks.includes(a)) asks.push(a); };
  const known = (names: string[]): string[] => names.flatMap((n) => { const p = personOf(n, people); if (!p) ask(n); return p ? [p] : []; });

  // Slots: the three main ones always; a custom or add-on one only when the family named it.
  const slots: ReadSlot[] = [];
  for (const s of read.slots) {
    const main = SLOTS.find((m) => same(m, s.name));
    if (slots.some((x) => same(x.name, s.name))) continue;
    if (main) {
      // A main meal's people left out only because they are away on weekdays (school, office: household.weekly) are its
      // people still: the weekly absences take them off those days, never the weekend's (eval h6: no children at Sunday lunch).
      let usual = uniq(known(s.usual_people));
      const out = people.map((p) => p.name).filter((p) => !usual.includes(p));
      const weekdaysOnly = (p: string) => (ctx.household.weekly ?? []).some((w) => w.person === p && w.where !== "home" && w.weekdays.length > 0 && w.weekdays.every((d) => WEEKDAYS.indexOf(d) < 5));
      if (usual.length && out.length && out.every(weekdaysOnly)) usual = [];
      slots.push({ ...s, name: main, kind: "main", addon_of: null, after: null, usual_people: usual }); continue;
    }
    if (!saidByFamily(s.quote, said)) { dropped.push(`the ${s.name} ("${s.quote}"): not something the family said`); continue; }
    const usual = uniq(known(s.usual_people));
    let kind: SlotKind = s.kind === "addon" ? "addon" : "custom";
    const addon_of = kind === "addon" ? SLOTS.find((m) => same(m, s.addon_of ?? "")) ?? null : null;
    if (kind === "addon" && !addon_of) kind = "custom";
    if (kind === "addon" && !usual.length) { dropped.push(`the ${s.name}: nobody at home it is for`); continue; }
    // A person's own meal in place of a main meal (class 3: "she eats before sunset, on her own"): a meal of theirs alone, not
    // beside the family's (an add-on's people eat the main meal too, and it goes where the main meal goes, out or ordered in).
    // The meal it is eaten in place of is the read's own field, never the meal it comes after (eval h1/h18: a school box
    // "after Breakfast" is in place of Lunch); a box with people and none keeps its place from `after`.
    const instead_of = s.instead_of && usual.length ? SLOTS.find((m) => same(m, s.instead_of!)) ?? null : null;
    if (instead_of) { slots.push({ ...s, kind: "custom", addon_of: null, after: instead_of, usual_people: usual, instead_of }); continue; }
    slots.push({ ...s, kind, addon_of, after: SLOTS.find((m) => same(m, s.after ?? "")) ?? null, usual_people: usual, instead_of: null });
  }
  for (const m of SLOTS) if (!slots.some((s) => s.name === m))
    slots.push({ name: m, kind: "main", addon_of: null, after: null, usual_people: [], days: [], skip_days: [], quote: "" });
  // The main meal of a person who has their own in its place is cooked for the others (its people said plainly in the read-back,
  // so the family can correct it); its change stands on the family's words for that meal of theirs.
  // A box on some days only (a school box, Mon–Fri) takes its people off the meal on its days alone: the plan does that day by
  // day (planDays), so the meal keeps them for the other days (§5.4).
  for (const s of slots.filter((x) => x.instead_of && (!x.days.length || x.days.length === 7))) {
    const main = slots.find((x) => x.name === s.instead_of)!;
    const others = (main.usual_people.length ? main.usual_people : people.map((p) => p.name)).filter((p) => !s.usual_people.includes(p));
    if (!others.length) continue;
    main.usual_people = others;
    if (!main.quote) main.quote = s.quote;
  }
  // Weekday lunch as the replies say it, by the household's names.
  const weekday_lunch = read.weekday_lunch.flatMap((w) => { const p = personOf(w.person, people); return p ? [{ ...w, person: p }] : []; });
  // An extras add-on of Lunch read with no days (D6: "I take 4 boiled eggs and some salad with it", carried to work) goes with
  // the lunch its people carry: on their carrying days, never every day. A person's weekday lunch: the replies' word, else
  // household.weekly's; their days: their weekly entries', else Mon–Fri (as the plan reads a lunch said with no weekly entry:
  // planDays withLunchSaid). Left as read when anyone of its people does not carry lunch.
  const weeklyOf = (p: string) => (ctx.household.weekly ?? []).filter((w) => w.person === p && w.weekdays.length);
  const carryDays = (p: string): Weekday[] | null => {
    const lunch = weekday_lunch.find((w) => w.person === p)?.lunch ?? weeklyOf(p).find((w) => w.lunch)?.lunch ?? null;
    if (lunch !== "carries") return null;
    const ws = weeklyOf(p);
    return ws.length ? uniq(ws.flatMap((w) => w.weekdays)) : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  };
  for (const s of slots) if (s.kind === "addon" && s.extras && s.addon_of === "Lunch" && !s.days.length && s.usual_people.length) {
    const each = s.usual_people.map(carryDays);
    if (each.every((d): d is Weekday[] => !!d)) s.days = WEEKDAYS.filter((d) => each.some((x) => x.includes(d)));
  }
  const slotNames = slots.map((s) => s.name);
  // The days each meal is cooked at home: its days less the days it is eaten out or ordered in ("weekday lunch is ..." where
  // weekend lunch is out names the meal's days, not the dish's).
  const slotDays = new Map(slots.map((s) => [s.name, (s.days.length ? s.days : [...WEEKDAYS]).filter((d) => !(s.skip_days ?? []).some((x) => x.day === d))]));
  const slotOf = (w: string) => resolveSlot(w, slotNames);

  // Rules.
  const rules: ReadRule[] = [];
  for (const r0 of read.rules) {
    let r: ReadRule = { ...r0 };
    const what = `${r.what}${r.who ? ` for ${r.who}` : ""}${r.items?.length ? ` ${r.items.join(", ")}` : ""} ("${r.quote}")`;
    if (!saidByFamily(r.quote, said)) { dropped.push(`${what}: not something the family said`); continue; }
    if (r.who) {
      const p = personOf(r.who, people);
      if (!p) { ask(r.who); dropped.push(`${what}: ${r.who} is not someone at home`); continue; }
      r.who = p;
    }
    if (r.slots) {
      const found = r.slots.map(slotOf);
      if (found.some((s) => !s)) {
        noted.push(`"${r.quote}": not saved, there is no meal called ${r.slots.filter((_, i) => !found[i]).join(", ")}`);
        continue;
      }
      r.slots = uniq(found as string[]);
      // Days that are just its meals' own days (a tiffin's school days) say nothing more: every day of those meals.
      const own = uniq(r.slots.flatMap((n) => slots.find((x) => x.name === n)?.days ?? []));
      if (r.days && own.length && r.slots.every((n) => slots.find((x) => x.name === n)?.days.length) && r.days.length === own.length && r.days.every((d) => own.includes(d))) r.days = null;
    }
    if (HARD_ONLY.includes(r.what)) r.hard = true;
    if (r.what === "note") r.hard = false;
    if (r.hard && r.frequency) { dropped.push(`how often for ${what}: a hard rule holds every time`); r.frequency = null; }
    if (r.what !== "fasting") r.fasting_food = null;
    if (r.what !== "cap") r.per_meal = null;
    const need = NEEDS[r.what];
    if (need && !need(r)) { dropped.push(`${what}: not complete for a ${r.what} rule, kept as a note`); r = { ...r, what: "note", items: null, to: null, per_meal: null, fasting_food: null }; }
    // A note that is only the cook's limit again ("Yes, she has two hours, so 3 to 4 dishes in all"): the cook keeps it, not
    // the family's notes (onboarding run 24 showed it under "All week" in the plan).
    if (r.what === "note" && !r.who && aboutTheCook(r.quote, read.cook)) { dropped.push(`${what}: the cook's limit, kept with the cook`); continue; }
    if (rules.some((x) => ruleKey(x) === ruleKey(r))) continue;
    rules.push(r);
  }
  // Each rule's targets typed once, here (§5.2, targets.ts): its words still kept (items, to) for the Family page's text.
  const typed = (r: ReadRule): ReadRule => {
    const targets = targetsOf({ what: r.what, items: r.items ?? null, targets: null });
    return { ...r, targets: targets.length ? targets : null, gives: r.what === "swap" && r.hard && r.to ? resolveGives(r.to) : null };
  };

  // Eggs for some people in a vegetarian house ("Vegetarian. Eggs okay for Vivaan and Varun"): the others eat none, else the
  // exception says nothing. The reader is asked for their no_eggs rules; any it left out are added here (eval h13: egg
  // paratha went to the two not named). Structure only: a house veg rule, no house egg rule, egg rules for named people.
  const eggFor = rules.filter((r) => r.what === "egg" && r.who);
  if (eggFor.length && rules.some((r) => r.what === "veg" && !r.who) && !rules.some((r) => (r.what === "egg" || r.what === "no_eggs") && !r.who)) {
    for (const p of people) if (!rules.some((r) => (r.what === "egg" || r.what === "no_eggs") && r.who === p.name)) {
      rules.push({ hard: true, what: "no_eggs", who: p.name, quote: eggFor[0].quote, slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null });
    }
  }

  // A person's vegetarian rule with their no-eggs words beside it ("<person> is vegetarian and won't touch eggs"): their
  // no_eggs rule, when the reader left it out (eval h8: read once in three). Backed by the veg rule's own words, or a reply
  // that names that person and nobody else at home and says no eggs; an egg rule of theirs wins.
  const names = (p: HPerson) => [p.name, ...p.nicknames];
  for (const v of rules.filter((r) => r.what === "veg" && r.who)) {
    if (rules.some((r) => r.who === v.who && (r.what === "no_eggs" || r.what === "egg"))) continue;
    const me = people.find((p) => p.name === v.who);
    if (!me) continue;
    const others = people.filter((p) => p !== me).flatMap(names);
    // Sentence by sentence first ("Baba is diabetic. Ma is vegetarian, no fish, meat, eggs" is two people's), then whole replies.
    const own = (ls: string[]) => ls.filter((l) => names(me).some((n) => namedIn(n, [l])) && !others.some((n) => namedIn(n, [l])));
    const line = [v.quote, ...own(ctx.sentences ?? []), ...own(said)].find(saysNoEggs);
    if (line) rules.push({ hard: true, what: "no_eggs", who: v.who, quote: line, slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null });
  }

  // The library: a dish on a slot that exists, said by the family; its days or count backed by its quote.
  const library: ReadDish[] = [];
  for (const d0 of read.library) {
    const slot = slotOf(d0.slot);
    if (!slot) { dropped.push(`${d0.name} at ${d0.slot}: no such meal`); continue; }
    const d: ReadDish = { ...d0, slot };
    const quoted = saidByFamily(d.quote, said);
    if (!quoted && !namedIn(d.name, said)) { dropped.push(`${d.name} ("${d.quote}"): not something the family said`); continue; }
    backHowOften(d, ctx.sentences ?? said, slotDays.get(slot) ?? [], dropped);
    const had = library.find((x) => dishKey(x.name) === dishKey(d.name) && x.slot === d.slot);
    if (had) {
      had.frequency ??= d.frequency;
      if (d.days) had.days = WEEKDAYS.filter((x) => had.days?.includes(x) || d.days!.includes(x));
      if ((d.frequency || d.days) && d.said && d.said !== had.said) had.said = had.said && (had.frequency || had.days) ? `${had.said}; ${d.said}` : d.said;
      if (!had.often && d.often) Object.assign(had, { often: d.often, oftenAt: d.oftenAt });
      continue;
    }
    library.push(d);
  }
  dropShared(library, dropped);
  for (const d of library) {
    if (d.frequency || d.days || d.shared) continue;
    // A dish read without its words: the family's sentence that names it ("Sunday dinner ... something simple like pasta").
    if (!d.quote?.trim()) d.quote = said.find((l) => namedIn(d.name, [l]) && quoteHasDayOrCount(l)) ?? d.quote;
    if (d.quote && quoteHasDayOrCount(d.quote) && saidByFamily(d.quote, said)) lint.push(d);
  }

  // The seed: the past week's plates, in the family's words; each of its dishes is in the library too.
  const seed: ReadSeed[] = [];
  for (const s of read.seed) {
    const slot = slotOf(s.slot);
    if (!slot) { dropped.push(`the ${s.slot} example "${s.dishes.join(", ")}": no such meal`); continue; }
    if (!saidByFamily(s.quote, said)) { dropped.push(`the ${slot} example "${s.dishes.join(", ")}": not the family's words`); continue; }
    if (seed.some((x) => x.slot === slot && x.dishes.join("|").toLowerCase() === s.dishes.join("|").toLowerCase())) continue;
    // The same dish twice on one plate ("roti sabzi ... dal, rice, sabzi") is one dish.
    seed.push({ ...s, slot, dishes: s.dishes.filter((d, i) => s.dishes.findIndex((x) => dishKey(x) === dishKey(d)) === i) });
    for (const name of s.dishes) if (!library.some((x) => dishKey(x.name) === dishKey(name) && x.slot === slot))
      library.push({ name, slot, frequency: null, days: null, quote: s.quote, often: "" });
  }

  // Class 6: a person with their own meal in place of a main meal eats nothing of the family's there. A dish or plate of that
  // meal said in a sentence of the family's that names only them ("<child> has khichdi or dal rice every night") is their own
  // meal's, never the family's (structure: whom the sentence names).
  const insteadSlots = slots.filter((x) => x.instead_of);
  if (insteadSlots.length) {
    const lines = ctx.sentences ?? said;
    const ownOf = (slot: string, quote: string): string | null => {
      const mine = insteadSlots.find((x) => x.instead_of === slot);
      const line = mine && quote ? lines.find((l) => saidByFamily(quote, [l])) : undefined;
      if (!mine || !line) return null;
      const who = people.filter((p) => names(p).some((n) => namedIn(n, [line]))).map((p) => p.name);
      return who.length && who.every((p) => mine.usual_people.includes(p)) ? mine.name : null;
    };
    for (const d of [...library]) {
      const to = ownOf(d.slot, d.quote);
      if (!to) continue;
      const there = library.find((x) => x !== d && dishKey(x.name) === dishKey(d.name) && x.slot === to);
      if (there) { there.frequency ??= d.frequency; there.days ??= d.days; library.splice(library.indexOf(d), 1); } else d.slot = to;
    }
    for (const x of [...seed]) {
      const to = ownOf(x.slot, x.quote);
      if (!to) continue;
      if (seed.some((y) => y !== x && y.slot === to && y.dishes.join("|").toLowerCase() === x.dishes.join("|").toLowerCase())) seed.splice(seed.indexOf(x), 1);
      else x.slot = to;
    }
  }

  // The cook, who of the family cooks, lunch.
  const cook = read.cook ? { ...read.cook, visits: read.cook.visits.flatMap((v): Visit[] => {
    const meals = v.meals ? uniq(v.meals.map(slotOf).filter((m): m is string => !!m)) : [];
    return v.at || meals.length ? [{ ...(v.at ? { at: v.at } : {}), ...(meals.length ? { meals } : {}) }] : [];
  }) } : null;
  const family_cooks = read.family_cooks.flatMap((f) => { const p = personOf(f.person, people); if (!p) ask(f.person); return p && f.days.length ? [{ ...f, person: p }] : []; });
  const lunchKnown = (p: string) => weekday_lunch.some((w) => w.person === p) || !!ctx.household.weekly?.find((w) => w.person === p)?.lunch;
  const lunch_unclear = uniq(read.lunch_unclear.map((n) => personOf(n, people)).filter((p): p is string => !!p && !lunchKnown(p)));
  const unplaced = read.unplaced.filter((u) => saidByFamily(u.quote, said));
  for (const u of read.unplaced) if (!unplaced.includes(u)) dropped.push(`"${u.text}": not something the family said`);

  // Links: a box's link to another meal of the house, said by the family.
  const links: ReadLink[] = [];
  for (const l of read.links) {
    const slot = slotOf(l.slot), from = slotOf(l.from);
    if (!slot || !from || slot === from) { dropped.push(`the link of ${l.slot} to ${l.from}: no such meal`); continue; }
    if (!saidByFamily(l.quote, said)) { dropped.push(`the link of ${slot} to ${from} ("${l.quote}"): not something the family said`); continue; }
    if (links.some((x) => x.slot === slot && x.from === from && same(x.words, l.words))) continue;
    links.push({ ...l, slot, from });
  }

  return { read: { ...read, slots, rules: rules.map(typed), library, seed, cook, family_cooks, weekday_lunch, lunch_unclear, unplaced, links }, dropped, asks, noted, lint, slotDays };
}

// ── Model calls ──

/** A model call that answers by `ms` or is a timeout (the call itself is not stopped: the SDK takes no signal). */
async function withDeadline(call: Promise<ModelResult>, ms: number): Promise<ModelResult> {
  if (ms <= 0) return { ok: false, code: "timeout", message: "no time left for the setup" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ModelResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "timeout", message: `no answer in ${Math.round(ms / 1000)} s` }), ms); });
  try { return await Promise.race([call, late]); } finally { clearTimeout(timer); }
}
/** One call, tried once more on a failure worth retrying while RETRY_FLOOR_MS is left. */
async function askOnce(model: ModelCall, req: Parameters<ModelCall>[0], until: number, log: (l: string) => void, ok: (r: ModelResult) => ModelResult = (r) => r): Promise<ModelResult> {
  const ask = async () => ok(await withDeadline(model(req), until - Date.now()));
  let r = await ask();
  if (!r.ok && RETRY_CODES.includes(r.code) && until - Date.now() >= RETRY_FLOOR_MS) {
    log(`${req.purpose}: model ${r.code}: ${r.message.slice(0, 300)}; asking once more`);
    r = await ask();
  }
  return r;
}

/** The lint's one re-read of the dishes whose quote has a day word or a number and nothing saved. */
async function lintReread(model: ModelCall, dishes: ReadDish[], replies: string[], until: number, log: (l: string) => void,
  check: { said: string[]; slotDays: Map<string, Weekday[]>; dropped: string[]; library: ReadDish[] }): Promise<void> {
  if (!dishes.length) return;
  const words = dishes.map((d) => ({ name: d.name, slot: d.slot, quote: d.quote,
    line: replies.find((l) => plainWords(l).includes(plainWords(d.quote))) ?? d.quote }));
  // Its own deadline (LINT_MS): a second look, never what holds the setup to its budget's end (eval h1, h4: 48–60 s, then out of tokens).
  const r = await withDeadline(model({ tier: "balanced", purpose: "setup: how often (lint)", system: LINT_SYSTEM, user: JSON.stringify({ dishes: words }), schema: LINT_SCHEMA, maxTokens: 2000 }), Math.min(until - Date.now(), LINT_MS));
  if (!r.ok) { log(`lint: model ${r.code}: ${r.message.slice(0, 200)}`); return; }
  const done = new Set<ReadDish>();
  for (const x of arr(isObject(r.json) ? r.json.dishes : null).filter(isObject)) {
    // One dish at two meals is asked twice, in order: each answer is the next of that name.
    const d = dishes.find((y) => same(y.name, str(x.name)) && !done.has(y));
    if (!d) continue;
    done.add(d);
    const f = frequencyOf(x.frequency), days = daysOf(x.days);
    if (!f && !days.length) continue;
    const line = words.find((w) => w.name === d.name && w.slot === d.slot)?.line ?? "";
    Object.assign(d, { frequency: f, days: days.length ? days : null, often: str(x.often), said: saidOf(str(x.often), [d.quote, ...line.split(/[.!?;,]+/), ...line.split(/[.!?;]+/)]) });
    backHowOften(d, check.said, check.slotDays.get(d.slot) ?? [], check.dropped);
    if (d.frequency || d.days) log(`lint: ${d.name} re-read as ${d.frequency ?? ""} ${(d.days ?? []).join(",")} ("${d.often}")`.trim());
  }
  dropShared(check.library, check.dropped);
}

/** The contains read (fast, ≤CONTAINS_BATCH dishes a call, the calls at once): for each dish, the tags asked that it has and
 *  has not. A dish or tag the answer leaves out stays unread (unknown: the plan fails closed on it). */
export async function containsRead(model: ModelCall, ask: Map<string, { name: string; tags: Set<string> }>, until: number, log: (l: string) => void): Promise<Map<string, Record<string, boolean>>> {
  const out = new Map<string, Record<string, boolean>>();
  const items = [...ask.values()];
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += CONTAINS_BATCH) batches.push(items.slice(i, i + CONTAINS_BATCH));
  await Promise.all(batches.map(async (b, i) => {
    const tags = [...new Set(b.flatMap((d) => [...d.tags]))].sort();
    const r = await askOnce(model, { tier: "fast", purpose: `setup: contains ${i + 1}/${batches.length}`, system: CONTAINS_SYSTEM,
      user: JSON.stringify({ dishes: b.map((d) => d.name), tags }), schema: CONTAINS_SCHEMA, maxTokens: 4000 }, until, log);
    if (!r.ok || !isObject(r.json)) { log(`contains ${i + 1}: ${r.ok ? "no answer" : `${r.code}: ${r.message.slice(0, 200)}`}`); return; }
    const byKey = new Map(Object.entries(r.json).map(([k, v]) => [dishKey(k), v]));
    for (const d of b) {
      const v = byKey.get(dishKey(d.name));
      if (!isObject(v)) continue;
      const read: Record<string, boolean> = {};
      for (const t of d.tags) if (typeof v[t] === "boolean") read[t] = v[t] as boolean;
      out.set(dishKey(d.name), read);
    }
  }));
  return out;
}

// ── What is saved, and the diff (§4.5) ──

/** What apply_setup keeps beside the rows, on the house (house.setup_state). */
export type SetupState = { replies: string[]; family_cooks: FamilyCook[]; weekday_lunch: WeekdayLunch[]; lunch_unclear: string[]; noted: string[]; asks: string[];
  /** Each dish's place in the catalog as read ("<meal>|<dish key>"), so a correction asks the kinds read only of new dishes. */
  places?: Record<string, Place>;
  /** Each meal's plates in the family's words, as last read back ("rice, sambar, a poriyal and curd; or ..."). */
  meals?: Record<string, string>;
  /** The boxes' links to another meal (§5.4), as read: setup's memory for correction rounds. */
  links?: ReadLink[];
  /** The family's category words per meal ("dry sabji"): never library rows (§5.3), kept here so a correction can build the
   *  meal's plates again. Nothing in planning reads them. */
  categories?: Record<string, MealDishRow[]> };
/** A category word of a meal, as kept for corrections. */
export type MealDishRow = { name: string; frequency: Frequency | null; days: Weekday[] | null; said: string | null };
export type Saved = { slots: ReadSlot[]; rules: (Rule)[]; library: LibraryDish[]; seed: ReadSeed[]; cook: Cook | null; state: SetupState | null };

/** What the planner holds now, in the read's shape. */
export function savedOf(db: Db): Saved {
  const h = getHouse(db), view = houseView(h);
  let state: SetupState | null = null;
  try { state = h.setup_state ? JSON.parse(h.setup_state) : null; } catch { state = null; }
  return {
    slots: listSlots(db).map((s) => ({ name: s.name, kind: s.kind, addon_of: s.addon_of, after: null, usual_people: s.usual_people, days: s.days, skip_days: s.skip_days, quote: "",
      ...(s.extras ? { extras: true } : {}) })),
    rules: listRules(db),
    library: listLibrary(db).filter((d) => d.origin !== "planner_suggested"),
    seed: seedSlotDays(db).map((s) => ({ slot: s.slot, dishes: s.dishes.map((d) => d.dish), quote: "" })),
    // A cook without a name is saved with her days (cook_days set, never null for a cook): that is the cook being there.
    cook: h.cook_name || h.cook_days ? { name: h.cook_name, days: view.cook_days, visits: cookVisits(h.cook_arrival), limits_words: h.cook_time_limit, quote: "" } : null,
    state,
  };
}

/** The writes a read makes, and what they change in words. */
export type Ops = {
  slots: ReadSlot[]; removeSlots: string[]; rules: ReadRule[]; removeRules: string[]; library: ReadDish[]; removeLibrary: { name: string; slot: string }[];
  /** Meals whose plates are built again though no library row of theirs changed: a category word dropped, a box's link changed. */
  rebuild?: string[];
  seed: ReadSeed[]; cook?: Cook | null; apps?: { main: GroceryApp; fallback: GroceryApp | null }; subscriptions: SetupRead["subscriptions"];
  state: Omit<SetupState, "replies">; changed: string[]; discarded: string[];
};

const slotSame = (a: ReadSlot, b: ReadSlot) => a.kind === b.kind && (a.addon_of ?? null) === (b.addon_of ?? null)
  && JSON.stringify([...a.usual_people].sort()) === JSON.stringify([...b.usual_people].sort()) && a.days.join() === b.days.join()
  && JSON.stringify(a.skip_days) === JSON.stringify(b.skip_days) && !!a.extras === !!b.extras;
const ruleSame = (a: ReadRule, b: ReadRule) => ruleKey(a) === ruleKey(b) && !!a.hard === !!b.hard && (a.frequency ?? null) === (b.frequency ?? null)
  && (a.per_meal ?? null) === (b.per_meal ?? null) && JSON.stringify(a.fasting_food ?? null) === JSON.stringify(b.fasting_food ?? null);
const cookSame = (a: Cook | null, b: Cook | null) => JSON.stringify(a && [a.name, a.days, a.visits, a.limits_words ?? null]) === JSON.stringify(b && [b.name, b.days, b.visits, b.limits_words ?? null]);

/** The writes from a checked read. `fresh`: the lines (plain) whose words may change what is saved: every family line on a
 *  first setup (`all`), only the new replies on a correction. On a correction an item is applied only when its quote is in a
 *  new reply, or a new reply names it (by name, slot or person); every other difference is discarded and logged. */
export function diffSetup(saved: Saved, next: SetupRead, fresh: string[], all: boolean): Ops {
  const inNew = (quote: string) => all || saidByFamily(quote, fresh);
  const named = (name: string) => all || namedIn(name, fresh);
  const ops: Ops = { slots: [], removeSlots: [], rules: [], removeRules: [], library: [], removeLibrary: [], seed: [], subscriptions: [],
    state: { family_cooks: saved.state?.family_cooks ?? [], weekday_lunch: saved.state?.weekday_lunch ?? [], lunch_unclear: next.lunch_unclear,
      noted: saved.state?.noted ?? [], asks: [], places: saved.state?.places, meals: saved.state?.meals, links: saved.state?.links, categories: saved.state?.categories },
    changed: [], discarded: [] };

  for (const s of next.slots) {
    const had = saved.slots.find((x) => same(x.name, s.name));
    if (had && slotSame(had, s)) continue;
    if (inNew(s.quote) || named(s.name)) { ops.slots.push(s); if (!all) ops.changed.push(had ? `${s.name}: now ${slotText(s)}.` : `Added ${s.name}: ${slotText(s)}.`); }
    else ops.discarded.push(`slot ${s.name}`);
  }
  for (const s of saved.slots) if (s.kind !== "main" && !next.slots.some((x) => same(x.name, s.name))) {
    if (!all && named(s.name)) { ops.removeSlots.push(s.name); ops.changed.push(`Removed ${s.name}.`); }
    else if (!all) ops.discarded.push(`slot ${s.name} not read`);
  }

  const applied: ReadRule[] = [];
  for (const r of next.rules) {
    const had = saved.rules.find((x) => ruleKey(x) === ruleKey(r));
    if (had && ruleSame(had, r)) continue;
    // A fast's food, said in answer to the read-back's question ("Sabudana khichdi and fruit"): the food named is enough.
    const foodSaid = !!had && r.what === "fasting" && !had.fasting_food?.length && !!r.fasting_food?.some((x) => named(x));
    if (inNew(r.quote) || foodSaid) { ops.rules.push(r); applied.push(r); if (had) ops.removeRules.push(had.id); if (!all) ops.changed.push(`${had ? "Changed" : "Added"}: ${ruleLine(r)}.`); }
    else ops.discarded.push(`rule ${ruleKey(r)}`);
  }
  if (!all) for (const r of saved.rules) {
    if (next.rules.some((x) => ruleKey(x) === ruleKey(r)) || ops.removeRules.includes(r.id)) continue;
    const replaced = applied.some((x) => (x.who ?? null) === (r.who ?? null) && (x.what === r.what || (x.items ?? []).some((i) => r.items?.includes(i))));
    const said = (r.who ? named(r.who) : true) && [...(r.items ?? []), ...(r.to ? [r.to] : [])].some(named);
    if (replaced || said) { ops.removeRules.push(r.id); ops.changed.push(`Removed: ${ruleLine(r)}.`); }
    else ops.discarded.push(`rule ${ruleKey(r)} not read`);
  }

  for (const d of next.library) {
    const had = saved.library.find((x) => x.key === dishKey(d.name) && same(x.slot, d.slot));
    if (had && (had.frequency ?? null) === d.frequency && JSON.stringify(had.days ?? null) === JSON.stringify(d.days ?? null)) continue;
    if (inNew(d.quote) || named(d.name)) { ops.library.push(d); if (!all) ops.changed.push(`${had ? "Changed" : "Added"}: ${dishLine(d)}.`); }
    else ops.discarded.push(`dish ${d.name} at ${d.slot}`);
  }
  if (!all) for (const d of saved.library) {
    if (next.library.some((x) => dishKey(x.name) === d.key && same(x.slot, d.slot))) continue;
    if (named(d.name)) { ops.removeLibrary.push({ name: d.name, slot: d.slot }); ops.changed.push(`Removed: ${d.name} at ${mealWord(d.slot)}.`); }
  }

  // A category word kept by setup (never a library row) that a new reply names and the read no longer has: removed.
  if (!all && ops.state.categories) {
    const cats: NonNullable<SetupState["categories"]> = {};
    for (const [slot, cs] of Object.entries(ops.state.categories)) {
      const keep = cs.filter((c) => !named(c.name) || next.library.some((x) => dishKey(x.name) === dishKey(c.name) && same(x.slot, slot)));
      for (const c of cs) if (!keep.includes(c)) { ops.changed.push(`Removed: ${c.name.toLowerCase()} at ${mealWord(slot)}.`); ops.rebuild = uniq([...(ops.rebuild ?? []), slot]); }
      if (keep.length) cats[slot] = keep;
    }
    ops.state.categories = cats;
  }

  houseAllergies(ops, saved, all);

  // Links: a first setup takes them all; a correction replaces a box's links when a new reply says them or names the box.
  const links = next.links.filter((l) => inNew(l.quote) || named(l.slot));
  if (all) ops.state.links = next.links;
  else if (links.length) {
    const was = ops.state.links ?? [];
    ops.state.links = [...was.filter((l) => !links.some((x) => x.slot === l.slot)), ...links];
    const key = (ls: ReadLink[], slot: string) => JSON.stringify(ls.filter((l) => l.slot === slot).map((l) => [l.from, plainWords(l.words)]).sort());
    for (const slot of uniq(links.map((l) => l.slot))) if (key(was, slot) !== key(ops.state.links, slot)) ops.rebuild = uniq([...(ops.rebuild ?? []), slot]);
  }

  const seedKey = (s: ReadSeed) => `${s.slot.toLowerCase()}|${s.dishes.map(dishKey).join("|")}`;
  for (const s of next.seed) if (inNew(s.quote) && !saved.seed.some((x) => seedKey(x) === seedKey(s))) ops.seed.push(s);

  if (!cookSame(saved.cook, next.cook)) {
    const cookSaid = next.cook ? inNew(next.cook.quote) || (!!next.cook.name && named(next.cook.name)) : !!saved.cook?.name && named(saved.cook.name);
    if (cookSaid || all) { ops.cook = next.cook; if (!all) ops.changed.push(next.cook ? `${cookLine(next.cook)}` : `No cook.`); }
    else ops.discarded.push("cook");
  }
  const fc = next.family_cooks.filter((f) => inNew(f.quote) || named(f.person));
  if (all) ops.state.family_cooks = next.family_cooks;
  else if (fc.length) {
    ops.state.family_cooks = [...ops.state.family_cooks.filter((f) => !fc.some((x) => x.person === f.person)), ...fc];
    for (const f of fc) ops.changed.push(`${f.person} cooks ${daysSaid(f.days)}.`);
  }
  const wl = next.weekday_lunch.filter((w) => inNew(w.quote) || named(w.person));
  ops.state.weekday_lunch = all ? next.weekday_lunch : [...ops.state.weekday_lunch.filter((w) => !wl.some((x) => x.person === w.person)), ...wl];
  const notes = next.unplaced.filter((u) => inNew(u.quote)).map((u) => u.text);
  ops.state.noted = all ? notes : uniq([...ops.state.noted, ...notes]);

  const main = appOf(next.apps.main ?? ""), fallback = appOf(next.apps.fallback ?? "");
  if (main && (all || named(APP_NAMES[main]))) ops.apps = { main, fallback: fallback && fallback !== main ? fallback : null };
  ops.subscriptions = next.subscriptions.filter((s) => all || named(s.item));
  return ops;
}

/** A house-wide hard avoid, on every meal and day: what "everything at home is without peanuts" reads as. */
const houseWide = (r: ReadRule): boolean => !r.who && r.hard && r.what === "avoid" && !!r.items?.length && !r.slots?.length && !r.days?.length;
const allergyOf = (r: ReadRule): boolean => !!r.who && isAllergyRule({ hard: r.hard, what: r.what, items: r.items ?? null, quote: r.quote });

/** An allergy the whole kitchen goes without (the read-back asked "Do you cook everything without peanuts, or only Ishaan's
 *  food?" and the family said everything; or they said so to begin with): one house rule, hard, in place of the person's
 *  allergy rule it covers (every item of it), keeping the allergy's own words as its quote so it is still read as an allergy
 *  (isAllergyRule). Structure only: which words mean the whole house is the rules reader's read. */
export function houseAllergies(ops: Ops, saved: Saved, all: boolean): void {
  for (const h of ops.rules.filter(houseWide)) {
    const covers = (p: ReadRule) => allergyOf(p) && p.items!.every((i) => h.items!.includes(i));
    const fromNext = ops.rules.filter((p) => p !== h && covers(p));
    const fromSaved = saved.rules.filter((p) => covers(p) && !ops.removeRules.includes(p.id));
    if (!fromNext.length && !fromSaved.length) continue;
    ops.rules = ops.rules.filter((p) => !fromNext.includes(p));
    for (const p of fromSaved) { ops.removeRules.push(p.id); if (!all) ops.changed.push(`Removed: ${ruleLine(p)} (now for everyone).`); }
    if (!isAllergyRule({ hard: h.hard, what: h.what, items: h.items ?? null, quote: h.quote })) h.quote = (fromNext[0] ?? fromSaved[0]).quote;
  }
}

// ── Writing (§4.3): people → slots → rules → library → seed → cook, in one transaction; then apps and subscriptions ──

const orderOf = (s: ReadSlot, i: number): number => s.kind === "main" ? SLOT_ORDER[s.name as (typeof SLOTS)[number]]
  : s.kind === "addon" ? SLOT_ORDER.addon + i : s.instead_of ? SLOT_ORDER[s.instead_of as (typeof SLOTS)[number]] + INSTEAD_STEP
  : s.after === "Breakfast" ? SLOT_ORDER.tiffin : s.after === "Dinner" ? SLOT_ORDER.Dinner + INSTEAD_STEP : SLOT_ORDER.snack;
const groupOf = (p: HPerson): string => (GROUPS as readonly string[]).includes(p.group) ? p.group
  : p.age !== undefined ? (p.age < 18 ? "child" : p.age >= 60 ? "elder" : "adult") : "adult";

function writeOps(tx: Db, ops: Ops, opts: { first: boolean; household: Household; replies: string[] }, by: string, changes: Change[]): void {
  const now = new Date().toISOString();
  // People (names only): the household's, as Flock holds them.
  if (opts.first) for (const p of opts.household.people) {
    const had = tx.select().from(peopleTable).all().find((x) => same(x.name, p.name));
    const set = { group: groupOf(p), active: 1, ...(p.relationship ? { relationship: p.relationship } : {}), ...(p.age !== undefined ? { note: `age ${p.age}` } : {}) };
    const row = had ? tx.update(peopleTable).set({ ...set, updated_at: now, updated_by: by }).where(eq(peopleTable.id, had.id)).returning().get()
      : tx.insert(peopleTable).values({ ...set, name: p.name, updated_by: by }).returning().get();
    changes.push(["people", row.id, had ? "update" : "insert", by]);
  }
  // A first setup replaces what an earlier one saved: its rules, its seed, its own dishes, its custom and add-on slots.
  if (opts.first) {
    for (const r of listRules(tx)) removeRule(tx, r.id, by, changes);
    deleteSeedSlotDays(tx, by, changes);
    for (const d of listLibrary(tx).filter((x) => x.origin === "setup_named")) removeLibrary(tx, d.name, d.slot, by, changes);
    for (const s of listSlots(tx)) if (s.kind !== "main" && !ops.slots.some((x) => same(x.name, s.name))) upsertSlot(tx, { name: s.name, active: false }, by, changes);
  }
  let addon = listSlots(tx, { all: true }).filter((s) => s.kind === "addon").length;
  for (const s of ops.slots) {
    const had = listSlots(tx, { all: true }).find((x) => same(x.name, s.name));
    upsertSlot(tx, { name: s.name, kind: s.kind, addon_of: s.addon_of, usual_people: s.usual_people, days: s.days, skip_days: s.skip_days, active: true, extras: !!s.extras,
      ...(had ? {} : { order: orderOf(s, s.kind === "addon" ? addon++ : 0) }) }, by, changes);
  }
  for (const name of ops.removeSlots) upsertSlot(tx, { name, active: false }, by, changes);
  for (const id of ops.removeRules) removeRule(tx, id, by, changes);
  for (const r of ops.rules) addRule(tx, r, by, changes);
  for (const d of ops.removeLibrary) removeLibrary(tx, d.name, d.slot, by, changes);
  for (const d of ops.library) upsertLibrary(tx, { name: d.name, slot: d.slot, frequency: d.frequency, days: d.days,
    said: d.frequency || d.days ? d.said || d.often || null : null,
    ...(listLibrary(tx, { names: [d.name], slot: d.slot }).length ? {} : { origin: "setup_named" as const, untried: false }) }, by, changes);
  for (const s of ops.seed) saveSlotDay(tx, { date: null, slot: s.slot, status: "confirmed", dishes: s.dishes.map((dish) => ({ dish })) }, by, changes);
  const h = getHouse(tx);
  const set: Partial<typeof house.$inferInsert> = {};
  if (ops.cook !== undefined) {
    const c = ops.cook;
    Object.assign(set, { cook_name: c?.name ?? null, cook_days: c ? JSON.stringify(c.days) : null, cook_time_limit: c?.limits_words ?? null,
      // Earliest first when every visit has its time; visits without one stay in the order said.
      cook_arrival: !c || !c.visits.length ? null : c.visits.length === 1 && !c.visits[0].meals && c.visits[0].at ? c.visits[0].at
        : JSON.stringify(c.visits.every((v) => v.at) ? [...c.visits].sort((a, b) => a.at!.localeCompare(b.at!)) : c.visits) });
  }
  const state: SetupState = { replies: opts.replies, ...ops.state };
  tx.update(house).set({ ...set, setup_state: JSON.stringify(state), updated_at: now, updated_by: by }).where(eq(house.id, h.id)).run();
  changes.push(["house", h.id, "update", by]);
  // Settings defaults (new_dishes_per_week): its default holds until the family sets it; nothing to write.
}

// ── The read-back (§4.4), in plain words ──

const andWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const mealWord = (slot: string) => ((SLOTS as readonly string[]).includes(slot) ? slot.toLowerCase() : slot);
const tagWords = (t: string) => t.replace(/_/g, " ");
const daysPart = (days: readonly string[] | null | undefined) => (days?.length && days.length < 7 ? ` ${daysSaid(days)}` : "");

/** How often, in words. */
export function frequencyText(f: Frequency | null | undefined): string {
  if (!f) return "";
  if (f === "daily") return "every day";
  if (f === "usually") return "most days";
  if (f === "sometimes") return "2–3 times a week";
  if (f === "rarely") return "at most once a week";
  const n = Number(f.split("/")[0]);
  return n === 1 ? "once a week" : n === 2 ? "twice a week" : `${n} times a week`;
}
/** A slot in words: its days and who it is for. */
export function slotText(s: Pick<ReadSlot, "kind" | "addon_of" | "usual_people" | "days">): string {
  const days = s.days.length && s.days.length < 7 ? daysSaid(s.days) : "every day";
  const who = s.usual_people.length ? ` for ${andWords(s.usual_people)}` : " for everyone";
  return `${days}${who}${s.kind === "addon" && s.addon_of ? `, beside ${s.addon_of.toLowerCase()}` : ""}`;
}
/** The morning, midday or evening visit a cook's cap is on, by its meals. */
const visitLabel = (slots: readonly string[]): string | null => {
  const has = (m: string) => slots.some((x) => same(x, m));
  return has("Breakfast") ? "morning" : has("Lunch") ? "midday" : has("Dinner") ? "evening" : null;
};
/** One rule in words, without its person: built from its typed targets when it has them (§6.4: "no egg, no salad", "Pancakes
 *  when it's upma"), else from its words. */
export function ruleSaid(r: Pick<Rule, "what" | "items" | "to" | "slots" | "days" | "frequency" | "per_meal" | "fasting_food" | "quote"> & Partial<Pick<Rule, "targets" | "gives">>): string {
  const targets = r.targets?.length ? r.targets : null;
  const said = (t: RuleTarget) => targetText(t).toLowerCase();
  const items = targets ? andWords(targets.map(said)) : andWords((r.items ?? []).map(tagWords));
  const at = `${r.slots?.length ? ` at ${andWords(r.slots.map(mealWord))}` : ""}${daysPart(r.days)}`;
  const often = r.frequency ? `, ${frequencyText(r.frequency)}` : "";
  switch (r.what) {
    case "veg": return `vegetarian${at}`;
    case "egg": return `eggs but no meat${at}`;
    case "no_eggs": return `no eggs${at}`;
    case "avoid": return targets ? `${targets.map((t) => `no ${said(t)}`).join(", ")}${at}` : `no ${items}${at}`;
    case "only": return `only ${items}${at}`;
    case "swap": return r.gives && targets ? `${targetText(r.gives)} when it's ${targets.map(said).join(" or ")}${at}${often}` : `${r.to} in place of ${items}${at}${often}`;
    case "require": return `${items}${at}${often}`;
    case "fasting": return `fasts${daysPart(r.days)}${r.slots?.length ? ` at ${andWords(r.slots.map(mealWord))}` : ""}${r.fasting_food?.length ? ` (${andWords(r.fasting_food)} allowed)` : ""}`;
    case "cap": { const v = r.slots?.length ? visitLabel(r.slots) : null; return v ? `at most ${r.per_meal} dishes in the ${v} visit` : `at most ${r.per_meal} dishes a meal${at}`; }
    default: return `${r.quote}${often}`;
  }
}
const ruleLine = (r: ReadRule) => `${r.who ?? "Everyone"}: ${ruleSaid({ ...r, items: r.items ?? null, to: r.to ?? null, slots: r.slots ?? null, days: r.days ?? null,
  frequency: r.frequency ?? null, per_meal: r.per_meal ?? null, fasting_food: r.fasting_food ?? null })}`;
const dishLine = (d: ReadDish) => `${d.name} at ${mealWord(d.slot)}${d.frequency ? `, ${frequencyText(d.frequency)}` : ""}${d.days ? `, ${daysSaid(d.days)}` : ""}`;
function cookLine(c: Pick<Cook, "name" | "days" | "visits" | "limits_words">): string {
  const visits = c.visits.map((v) => [v.meals?.length ? andWords(v.meals.map(mealWord)) : "", v.at ? `at ${clockText(v.at)}` : ""].filter(Boolean).join(" "));
  // Visits said by their meals alone are told apart by a comma: "breakfast and lunch, and dinner".
  const said = visits.length > 1 && c.visits.some((v) => !v.at) ? `${visits.slice(0, -1).join(", ")}, and ${visits[visits.length - 1]}` : andWords(visits);
  // A role is never a name (spec §6.3): a cook the family never named is "your cook".
  return `${c.name ?? "Your cook"} cooks ${daysSaid(c.days)}${visits.length ? `: ${said}` : ""}${c.limits_words ? ` (${c.limits_words})` : ""}.`;
}
const placeText = (w: string) => (w === "office" ? "the office" : w);

/** The weekday lunch line: who has weekday lunch at home, and where the others are (household.weekly, the replies winning). */
export function lunchLine(people: string[], weekly: WeeklyEntry[] | null, said: WeekdayLunch[], lunchFor: string[]): string | null {
  if (!weekly && !said.length) return null;
  const home: string[] = [], away = new Map<string, { carries: boolean; place: string; people: string[] }>();
  for (const p of people) {
    if (lunchFor.length && !lunchFor.includes(p)) continue;
    const w = weekly?.find((x) => x.person === p && x.where !== "home" && x.weekdays.some((d) => WEEKDAYS.indexOf(d) < 5));
    const lunch = said.find((x) => x.person === p)?.lunch ?? w?.lunch ?? (w ? "away" : "home");
    if (lunch === "home") { home.push(p); continue; }
    const place = placeText(w?.where ?? "work"), key = `${lunch}|${place}`;
    const g = away.get(key) ?? { carries: lunch === "carries", place, people: [] };
    g.people.push(p);
    away.set(key, g);
  }
  const parts = [...away.values()].map((g) => {
    const many = g.people.length > 1, who = andWords(g.people);
    return g.carries ? `${who} ${many ? "take" : "takes"} lunch to ${g.place}` : many ? `${who} are at ${g.place}` : `${who}'s at ${g.place}`;
  });
  return `Weekday lunch is for ${home.length ? andWords(home) : "nobody at home"}${parts.length ? `; ${parts.join("; ")}` : ""}.`;
}

/** The read-back's question for a fast with no food said: "What does Gowri Shankar eat on his Tuesday fast?" */
export const fastingAsk = (who: string, days: readonly string[] | null): string =>
  `What does ${who} eat on ${days?.length && days.length < 7 ? `the ${andWords(days.map((d) => LONG_DAY[d as keyof typeof LONG_DAY] ?? d))} fast` : "a fasting day"}?`;

/** The family's word for a rule's item, from the rule's own words ("peanuts" for the tag peanut), else the tag in words. */
export function itemWord(tag: string, quote: string): string {
  const t = plainWords(tagWords(tag));
  return (t && new RegExp(`(?:^| )(${t}(?:e?s)?)(?= |$)`).exec(plainWords(quote))?.[1]) || tagWords(tag);
}
/** The read-back's question for an allergy kept on one person (owner, 25 Nov): "Do you cook everything without peanuts, or
 *  only Ishaan's food?" The answer comes back as a correction: "everything" makes it one house rule (houseAllergies). */
export const allergyAsk = (r: Pick<Rule, "who" | "items" | "quote">): string =>
  `Do you cook everything without ${andWords((r.items ?? []).map((i) => itemWord(i, r.quote)))}, or only ${r.who}'s food?`;
/** A read-back question the family has answered: it is a Q line of the transcript, with a reply after it. */
export function answeredIn(question: string, transcript: string[]): boolean {
  const q = plainWords(question);
  const at = transcript.findIndex((l) => /^Q:/i.test(l) && plainWords(l.replace(/^Q:\s*/i, "")).includes(q));
  return at >= 0 && transcript.slice(at + 1).some((l) => /^A\d*:/i.test(l));
}

/** The main meal a slot is someone's own meal in place of: a custom slot of named people just after a main meal (its order) whose
 *  people are not among that meal's. */
export function insteadOf(s: Pick<Slot, "kind" | "order" | "usual_people">, slots: Pick<Slot, "name" | "kind" | "order" | "usual_people">[]) {
  if (s.kind !== "custom" || !s.usual_people.length) return null;
  const main = slots.find((m) => m.kind === "main" && m.order + INSTEAD_STEP === s.order);
  return main && main.usual_people.length && !s.usual_people.some((p) => main.usual_people.some((q) => same(p, q))) ? main : null;
}

/** The setup read back from the rows: people, the cook, slots, weekday lunch, meals out, rules, every-day dishes, "Noted, not
 *  checked", then one question. */
export function readBack(db: Db, household: Household, extra: { noted: string[]; asks: string[] }): string {
  const saved = savedOf(db);
  const state = saved.state;
  const fam = db.select().from(peopleTable).where(eq(peopleTable.active, 1)).all().map((p) => p.name);
  const lines: string[] = [];
  lines.push(`At home: ${fam.length ? andWords(fam) : "nobody yet"}.`);
  // Who cooks: the cook, the family members said, and the family on the other days.
  const cookParts: string[] = [];
  if (saved.cook) cookParts.push(cookLine(saved.cook).replace(/\.$/, ""));
  const covered = new Set<string>(saved.cook?.days ?? []);
  for (const f of state?.family_cooks ?? []) { cookParts.push(`${f.person} cooks ${daysSaid(f.days)}`); f.days.forEach((d) => covered.add(d)); }
  const rest = WEEKDAYS.filter((d) => !covered.has(d));
  if (rest.length === 7) cookParts.push("The family cooks every day");
  else if (rest.length) cookParts.push(`the family cooks ${rest.length === 1 ? `on ${LONG_DAY[rest[0]]}` : daysSaid(rest)}`);
  lines.push(`${cookParts.join("; ")}.`);
  // Slots.
  const slots = listSlots(db);
  const extraSlots = slots.filter((s) => s.kind !== "main").map((s) => s.kind === "addon"
    ? `${s.name} for ${andWords(s.usual_people)} at ${mealWord(s.addon_of ?? "")}` : `${s.name}${daysPart(s.days)}${s.usual_people.length ? ` for ${andWords(s.usual_people)}` : ""}`);
  lines.push(`Each day: ${andWords(slots.filter((s) => s.kind === "main").map((s) => s.name))}${extraSlots.length ? `, plus ${andWords(extraSlots)}` : ""}.`);
  // A person's own meal in place of the family's, said plainly so a family can correct it.
  for (const s of slots) {
    const main = insteadOf(s, slots);
    if (main) lines.push(`${andWords(s.usual_people)} ${s.usual_people.length > 1 ? "have" : "has"} a separate ${mealWord(main.name)} (${s.name}), not the family's; ${main.name} is for ${andWords(main.usual_people)}.`);
  }
  const lunch = lunchLine(fam, household.weekly, state?.weekday_lunch ?? [], slots.find((s) => s.name === "Lunch")?.usual_people ?? []);
  if (lunch) lines.push(lunch);
  // Meals eaten out or ordered in.
  const out: string[] = [];
  for (const s of slots) for (const sk of s.skip_days) out.push(`${LONG_DAY[sk.day]} ${mealWord(s.name)} is ${sk.skip === "eaten_out" ? "eaten out" : "ordered in"}`);
  if (out.length) lines.push(`${out.join("; ")}.`);
  // Rules, per person; notes are "noted, not checked".
  const rules = saved.rules.filter((r) => r.what !== "note");
  const by = new Map<string, string[]>();
  for (const r of rules) { const k = r.who ?? "Everyone"; by.set(k, [...(by.get(k) ?? []), ruleSaid(r)]); }
  if (by.size) lines.push(`Food rules:\n${[...by].map(([who, rs]) => `- ${who}: ${rs.join("; ")}`).join("\n")}`);
  // The family's own dishes per meal, so a meal read wrong or left out (run 28: the adults' dinner never asked) is seen here.
  // Each meal as its plates, in the family's own words (the kinds model), so a plate read wrong is seen here; a meal not read
  // that way yet lists its dishes.
  const mealLines = slots.map((s) => [s.name, state?.meals?.[s.name] || saved.library.filter((d) => same(d.slot, s.name)).map((d) => d.name).join(", ")] as const)
    .filter(([, l]) => l);
  if (mealLines.length) lines.push(`Your usual meals:\n${mealLines.map(([slot, l]) => `- ${slot}: ${l}`).join("\n")}`);
  const kitchen = kitchenLine(houseView(getHouse(db)).cuisines ?? []);
  if (kitchen) lines.push(kitchen);
  const daily = [...saved.library.filter((d) => d.frequency === "daily").map((d) => `${d.name.toLowerCase()} at ${mealWord(d.slot)}`),
    ...Object.entries(state?.categories ?? {}).flatMap(([slot, cs]) => cs.filter((c) => c.frequency === "daily").map((c) => `${c.name.toLowerCase()} at ${mealWord(slot)}`))];
  if (daily.length) lines.push(`Every day: ${andWords(daily)}.`);
  const noted = uniq([...saved.rules.filter((r) => r.what === "note").map((r) => `${r.who ? `${r.who}: ` : ""}${ruleSaid(r)}`), ...(state?.noted ?? []), ...extra.noted]);
  if (noted.length) lines.push(`Noted, not checked:\n${noted.map((n) => `- ${n}`).join("\n")}`);
  for (const a of extra.asks) lines.push(a);
  lines.push(lunchQuestion(state?.lunch_unclear ?? [], household.weekly) ?? "Anything to change?");
  return lines.join("\n");
}
/** The one lunch question, when someone's weekday lunch is not known. */
function lunchQuestion(unclear: string[], weekly: WeeklyEntry[] | null): string | null {
  if (!unclear.length) return null;
  const where = uniq(unclear.map((p) => weekly?.find((w) => w.person === p && w.where !== "home")?.where ?? "work"));
  const place = where.length === 1 ? placeText(where[0]) : "work";
  return `${unclear.length > 1 ? "Do" : "Does"} ${andWords(unclear)} take lunch from home to ${place}?`;
}

// ── The kinds model (docs/kinds-model-build.md): each dish's place in the catalog, each meal's kinds and templates, the
// family's cuisines. Code places what the catalog names (matchDish); one fast read places the rest. ──

/** A dish's place in the catalog as the setup reads it. kind null: not placed (its template part holds just the dish). own: a
 *  kind only this family has, named after their dish (decided 19). named: the family's words name one dish, or a category (any
 *  dish of a kind or sub-kind). parts: a dish plated as two ("curd rice" is rice and curd, decided 3). word: the family's words
 *  for it, for the read-back ("a poriyal"). */
export type Place = { kind: string | null; sub: string | null; item: string | null; own: boolean; named: "dish" | "category";
  parts?: { kind: string; sub: string | null }[]; word: string };

/** The family's words for a dish: "a poriyal" when they said it so ("a", "an", "some", "any" before it), else its name. */
export function wordOf(name: string, quote = ""): string {
  const n = plainWords(name);
  const m = n ? new RegExp(`(?:^| )((?:a|an|some|any) ${n})(?= |$)`).exec(plainWords(quote)) : null;
  return m?.[1] ?? name.trim().toLowerCase();
}

/** The words for plain rice a curry or curd is mixed with ("curd rice", "kadhi chawal", "varan bhaat"). */
const RICE_WORDS = new Set(["rice", "chawal", "chaval", "bhaat", "bhat", "annam", "anna", "sadam", "saadam"]);
/** The words for a plain roti said with a dish ("roti sabzi", "phulka dal", "chapati with aloo gobi"; owner, 26 Nov). A paratha
 *  is not one: it is its own dish. */
const BREAD_WORDS = new Set(["roti", "chapati", "chapathi", "chapatti", "phulka", "fulka", "rotli", "poli"]);
const JOIN_WORDS = new Set(["with", "and", "n", "aur"]);
const soleSub = (k: CatalogKind): string | null => (k.subs.length === 1 ? k.subs[0].name : null);
const manySubs = (kind: string): boolean => (catalogKind(kind)?.subs.length ?? 0) > 1;
const isStaple = (kind: string): boolean => !!catalogKind(kind)?.staple;

/** Where code places a dish, from the catalog alone; null when the catalog does not name it (the model reads it). An item is a
 *  dish; a sub-kind or kind is a category. Rice said with a curry or curd that the catalog names ("rasam rice", "rajma chawal")
 *  is two parts: the rice and the other (never when the words are one rice dish of the catalog's: "lemon rice"). */
/** What tells a family's region (decided 20): the cuisines they name in their own words, and each of their dishes' cuisines. */
export type Region = { said: readonly string[]; dishes: readonly string[][] };
/** A regional word's meaning for this family: the region they name, else the meaning their dishes point to. A dish points to
 *  a meaning when all its cuisines fit that meaning and no other (pappu, pesarattu: Andhra; idli, eaten all over the south:
 *  none); the meaning wins with more such dishes than all the others together. Null when nothing settles it. */
export function regionalFor(word: RegionalWord, region: readonly string[] | Region): RegionalMeaning | null {
  const r: Region = Array.isArray(region) ? { said: region as string[], dishes: [] } : (region as Region);
  const said = regionalMeaning(word, r.said);
  if (said) return said;
  const fits = (c: string, m: RegionalMeaning) => m.cuisines.includes(c) || (BROAD.includes(c) && m.cuisines.some((x) => REGION_OF[x] === c));
  const votes = word.meanings.map(() => 0);
  for (const cs of r.dishes) {
    const narrow = cs.filter((c) => !BROAD.includes(c)), use = narrow.length ? narrow : cs;
    if (!use.length) continue;
    const hit = word.meanings.map((m, i) => (use.every((c) => fits(c, m)) ? i : -1)).filter((i) => i >= 0);
    if (hit.length === 1) votes[hit[0]]++;
  }
  const total = votes.reduce((a, b) => a + b, 0), best = votes.indexOf(Math.max(...votes));
  return votes[best] > total - votes[best] ? word.meanings[best] : null;
}

export function codePlace(name: string, word = name.trim().toLowerCase(), region: readonly string[] | Region = []): Place | null {
  // A word that means different dishes by region (decided 20: "curry", "pachadi") is settled here only when the family's region
  // (their other dishes' cuisines, the region they name) says which; else the kinds read decides.
  const rw = regionalWordOf(name);
  if (rw) {
    const m = regionalFor(rw, region), k = m ? catalogKind(m.kind) : null;
    return m && k ? { kind: k.name, sub: m.sub ?? soleSub(k), item: null, own: false, named: "category", word } : null;
  }
  const whole = matchDish(name);
  const rin = regionalIn(name);
  if (rin && (!whole || rin.word.meanings.some((x) => norm(x.kind) === norm(whole.kind)))) {
    // A dish named with one ("cabbage curry", "tomato pachadi"): its vegetable and the word's meaning. A catalog item of the
    // word's own kinds yields to the meaning ("cucumber pachadi" in an Andhra home is a chutney); one of another kind stays.
    const m = regionalFor(rin.word, region), hit = m ? regionalDish(rin.base, m) : null;
    if (hit) return { kind: hit.kind, sub: hit.sub, item: hit.item, own: false, named: "dish", word };
    if (!whole) return null;
  }
  const ws = norm(name).split(" ");
  if (ws.length > 1) for (const [rice, rest] of [[ws[ws.length - 1], ws.slice(0, -1)], [ws[0], ws.slice(1)]] as const) {
    if (!RICE_WORDS.has(rice)) continue;
    const m = matchDish(rest.join(" ")), k = m ? catalogKind(m.kind) : null;
    if (!m || !k || k.name === "Rice" || k.part === "complete" || k.name === "Pulao") continue;
    if (whole && whole.kind !== m.kind) continue;
    const sub = m.sub ?? soleSub(k);
    return { kind: k.name, sub, item: null, own: false, named: "dish", parts: [{ kind: "Rice", sub: null }, { kind: k.name, sub }], word };
  }
  // A plain roti said with a dish ("roti sabzi", "roti with aloo gobi", "dal roti") is two parts: the roti and the dish (never a
  // roti of the catalog's own: "missi roti").
  if (ws.length > 1 && !(whole && isStaple(whole.kind))) for (const [bread, rest0] of [[ws[0], ws.slice(1)], [ws[ws.length - 1], ws.slice(0, -1)]] as const) {
    if (!BREAD_WORDS.has(bread)) continue;
    const rest = [...rest0];
    while (rest.length && JOIN_WORDS.has(rest[0])) rest.shift();
    while (rest.length && JOIN_WORDS.has(rest[rest.length - 1])) rest.pop();
    const m = rest.length ? matchDish(rest.join(" ")) : null, k = m ? catalogKind(m.kind) : null;
    if (!m || !k || k.staple || k.part === "complete") continue;
    if (whole && whole.kind !== m.kind) continue;
    const sub = m.sub ?? soleSub(k);
    return { kind: k.name, sub, item: m.by === "item" ? m.item : null, own: false, named: m.by === "item" ? "dish" : "category",
      parts: [{ kind: "Roti", sub: null }, { kind: k.name, sub }], word };
  }
  if (!whole) {
    // A vegetable said on its own ("bhindi", "lauki") is the catalog's sabzi of it: a side of the plate.
    const veg = ws.length <= 2 ? matchDish(`${name} sabzi`) : null;
    return veg?.by === "item" && veg.kind === "Sabzi" ? { kind: "Sabzi", sub: veg.sub, item: veg.item, own: false, named: "dish", word } : null;
  }
  const k = catalogKind(whole.kind)!;
  // A kind or sub-kind word said bare ("dosa", "rasam") names its decided dish (§5.1, the catalog's bare list): a dish; said
  // as any of it ("some dal", "any dosa") or with no decided dish ("upma", "sabzi") it is a category.
  const bare = whole.by !== "item" && !/^(?:some|any|all|different|a different) /.test(plainWords(word)) && !!bareDish(k.name, whole.sub);
  return { kind: k.name, sub: whole.sub ?? soleSub(k), item: whole.item, own: false, named: whole.by === "item" || bare ? "dish" : "category", word };
}

/** The dish a bare kind or sub-kind word names (§5.1: "dosa" is Plain dosa, "rasam" Tomato rasam): for a place read as a dish
 *  with no catalog item, whose name is the kind's or sub-kind's own word. Null otherwise ("Egg paratha roll" is their own item). */
export function bareOf(name: string, p: Place | null): string | null {
  if (!p?.kind || p.own || p.parts || p.item || p.named !== "dish" || isStaple(p.kind)) return null;
  const m = matchDish(name);
  if (!m || m.by === "item" || norm(m.kind) !== norm(p.kind)) return null;
  return bareDish(p.kind, m.sub ?? p.sub);
}

/** Whether the model must say if the family's words name a category or a dish: a kind or sub-kind word (not a staple) at a meal
 *  the catalog does not suggest it at. A category there gets new items of it; a dish stays just theirs (decided 19). */
export const needsNamed = (p: Place, meal: string): boolean =>
  !!p.kind && !p.own && !p.parts && p.named === "category" && !isStaple(p.kind) && !suggestMeals({ kind: p.kind, sub: p.sub }).includes(meal);

/** The meal a slot is, as the catalog says meals: a main meal's own, an add-on its main meal's, a tiffin or box "tiffin", any
 *  other meal of the family's "snack". */
export function mealOf(s: Pick<Slot, "name" | "kind" | "addon_of" | "order">): string {
  if (s.kind === "main") return s.name.toLowerCase();
  if (s.kind === "addon") return (s.addon_of ?? "dinner").toLowerCase();
  // A person's own meal in place of a main meal sits just after it: that meal.
  const own = SLOTS.find((m) => s.order === SLOT_ORDER[m] + INSTEAD_STEP);
  return s.order === SLOT_ORDER.tiffin ? "tiffin" : own ? own.toLowerCase() : "snack";
}

/** The catalog as the kinds read sees it: one line per kind, its meals and its sub-kinds. */
export const catalogLines = (): string[] =>
  CATALOG.kinds.map((k) => `${k.name} [${k.meals.join(", ")}]${k.subs.length > 1 ? `: ${k.subs.map((s) => s.name).join(", ")}` : ""}`);

/** One dish the kinds read is asked about: its name, meal and words; `known` when code found its kind and only named is asked. */
export type KindsAsk = { name: string; meal: string; words: string; known?: Place };

/** The kinds read's answer for one dish made safe: a kind or sub-kind not in the catalog is none (own when no kind is left); a
 *  part not in the catalog is dropped, and fewer than two parts is no parts. A dish asked only for named keeps code's place. */
export function placeOf(ask: KindsAsk, x: Record<string, unknown>, word: string): Place {
  const named = x.named === "category" ? "category" : "dish";
  if (ask.known) return { ...ask.known, named, word };
  const k = x.own === true ? null : catalogKind(str(x.kind));
  if (!k) {
    const same = catalogKind(ask.name);
    return same ? { kind: same.name, sub: soleSub(same), item: null, own: false, named, word } : { kind: ask.name.trim(), sub: null, item: null, own: true, named: "dish", word };
  }
  const sub = catalogSub(k.name, str(x.sub)) ?? soleSub(k);
  const parts = arr(x.parts).filter(isObject).flatMap((p) => {
    const pk = catalogKind(str(p.kind));
    return pk ? [{ kind: pk.name, sub: catalogSub(pk.name, str(p.sub)) ?? soleSub(pk) }] : [];
  });
  // Parts are how this dish is plated (curd rice: rice and curd), so the dish's own kind is one of them.
  return { kind: k.name, sub, item: null, own: false, named, ...(parts.length >= 2 && parts.some((p) => p.kind === k.name) ? { parts } : {}), word };
}

/** The regional words among these dishes' names, each with its meanings by region, for the kinds read (decided 20). */
export function regionalLines(names: string[]): { word: string; meanings: string[] }[] {
  const words = uniq(names.map((n) => regionalWordOf(n) ?? regionalIn(n)?.word).filter((w): w is NonNullable<typeof w> => !!w).map((w) => w.word));
  return words.map((w) => CATALOG.regional!.find((r) => r.word === w)!).map((r) => ({ word: r.word,
    meanings: r.meanings.map((m) => `${m.cuisines.map((c) => CUISINE_NAMES[c] ?? c).join(", ")}: ${[m.kind, m.sub].filter(Boolean).join(" / ")}`) }));
}

/** The kinds read's answer: the dishes it placed, and those an answer came back without, even when asked again (F4: a partial
 *  read). A failed call leaves nothing `left`: what it would place stays as code found it. */
export type KindsPlaced = { placed: Map<string, Place>; left: KindsAsk[] };

/** The kinds read: one fast call for every dish asked, and one more for the dishes its answer left out. A failed call places
 *  nothing (the caller keeps what code found, or none). */
export async function kindsRead(model: ModelCall, asks: KindsAsk[], until: number, log: (l: string) => void, family: string[] = []): Promise<KindsPlaced> {
  const out = new Map<string, Place>();
  if (!asks.length) return { placed: out, left: [] };
  // Its own deadline, inside the setup's: never what pushes the setup past its budget (eval h4 ran 150.09 s); on a timeout what
  // it would place stays the family's fixed dish.
  const by = Math.min(until - KINDS_MARGIN_MS, Date.now() + KINDS_MS);
  const ask = async (these: KindsAsk[]): Promise<KindsAsk[] | null> => {
    const regional = regionalLines(these.map((a) => a.name));
    const user = JSON.stringify({ catalog: catalogLines(), dishes: these.map((a) => ({ name: a.name, meal: a.meal, words: a.words,
      ...(a.known ? { known: [a.known.kind, a.known.sub].filter(Boolean).join(" / ") } : {}) })), ...(regional.length ? { regional, family_dishes: family } : {}) });
    const r = await askOnce(model, { tier: "fast", purpose: "setup: kinds", system: KINDS_SYSTEM, user, schema: KINDS_SCHEMA, maxTokens: 4000 }, by, log);
    // No dishes list at all is no answer (a failed read), not one that left every dish out.
    if (!r.ok || !isObject(r.json) || !Array.isArray(r.json.dishes)) { log(`kinds: ${r.ok ? "no answer" : `${r.code}: ${r.message.slice(0, 200)}`}`); return null; }
    const rows = r.json.dishes.filter(isObject);
    const left: KindsAsk[] = [];
    for (const a of these) {
      const x = rows.find((y) => dishKey(str(y.name)) === dishKey(a.name) && (!str(y.meal) || same(str(y.meal), a.meal)));
      if (x) out.set(`${a.meal}|${dishKey(a.name)}`, placeOf(a, x, wordOf(a.name, a.words)));
      else left.push(a);
    }
    return left;
  };
  const left = await ask(asks);
  if (!left?.length) return { placed: out, left: [] };
  // An answer that left dishes out (eval h18 rep 3: "Dry sabji" read as nothing, saved as a dish on the plate): asked again,
  // once, for only those.
  log(`kinds: the answer left out ${left.map((a) => `${a.name} (${a.meal})`).join(", ")}; asking once more for them`);
  const again = await ask(left);
  return { placed: out, left: again ?? left };
}

/** One of the family's dishes at a meal, with its place and how often they said they have it. */
export type MealDish = { name: string; place: Place | null; frequency: Frequency | null; days: Weekday[] | null; said: string | null };
/** A meal's shape: its kinds and templates to store, its read-back line in the family's words, and what was left out. */
/** What setup reads of a plate: a kind (with its words and dish) or the family's own fixed dishes; it never reads a link. */
type TemplatePart = KindPart | ItemsPart;
export type MealShape = { templates: MealTemplate[]; line: string; dropped: string[];
  /** The dishes (keys) whose words are on a part of the templates: a category word among them leaves the library (§5.3). */
  onParts: string[] };
/** A box's link to another meal, resolved: `kind` null = the whole plate of `from`. `words`: the family's, for the read-back. */
export type MealLink = { kind: string | null; sub: string | null; from: string; words?: string };

type PlatePart = { part: TemplatePart; words: string[]; dish: MealDish | null };
type Draft = { parts: PlatePart[]; defining: MealDish[] };

/** A dish's parts on a plate (decided 17–19). A staple's kind; an own kind; a category word its kind, or its sub-kind when the
 *  word is one; a named dish its kind where the catalog suggests that kind at this meal (variety among it), else the dish
 *  itself (nothing new suggested at a meal it does not belong to: "appam with stew"); a dish not placed, itself. */
export function partsOf(d: MealDish, meal: string): TemplatePart[] {
  const p = d.place;
  if (!p?.kind) return [{ items: [d.name] }];
  // The family's words for it ride on its part (§5.1), for the read-back and messages.
  const w = (x: KindPart): KindPart => (p.word ? { ...x, words: p.word } : x);
  if (p.parts) return p.parts.map((x, i, all) => {
    const part: KindPart = isStaple(x.kind) || !x.sub || !manySubs(x.kind) ? { kind: x.kind } : { kind: x.kind, sub: x.sub };
    return i === all.length - 1 ? w(part) : part;
  });
  if (p.own || isStaple(p.kind)) return [w({ kind: p.kind })];
  if (p.named === "category") return [w(p.sub && manySubs(p.kind) ? { kind: p.kind, sub: p.sub } : { kind: p.kind })];
  // A named dish: a catalog item (their row), else the dish their bare word names, else their own dish of that kind ("Kovakkai",
  // a sabzi): their dish on a part of its kind, others of the kind offered as new. A box's filling variant of a kind its other
  // plates have ("Egg paratha roll") is fixed by buildMeal.
  const bare = p.item ? null : bareOf(d.name, p);
  const dish = p.item || !bare ? d.name : bare;
  if (!suggestMeals({ kind: p.kind, sub: p.sub, item: p.item ?? bare }).includes(meal)) return [{ items: [dish] }];
  // Their word named a sub-kind ("rasam"), or their own dish was read under one: the part keeps it.
  const sub = p.sub && manySubs(p.kind) && (matchDish(p.word || d.name)?.by === "sub" || (!p.item && !bare)) ? p.sub : null;
  return [w({ kind: p.kind, ...(sub ? { sub } : {}), dish })];
}

/** The catalog dish a fixed part is saved as (owner, 26 Nov): a family's sub-kind or kind word kept as a dish at a meal its kind
 *  is not suggested at ("idiyappam with stew") is planned as a specific dish, never the bare word. Their word names one
 *  everyday dish when the one dish of that place named "<something> <word>" is its "Vegetable <word>" (or "Veg <word>"):
 *  "stew" → "Vegetable stew", "kurma" → "Vegetable kurma". Else null: their own words stay. The new place keeps their word for the read-back, and
 *  stays a fixed part (no rotation into other dishes of the kind). */
export function nearestDish(d: MealDish, meal: string): { name: string; place: Place } | null {
  const p = d.place;
  if (!p?.kind || p.own || p.parts || p.item || isStaple(p.kind)) return null;
  const fixed = (x: MealDish) => { const ps = partsOf(x, meal); return ps.length === 1 && "items" in ps[0]; };
  if (!fixed(d)) return null;
  const m = matchDish(d.name), k = m && m.by !== "item" && norm(m.kind) === norm(p.kind) ? catalogKind(m.kind) : null;
  if (!k) return null;
  const n = norm(d.name);
  const hits = k.items.filter((it) => (!m!.sub || norm(it.sub) === norm(m!.sub))
    && [it.name, ...(it.aka ?? [])].some((w) => norm(w) === `vegetable ${n}` || norm(w) === `veg ${n}`));
  // One clear dish: no other dish of the place is a "<something> <word>" ("khichdi" has many: their word stays).
  const ends = k.items.filter((it) => (!m!.sub || norm(it.sub) === norm(m!.sub)) && [it.name, ...(it.aka ?? [])].some((w) => norm(w).endsWith(` ${n}`)));
  if (hits.length !== 1 || ends.length !== 1) return null;
  const place: Place = { ...p, sub: hits[0].sub ?? p.sub, item: hits[0].name, named: "dish" };
  return fixed({ ...d, name: hits[0].name, place }) ? { name: hits[0].name, place } : null;
}
const partKey = (p: TemplatePart): string => ("items" in p ? `i:${p.items.map(dishKey).sort().join("|")}` : `k:${norm(p.kind)}|${norm(p.sub ?? "")}|${p.dish ? dishKey(p.dish) : ""}`);
const draftKey = (t: Draft): string => t.parts.map((p) => partKey(p.part)).sort().join("+");
/** A dish fits a part already there: the part is its kind (of whatever sub-kind: the family's sub-kinds are the kind's, and
 *  rotation prefers them), or holds the dish. */
const fits = (p: TemplatePart, d: MealDish): boolean => ("items" in p ? p.items.some((x) => dishKey(x) === dishKey(d.name))
  : !!d.place?.kind && norm(p.kind) === norm(d.place.kind));
/** A kind that is a whole plate at lunch or dinner: a one-dish meal (khichdi, biryani), a bread or rice (puri; "two phulkas"
 *  for one person), pulao, or a kind of the family's own. */
const wholePlate = (d: MealDish): boolean => {
  const p = d.place;
  if (!p?.kind || p.own) return true;
  const k = catalogKind(p.kind);
  return !k || k.part === "complete" || k.part === "staple" || k.name === "Pulao";
};
/** The base of a plate (roti, rice, bhakri): what a main dish in none of the family's plates is had with. Curd is a staple
 *  too, but a side: it is not added. */
const isBase = (p: TemplatePart): boolean => "kind" in p && isStaple(p.kind) && catalogKind(p.kind)?.part === "staple";
const SMALL_MEALS = ["breakfast", "tiffin", "snack"];
const isDaily = (d: MealDish): boolean => d.frequency === "daily";

/** A meal's kinds and templates from the family's example plates (each seed row one way the plate is made) and their dishes
 *  there. A dish in no plate: an option of a part of its kind already there; else its own plate when it is a whole meal (any
 *  dish at breakfast, a tiffin or a snack; a one-dish meal at lunch or dinner), or the meal's staples with it (rajma twice a
 *  week is rice and rajma); a dish they have every day goes on every plate. A plate's share is the family's how-often words on
 *  its own (not staple) dish. Pure. */
export function buildMeal(meal: string, dishes: MealDish[], seeds: string[][], links: MealLink[] = [], opts: { box?: boolean } = {}): MealShape {
  const dropped: string[] = [];
  const byKey = new Map(dishes.map((d) => [dishKey(d.name), d]));
  const used = new Set<string>();
  const drafts: Draft[] = [];
  const add = (t: Draft) => {
    if (!t.parts.length) return;
    const had = drafts.find((x) => draftKey(x) === draftKey(t));
    if (!had) { drafts.push(t); return; }
    // The same plate again: its words join the matching parts' ("beans poriyal or carrot poriyal").
    const free = [...had.parts];
    for (const p of t.parts) {
      const i = free.findIndex((x) => partKey(x.part) === partKey(p.part));
      if (i >= 0) { free[i].words = uniq([...free[i].words, ...p.words]); free.splice(i, 1); }
    }
    had.defining.push(...t.defining.filter((d) => !had.defining.includes(d)));
  };
  // The family's words go on the dish's part; a combination's rice part has none of its own ("curd rice" is said once).
  const partsFor = (d: MealDish): PlatePart[] => partsOf(d, meal).map((part, i, all) =>
    ({ part, words: all.length > 1 && "kind" in part && isStaple(part.kind) && i < all.length - 1 ? [] : [d.place?.word ?? d.name.toLowerCase()], dish: d }));
  const defines = (d: MealDish): boolean => !d.place?.kind || !!d.place.parts || d.place.own || !isStaple(d.place.kind);

  for (const row of seeds) {
    const t: Draft = { parts: [], defining: [] };
    for (const name of row) {
      const d = byKey.get(dishKey(name)) ?? { name, place: null, frequency: null, days: null, said: null };
      used.add(dishKey(name));
      const ps = partsFor(d);
      // A plate has one of each staple: "rice, rasam rice" is one rice, "phulka or chapati" one roti.
      for (const p of ps) {
        const had = "kind" in p.part && isStaple(p.part.kind) ? t.parts.find((x) => partKey(x.part) === partKey(p.part)) : null;
        if (had) { if (!d.place?.parts) had.words = uniq([...had.words, ...p.words]); } else t.parts.push(p);
      }
      if (defines(d) && !isDaily(d)) t.defining.push(d);
    }
    // Two parts of one kind from named dishes of different sub-kinds keep their sub-kinds (sambar and rasam, decided 17).
    const bare = new Map<string, PlatePart[]>();
    for (const p of t.parts) if ("kind" in p.part && !p.part.sub && p.dish?.place?.sub && manySubs(p.part.kind)) bare.set(norm(p.part.kind), [...(bare.get(norm(p.part.kind)) ?? []), p]);
    for (const ps of bare.values()) if (ps.length > 1 && new Set(ps.map((p) => p.dish!.place!.sub)).size === ps.length)
      for (const p of ps) p.part = { kind: (p.part as { kind: string }).kind, sub: p.dish!.place!.sub! };
    add(t);
  }

  const rest = dishes.filter((d) => !used.has(dishKey(d.name)));
  const joined = new Set<string>();
  for (const d of rest.filter((x) => !isDaily(x))) {
    const ps = partsFor(d);
    // An option of every part of its kind already on a plate.
    const at = d.place?.parts ? [] : drafts.flatMap((t) => t.parts).filter((p) => fits(p.part, d));
    for (const p of at) p.words = uniq([...p.words, ...ps[0].words]);
    if (at.length) { joined.add(dishKey(d.name)); continue; }
    if (SMALL_MEALS.includes(meal) || wholePlate(d) || d.place?.parts) { add({ parts: ps, defining: [d] }); continue; }
    if (catalogKind(d.place!.kind!)?.part === "main" || !drafts.length) {
      const staples = drafts.find((t) => t.parts.some((p) => isBase(p.part)))?.parts
        .filter((p) => isBase(p.part)).map((p) => ({ ...p, words: p.words.slice(0, 1) })) ?? [];
      add({ parts: [...staples.filter((s) => !ps.some((p) => partKey(p.part) === partKey(s.part))), ...ps], defining: [d] });
      continue;
    }
    dropped.push(`${d.name}: a side in none of the family's plates, kept as their dish`);
  }
  for (const d of rest.filter(isDaily)) {
    if (drafts.some((t) => t.parts.some((p) => fits(p.part, d)))) { joined.add(dishKey(d.name)); continue; }
    if (!drafts.length) { add({ parts: partsFor(d), defining: [d] }); continue; }
    // Every day the same dish: fixed; a category word every day ("salad every day"): its kind, on every plate.
    const daily = d.place?.kind && d.place.named === "category" && !d.place.parts ? partsOf(d, meal)[0] : { items: [d.name] };
    for (const t of drafts) t.parts.push({ part: daily, words: [d.place?.word ?? d.name.toLowerCase()], dish: d });
  }

  // A plate of only sides and curries ("with coconut chutney and sambar", "kurma" told on its own) is no meal alone: its parts go
  // on the plates that have nothing beside their dish or bread yet ([Idli] → [Idli, Chutney, Sambar]; [Dosa], [Chapati] take the
  // kurma, [Rice, Rasam] does not). With no such plate: at breakfast, a tiffin or a snack onto every plate; at lunch or dinner
  // a curry gets the meal's rice or bread. An egg dish at breakfast is a whole breakfast.
  const small = SMALL_MEALS.includes(meal);
  const isSide = (p: PlatePart): boolean => {
    // A part they have every day (salad every day) is on every plate: it never makes a plate one of sides.
    if (!("kind" in p.part) || p.dish?.place?.own || isStaple(p.part.kind) || (p.dish && isDaily(p.dish))) return false;
    const part = catalogKind(p.part.kind)?.part;
    return part === "side" || (part === "main" && !(small && norm(p.part.kind) === "egg"));
  };
  const sideOnly = drafts.filter((t) => t.parts.length && t.parts.every(isSide));
  if (sideOnly.length && sideOnly.length < drafts.length) {
    const plates = drafts.filter((t) => !sideOnly.includes(t));
    const bare = plates.filter((t) => t.parts.every((p) => !isSide(p)));
    const onto = bare.length ? bare : small ? plates : [];
    // At lunch or dinner each bare plate goes with each plate of sides as its own way of making the meal ("bhakri or poli
    // with usal or pithla": four plates), never every curry on one plate.
    if (!small && bare.length) {
      const was = [...drafts];
      drafts.length = 0;
      for (const b of was) {
        if (sideOnly.includes(b)) continue;
        if (!bare.includes(b)) { add(b); continue; }
        for (const s of sideOnly) add({ parts: [...b.parts.map((p) => ({ ...p, words: [...p.words] })), ...s.parts.filter((p) => !b.parts.some((x) => partKey(x.part) === partKey(p.part))).map((p) => ({ ...p, words: [...p.words] }))],
          defining: uniq([...b.defining, ...s.defining]) });
      }
    } else for (const s of sideOnly) {
      if (onto.length) {
        for (const t of onto) for (const p of s.parts) if (!t.parts.some((x) => partKey(x.part) === partKey(p.part))) t.parts.push({ ...p, words: [...p.words] });
      } else {
        const base = plates.flatMap((t) => t.parts).find((p) => isBase(p.part));
        if (base && !s.parts.some((p) => partKey(p.part) === partKey(base.part))) s.parts.unshift({ ...base, words: base.words.slice(0, 1) });
        continue;
      }
      drafts.splice(drafts.indexOf(s), 1);
    }
  }

  // At lunch or dinner a plate of only a bread or rice ("chapati" told on its own) is no meal: where another plate has that
  // bread with something, the bare one goes (eval h2: "Wed dinner: only Chapati").
  if (!small) for (const t of [...drafts]) {
    if (!t.parts.length || !t.parts.every((p) => isBase(p.part))) continue;
    if (drafts.some((x) => x !== t && x.parts.some((p) => !isBase(p.part)) && t.parts.every((p) => x.parts.some((q) => partKey(q.part) === partKey(p.part))))) drafts.splice(drafts.indexOf(t), 1);
  }

  // What the stored shape refuses is dropped, never the whole meal (checkMealShape: the slot store checks again). Each kind part
  // carries the family's words for it (§5.1), the words said for it joined ("beans poriyal or carrot poriyal").
  // A box's filling variant (a plate that is only their own dish of a kind its other plates have: "Egg paratha roll" beside
  // the plain paratha roll) is that fixed dish, never a rotating part of the kind.
  if (opts.box) for (const t of drafts) {
    if (t.parts.length !== 1) continue;
    const p = t.parts[0].part;
    if (!isKindPart(p) || !p.dish || catalogItem(p.dish)) continue;
    if (drafts.some((o) => o !== t && o.parts.some((x) => isKindPart(x.part) && norm(x.part.kind) === norm(p.kind) && dishKey(x.part.dish ?? "") !== dishKey(p.dish!))))
      t.parts[0] = { ...t.parts[0], part: { items: [p.dish] } };
  }
  const templates: MealTemplate[] = [], words: { words: string[][]; share: Frequency | null; days: Weekday[] | null }[] = [];
  let onParts = new Set<string>(joined);
  for (const t of drafts) {
    const parts = t.parts.filter((p) => { const e = checkMealShape([{ parts: [p.part] }], { slot: meal, slots: [] }); if (e.length) dropped.push(...e); return !e.length; });
    if (!parts.length) continue;
    for (const p of parts) if (p.dish) onParts.add(dishKey(p.dish.name));
    const often = t.defining.find((d) => d.frequency && !isDaily(d)), pinned = t.defining.find((d) => d.days?.length);
    const share = often?.frequency ?? null;
    const said = (often ?? pinned)?.said ?? null;
    const days = share ? null : pinned?.days ?? null;
    templates.push({ parts: parts.map((p) => withWords(p.part, p.words)), share, said, ...(days ? { days } : {}) });
    words.push({ words: parts.map((p) => p.words), share, days });
  }
  // A box's links (§5.4): the whole plate of another meal is the slot's one template; a kind of another meal joins every plate
  // that is made of kinds (a fixed dish alone, the egg roll, takes none), or is a plate of its own when there is none.
  const whole = links.find((l) => !l.kind);
  if (whole) {
    templates.length = 0; words.length = 0; onParts = new Set();
    templates.push({ parts: [{ from: whole.from }], share: null, said: null });
    words.push({ words: [[`the ${mealWord(whole.from)} as the family has it`]], share: null, days: null });
  } else for (const l of links) {
    const part: LinkedPart = { from: l.from, kind: l.kind!, ...(l.sub ? { sub: l.sub } : {}) };
    const said = [`the ${mealWord(l.from)} ${l.words || l.kind!.toLowerCase()}`];
    const onto = templates.map((t, i) => [t, i] as const).filter(([t]) => t.parts.some((p) => isKindPart(p)));
    if (!onto.length) { templates.push({ parts: [part], share: null, said: null }); words.push({ words: [said], share: null, days: null }); continue; }
    for (const [t, i] of onto) if (!t.parts.some((p) => isLinkedPart(p) && norm(p.from) === norm(l.from) && norm(p.kind ?? "") === norm(l.kind!))) {
      t.parts.push(part); words[i].words.push(said);
    }
  }
  const line = words.map((w) => `${andWords(w.words.filter((ws) => ws.length).map((ws) => ws.join(" or ")))}${w.share ? ` (${frequencyText(w.share)})` : w.days ? ` (${daysSaid(w.days)})` : ""}`).join("; or ");
  return { templates, line, dropped, onParts: [...onParts] };
}
/** A kind part with the family's words for it; a part with none (the rice of "curd rice") has no words. */
const withWords = (p: TemplatePart, ws: string[]): TemplatePart => {
  if (!isKindPart(p)) return p;
  const { words: _, ...rest } = p;
  return ws.length ? { ...rest, words: ws.join(" or ") } : rest;
};

// ── The family's cuisines (decided 7) ──

const BROAD = ["south", "north", "west", "east", "central", "northeast"];
/** A narrow cuisine's broad region: a Tamil kitchen is a South Indian one too. */
const REGION_OF: Record<string, string> = { tamil: "south", kerala: "south", karnataka: "south", andhra: "south", maharashtra: "west", gujarat: "west",
  goa: "west", parsi: "west", sindhi: "west", rajasthan: "north", punjab: "north", kashmir: "north", bengal: "east", odisha: "east", assam: "northeast" };
/** The words a family says its region or kitchen in, for each catalog cuisine. */
export const CUISINE_WORDS: Record<string, string[]> = { tamil: ["tamil", "tamilian"], kerala: ["kerala", "keralite", "malayali"], karnataka: ["karnataka", "kannadiga"],
  andhra: ["andhra", "telugu", "telangana"], maharashtra: ["maharashtrian", "marathi"], gujarat: ["gujarati"], goa: ["goan"], parsi: ["parsi"], sindhi: ["sindhi"],
  rajasthan: ["rajasthani", "marwari"], punjab: ["punjabi"], kashmir: ["kashmiri"], bengal: ["bengali"], odisha: ["odia", "oriya"], assam: ["assamese"],
  south: ["south indian"], north: ["north indian"] };
/** A cuisine in words, for the read-back. */
export const CUISINE_NAMES: Record<string, string> = { tamil: "Tamil", kerala: "Kerala", karnataka: "Karnataka", andhra: "Andhra", maharashtra: "Maharashtrian",
  gujarat: "Gujarati", goa: "Goan", parsi: "Parsi", sindhi: "Sindhi", rajasthan: "Rajasthani", punjab: "Punjabi", kashmir: "Kashmiri", bengal: "Bengali",
  odisha: "Odia", assam: "Assamese", northeast: "North-East Indian", south: "South Indian", north: "North Indian", west: "West Indian", east: "East Indian",
  central: "Central Indian", continental: "Continental", indo_chinese: "Indo-Chinese" };

/** The cuisines a placed dish tells of: its item's (else its sub-kind's, else its kind's) narrow cuisines with their regions, or
 *  the one broad region a list names alone (sambar is South Indian). A list of several broad regions (dal, roti) tells nothing,
 *  nor a sub-kind's or kind's that mixes regions and states (a wide family of dishes). */
export function cuisinesOfPlace(p: Pick<Place, "kind" | "sub" | "item" | "own">): string[] {
  if (!p.kind || p.own) return [];
  const k = catalogKind(p.kind);
  if (!k) return [];
  const it = p.item ? k.items.find((i) => norm(i.name) === norm(p.item!)) : null;
  const sb = p.sub ? k.subs.find((s) => norm(s.name) === norm(p.sub!)) : null;
  const fromItem = !!it?.cuisines?.length;
  const list = fromItem ? it!.cuisines! : sb?.cuisines.length ? sb.cuisines : k.cuisines;
  const narrow = list.filter((c) => !BROAD.includes(c));
  if (!narrow.length) return list.length === 1 ? [...list] : [];
  if (narrow.length < list.length && !fromItem) return [];
  return uniq([...narrow, ...narrow.flatMap((c) => (REGION_OF[c] ? [REGION_OF[c]] : []))]);
}
/** The family's cuisine profile: what their dishes tell, and the regions their own words name. Narrow ones first. */
export function cuisinesOf(places: Pick<Place, "kind" | "sub" | "item" | "own">[], lines: string[]): string[] {
  const out = new Set(places.flatMap(cuisinesOfPlace));
  for (const [c, ws] of Object.entries(CUISINE_WORDS)) if (ws.some((w) => namedIn(w, lines))) { out.add(c); if (REGION_OF[c]) out.add(REGION_OF[c]); }
  const order = Object.keys(CUISINE_NAMES);
  return [...out].sort((a, b) => (BROAD.includes(a) ? 1 : 0) - (BROAD.includes(b) ? 1 : 0) || order.indexOf(a) - order.indexOf(b));
}
/** The read-back's line for the cuisine profile, inviting a correction. */
export const kitchenLine = (cuisines: readonly string[]): string | null =>
  cuisines.length ? `Your kitchen: ${cuisines.map((c) => CUISINE_NAMES[c] ?? c).join(", ")}. Tell me if that's not right.` : null;

/** The meals whose kinds are read now, and their dishes' places: code's, else what was read before, else asked of the kinds
 *  read (`asks`; until it answers, code's place as a dish, or none). */
export type KindsPlan = { slots: Slot[]; places: Map<string, Place | null>; asks: KindsAsk[]; cache: Record<string, Place>;
  /** All the family's dish names: the kinds read's context for a regional word. */ family?: string[] };
const placeKey = (slot: string, key: string) => `${slot.toLowerCase()}|${key}`;
const cacheKey = (meal: string, key: string) => `${meal}|${key}`;
const familyDishes = (db: Db, slot: string): LibraryDish[] => listLibrary(db, { slot }).filter((d) => d.origin !== "planner_suggested");

/** The family's region as their words tell it (decided 20): the regions they name, and the cuisines of each of their dishes
 *  (a dish named with a regional word by its vegetable's: "dondakaya" is a Telugu word, its catalog dishes Andhra ones). */
export function familyRegion(db: Db, lines: string[]): Region {
  const dishes: string[][] = [];
  for (const name of uniq(listLibrary(db).filter((d) => d.origin !== "planner_suggested").map((d) => norm(d.name)))) {
    if (regionalWordOf(name)) continue;
    const rin = regionalIn(name);
    if (!rin) { const p = codePlace(name); if (p) dishes.push(cuisinesOfPlace(p)); continue; }
    const bw = rin.base.split(" ").filter(Boolean);
    const items = bw.length ? CATALOG.kinds.flatMap((k) => k.items).filter((it) => [it.name, ...(it.aka ?? [])].some((w) => { const ws = norm(w).split(" "); return bw.every((x) => ws.includes(x)); })) : [];
    const cs = uniq(items.flatMap((it) => it.cuisines ?? []));
    if (items.length && items.every((it) => it.cuisines?.length)) dishes.push(cs);
  }
  return { said: cuisinesOf([], lines), dishes };
}

/** Every meal on a first setup; on a correction the meals whose dishes or example plates changed, a meal with a dish the new
 *  replies name (read again, not from before: "the khichdi is any khichdi"), and any meal not read so yet. */
export function planKinds(db: Db, opts: { first: boolean; ops: Pick<Ops, "library" | "removeLibrary" | "seed" | "rebuild">; read: Pick<SetupRead, "library">; cache: Record<string, Place>;
  fresh?: string[]; lines?: string[] }): KindsPlan {
  const region = familyRegion(db, opts.lines ?? []);
  const renamed = (name: string) => !opts.first && !!opts.fresh && namedIn(name, opts.fresh);
  const touched = new Set([...[...opts.ops.library, ...opts.ops.removeLibrary, ...opts.ops.seed].map((d) => d.slot), ...(opts.ops.rebuild ?? [])].map((x) => x.toLowerCase()));
  const slots = listSlots(db).filter((s) => opts.first || touched.has(s.name.toLowerCase()) || s.templates === null
    || familyDishes(db, s.name).some((d) => renamed(d.name)));
  const places = new Map<string, Place | null>(), asks: KindsAsk[] = [];
  for (const slot of slots) {
    const meal = mealOf(slot);
    for (const d of familyDishes(db, slot.name)) {
      const quote = opts.read.library.find((x) => dishKey(x.name) === d.key && same(x.slot, slot.name))?.quote ?? "";
      const had = renamed(d.name) ? undefined : opts.cache[cacheKey(meal, d.key)];
      const word = quote ? wordOf(d.name, quote) : had?.word ?? wordOf(d.name);
      const code = codePlace(d.name, word, region);
      if (code && !needsNamed(code, meal)) places.set(placeKey(slot.name, d.key), code);
      else if (had) places.set(placeKey(slot.name, d.key), { ...had, word });
      else {
        // A word alone is a dish (decided 19) until the read says otherwise.
        places.set(placeKey(slot.name, d.key), code ? { ...code, named: "dish" } : null);
        if (!asks.some((a) => a.meal === meal && dishKey(a.name) === d.key)) asks.push({ name: d.name, meal, words: quote || d.name, ...(code ? { known: code } : {}) });
      }
    }
  }
  const family = uniq(listLibrary(db).filter((d) => d.origin !== "planner_suggested").map((d) => d.name));
  return { slots, places, asks, cache: opts.cache, family };
}

/** A catalog item's contents laid on a dish's row: the catalog answers its tags (what it does not list, the item does not have),
 *  the rest stay as read. Null when the dish is no catalog item. */
export function catalogContents(d: Pick<LibraryDish, "contains" | "contains_read">, item: string | null): { contains: string[]; contains_read: string[] } | null {
  const t = item ? plannerTags(item) : null;
  if (!t) return null;
  return { contains: uniq([...d.contains.filter((x) => !t.read.includes(x)), ...t.contains]), contains_read: uniq([...d.contains_read, ...t.read]) };
}

/** A category word's place: any dish of a kind or sub-kind, no one dish (§5.3). */
const isCategory = (p: Place | null): boolean => !!p?.kind && p.named === "category" && !p.item && !p.own && !isStaple(p.kind);

/** A box's link in kinds: the whole plate (null); else the kind the family's words name, as the linked meal's own parts say it
 *  ("sabzi" is the lunch's "dry sabji" part), else as the catalog names it; undefined when neither knows it. */
function linkKind(tx: Db, l: ReadLink): { kind: string; sub: string | null } | null | undefined {
  if (!l.words.trim()) return null;
  const from = listSlots(tx).find((s) => same(s.name, l.from));
  const w = plainWords(l.words);
  for (const t of from?.templates ?? []) for (const p of t.parts)
    if (isKindPart(p) && p.words && (wordsIn(plainWords(p.words), w) || wordsIn(w, plainWords(p.words)))) return { kind: p.kind, sub: p.sub ?? null };
  const m = matchDish(l.words);
  return m ? { kind: m.kind, sub: m.by === "kind" || !manySubs(m.kind) ? null : m.sub ?? null } : undefined;
}

/** Write the kinds read: each dish's kind, sub-kind and catalog item; each meal's kinds and templates (a shape the store refuses
 *  is logged and that meal left as it was, never the setup failed); the family's cuisines; what was read, kept for corrections.
 *  Gives each meal's line in the family's words, and the cuisines. */
export function writeKinds(tx: Db, plan: KindsPlan, placed: Map<string, Place>, opts: { lines: string[]; log: (l: string) => void; left?: KindsAsk[] }, by: string,
  changes: Change[]): { meals: Record<string, string>; changed: string[]; cuisines: string[]; asks: string[] } {
  const meals: Record<string, string> = {}, cache = { ...plan.cache }, changed: string[] = [], asks: string[] = [];
  const h0 = getHouse(tx);
  let state0: Partial<SetupState> = {};
  try { state0 = h0.setup_state ? JSON.parse(h0.setup_state) : {}; } catch { state0 = {}; }
  const categories: Record<string, MealDishRow[]> = { ...(state0.categories ?? {}) };
  for (const slot of plan.slots) {
    const meal = mealOf(slot), dishes: MealDish[] = [];
    for (const d of familyDishes(tx, slot.name)) {
      let place = placed.get(cacheKey(meal, d.key)) ?? plan.places.get(placeKey(slot.name, d.key)) ?? null;
      // A dish the kinds read's answers left out, twice, that code cannot place either (F4, D3e): its word may be a category
      // ("dry sabji"), so it is no dish on a plate and no library row (§5.1); the family is asked what it is.
      const left = !place && opts.left?.find((a) => a.meal === meal && dishKey(a.name) === d.key && !a.known);
      if (left) {
        opts.log(`kinds: ${slot.name}: ${d.name} not placed by the kinds read, asked`);
        removeLibrary(tx, d.name, d.slot, by, changes);
        const a = kindsAsk(wordOf(left.name, left.words), slot);
        if (!asks.includes(a)) asks.push(a);
        continue;
      }
      // Kept for a correction: a dish asked of the kinds read and not answered is asked again then.
      if (place && !plan.asks.some((a) => a.meal === meal && dishKey(a.name) === d.key && !placed.has(cacheKey(meal, d.key)))) cache[cacheKey(meal, d.key)] = place;
      let name = d.name;
      // A bare kind word is the dish the catalog decided for it (§5.1: "dosa" is Plain dosa), saved as their dish under that name.
      const bare = bareOf(name, place);
      const hit = bare ? catalogItem(bare) : null;
      const near = bare ? null : nearestDish({ name, place, frequency: d.frequency, days: d.days, said: d.said }, meal);
      if (bare && place) {
        opts.log(`kinds: ${slot.name}: ${d.name} is their ${bare}`);
        renameDish(tx, d.name, d.slot, bare, by, changes);
        name = bare; place = { ...place, item: hit?.item.name ?? null, sub: hit?.item.sub ?? place.sub };
        cache[cacheKey(meal, dishKey(name))] = place;
        const c = catalogContents(getLibraryDish(tx, name, d.slot) ?? d, place.item);
        if (c) upsertLibrary(tx, { name, slot: d.slot, ...c }, by, changes);
      } else if (near) {
        opts.log(`kinds: ${slot.name}: ${d.name} kept as ${near.name}`);
        renameDish(tx, d.name, d.slot, near.name, by, changes);
        name = near.name; place = near.place;
        cache[cacheKey(meal, dishKey(name))] = place;
        const c = catalogContents(getLibraryDish(tx, name, d.slot) ?? d, place.item);
        if (c) upsertLibrary(tx, { name, slot: d.slot, ...c }, by, changes);
      }
      if (dishes.some((x) => dishKey(x.name) === dishKey(name))) continue;   // their word and the dish both said: one dish
      upsertLibrary(tx, { name, slot: d.slot, kind: place?.kind ?? null, sub: place?.sub ?? null, catalog_item: place?.parts ? null : place?.item ?? null }, by, changes);
      dishes.push({ name, place, frequency: d.frequency, days: d.days, said: d.said });
    }
    // The meal's category words read before (a correction): not library rows, kept in the setup's memory with their places.
    for (const c of categories[slot.name] ?? []) if (!dishes.some((x) => dishKey(x.name) === dishKey(c.name)))
      dishes.push({ ...c, place: cache[cacheKey(meal, dishKey(c.name))] ?? null });
    // An example plate's dish that is neither a library row nor a kept category word was removed: it is no part of the plate.
    const seeds = seedSlotDays(tx).filter((s) => same(s.slot, slot.name)).map((s) => s.dishes.map((x) => x.dish).filter((n) => dishes.some((x) => dishKey(x.name) === dishKey(n))))
      .filter((r) => r.length);
    const links = (state0.links ?? []).filter((l) => same(l.slot, slot.name)).flatMap((l): MealLink[] => {
      const r = linkKind(tx, l);
      if (r === undefined) { opts.log(`kinds: ${slot.name}: the link to ${l.from} ("${l.words}") names no kind of it`); return []; }
      return [{ ...(r ?? { kind: null, sub: null }), from: l.from, words: l.words }];
    });
    const shape = dishes.length || links.length ? buildMeal(meal, dishes, seeds, links, { box: slot.kind === "custom" }) : { templates: [] as MealTemplate[], line: "", dropped: [] as string[], onParts: [] as string[] };
    for (const d of shape.dropped) opts.log(`kinds: ${slot.name}: ${d}`);
    if (!dishes.length && !links.length && slot.templates === null) continue;
    try {
      upsertSlot(tx, { name: slot.name, templates: shape.templates }, by, changes);
      meals[slot.name] = shape.line;
      if (JSON.stringify(slot.templates) !== JSON.stringify(shape.templates)) changed.push(slot.name);
      // A category word is never a library row (§5.3): once its words are on the meal's saved parts, its row goes; setup keeps
      // it to build the meal again on a correction.
      // One whose part was dropped or refused is logged and kept by setup, never left a library row (a bare category word on a plate).
      const cats = dishes.filter((x) => isCategory(x.place));
      for (const c of cats) if (!shape.onParts.includes(dishKey(c.name))) opts.log(`kinds: ${slot.name}: ${c.name} is on no part (a category word, kept by setup only)`);
      for (const c of cats) if (getLibraryDish(tx, c.name, slot.name)) removeLibrary(tx, c.name, slot.name, by, changes);
      if (cats.length) categories[slot.name] = cats.map(({ name, frequency, days, said }) => ({ name, frequency, days, said }));
      else delete categories[slot.name];
    }
    catch (e) { opts.log(`kinds: ${slot.name} not saved: ${(e as Error).message}`); }
  }
  const cuisines = cuisinesOf(listLibrary(tx).filter((d) => d.origin !== "planner_suggested")
    .map((d) => ({ kind: d.kind, sub: d.sub, item: d.catalog_item, own: false })), opts.lines);
  const h = getHouse(tx);
  let state: Partial<SetupState> = {};
  try { state = h.setup_state ? JSON.parse(h.setup_state) : {}; } catch { state = {}; }
  tx.update(house).set({ cuisines: JSON.stringify(cuisines), setup_state: JSON.stringify({ ...state, places: cache, meals: { ...state.meals, ...meals }, categories }),
    updated_at: new Date().toISOString(), updated_by: by }).where(eq(house.id, h.id)).run();
  changes.push(["house", h.id, "update", by]);
  return { meals, changed, cuisines, asks };
}

/** The read-back's question for a word the kinds read could not place (F4): one dish of theirs, or any of its kind. */
export const kindsAsk = (word: string, slot: Pick<Slot, "name" | "kind">): string =>
  `What do you mean by "${word}" at ${slot.kind === "main" ? slot.name.toLowerCase() : slot.name}: one dish you make (which one?), or a different one each time?`;

// ── apply_setup ──

/** One write through the app's own route: its answer, or its refusal's reason. */
type Post = (path: string, body: unknown) => Promise<{ ok: true; body: any } | { ok: false; reason: string }>;

export type SetupResult =
  | { ok: true; said: string; changed: string[]; noted: string[]; dropped: string[]; asks: string[]; read: SetupRead; correction: boolean;
      contains_read: number; contains_missing: number; model: string }
  | { ok: false; reason: string; say: string };

/** Read the setup and save it (or, when a setup is saved already, the correction the new replies make). Never refuses the
 *  whole: what does not fit is noted, what was not said is dropped. */
export async function applySetup(deps: { db: Db; emit: Emit; model: ModelCall; post: Post; household: unknown; transcript: string[]; by?: string;
  log?: (l: string) => void; budgetMs?: number }): Promise<SetupResult> {
  const log = deps.log ?? ((l: string) => console.log(`[planner] apply_setup: ${l}`));
  const by = deps.by ?? "app";
  const household = householdOf(deps.household);
  let n = 0;
  const numbered = deps.transcript.map((l) => (/^A\d*:/i.test(l) ? `A${++n}: ${l.replace(/^A\d*:\s*/i, "")}` : l));
  const user = JSON.stringify({ household: deps.household ?? {}, transcript: numbered.join("\n") });
  const t0 = Date.now(), until = t0 + (deps.budgetMs ?? SETUP_BUDGET_MS) - SAVE_MARGIN_MS;

  // 1. The four reads at once.
  const results = await Promise.all(SETUP_PARTS.map(async (part): Promise<ModelResult> => {
    const r = await askOnce(deps.model, { tier: part.tier, purpose: part.purpose, system: part.system, user, schema: part.schema, maxTokens: part.maxTokens }, until, log,
      (x) => (x.ok && part.id === "dishes" && !arr(isObject(x.json) ? x.json.library : null).length ? { ok: false, code: "invalid_output", message: "no dishes in the answer" } : x));
    log(`${part.id}: model ${r.ok ? `ok (${r.model})` : `${r.code}: ${r.message.slice(0, 300)}`} in ${Date.now() - t0} ms`);
    return r;
  }));
  const failed = SETUP_PARTS.map((part, i) => ({ part, r: results[i] })).filter((x) => x.part.need && !x.r.ok);
  if (failed.length) {
    const r = failed[0].r as Extract<ModelResult, { ok: false }>;
    return { ok: false, reason: r.code, say: "I couldn't save the setup just now. Tell me \"save my setup\" in a little while; nothing you told me is lost." };
  }
  const json = (i: number) => (results[i].ok ? (results[i] as Extract<ModelResult, { ok: true }>).json : null);
  const model = (results[0] as Extract<ModelResult, { ok: true }>).model;
  const read = readOf(json(0), json(1), json(2), json(3));
  const noted: string[] = [];


  // 2. The checks, and the lint's one re-read.
  const replies = repliesOf(deps.transcript);
  const said = familyLines(deps.transcript, deps.household);
  const sentences = familySentences(deps.transcript, deps.household);
  const checked = checkRead(read, { household, said, sentences });
  noted.push(...checked.noted);
  for (const d of checked.dropped) log(`dropped: ${d}`);
  await lintReread(deps.model, checked.lint, replies, until, log, { said: sentences, slotDays: checked.slotDays, dropped: checked.dropped, library: checked.read.library });

  // 3. The diff: a first setup takes all of it; a correction only what its new replies said.
  const saved = savedOf(deps.db);
  const first = !saved.state;
  const none: Saved = { slots: [], rules: [], library: [], seed: [], cook: null, state: null };
  const before = new Set(saved.state?.replies ?? []);
  const fresh = first ? said : replies.map(plainWords).filter((l) => l && !before.has(l));
  const ops = diffSetup(first ? none : saved, checked.read, fresh, first);
  // No dish read (the read failed, or found none in the replies): asked as a real question, never a quiet note (#29); make_plan
  // will not plan a meal it knows no dish for.
  if (!checked.read.library.length && !saved.library.length) checked.asks.push(DISHES_ASK);
  ops.state.asks = checked.asks;
  for (const d of ops.discarded) log(`not in the new replies, not changed: ${d}`);
  commit(deps.db, deps.emit, (tx, changes) => writeOps(tx, ops, { first, household, replies: replies.map(plainWords) }, by, changes));

  // 4. Kinds: the dishes of the meals read now placed in the catalog, code first; a catalog item's contents from the catalog, so
  // the contains read asks only what the catalog cannot say. Then the contains read and the kinds read (what code could not
  // place) at once.
  const before4 = savedOf(deps.db).state;
  const plan = planKinds(deps.db, { first, ops, read: checked.read, cache: before4?.places ?? {}, fresh, lines: said });
  commit(deps.db, deps.emit, (tx, changes) => {
    for (const slot of plan.slots) for (const d of familyDishes(tx, slot.name)) {
      const p = plan.places.get(placeKey(slot.name, d.key));
      const c = catalogContents(d, p && !p.parts ? p.item : null);
      if (c) upsertLibrary(tx, { name: d.name, slot: d.slot, ...c }, by, changes);
    }
  });
  const tags = uniq([...BASE_TAGS, ...listRules(deps.db).flatMap((r) => r.items ?? [])]);
  const lib = listLibrary(deps.db);
  const ask = new Map<string, { name: string; tags: Set<string> }>();
  for (const d of lib) {
    const missing = tags.filter((t) => !d.contains_read.includes(t));
    if (!missing.length) continue;
    const had = ask.get(d.key) ?? { name: d.name, tags: new Set<string>() };
    missing.forEach((t) => had.tags.add(t));
    ask.set(d.key, had);
  }
  const [contains, { placed, left }] = await Promise.all([ask.size ? containsRead(deps.model, ask, until, log) : new Map<string, Record<string, boolean>>(),
    kindsRead(deps.model, plan.asks, until, log, plan.family)]);
  commit(deps.db, deps.emit, (tx, changes) => {
    for (const d of lib) {
      const r = contains.get(d.key);
      if (!r) continue;
      const read = Object.keys(r);
      upsertLibrary(tx, { name: d.name, slot: d.slot, contains_read: uniq([...d.contains_read, ...read]),
        contains: uniq([...d.contains.filter((t) => r[t] !== false), ...read.filter((t) => r[t])]) }, by, changes);
    }
  });
  const after = listLibrary(deps.db);
  const missing = after.filter((d) => tags.some((t) => !d.contains_read.includes(t))).length;
  if (missing) log(`contains: ${missing} dishes not read for every tag (unknown: the plan fails closed on them)`);
  // Each meal's kinds and templates; on a correction, a meal whose plates now read differently, and the cuisines, are said.
  const cuisinesBefore = houseView(getHouse(deps.db)).cuisines ?? [];
  const kinds = commit(deps.db, deps.emit, (tx, changes) => writeKinds(tx, plan, placed, { lines: said, log, left }, by, changes));
  for (const a of kinds.asks) if (!checked.asks.includes(a)) checked.asks.push(a);
  if (!first) {
    for (const [slot, line] of Object.entries(kinds.meals)) if (line && (line !== before4?.meals?.[slot] || kinds.changed.includes(slot))) ops.changed.push(`${slot}: ${line}.`);
    if (kinds.cuisines.join() !== cuisinesBefore.join()) ops.changed.push(kitchenLine(kinds.cuisines) ?? "No kitchen of a region noted.");
  }

  // 5. Shopping apps and subscriptions, through their own routes.
  if (ops.apps) {
    const res = await deps.post("/api/family/shopping-apps", { ...ops.apps, connected: houseView(getHouse(deps.db)).connected_apps });
    if (!res.ok) noted.push(`shopping apps: not saved (${res.reason})`);
    else if (!first) ops.changed.push(`Groceries from ${APP_NAMES[ops.apps.main]}.`);
  } else if (first && read.apps.main) noted.push(`${read.apps.main}: not a shopping app the planner orders on`);
  for (const s of ops.subscriptions) {
    const res = await deps.post("/api/items/subscription", { item: s.item, source: s.source || "a subscription", active: true });
    if (!res.ok) noted.push(`${s.item} subscription: not saved (${res.reason})`);
    else if (!first) ops.changed.push(`${s.item} comes on subscription.`);
  }

  // A fast saved with nothing said of what they eat on it (run 28: "He fasts on Tuesdays"): the plan would leave that person
  // without food that day, so the read-back asks. Their answer comes back as a correction and fills the rule's fasting_food.
  for (const r of listRules(deps.db)) if (r.what === "fasting" && r.who && !r.fasting_food?.length) {
    const a = fastingAsk(r.who, r.days);
    if (!checked.asks.includes(a)) checked.asks.push(a);
  }
  // An allergy kept on one person: does the whole kitchen go without it, or only their food? Asked once per allergy; whatever
  // the answer, it is not asked again (it is in the transcript). "Everything" comes back as a house rule (houseAllergies).
  for (const r of listRules(deps.db)) if (r.who && isAllergyRule(r)) {
    const a = allergyAsk(r);
    if (!checked.asks.includes(a) && !answeredIn(a, deps.transcript)) checked.asks.push(a);
  }

  // 6. The read-back: the whole setup the first time; on a correction, only what changed.
  let text: string;
  if (first) text = readBack(deps.db, household, { noted, asks: checked.asks });
  else {
    const q = lunchQuestion(ops.state.lunch_unclear, household.weekly) ?? "Anything else to change?";
    text = [ops.changed.length ? ops.changed.join("\n") : "I didn't change anything from that.", ...noted, ...checked.asks, q].join("\n");
  }
  log(`${first ? "saved" : `correction: ${ops.changed.length} changes`} in ${Date.now() - t0} ms`);
  return { ok: true, said: text, changed: ops.changed, noted, dropped: checked.dropped, asks: checked.asks, read: checked.read, correction: !first,
    contains_read: after.length - missing, contains_missing: missing, model };
}

/** apply_setup { household, transcript }: answers { ok, said, changed, noted, dropped, asks, read } or { ok: false, reason, say }. */
export function mountSetupRoute(hono: Hono<any>, db: Db, emit: Emit, opts: { model: ModelCall; budgetMs?: number }) {
  const write = writeRoutes(hono);
  write("/api/family/setup", async (b, by, c) => {
    const transcript = transcriptLines(b.transcript);
    if (!transcript.length) refuse("transcript is required: the planner's questions and the family's replies, word for word, as Q: / A: lines");
    // A setup is read from the family's own replies (owner 24 Nov, #29: an agent sent one line of its own, "Ankita is the only
    // person eating at home", and the setup saved with no dishes). No reply, nothing to read: refused, never saved empty.
    if (!transcript.some((l) => /^A\d*:/i.test(l))) refuse("transcript has no family replies: send the planner's questions and the family's replies word for word, as Q: / A: lines (\"A: rice, sambar and a poriyal\"), never a summary");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const k of ["x-flock-agent", "x-flock-user"]) { const v = c.req.header(k); if (v) headers[k] = v; }
    const post: Post = async (path, body) => {
      const res = await hono.request(path, { method: "POST", headers, body: JSON.stringify(body) });
      const out = await res.json().catch(() => null) as any;
      return res.ok ? { ok: true, body: out } : { ok: false, reason: out?.reason ?? `refused (${res.status})` };
    };
    return { body: await applySetup({ db, emit, model: opts.model, post, household: b.household, transcript, by, budgetMs: opts.budgetMs }) };
  });
}
