import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";

import { SLOTS, AISLES } from "./constants";

export { SLOTS, AISLES };

export const recipes = sqliteTable("recipes", {
  ...kitColumns(),
  name: text("name").notNull(),
  ingredients: text("ingredients"),                           // one per line: "Rajma, 1 cup"
  method: text("method"),                                     // how the family makes it
  notes: text("notes"),
});

/** One row per dish; the rows on one date and slot are that meal (Monday lunch: Rice, Sambar, Bhindi fry as three rows) */
export const meals = sqliteTable("meals", {
  ...kitColumns(),
  date: text("date").notNull(),                               // ISO date
  slot: text("slot").notNull(),                               // Breakfast | Lunch | Dinner
  dish: text("dish").notNull(),                               // one dish, never a list: "Sambar", not "Rice, sambar"
  recipe_id: text("recipe_id").references(() => recipes.id),  // the recipe it was planned from, if any; metadata only (foreign keys are off): import $refs and Clear samples
});

export const groceries = sqliteTable("groceries", {
  ...kitColumns(),
  item: text("item").notNull(),
  aisle: text("aisle").default("Other"),                      // Vegetables | Dairy | Staples | Spices | Other
  done: integer("done", { mode: "boolean" }).default(false),   // bought
  for_dish: text("for_dish"),
});
