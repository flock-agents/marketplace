// The weekly run (Sunday 11:00): the agent is asked to plan next week and send the plan to the family. It plans only: nothing
// is bought or put on a cart here, the daily reminders do that. On an install carried over from Meal Planner 2.0 it is first asked to turn the family's old profile into people, rules, the cook
// and the slots (a week is planned only from a family the app knows), then to tell the family and plan the week in that
// same run, so an upgraded family is not left with an empty app until the next weekly run.
import { dayLabel, nextMonday, todayStr } from "../dates";
import { getHouse } from "../family";
import { profilePending } from "../gate";
import { weekContext } from "../meals";
import { fitsWake, wake, type RoutineCtx } from "./ctx";
import { recordTime, scheduleTime } from "./reminders";

const STRUCTURE_PROFILE = (weekStart: string): string => "Structure the family profile below with set_person / set_house_rules / set_cook / set_slots / set_item, "
  + "then clear it with set_house_rules { structured: true }. Keep the family's own words, and ask them about anything the profile leaves unclear. "
  + `No week is planned until it is cleared. Once it is, tell the family the app was rebuilt, and plan the week of ${dayLabel(weekStart)} (week_start ${weekStart}) as the weekly run does (call guide).`;

/** What the agent does on the weekly run, as the app's operations in the order they are called. Each day is kept final as it
 *  is sent, so a run cut short still leaves the days planned; the message and the intro come from the one closing call. */
export const WEEKLY_PROMPT = (weekStart: string): string => [
  `Plan the family's meals for the week of ${dayLabel(weekStart)} (week_start ${weekStart}) and send them the plan.`,
  `1. The context to plan from is in the data below when it has \`context\` (people, house rules with the cooking days, the cook, what the house buys often, last week's dishes, the recipe book); else plan_week { week_start: "${weekStart}", mode: "draft" } without meals answers with it, in full.`,
  "2. Plan from it: each person's diet, allergies, dislikes and portions; the house rules for that weekday (a rule without days holds every day); the cook's days and visits (cook_visits: when the cook comes and, when said, the meals each visit makes), what the cook makes well, never what the cook does not make (cook_wont_make), the cook's time (cook_time_limit: a cook who leaves early gets only a dish or two in the morning), and cook_new_recipes (set_menu: familiar dishes the cook knows; open: new dishes and saved recipes, with their video).",
  "3. Every slot on its days: Breakfast, Lunch, Dinner and each of house.extra_slots on its days for its people (a child's school tiffin, on school days, is its own slot). Variety: no dish twice in the week unless the family asked for it (roti, rice and curd aside), and not last week's dishes again.",
  "4. Every dish gets its ingredients: { item, amount, unit } with amounts for the people it is for (add up their portions for that one meal; leave out salt and water). A dish without them is refused.",
  `5. Plan only the house's cooking_days, one day a call (a call carries 16 KB at most): plan_week { week_start: "${weekStart}", mode: "final", keep_rest: true, meals } with that day's meals. These calls answer no message.`,
  `6. Then make one closing call, plan_week { week_start: "${weekStart}", mode: "final" } without meals. When it is refused, fix what it names (set_dish, set_meal) and call it again. Its answer has \`message\` and, the first time, \`intro\`: do what its \`instructions\` say. Send \`message\` word for word: it holds the only link to send. Then its \`intro\` word for word, once, when it has one. Then end your turn.`,
  "7. Do not wait for a reply. Plan meals only: buy nothing and put nothing on a cart.",
].join("\n");

/** A row without the kit's own columns: the agent plans from what the family said, not from the row's bookkeeping. */
const bare = <T extends object>(row: T): Partial<T> =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !["id", "created_at", "updated_at", "updated_by"].includes(k))) as Partial<T>;

export async function weeklyPlan(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  // The time it really runs at, for the how-to-use intro ("every Sunday morning").
  recordTime(ctx, "plan_time", scheduleTime(ctx.routine?.trigger, "weekly"));
  const { db, sqlite } = ctx.kit;
  const weekStart = nextMonday(todayStr(now));
  if (profilePending(sqlite)) {
    await wake(ctx, STRUCTURE_PROFILE(weekStart), { profile: getHouse(db).profile_to_structure });
    return;
  }
  const c = weekContext(db, weekStart);
  // Cut down to fit in a wake; a context still too long is left out, and the agent reads it with plan_week.
  const data = { week_start: weekStart, context: { ...c, people: c.people.map(bare), house: bare(c.house) } };
  await wake(ctx, WEEKLY_PROMPT(weekStart), fitsWake(data) ? data : { week_start: weekStart });
}
