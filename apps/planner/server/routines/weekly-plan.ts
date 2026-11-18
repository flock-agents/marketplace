// The weekly run: the agent is asked to plan next week, place its first order and send the plan to the family. On an
// install carried over from Meal Planner 2.0 it is first asked to turn the family's old profile into people, rules, the cook
// and the slots: a week is planned only from a family the app knows.
import { dayLabel, nextMonday, todayStr } from "../dates";
import { getHouse } from "../family";
import { profilePending } from "../gate";
import { weekContext } from "../meals";
import { wake, type RoutineCtx } from "./ctx";

const STRUCTURE_PROFILE = "Structure the family profile below with set_person / set_house_rules / set_cook / set_slots / set_regular, "
  + "then clear it with set_house_rules { structured: true }. Keep the family's own words, and ask them about anything the profile leaves unclear. "
  + "No week is planned until it is cleared.";

/** What the agent does on the weekly run, as the app's operations in the order they are called. */
export const WEEKLY_PROMPT = (weekStart: string): string => [
  `Plan the family's meals for the week of ${dayLabel(weekStart)} (week_start ${weekStart}), place its first order and send them the plan.`,
  `1. The context to plan from is in the data below (people, house rules, the cook, everyday items, last week's dishes, the recipe book); plan_week { week_start: "${weekStart}", mode: "draft" } without meals answers with it again.`,
  `2. plan_week { week_start: "${weekStart}", mode: "final", meals } with the whole week's meals. It answers with the week and its orders.`,
  "3. place_order { order_id } on the first of those orders right away, and place it on the grocery app as its answer says. Never ask for a yes before placing. An order with nothing on it is refused: leave it.",
  "4. record_order { order_id, placed: true } as soon as it is placed. When the answer has intro, send it to the family word for word.",
  `5. ask_low_or_out { week_start: "${weekStart}" } answers with the week's long-life items and a question. Send the family the plan, for them to change, with that question in the same message.`,
  `6. When they answer, ask_low_or_out { week_start: "${weekStart}", low_or_out: [the items they said are low or out] }: send the names from \`items\`, not their raw words, and an empty list when they have everything.`,
  "After placing, the payment step asks the person. When they pay, record_order { order_id, paid: true }. If they do not pay, or say cancel, record_order { order_id, paid: false }. Cancel nothing on the grocery app: the items move to the next order.",
].join("\n");

export async function weeklyPlan(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  const { db, sqlite } = ctx.kit;
  if (profilePending(sqlite)) {
    await wake(ctx, STRUCTURE_PROFILE, { profile: getHouse(db).profile_to_structure });
    return;
  }
  const weekStart = nextMonday(todayStr(now));
  await wake(ctx, WEEKLY_PROMPT(weekStart), { week_start: weekStart, context: weekContext(db, weekStart) });
}
