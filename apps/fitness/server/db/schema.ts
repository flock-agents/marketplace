import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";
import { NUTRIENT_KEYS, type NutrientKey } from "../nutrition/catalog";

/** One nullable column per nutrient of the full breakdown (server/nutrition/catalog.ts): estimated per meal, tracked for review. */
const nutrientColumns = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, real(k)])) as { [K in NutrientKey]: ReturnType<typeof real> };

/** One row per reading. A number on the page is the newest reading of its label; the trend is the readings over time. List sample readings of a label oldest first: they are spread over past weeks in the order given. */
export const metrics = sqliteTable("metrics", {
  ...kitColumns(),
  label: text("label").notNull(),
  value: real("value").notNull(),
  unit: text("unit"),                                // "%" shows as a percent, "min" as minutes, anything else as a number with its unit
});

export const events = sqliteTable("events", {
  ...kitColumns(),
  title: text("title").notNull(),
  at: text("at").notNull(),                          // ISO date or date-time
  kind: text("kind").default("Note"),                // Meal | Alert | Milestone | Note
  kcal: real("kcal"),                                // a meal's calories; the day's meals add up to Calories in
  protein_g: real("protein_g"),                      // a meal's protein in grams; the day's meals add up to Protein
  fiber_g: real("fiber_g"),                          // a meal's fiber in grams; the day's meals add up to Fiber
  ...nutrientColumns(),                              // a meal's full breakdown (carbs_g, iron_mg, ...): not on the page, kept for review
});

/** Today's prescribed workout, one row per exercise: what the coach set for the day, ticked off as it is done. */
export const plan_items = sqliteTable("plan_items", {
  ...kitColumns(),
  day: text("day").notNull(),                        // YYYY-MM-DD, local
  name: text("name").notNull(),                      // "Goblet squat"; a library exercise is linked by its name
  exercise: text("exercise"),                        // the library exercise's slug, when the coach names it; else matched by name
  dose: text("dose"),                                // "3x12", "3x10/side", "20 min"
  position: real("position").default(0),             // order within the day
  done: integer("done", { mode: "boolean" }).default(false),
});

/** Exercises the coach added to the library (the preloaded ones ship with the app): a moving picture is downloaded by the
 *  app into its data dir, never into the code, so the app stays an untouched copy that keeps updating. */
export const exercises = sqliteTable("exercises", {
  ...kitColumns(),
  slug: text("slug").notNull(),                      // "cable-face-pull": from the name, one row per slug
  name: text("name").notNull(),                      // "Cable face pull"
  notes: text("notes"),                              // muscles worked, cues, what to watch
  gif_url: text("gif_url"),                          // where the picture was found
  file: text("file"),                                // the downloaded picture in the data dir; null when none was found
  added_by: text("added_by"),                        // who added it: "agent:<id>" or "owner"
  added_at: text("added_at"),                        // ISO time it was added
});

/** The day's planned meals, one row per meal: what the coach planned, ticked off as it is eaten. */
export const meal_plan_items = sqliteTable("meal_plan_items", {
  ...kitColumns(),
  day: text("day").notNull(),                        // YYYY-MM-DD, local
  slot: text("slot"),                                // Breakfast | Lunch | Snack | Dinner; a logged meal of the same slot ticks it
  name: text("name").notNull(),                      // "Besan chilla + curd"
  kcal: real("kcal"),                                // expected calories
  protein_g: real("protein_g"),                      // expected protein in grams
  fiber_g: real("fiber_g"),                          // expected fiber in grams
  ...nutrientColumns(),                              // expected full breakdown, copied onto the meal when it is eaten
  position: real("position").default(0),             // order within the day
  done: integer("done", { mode: "boolean" }).default(false),
});

/** Water drunk, one row per glass (or bottle) logged: the day's rows add up to Water. */
export const water_logs = sqliteTable("water_logs", {
  ...kitColumns(),
  at: text("at").notNull(),                          // ISO date-time, local or UTC
  ml: real("ml").notNull(),                          // 250 for a glass
});

/** Today's running totals as each fresh Zepp sync saw them, one row per number per sync: the person's usual shape of a day
 *  (how much is usually done by 2 PM) is built from these. Written by the app, read by the pace check. */
export const pace_samples = sqliteTable("pace_samples", {
  ...kitColumns(),
  day: text("day").notNull(),                        // YYYY-MM-DD, local
  minute: integer("minute").notNull(),               // local minute of the day the sync ran, 0-1439
  label: text("label").notNull(),                    // Steps | Calories burned | Distance
  value: real("value").notNull(),                    // the running total Zepp had then
});

/** Each time the pace check woke the coach because the person was well behind their usual pace for the time of day. */
export const pace_nudges = sqliteTable("pace_nudges", {
  ...kitColumns(),
  day: text("day").notNull(),                        // YYYY-MM-DD, local
  at: text("at").notNull(),                          // ISO date-time of the wake
  labels: text("labels").notNull(),                  // the numbers behind, "Steps, Calories burned"
  message: text("message").notNull(),                // what the coach was told
});
