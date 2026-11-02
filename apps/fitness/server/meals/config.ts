/** Who a meal plan written through /api/meal-plan, or a planned meal eaten with one tap, is stored as. */
export const MEAL_PLAN_AUTHOR = "app:meal-plan";
/** The intent that wakes the coach to estimate and log a planned meal that has no numbers yet (flock.app.json agentInterface). */
export const ESTIMATE_INTENT = "log-planned-meal";
/** The least time between two wakes for the same planned meal: every wake is a model run. */
export const ESTIMATE_WAIT_MS = 3 * 60_000;
/** When a meal eaten on an earlier day is filed, by its slot. */
export const SLOT_TIMES: Record<string, string> = { Breakfast: "08:30", Lunch: "13:30", Snack: "17:00", Dinner: "20:30" };
