import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { SLOTS, AISLES, MEAL_STATUSES, COACH_CHECKS, BUY_CATEGORIES, GROCERY_SOURCES, GROCERY_STATUSES, CART_STATUSES } from "./constants";

export { SLOTS, AISLES, MEAL_STATUSES, COACH_CHECKS, BUY_CATEGORIES, GROCERY_SOURCES, GROCERY_STATUSES, CART_STATUSES };

/** The one canonical ingredient catalog: every recipe_ingredients and groceries row that means "onion" points at
 *  the SAME row here, however the dish or the shopping list happens to phrase it — never a near-duplicate entry
 *  per spelling. server/ingredients.ts matches/creates against this; a periodic check flags any near-duplicate
 *  that slips in anyway (e.g. two genuinely-different names for the same thing) for the agent to merge. */
export const ingredients = sqliteTable("ingredients", {
  ...kitColumns(),
  name: text("name").notNull(),
  default_unit: text("default_unit"),
  category: text("category"),                                 // dairy | vegetables | pantry | spices
  // Stock reconciliation (a staple-cadence-like idea, for a recipe-driven ingredient): the last actual purchase,
  // so the plan doesn't re-buy something a recipe mentions again while there's reasonably still some at home.
  // Set by the agent as part of an order's own bookkeeping (orderTimeWake's "LAST STEP"), same as a staple's own
  // last_ordered_at/last_checked_at.
  last_ordered_at: text("last_ordered_at"),
  last_ordered_qty: real("last_ordered_qty"),
  aliases: text("aliases"),                                    // JSON string[]: English/Hindi/regional names ("palak", "spinach")
  unit_conversions: text("unit_conversions"),                  // JSON { "pc": 150, "bunch": 250 }: grams (or ml) per unit
  shelf_life_days: integer("shelf_life_days"),                // in THIS home (weather, season, storage): the agent's informed guess, never asked
  shelf_life_source: text("shelf_life_source"),                // default (the seed table) | agent
  shelf_life_note: text("shelf_life_note"),                    // the agent's one-line reason ("Bengaluru, humid Oct, kept in fridge")
  prefs: text("prefs"),                                        // JSON ShoppingPrefs (server/quantity.ts); falls back to prefs.category_defaults
  notes: text("notes"),                                        // free-text preferences the agent reads
  level: text("level"),                                        // pantry rough level: plenty | low | out (null = not checked)
  last_checked_at: text("last_checked_at"),                    // ISO: the family last said how much is at home (server/stock.ts check cadence)
});

export const recipes = sqliteTable("recipes", {
  ...kitColumns(),
  name: text("name").notNull(),
  ingredients: text("ingredients"),                           // one per line: "Rajma, 1 cup"
  method: text("method"),                                     // how the family makes it
  notes: text("notes"),
  prep_steps: text("prep_steps"),                              // JSON [{step, hours_before_cook}], ordered; null = nothing to prep ahead
  prep_lead_hours: real("prep_lead_hours"),                    // the largest hours_before_cook, for display
  servings: integer("servings"),
  prep_min: integer("prep_min"),
  cook_min: integer("cook_min"),
  tags: text("tags"),                                          // JSON string[]
  cuisine: text("cuisine"),
  source_url: text("source_url"),
});

/** The structured ingredient list `ingredients` (freeform text) can't be computed from: one row per ingredient, in
 *  the quantity for ONE REGULAR ADULT PORTION. The grocery-generation logic reads this; `ingredients` stays the
 *  human-edited display copy. A freshly auto-created recipe stub (meals written with no matching recipe) has none
 *  of these yet — the agent fills them in (see recipe_ingredients_needed in server/recipeStubs.ts). */
export const recipe_ingredients = sqliteTable("recipe_ingredients", {
  ...kitColumns(),
  recipe_id: text("recipe_id").notNull().references(() => recipes.id),
  ingredient_id: text("ingredient_id").references(() => ingredients.id),   // the catalog entry this line means; server/ingredients.ts resolves it
  item: text("item").notNull(),
  qty: real("qty"),
  unit: text("unit"),
  category: text("category"),                                 // dairy | vegetables | pantry | spices: maps straight to a grocery row's own category
  qty_per_adult: real("qty_per_adult"),                        // v2 name for qty (one regular adult portion); the engine reads qty_per_adult ?? qty
  optional: integer("optional"),                               // 0/1: an optional line never generates a grocery need
  substitutes: text("substitutes"),                            // JSON string[] of ingredient ids
});

