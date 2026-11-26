import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

// Meal Planner's tables (the slot model, docs/slot-model-spec.md §2). None shares a name with a 2.0 table (constants.ts OLD_TABLES): those stay beside these, untouched.
// Lists and small objects are JSON text; dates are "YYYY-MM-DD", times "HH:MM", a moment "YYYY-MM-DDTHH:MM", all local.

/** Who eats at home. */
export const people = sqliteTable("people", {
  ...kitColumns(),
  name: text("name").notNull(),
  relationship: text("relationship"),
  group: text("group"),                                        // child | adult | elder (constants.ts GROUPS)
  portions: text("portions"),                                  // in the family's words
  diet: text("diet"),
  allergies: text("allergies"),
  dislikes: text("dislikes"),
  targets: text("targets"),
  note: text("note"),
  active: integer("active").default(1),
});

/** The household itself: one row. The rules, the slots, the meals eaten out and the meal examples are their own tables now
 *  (rules, slots, slot_days); the cook's limits are cap / note rules on the cook's days. */
export const house = sqliteTable("house", {
  ...kitColumns(),
  cook_name: text("cook_name"),
  cook_days: text("cook_days"),                                // JSON weekday[]
  cook_arrival: text("cook_arrival"),                          // "HH:MM", or for a cook who comes more than once JSON [{ at: "HH:MM", meals?: string[] }]
  cook_makes_well: text("cook_makes_well"),
  cook_wont_make: text("cook_wont_make"),                      // what the cook does not make well or will not make
  cook_time_limit: text("cook_time_limit"),                    // the cook's time, in the family's words ("leaves early: a dish or two in the morning")
  cook_new_recipes: text("cook_new_recipes"),                  // open (new recipes from reels and the internet) | set_menu (familiar dishes)
  cook_note: text("cook_note"),
  notes: text("notes"),
  profile_to_structure: text("profile_to_structure"),          // the 2.0 household.profile, waiting to be turned into rows
  intro_sent_at: text("intro_sent_at"),
  afternoon_time: text("afternoon_time"),                      // "HH:MM": when the afternoon reminder really runs, written by that routine
  evening_time: text("evening_time"),                          // "HH:MM": the same for the evening reminder
  cuisines: text("cuisines"),                                  // JSON string[]: the family's cuisine profile (kinds.json cuisines), shown in the read-back; null = not read yet
  plan_time: text("plan_time"),                                // "HH:MM": the same for the weekly plan
  connected_apps: text("connected_apps"),                      // JSON GroceryApp[]: the shopping apps the family has signed in to (the main app only once it is)
  history_synced: text("history_synced"),                      // JSON { [app or "app:account"]: { [reader]: "YYYY-MM-DD" } }: how far each reader (a person's agent) read each app's order history, per shop account when named; a plain date is from before readers were kept apart
  regulars_moved_at: text("regulars_moved_at"),                // when the old everyday items (the retired regulars table's rows) became item cycles
  asks_confirmed: integer("asks_confirmed").default(0),
  asks_still_have: integer("asks_still_have").default(0),
  sync_session_id: text("sync_session_id"),                    // the session the last sync-cart ask started: the next one reuses it
  meaning_model_at: text("meaning_model_at"),                  // when migrateMeaning moved this house to the one meaning model (the migration's marker)
  setup_state: text("setup_state"),                            // JSON: what apply_setup read beside the rows (the replies it read, who of the family cooks, weekday lunch, open asks), for a correction's diff
});

/** A meal of the day the family plans: the main ones, a custom one (a child's tiffin, an evening snack) and an add-on to a main
 *  one for one person's different plate ("Papa's dinner": two phulkas, no rice). Spec slot-model §2.1. */
export const slots = sqliteTable("slots", {
  ...kitColumns(),
  name: text("name").notNull().unique(),                       // "Breakfast", "School tiffin", "Papa's dinner"
  kind: text("kind").notNull(),                                // main | custom | addon (constants.ts SLOT_KINDS)
  addon_of: text("addon_of"),                                  // an addon's main slot ("Dinner")
  usual_people: text("usual_people"),                          // JSON string[]: names; empty = everyone at home
  days: text("days"),                                          // JSON weekday[]; empty = every day
  skip_days: text("skip_days"),                                // JSON [{ day: weekday, skip: eaten_out | ordered_in }]: every week
  order: integer("order").notNull(),                           // planning order (constants.ts SLOT_ORDER)
  active: integer("active").default(1),
  extras: integer("extras").default(0),                        // 1: an add-on beside the main plate: its people stay counted and fed at the main meal
  kinds: text("kinds"),                                        // retired (one meaning model): nulled by migrateMeaning, never read; the kinds a meal has come from its templates (kinds.ts mealKinds)
  templates: text("templates"),                                // JSON MealTemplate[] (kinds.ts): the ways it is plated, [Roti, Sabzi]; null = not read yet
});

