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
  rules: text("rules"),                                        // JSON [{ kind: veg | egg | fasting | no_onion_garlic | other, days: string[], note? }]
  cook_name: text("cook_name"),
  cook_days: text("cook_days"),                                // JSON weekday[]
  cook_arrival: text("cook_arrival"),                          // "HH:MM"
  cook_makes_well: text("cook_makes_well"),
  cook_note: text("cook_note"),
  extra_slots: text("extra_slots"),                            // JSON [{ name, days?: string[], for?: string[] }]
  order_in: text("order_in"),                                  // JSON [{ day, slot, note? }]
  notes: text("notes"),
  profile_to_structure: text("profile_to_structure"),          // the 2.0 household.profile, waiting to be turned into rows
  intro_sent_at: text("intro_sent_at"),
  dinner_check_time: text("dinner_check_time"),                // "HH:MM": when the dinner check-in really runs, written by that routine
  tomorrow_check_time: text("tomorrow_check_time"),            // "HH:MM": the same for the tomorrow check-in
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
  keeps: text("keeps").default("fresh"),                       // fresh | long (constants.ts KEEPS)
});

/** Everyday items no dish asks for (milk, bread, fruit). */
export const regulars = sqliteTable("regulars", {
  ...kitColumns(),
  item: text("item").notNull(),
  amount: real("amount"),
  unit: text("unit"),
  every: text("every").notNull(),                              // day | week | weekdays (constants.ts EVERY)
  times_per_week: integer("times_per_week"),                   // for every = week
  weekdays: text("weekdays"),                                  // JSON weekday[], for every = weekdays
  for_whom: text("for_whom"),
  keeps: text("keeps").default("fresh"),
  active: integer("active").default(1),
  paused_until: text("paused_until"),                          // a date: not needed up to and including it
});

/** One grocery order: what is bought for the days it covers. */
export const orders = sqliteTable("orders", {
  ...kitColumns(),
  place_at: text("place_at").notNull(),                        // "YYYY-MM-DDTHH:MM"
  covers_from: text("covers_from").notNull(),
  covers_to: text("covers_to").notNull(),
  week_start: text("week_start"),
  app: text("app").notNull(),                                  // constants.ts GROCERY_APPS
  status: text("status").notNull(),                            // constants.ts ORDER_STATUSES
  total: real("total"),
  placed_at: text("placed_at"),
  paid_at: text("paid_at"),
  app_order_ref: text("app_order_ref"),
  wake_sent_at: text("wake_sent_at"),                          // the agent was woken to place it
  skipped_items: text("skipped_items"),                        // JSON string[]: items the family said they have
  note: text("note"),
});

export const order_lines = sqliteTable("order_lines", {
  ...kitColumns(),
  order_id: text("order_id").notNull().references(() => orders.id),
  item: text("item").notNull(),
  amount: real("amount"),
  unit: text("unit"),
  qty: integer("qty"),                                         // packs
  qty_checked: integer("qty_checked").default(1),              // 0: the pack could not be worked out, the agent sets qty when placing
  product_id: text("product_id"),
  name_on_app: text("name_on_app"),
  pack: text("pack"),
  price: real("price"),
  image: text("image"),
  source: text("source").notNull(),                            // dish | regular | added
  sources: text("sources"),                                    // JSON [{ kind, id, label }]
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
