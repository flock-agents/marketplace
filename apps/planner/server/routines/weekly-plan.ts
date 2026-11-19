// The weekly run: the agent is asked to plan next week, place its first order and send the plan to the family. On an
// install carried over from Meal Planner 2.0 it is first asked to turn the family's old profile into people, rules, the cook
// and the slots (a week is planned only from a family the app knows), then to tell the family and plan the week in that
// same run, so an upgraded family is not left with an empty app until the next weekly run.
import { dayLabel, nextMonday, todayStr } from "../dates";
import { getHouse } from "../family";
import { profilePending } from "../gate";
import { weekContext } from "../meals";
import { fitsWake, wake, type RoutineCtx } from "./ctx";

const STRUCTURE_PROFILE = (weekStart: string): string => "Structure the family profile below with set_person / set_house_rules / set_cook / set_slots / set_regular, "
  + "then clear it with set_house_rules { structured: true }. Keep the family's own words, and ask them about anything the profile leaves unclear. "
  + `No week is planned until it is cleared. Once it is, tell the family the app was rebuilt, and plan the week of ${dayLabel(weekStart)} (week_start ${weekStart}) as the weekly run does (call guide).`;

/** What the agent does on the weekly run, as the app's operations in the order they are called. */
export const WEEKLY_PROMPT = (weekStart: string): string => [
  `Plan the family's meals for the week of ${dayLabel(weekStart)} (week_start ${weekStart}), place its first order and send them the plan.`,
  `1. The context to plan from is in the data below when it has \`context\` (people, house rules, the cook, everyday items, last week's dishes, the recipe book); plan_week { week_start: "${weekStart}", mode: "draft" } without meals answers with it, in full.`,
  `2. Send the week one day a call (a call carries 16 KB at most): plan_week { week_start: "${weekStart}", mode: "draft", meals } with the first day's meals, then each other day the same with keep_rest: true (only the meals sent are replaced). Then plan_week { week_start: "${weekStart}", mode: "final" } without meals: it answers with the week and its orders. If a draft is refused because the week already has orders, send every day with mode: "final" and keep_rest: true instead: each answer has the orders.`,
  "3. Place the first of those orders right away (it has the first days' fresh items and the everyday items; the week's long-life items wait on the second order), but only if it is scheduled and not being placed (its wake_sent_at is empty); if it is already placed, paid or being placed, place none: the later ones go out at their own time. To place it: place_order { order_id }, fill the lines in its needs_product and needs_qty with add_to_order { order_id, item, … }, and place it on the grocery app. Never ask for a yes before placing. An order with nothing on it is refused: leave it. If you were already handed this order_id, act once.",
  "4. record_order { order_id, placed: true } as soon as it is placed. When the answer has intro, send it to the family word for word.",
  `5. ask_low_or_out { week_start: "${weekStart}" } answers with the week's long-life items, which are on the second order, and a question. Send the family the plan, for them to change, with that question in the same message.`,
  `6. When they answer, ask_low_or_out { week_start: "${weekStart}", low_or_out: [the items they said are low or out] }: send the names from \`items\`, not their raw words, and an empty list when they have everything. The items they have come off the second order; the ones low or out stay on it.`,
  "After placing, the payment step asks the person. When they pay, record_order { order_id, paid: true }. If they do not pay, or say cancel, record_order { order_id, paid: false }. Cancel nothing on the grocery app: the items move to the next order. An order still waiting for its payment 24 hours after it was placed is closed as not paid by the app, which then hands you the line to send.",
].join("\n");

/** A row without the kit's own columns: the agent plans from what the family said, not from the row's bookkeeping. */
const bare = <T extends object>(row: T): Partial<T> =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !["id", "created_at", "updated_at", "updated_by"].includes(k))) as Partial<T>;

export async function weeklyPlan(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  const { db, sqlite } = ctx.kit;
  const weekStart = nextMonday(todayStr(now));
  if (profilePending(sqlite)) {
    await wake(ctx, STRUCTURE_PROFILE(weekStart), { profile: getHouse(db).profile_to_structure });
    return;
  }
  const c = weekContext(db, weekStart);
  // Cut down to fit in a wake; a context still too long is left out, and the agent reads it with plan_week.
  const data = { week_start: weekStart, context: { ...c, people: c.people.map(bare), regulars: c.regulars.map(bare), house: bare(c.house) } };
  await wake(ctx, WEEKLY_PROMPT(weekStart), fitsWake(data) ? data : { week_start: weekStart });
}
