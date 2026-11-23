// The weekly run (Sunday 11:00): next week is planned in steps the app's code drives (makePlan.ts: the menu from one model
// call per meal of the day, all at once, checked in code, then each day's ingredients), saved final, and the agent is woken only to send the family the
// message the app wrote. It plans only: nothing is bought or put on a cart here, the daily reminders do that. On an install
// carried over from Meal Planner 2.0 the agent is first asked to turn the family's old profile into people, rules, the cook
// and the slots (a week is planned only from a family the app knows), then to tell the family and plan the week in that same
// run, so an upgraded family is not left with an empty app until the next weekly run.
import { dayLabel, nextMonday, todayStr } from "../dates";
import { getHouse } from "../family";
import { profilePending } from "../gate";
import { weekContext } from "../meals";
import { makePlan, ROUTINE_BUDGET_MS } from "../makePlan";
import { weekSendText } from "../messages";
import { hasModel, sdkModel, type ModelCall } from "../model";
import { fitsWake, routineEnv, wake, type RoutineCtx } from "./ctx";
import { recordTime, scheduleTime } from "./reminders";

const STRUCTURE_PROFILE = (weekStart: string): string => "Structure the family profile below with set_person / set_house_rules / set_cook / set_slots / set_item, "
  + "then clear it with set_house_rules { structured: true }. Keep the family's own words, and ask them about anything the profile leaves unclear. "
  + `No week is planned until it is cleared. Once it is, tell the family the app was rebuilt, and plan the week of ${dayLabel(weekStart)} (week_start ${weekStart}) with make_plan { week_start: "${weekStart}" }: send its message and intro word for word.`;

/** The wake once the week is planned: deliver what the app wrote, nothing else. */
export const DELIVER_PROMPT = (intro: boolean): string =>
  `Send this message to the family word for word: \`message\` in the data below. ${weekSendText(intro)} Plan nothing and change nothing: the week is already saved.`;

/** What the agent did on the weekly run before the stepped plan, kept for a Flock that gives the app no model call
 *  (not_declared): the agent plans the week itself, as its operations allow. */
export const WEEKLY_PROMPT = (weekStart: string): string => [
  `Plan the family's meals for the week of ${dayLabel(weekStart)} (week_start ${weekStart}) and send them the plan.`,
  `1. The context to plan from is in the data below when it has \`context\` (people, house rules, the meals not cooked at home, the cook, family_dishes: the family's own dishes by meal, last week's dishes, known_dishes, the recipe book, how_to_plan); else plan_week { week_start: "${weekStart}", mode: "draft" } without meals answers with it, in full.`,
  "2. Build the week as how_to_plan says: from family_dishes, the family's own food, chosen and rotated, never invented. Each person's rules, diet, allergies, dislikes and portions; the house rules for that weekday (a rule without days holds every day); the cook's days and visits (cook_visits), what the cook makes well, never cook_wont_make, the cook's time (cook_time_limit: a cook who leaves early gets only a dish or two in the morning), and cook_new_recipes (set_menu: familiar dishes only; open: a new dish or a saved recipe may come in).",
  "3. Every day of the week is planned, Sunday too (a day the cook does not come, the family cooks: simple dishes; a meal not cooked at home has no dishes), and every slot on its days: Breakfast, Lunch, Dinner and each of house.extra_slots on its days for its people (a child's school tiffin, on school days, is its own slot). A person with their own dish: the shared one is for [\"everyone\"] except [them]. Variety: a main dish on two days at most (roti, rice and sides aside; sambar and rasam are mains), and last week's dishes rarely. What the family said wins. A dish in known_dishes rated didnt_work: plan it rarely, not never, and heed every dish's note.",
  `4. The whole week's menu in one call, dish names and who eats each, no ingredients: plan_menu { week_start: "${weekStart}", meals }. When it is refused, change only the meals it names and send it again.`,
  "5. Every dish gets its ingredients: { item, amount, unit } with amounts for the people it is for (add up their portions for that one meal; leave out salt and water). A dish without them is refused.",
  `6. Then the menu's dishes with their ingredients, every day of the week, one day a call (a call carries 16 KB at most): plan_week { week_start: "${weekStart}", mode: "final", keep_rest: true, meals } with that day's meals. These calls answer no message.`,
  `7. Then make one closing call, plan_week { week_start: "${weekStart}", mode: "final" } without meals. When it is refused, fix what it names (set_dish, set_meal) and call it again. Its answer has \`message\` and, the first time, \`intro\`: do what its \`instructions\` say. Send \`message\` word for word: it holds the only links to send. Then its \`intro\` word for word, once, when it has one. Then end your turn.`,
  "8. Do not wait for a reply. Plan meals only: buy nothing and put nothing on a cart.",
].join("\n");

/** A row without the kit's own columns: the agent plans from what the family said, not from the row's bookkeeping. */
const bare = <T extends object>(row: T): Partial<T> =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !["id", "created_at", "updated_at", "updated_by"].includes(k))) as Partial<T>;

/** The agent plans the week itself, from the context in the wake (WEEKLY_PROMPT): a Flock without the app's model call. */
async function legacyPlan(ctx: RoutineCtx, weekStart: string): Promise<void> {
  const c = weekContext(ctx.kit.db, weekStart);
  const data = { week_start: weekStart, context: { ...c, people: c.people.map(bare), house: bare(c.house) } };
  await wake(ctx, WEEKLY_PROMPT(weekStart), fitsWake(data) ? data : { week_start: weekStart });
}

/** `model`: the model call, for tests (else the platform's, model.ts sdkModel). */
export async function weeklyPlan(ctx: RoutineCtx, now: Date = new Date(), model?: ModelCall): Promise<void> {
  // The time it really runs at, for the how-to-use intro ("every Sunday morning").
  recordTime(ctx, "plan_time", scheduleTime(ctx.routine?.trigger, "weekly"));
  const { db, sqlite } = ctx.kit;
  const weekStart = nextMonday(todayStr(now));
  if (profilePending(sqlite)) {
    await wake(ctx, STRUCTURE_PROFILE(weekStart), { profile: getHouse(db).profile_to_structure });
    return;
  }
  // A Flock whose SDK gives the app no model call: the agent plans as it did before.
  if (!model && !hasModel(ctx.platform)) return legacyPlan(ctx, weekStart);
  const r = await makePlan({ db, emit: ctx.kit.emitChange, model: model ?? sdkModel(ctx.platform), weekStart, today: todayStr(now), basePath: routineEnv.basePath,
    budgetMs: ROUTINE_BUDGET_MS });
  if (r.ok) {
    await wake(ctx, DELIVER_PROMPT(!!r.intro), { week_start: weekStart, message: r.message, ...(r.intro ? { intro: r.intro } : {}) });
    return;
  }
  if (r.reason === "not_declared") return legacyPlan(ctx, weekStart);
  // No week this time (no credits, the day's budget, nothing known to plan from): the family is told so, plainly.
  await wake(ctx, DELIVER_PROMPT(false), { week_start: weekStart, message: r.say });
}