/** One slot on one date: who it is for and the dishes made. A setup seed example (the family's past week) has no date and is
 *  `confirmed`. A `planned` row is a suggestion the family was shown, never read as eaten. Unique (date, slot). */
export const slot_days = sqliteTable("slot_days", {
  ...kitColumns(),
  date: text("date"),                                          // YYYY-MM-DD; null = a seed example from the setup
  slot: text("slot").notNull(),                                // slots.name
  people: text("people"),                                      // JSON string[]: who it is for that day (computed, editable)
  guests: text("guests"),                                      // JSON [{ count, rules?: string[] }]: unnamed guests for this meal only
  occasion: text("occasion"),                                  // "dinner party", in their words
  new_dishes_allowed: integer("new_dishes_allowed"),           // this slot-day's own count, in place of the setting
  skip: text("skip"),                                          // eaten_out | ordered_in | null (constants.ts SKIPS)
  status: text("status").notNull().default("planned"),         // planned | confirmed (constants.ts SLOT_DAY_STATUSES)
  edited: integer("edited").default(0),                        // 1: the family changed it; a re-plan never overwrites it
  note: text("note"),
}, (t) => [uniqueIndex("slot_days_date_slot").on(t.date, t.slot)]);

/** The dishes made in a slot-day, in order. */
export const slot_dishes = sqliteTable("slot_dishes", {
  ...kitColumns(),
  slot_day_id: text("slot_day_id").notNull().references(() => slot_days.id),
  position: integer("position"),
  dish: text("dish").notNull(),                                // the dish's name (library key by dishKey)
  new: integer("new").default(0),                              // 1: a new suggestion of the planner's
  feedback_asked: integer("feedback_asked").default(0),        // 1: the next-day untried-dish question was sent for this placement; 2: the family answered it (record_feedback)
  note: text("note"),                                          // only when this dish needs a change for someone
  not_for: text("not_for"),                                    // JSON string[]: people at the slot-day a hard rule keeps it from (code's, never the model's); null/[] = everyone
  for_people: text("for_people"),                              // JSON string[]: a dish only for these people (a swap's item); null = the slot-day's people
});

/** What a planned dish needs bought, in the amount for this family. The SQL table is dish_ingredients: "ingredients" is a
 *  Meal Planner 2.0 table kept untouched on upgraded installs (constants.ts OLD_TABLES). */
export const ingredients = sqliteTable("dish_ingredients", {
  ...kitColumns(),
  slot_dish_id: text("slot_dish_id").notNull().references(() => slot_dishes.id),
  item: text("item").notNull(),
  amount: real("amount"),
  unit: text("unit"),
});

/** Retired: everyday items are now each item's own cycle (items.stated_amount, items.stated_days). Rows here are moved to items once (regulars.ts) and never read again; write none. */
export const regulars = sqliteTable("regulars", {
  ...kitColumns(),
  item: text("item").notNull(),
  amount: real("amount"),
  unit: text("unit"),
  every: text("every").notNull(),                              // day | week | weekdays (constants.ts EVERY)
  times_per_week: integer("times_per_week"),                   // for every = week
  weekdays: text("weekdays"),                                  // JSON weekday[], for every = weekdays
  for_whom: text("for_whom"),
  active: integer("active").default(1),
  paused_until: text("paused_until"),                          // a date: not needed up to and including it
});

