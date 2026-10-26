// Plain constants, no imports: both the server and the browser pages read these.
export const KINDS = ["Meal", "Sale", "Alert", "Milestone", "Note"] as const;
/** A stored kind as one of KINDS whatever its case ("meal" → "Meal"); an unknown kind is kept as written. */
export const canonicalKind = (kind: string | null): string => KINDS.find((k) => k.toLowerCase() === kind?.trim().toLowerCase()) ?? kind ?? "Note";
/** The nutrition columns a meal event carries, summed per day for the food goals. */
export type MealField = "kcal" | "protein_g" | "fiber_g";
/** Personal Activity Intelligence (Zepp and others): the rolling 7-day exercise score. */
export const PAI_LABEL = "PAI";
/** PAI's own aim: keep it at 100 or above. */
export const PAI_GOAL = 100;
/** Labels shown first among the headline numbers, in this order, whatever else has readings. */
export const PINNED_LABELS: readonly string[] = [PAI_LABEL];
/** Water drunk in a day, added up from the water logs (one tap on the page logs a glass). */
export const WATER_LABEL = "Water";
/** The day's water target in litres until a "Water target" reading is set. */
export const WATER_GOAL_L = 3;
/** One tap on the page logs this much water. */
export const GLASS_ML = 250;
/** The app setting naming the goals the Today page shows ("in focus"); every other goal is still tracked, on the History page. */
export const FOCUS_SETTING = "focus";
/** The goals in focus until the coach changes the setting. */
/** A goal in focus that is not available (its tracker has no data) is left out, so the default is the same with or without one. */
export const DEFAULT_FOCUS: readonly string[] = ["Workout", PAI_LABEL, "Calories in", "Protein", "Fiber", "Water"];
/** Day totals that keep growing until the day ends: today's reading of one is a running total, not a finished day. */
export const RUNNING_TOTALS: readonly string[] = ["Steps", "Calories burned", "Distance", PAI_LABEL, "Calories in", "Protein", "Fiber", "Water"];
/** How a day's number should land against its target: stay under it (food) or reach it (activity, sleep). */
export type GoalAim = "under" | "reach";
/** What a goal is about: the Today page shows the goals in focus under these headings. */
export type GoalGroup = "exercise" | "diet" | "water" | "activity" | "sleep" | "body";
/** One line of the Today view: the day's number (`label`, a reading) against its target (`target`, a reading that holds until
 *  changed). `fromWorkouts` sums the minutes of the day's workout events instead of reading a `label` reading.
 *  `fromMeals` sums that column over the day's meal events, falling back to the `label` reading on a day no meal carries it.
 *  `fromWater` adds up the day's water logs, in litres. `defaultTarget` applies until a `target` reading is set.
 *  `requires`: the metrics only a tracker files; the goal is available once one of them has a reading (synced or entered by
 *  hand) in the last AVAILABILITY_DAYS days. A goal without it (food, water, workouts, weight, waist) is always available. */
export interface DailyGoal { label: string; target: string; unit: string; aim: GoalAim; group: GoalGroup; fromWorkouts?: true; fromMeals?: MealField; fromWater?: true; defaultTarget?: number; requires?: readonly string[] }
/** How recent a required metric's reading must be for its goal to be available. */
export const AVAILABILITY_DAYS = 7;
export const DAILY_GOALS: readonly DailyGoal[] = [
  { label: "Calories in", group: "diet", target: "Calorie target", unit: "kcal", aim: "under", fromMeals: "kcal" },
  { label: "Protein", group: "diet", target: "Protein target", unit: "g", aim: "reach", fromMeals: "protein_g" },
  { label: "Fiber", group: "diet", target: "Fiber target", unit: "g", aim: "reach", fromMeals: "fiber_g" },
  { label: WATER_LABEL, group: "water", target: "Water target", unit: "L", aim: "reach", fromWater: true, defaultTarget: WATER_GOAL_L },
  { label: "Steps", group: "activity", target: "Steps target", unit: "steps", aim: "reach", requires: ["Steps"] },
  { label: "Calories burned", group: "activity", target: "Calories burned target", unit: "kcal", aim: "reach", requires: ["Calories burned"] },
  { label: "Workout", group: "exercise", target: "Workout target", unit: "min", aim: "reach", fromWorkouts: true },
  { label: PAI_LABEL, group: "activity", target: "PAI target", unit: "PAI", aim: "reach", defaultTarget: PAI_GOAL, requires: [PAI_LABEL] },
  { label: "Sleep", group: "sleep", target: "Sleep target", unit: "hours", aim: "reach", requires: ["Sleep"] },
  { label: "Weight", group: "body", target: "Weight target", unit: "kg", aim: "under" },
  { label: "Waist", group: "body", target: "Waist target", unit: "cm", aim: "under" },
];
/** A meal's slot, from the start of its title ("Lunch: dal, rice") or a planned meal's own slot. */
export const MEAL_SLOT = /^(breakfast|lunch|dinner|snacks?)\b/i;
/** How a workout event's title starts: the Zepp sync's "Workout · 12 min · …", and the coach's "Workout: Elliptical · 20 min". */
export const WORKOUT_TITLE = /^workout\b/i;
/** The minutes in a workout title: "… · 12 min · …". The Today view adds these up. */
export const WORKOUT_MINUTES = /(\d+)\s*min\b/;
