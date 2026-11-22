import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

// Meal Planner 3.0's tables. None shares a name with a 2.0 table (constants.ts OLD_TABLES): those stay beside these, untouched.
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

/** The household itself: one row. */
export const house = sqliteTable("house", {
  ...kitColumns(),
  rules: text("rules"),                                        // JSON [{ kind: veg | egg | no_eggs | no_meat | fasting | no_onion_garlic | other, days: string[] (empty: every day), note? }]
  cook_name: text("cook_name"),
  cook_days: text("cook_days"),                                // JSON weekday[]
  cook_arrival: text("cook_arrival"),                          // "HH:MM", or for a cook who comes more than once JSON [{ at: "HH:MM", meals?: string[] }]
  cook_makes_well: text("cook_makes_well"),
  cook_wont_make: text("cook_wont_make"),                      // what the cook does not make well or will not make
  cook_time_limit: text("cook_time_limit"),                    // the cook's time, in the family's words ("leaves early: a dish or two in the morning")
  cook_new_recipes: text("cook_new_recipes"),                  // open (new recipes from reels and the internet) | set_menu (familiar dishes)
  cook_note: text("cook_note"),
  extra_slots: text("extra_slots"),                            // JSON [{ name, days?: string[], for?: string[] }]
  order_in: text("order_in"),                                  // JSON [{ day, slot, note? }]
  notes: text("notes"),
  profile_to_structure: text("profile_to_structure"),          // the 2.0 household.profile, waiting to be turned into rows
  intro_sent_at: text("intro_sent_at"),
  afternoon_time: text("afternoon_time"),                      // "HH:MM": when the afternoon reminder really runs, written by that routine
  evening_time: text("evening_time"),                          // "HH:MM": the same for the evening reminder
  plan_time: text("plan_time"),                                // "HH:MM": the same for the weekly plan
  cooking_days: text("cooking_days"),                          // JSON weekday[]; Mon to Sat until set
  connected_apps: text("connected_apps"),                      // JSON GroceryApp[]: the shopping apps the family has signed in to (the main app only once it is)
  history_synced: text("history_synced"),                      // JSON { [app or "app:account"]: { [reader]: "YYYY-MM-DD" } }: how far each reader (a person's agent) read each app's order history, per shop account when named; a plain date is from before readers were kept apart
  regulars_moved_at: text("regulars_moved_at"),                // when the old everyday items (the retired regulars table's rows) became item cycles
  asks_confirmed: integer("asks_confirmed").default(0),
  asks_still_have: integer("asks_still_have").default(0),
  sync_session_id: text("sync_session_id"),                    // the session the last sync-cart ask started: the next one reuses it
});

/** One meal of the plan: a date and a slot, made of dishes. */
export const plan_meals = sqliteTable("plan_meals", {
  ...kitColumns(),
  date: text("date").notNull(),
  slot: text("slot").notNull(),                                // Breakfast | Lunch | Dinner, or one of house.extra_slots
  ordered_in: integer("ordered_in").default(0),                // 1: food is ordered in, so no dishes and no ingredients
  note: text("note"),
  status: text("status").notNull(),                            // draft | final
});

export const dishes = sqliteTable("dishes", {
  ...kitColumns(),
  meal_id: text("meal_id").notNull().references(() => plan_meals.id),
  position: integer("position"),
  name: text("name").notNull(),
  for_people: text("for_people"),                              // JSON string[]; null = everyone
  portion_note: text("portion_note"),
  recipe_id: text("recipe_id").references(() => saved_recipes.id),
  video_url: text("video_url"),
});

/** What a dish needs bought, in the amount for this family. */
export const dish_items = sqliteTable("dish_items", {
  ...kitColumns(),
  dish_id: text("dish_id").notNull().references(() => dishes.id),
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

/** What the family knows about a dish, kept by its name across weeks: its video (a link, never a file) and how it went
 *  when they last ate it. A dish planned again shows both. */
export const dish_book = sqliteTable("dish_book", {
  ...kitColumns(),
  key: text("key").notNull().unique(),                         // the dish's name, normalised (dishText.ts dishKey)
  name: text("name").notNull(),
  video_url: text("video_url"),                                // a YouTube video, an Instagram reel or any page: the link only
  video_title: text("video_title"),
  video_thumbnail: text("video_thumbnail"),
  rating: text("rating"),                                      // the latest: constants.ts DISH_RATINGS
  rating_note: text("rating_note"),                            // what went well or didn't, in the family's words ("too oily")
  rated_on: text("rated_on"),                                  // the day it was eaten
  rated_by: text("rated_by"),                                  // who said it, by name
  ratings: text("ratings"),                                    // JSON [{ rating, note, date, by }], newest first, a short history
  slots: text("slots"),                                        // JSON string[]: the meals the family eats it at (their own dishes, from the interview); null = not one of theirs
  eaten_by: text("eaten_by"),                                  // JSON string[]: who eats it (names on the Family page); null = everyone
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