/** What the family buys, one row per item: its group, the cycle the family stated (if any), what a purchase usually is and when it runs out (the cached estimate, from the whole house's purchases, else from the stated cycle). */
export const items = sqliteTable("items", {
  ...kitColumns(),
  item: text("item").notNull().unique(),                       // normalised
  name: text("name").notNull(),
  group: text("group"),                                        // constants.ts ITEM_GROUPS
  unit: text("unit"),                                          // g | ml | pc
  follows_plan: integer("follows_plan").default(0),
  subscription: text("subscription"),                          // the family's words, or null
  dont_ask: integer("dont_ask").default(0),
  snoozed_until: text("snoozed_until"),
  asks_unanswered: integer("asks_unanswered").default(0),
  last_ask_key: text("last_ask_key"),
  misses_in_row: integer("misses_in_row").default(0),
  wait_factor: real("wait_factor").default(1),
  stated_amount: real("stated_amount"),                        // what the family said they buy each time, in `unit` ("1 litre": 1000)
  stated_days: real("stated_days"),                            // and how often, in days ("every day": 1; "once a week": 7); used until the purchases show a cycle
  usual_amount: real("usual_amount"),                          // the cached derivation
  lasts_days: real("lasts_days"),
  product: text("product"),
  app: text("app"),
  last_bought: text("last_bought"),
  anchor_amount: real("anchor_amount"),
  run_out: text("run_out"),
  confident: integer("confident").default(0),
  image: text("image"),                                        // the product's picture from the shopping app (an order's item, else the first cart line that had one); never made up
});

/** What happened to an item: a purchase, an answer to a stock question, a question asked or one that went unanswered. */
export const item_events = sqliteTable("item_events", {
  ...kitColumns(),
  item_id: text("item_id").notNull().references(() => items.id),
  date: text("date").notNull(),
  kind: text("kind").notNull(),                                // constants.ts EVENT_KINDS
  tag: text("tag"),                                            // constants.ts EVENT_TAGS
  app: text("app"),                                            // a GroceryApp, or "outside"
  product: text("product"),
  product_id: text("product_id"),
  amount: real("amount"),                                      // base unit
  count: integer("count"),
  price: real("price"),
  days: real("days"),                                          // an answer's "enough for N days"
  cycle_days: real("cycle_days"),
  order_ref: text("order_ref"),
  order_id: text("order_id"),
  account: text("account"),                                    // the shop account an imported purchase was bought on, when named
  note: text("note"),
  void: integer("void").default(0),
});

/** One cart on a shopping app: the open one is being filled; the rest follow the order through ordering, placed and paid. */
export const orders = sqliteTable("orders", {
  ...kitColumns(),
  app: text("app").notNull(),                                  // constants.ts SHOP_APPS
  status: text("status").notNull(),                            // constants.ts ORDER_STATUSES
  total: real("total"),
  delivery_gap: real("delivery_gap"),                          // rupees short of free delivery
  synced_at: text("synced_at"),
  sync_state: text("sync_state"),                              // in_step | pending | building_at_order
  sync_asked_at: text("sync_asked_at"),
  outside_lines: text("outside_lines"),                        // JSON [{ name, qty }]: already in the cart on the app
  ordering_at: text("ordering_at"),
  reminder_key: text("reminder_key"),                          // "<date>:<which>": the reminder that ordered it without asking
  placed_at: text("placed_at"),
  paid_at: text("paid_at"),
  app_order_ref: text("app_order_ref"),
  unpaid_notice: text("unpaid_notice"),                        // pending | sent
  note: text("note"),
});

export const order_lines = sqliteTable("order_lines", {
  ...kitColumns(),
  order_id: text("order_id").notNull().references(() => orders.id),
  item_id: text("item_id").references(() => items.id),
  item: text("item").notNull(),
  qty: integer("qty"),                                         // packs; 0 = shown, not ordered
  product_id: text("product_id"),
  name_on_app: text("name_on_app"),
  pack: text("pack"),
  price: real("price"),
  image: text("image"),
  source: text("source").notNull(),                            // constants.ts LINE_SOURCES
  for_note: text("for_note"),                                  // the line under the name: "Tue lunch, you said it's missing"
  for_date: text("for_date"),
  rolled_from: text("rolled_from"),                            // the unpaid order this line moved here from
});

/** The product the family buys for an item on a grocery app, remembered once the agent has picked it. */
export const products = sqliteTable("products", {
  ...kitColumns(),
  item: text("item").notNull(),                                // normalised
  app: text("app").notNull(),
  product_id: text("product_id").notNull(),
  name_on_app: text("name_on_app").notNull(),
  pack: text("pack"),
  pack_amount: real("pack_amount"),
  pack_unit: text("pack_unit"),
  price: real("price"),
  image: text("image"),
});

/** The family's dishes, one row per dish and slot it is eaten at: how often, on which days, what it contains (for the rules),
 *  where it came from, whether the family has eaten it yet, and its video and how it went. Unique (key, slot). */