/** One row per dish; the rows on one date and slot are that meal (Monday lunch: Rice, Sambar, Bhindi fry as three rows) */
export const meals = sqliteTable("meals", {
  ...kitColumns(),
  date: text("date").notNull(),                               // ISO date
  slot: text("slot").notNull(),                               // Breakfast | Lunch | Dinner
  time: text("time"),                                          // "HH:MM"; null → the slot's default (cook.morning / cook.lunch / cook.evening)
  dish: text("dish").notNull(),                               // one dish, never a list: "Sambar", not "Rice, sambar"
  recipe_id: text("recipe_id").references(() => recipes.id),  // the recipe it was planned from, if any; metadata only (foreign keys are off): import $refs and Clear samples
  recipe_dish: text("recipe_dish"),                            // the dish text recipe_id was linked/confirmed for: a later dish edit re-links (recipeStubs.ts)
  // v3: recipe_id mirrors the FIRST of meal_recipes (the canonical set). note: free text the agent's review reads
  // ("leftovers from tonight", "only for the kids"). review: the agent's per-ingredient adjustments (JSON MealAdjustment[]),
  // valid only while review_for equals mealReviewKey(dish, note, recipes) (server/mealRecipes.ts).
  note: text("note"),
  review: text("review"),
  review_for: text("review_for"),
  status: text("status").notNull().default("planned"),        // planned | confirmed
  confirmed_by: text("confirmed_by"),
  confirmed_at: text("confirmed_at"),
  portions: text("portions"),                                  // JSON: { "<diner>": "2 roti, 100g paneer", … }
  coach_check: text("coach_check").notNull().default("pending"),  // pending | ok | flagged
  coach_notes: text("coach_notes"),
  // v3 (docs/V3-FLOW-SPEC.md): what became of the meal. null = still open. Set by the owner (app/chat), or inferred
  // (latest time passed → cooked; the agent heard "ordering in tonight" → skipped). A correction overwrites an inference.
  outcome: text("outcome"),                                    // cooked | skipped
  outcome_source: text("outcome_source"),                      // owner | inferred
  outcome_at: text("outcome_at"),                              // ISO: when it was cooked/skipped (or inferred to be)
});

/** v3: the recipes a meal is made of (one or more). The canonical link; meals.recipe_id mirrors the first. */
export const meal_recipes = sqliteTable("meal_recipes", {
  ...kitColumns(),
  meal_id: text("meal_id").notNull().references(() => meals.id),
  recipe_id: text("recipe_id").notNull().references(() => recipes.id),
  servings: real("servings").notNull().default(1),             // × the family's usual portion of this recipe
  position: integer("position").notNull().default(0),
});

/** The standing diet targets a coach set for each diner; read by the rolling-plan routine when it fills and checks meals. */
export const diners = sqliteTable("diners", {
  ...kitColumns(),
  name: text("name").notNull(),
  goal: text("goal"),                                          // "fat loss, high protein" | "weight gain, high fat and protein"
  kcal_target: real("kcal_target"),
  protein_g_target: real("protein_g_target"),
  fat_note: text("fat_note"),
  source: text("source"),                                      // the coach or app the numbers came from
});

/** A diner's typical portion of one regular adult serving, by meal slot — background data for the suggested-quantity
 *  calculation only (server/portions.ts); never shown in any settings, column or edit UI. Starts at 1.0 for
 *  everyone and is refined over time from grocery-order quantities vs. a recipe's per-adult amounts. */
export const diner_portions = sqliteTable("diner_portions", {
  ...kitColumns(),
  diner_id: text("diner_id").notNull().references(() => diners.id),
  slot: text("slot").notNull(),                                // Breakfast | Lunch | Dinner
  multiplier: real("multiplier").notNull().default(1),
});

/** Consumption that doesn't come from a planned dish at all — "2 glasses of milk daily for the kids", a protein
 *  shake a few times a week — but still draws down an ingredient the same way a meal would. Folded into the same
 *  quantity-suggestion and stock-reconciliation math as recipe-driven need (server/mealGroceries.ts), per diner.
 *  Like diner_portions, this is background data: no settings/edit UI of its own. */