export const library = sqliteTable("library", {
  ...kitColumns(),
  key: text("key").notNull(),                                  // the dish's name, normalised (dishText.ts dishKey)
  slot: text("slot").notNull(),                                // slots.name: the slot it is eaten at
  name: text("name").notNull(),
  frequency: text("frequency"),                                // usually | sometimes | rarely | "<n>/week"; null = the default (2 days at most)
  days: text("days"),                                          // JSON weekday[]: only these days; null = any day
  said: text("said"),                                          // the family's own words for how often or which days ("rajma or chole twice a week"); null = none
  contains: text("contains"),                                  // JSON string[]: the tags it has (egg, meat, onion_garlic, white_rice, ...)
  contains_read: text("contains_read"),                        // JSON string[]: the tags read for it; a rule's tag not here is unknown
  origin: text("origin").notNull(),                            // setup_named | family_added | planner_suggested (constants.ts LIBRARY_ORIGINS)
  suggested: integer("suggested").default(0),                  // 1: a planner suggestion not yet kept: offered only as a new dish
  untried: integer("untried").default(0),                      // 1: the family hasn't eaten it yet
  offers: integer("offers").default(0),                        // times an untried dish was put on a plan; 2 with no "made it" drops it
  disliked: integer("disliked").default(0),                    // 1: made and not liked; never planned again
  prep: text("prep"),                                          // later: "soak overnight"
  video_url: text("video_url"),                                // a YouTube video, an Instagram reel or any page: the link only
  video_title: text("video_title"),
  video_thumbnail: text("video_thumbnail"),
  rating: text("rating"),                                      // the latest: constants.ts DISH_RATINGS
  rating_note: text("rating_note"),                            // what went well or didn't, in the family's words ("too oily")
  rated_on: text("rated_on"),                                  // the day it was eaten
  rated_by: text("rated_by"),                                  // who said it, by name
  ratings: text("ratings"),                                    // JSON [{ rating, note, date, by }], newest first, a short history
  kind: text("kind"),                                          // the kind it is a variant of (a catalog kind, or the slot's own kind); null = not mapped yet
  sub: text("sub"),                                            // its catalog sub-kind ("Poriyal/Thoran"); null for an own kind or not mapped
  catalog_item: text("catalog_item"),                          // the catalog item it is (kinds.json), whose contents it can take; null = a dish only this family makes
}, (t) => [uniqueIndex("library_key_slot").on(t.key, t.slot)]);

/** The family's food rules, one a row, each with the family's own words. Hard ones are always kept; soft ones (`frequency`)
 *  as often as said. Checked in code against each dish's `contains`. */
export const rules = sqliteTable("rules", {
  ...kitColumns(),
  hard: integer("hard").notNull(),                             // 1 hard (allergy, veg, avoid, fast, no sugar), 0 soft
  what: text("what").notNull(),                                // veg | egg | no_eggs | avoid | only | swap | require | fasting | cap | note (constants.ts RULE_WHATS)
  who: text("who"),                                            // a person; null = everyone at that slot-day
  slots: text("slots"),                                        // JSON string[]; null = every slot
  days: text("days"),                                          // JSON weekday[]; null = every day
  items: text("items"),                                        // JSON string[]: tags or categories ("white_rice", "@nuts")
  targets: text("targets"),                                    // JSON RuleTarget[] (targets.ts): what the rule is about, a kind, sub-kind, item or ingredient
  gives: text("gives"),                                        // JSON RuleTarget: what a swap gives instead
  to: text("to"),                                              // a swap's target ("millets")
  frequency: text("frequency"),                                // soft only: usually | sometimes | rarely | "<n>/week"
  per_meal: integer("per_meal"),                               // cap: dishes per meal
  fasting_food: text("fasting_food"),                          // JSON string[]: what a fast allows ("fruit"); empty = nothing
  quote: text("quote").notNull(),                              // the family's own words
});

export const saved_recipes = sqliteTable("saved_recipes", {
  ...kitColumns(),
  name: text("name").notNull(),
  links: text("links"),                                        // JSON string[]
  source: text("source"),
  thumbnail: text("thumbnail"),
  notes: text("notes"),
  ingredients: text("ingredients"),                            // JSON [{ item, amount, unit }]
  tags: text("tags"),                                          // JSON string[]
  for_people: text("for_people"),                              // JSON string[]
});