export const standing_consumption = sqliteTable("standing_consumption", {
  ...kitColumns(),
  diner_id: text("diner_id").notNull().references(() => diners.id),
  ingredient_id: text("ingredient_id").notNull().references(() => ingredients.id),
  qty: real("qty").notNull(),                                  // per occurrence, e.g. 1 glass
  unit: text("unit"),
  times_per_week: real("times_per_week").notNull().default(7), // "daily" = 7; "a few times a week" ≈ 3
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Recurring items with a known cadence (milk) or a standing check (the pantry), bought without waiting on a meal. */
export const staples = sqliteTable("staples", {
  ...kitColumns(),
  item: text("item").notNull(),
  pack: text("pack"),
  category: text("category").notNull().default("pantry"),      // dairy | vegetables | pantry | spices
  every_min_days: real("every_min_days"),
  every_max_days: real("every_max_days"),
  max_days_ahead: real("max_days_ahead"),                      // how many days' worth one order may bundle
  usual_qty: text("usual_qty"),
  usual_price: real("usual_price"),
  last_ordered_at: text("last_ordered_at"),                    // ISO datetime
  last_checked_at: text("last_checked_at"),                    // ISO datetime; the pantry's own cadence
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  level: text("level"),                                        // pantry rough level: plenty | low | out (null = not checked)
});

/** One order on the shopping timeline: a group of grocery rows bought together, one yes, one set of fees. */
export const carts = sqliteTable("carts", {
  ...kitColumns(),
  buy_at: text("buy_at").notNull(),                            // ISO datetime this order is placed
  categories: text("categories"),                              // JSON list: ["dairy","vegetables"]
  status: text("status").notNull().default("draft"),           // draft | ordered | let_go (CART_STATUSES)
  checkin_sent_at: text("checkin_sent_at"),
  owner_notes: text("owner_notes"),                             // what the owner said at the check-in (add/drop, a service preference)
  estimate: real("estimate"),                                   // from usual prices, before a cart is built
  chosen_service: text("chosen_service"),
  items_total: real("items_total"),
  fees: text("fees"),                                           // JSON: {delivery, handling, platform, small_cart, surge, …}
  grand_total: real("grand_total"),
  quotes: text("quotes"),                                       // JSON Quote[] (server/quotes.ts): {service, total, fees?, lines?, screenshot_url?, at, lines_key}, one per service
  delivery_eta: text("delivery_eta"),                           // set only for an actual scheduled slot (e.g. "7 AM Thu"); null for an ordinary quick-commerce ETA
  confirmed_by: text("confirmed_by"),
  order_ref: text("order_ref"),
  ordered_at: text("ordered_at"),
  order_at: text("order_at"),                                   // local "YYYY-MM-DDTHH:MM": the order window start this cart is planned for
  prepare_at: text("prepare_at"),                               // v2 only (unused since v3); kept for existing rows
  snapshot: text("snapshot"),                                   // JSON CartSnapshot {service, lines[], fees, total, screenshot_url?} (server/shopping.ts)
  build_requested_at: text("build_requested_at"),                 // ISO: when the agent was last woken to build this cart (one wake per build)
  // v3 draft lifecycle (server/draft.ts)
  yes_at: text("yes_at"),                                       // ISO: a family member's explicit yes (confirmed_by says who); the draft is frozen from then
  moved_at: text("moved_at"),                                   // ISO: the owner moved this window (order_at); the timeline no longer re-plans it
  let_go_at: text("let_go_at"),                                 // ISO: when the draft was let go (no yes in time, or the owner's "Let it go")
});

export const groceries = sqliteTable("groceries", {
  ...kitColumns(),
  item: text("item").notNull(),
  aisle: text("aisle").default("Other"),                      // Vegetables | Dairy | Staples | Spices | Other
  done: integer("done", { mode: "boolean" }).default(false),   // bought
  for_dish: text("for_dish"),
  category: text("category"),                                  // dairy | vegetables | pantry | spices
  needed_by: text("needed_by"),                                 // ISO date: the earliest meal that uses it, or when a staple runs out
  buy_at: text("buy_at"),                                       // ISO datetime: when the timeline orders it (→ a carts row)
  qty: text("qty"),                                             // the REAL amount to buy — manual/staple rows set it directly; a meal-driven
                                                                 // row's qty starts null and is only ever set by the agent reviewing suggested_qty
                                                                 // (real packs come in fixed sizes a formula can't know), or by the owner by hand.
                                                                 // Once set, it's explicit: nothing here silently recomputes over it.
  suggested_qty: text("suggested_qty"),                         // the computed draft (recipe_ingredients × diner_portions, scaled) — a hint, never
                                                                 // written to qty automatically; null once qty is set (nothing left to review).
  ingredient_id: text("ingredient_id").references(() => ingredients.id),   // null for a manual/staple row — that's fine, nothing requires it
  source: text("source").default("manual"),                    // meal | staple | manual
  added_by: text("added_by"),                                   // who added it by hand
  status: text("status").default("pending"),                   // pending | confirmed | ordered | skipped | have_stock
  service: text("service"),                                     // the service it was (or usually is) ordered from
  price: real("price"),
  cart_id: text("cart_id").references(() => carts.id),
  in_stock_until: text("in_stock_until"),                        // ISO date: already have it: skip the timeline until this date passes
  meal_id: text("meal_id").references(() => meals.id),          // the meal this need is for; null for staple/manual rows
  qty_min: real("qty_min"),                                      // the engine's rough range (server/quantity.ts), in qty_unit
  qty_max: real("qty_max"),
  qty_unit: text("qty_unit"),                                    // g | ml | pc
});

/** Dedupes prep-reminders: one row per step actually sent, so a 30-minute tick never rings the same step twice. Server-only. */
export const prep_reminders = sqliteTable("prep_reminders", {
  ...kitColumns(),
  meal_id: text("meal_id").notNull().references(() => meals.id),
  step: text("step").notNull(),
  remind_at: text("remind_at").notNull(),
  sent_at: text("sent_at"),
});

/** Household-wide shopping preferences: a single row, id "household". */
export const shopping_prefs = sqliteTable("shopping_prefs", {
  ...kitColumns(),
  order_windows: text("order_windows"),                          // JSON OrderWindow[] (server/orderPatterns.ts): {days, from, to, source: learned|pinned, confidence, sample_count}
  patterns_computed_at: text("patterns_computed_at"),            // ISO: when the learned windows were last recomputed
  delivery_lead_min: text("delivery_lead_min"),                  // JSON { <service>: minutes }
  min_order: text("min_order"),                                  // JSON { <service>: ₹ }
  combine_orders: integer("combine_orders"),
  approver: text("approver"),
  payer: text("payer"),
  notes: text("notes"),
});

/** v3: what the household has at home. One row per bought (or "already have it") lot; prepared meals draw it down. */
export const stock = sqliteTable("stock", {
  ...kitColumns(),
  ingredient_id: text("ingredient_id").references(() => ingredients.id),
  item: text("item").notNull(),
  qty: real("qty"),                                             // remaining, in unit
  unit: text("unit"),                                           // g | ml | pc
  bought_at: text("bought_at"),                                 // ISO
  use_by: text("use_by"),                                       // ISO date: shelf_life_days, an agent guess, or the category default
  source: text("source").notNull(),                             // order | owner | inferred
  cart_id: text("cart_id").references(() => carts.id),
});

/** v3: a judgement the app asks the agent for, in the background (email-desk pattern). */
export const agent_jobs = sqliteTable("agent_jobs", {
  ...kitColumns(),
  kind: text("kind").notNull(),                                 // AGENT_JOB_KINDS
  subject: text("subject"),                                     // what it is about (a meal id, a cart id), for dedupe
  facts: text("facts").notNull(),                               // JSON snapshot the agent needs
  status: text("status").notNull().default("open"),             // open | answered | expired | fallback
  answer: text("answer"),                                       // JSON, validated before use
  asked_at: text("asked_at"),                                   // ISO: when the agent was last woken for it
  answered_at: text("answered_at"),
  expires_at: text("expires_at").notNull(),
});

/** v3: every owner choice and every inference, raw. The agent's find_patterns job reads it; the app never interprets it. */
export const choice_log = sqliteTable("choice_log", {
  ...kitColumns(),
  kind: text("kind").notNull(),                                 // CHOICE_KINDS
  subject: text("subject"),                                     // ingredient id, meal id, service, cart id …
  detail: text("detail"),                                       // JSON: the context of the choice
  source: text("source").notNull(),                             // owner | inferred | auto (an applied pattern)
  at: text("at").notNull(),                                     // ISO
});

/** v3: patterns the agent found, stored and applied by the app as-is. */
export const learned_prefs = sqliteTable("learned_prefs", {
  ...kitColumns(),
  kind: text("kind").notNull(),                                 // LEARNED_PREF_KINDS
  subject: text("subject"),
  summary: text("summary").notNull(),                           // one line the owner reads in "What I've learned"
  rule: text("rule").notNull(),                                 // JSON the app applies deterministically
  confidence: real("confidence"),                               // 0..1, the agent's own
  evidence: text("evidence"),                                   // JSON choice_log ids
  auto_apply: integer("auto_apply", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  found_at: text("found_at").notNull(),
});

/** v3: messages the app asked the agent to send, per shopping window: enforces the ≤3-per-window budget. Server-only. */
export const message_log = sqliteTable("message_log", {
  ...kitColumns(),
  cart_id: text("cart_id").references(() => carts.id),
  slot: text("slot").notNull(),                                 // reminder | heads_up | price
  requested_at: text("requested_at").notNull(),
  sent_at: text("sent_at"),                                     // the agent's ack
});
