// The weekly run (Sunday 11:00): next week is planned in steps the app's code drives (makePlan.ts: one model call per slot
// in planning order, checked in code, then each day's ingredients), saved, and the agent is woken only to send the family the
// message the app wrote, with one question when a festival the family likely keeps is near (FESTIVAL_PROMPT). It plans only: nothing is bought or put on a cart here, the daily reminders do that. On an install
// carried over from Meal Planner 2.0 the agent is first asked to turn the family's old profile into people, rules, the cook
// and the slots (a week is planned only from a family the app knows), then to tell the family and plan the week in that same
// run, so an upgraded family is not left with an empty app until the next weekly run.
import { asc } from "drizzle-orm";
import { people } from "../db/schema";
import { addDays, dayLabel, nextMonday, todayStr } from "../dates";
import { getHouse } from "../family";
import { profilePending } from "../gate";
import { makePlan, ROUTINE_BUDGET_MS } from "../makePlan";
import { weekSendText } from "../messages";
import { hasModel, sdkModel, stopSaid, type ModelCall } from "../model";
import { platformPeers } from "../planDays";
import { listRules } from "../slotStore";
import { routineEnv, wake, type RoutineCtx } from "./ctx";
import { recordTime, scheduleTime } from "./reminders";

const STRUCTURE_PROFILE = (weekStart: string): string => "Structure the family profile below with set_person / set_cook / set_item, everyone at home first. "
  + "Keep the family's own words, and ask them about anything the profile leaves unclear. "
  + `No week is planned until someone at home is saved. Once they are, tell the family the app was rebuilt, and plan the week of ${dayLabel(weekStart)} (week_start ${weekStart}) with make_plan { week_start: "${weekStart}" }: send its message and intro word for word.`;

/** The wake once the week is planned: deliver what the app wrote, nothing else. */
export const DELIVER_PROMPT = (intro: boolean): string =>
  `Send this message to the family word for word: \`message\` in the data below. ${weekSendText(intro)} Plan nothing and change nothing: the week is already saved.`;

/** The festival question (spec §5.6): not a table or a list, the agent's own judgement, always asked, never assumed. */
export const FESTIVAL_PROMPT = (weekStart: string): string =>
  `Before ending your turn, look at the week of ${dayLabel(weekStart)} to ${dayLabel(addDays(weekStart, 6))}: if a festival or observance this family likely keeps falls in it `
  + "(judge from the people's names in `family` and what they said about fasts or observances in `observances`; check the date with a calendar or search tool when you have one), "
  + "send one more short line after the message, asking whether to change anything for it, for example \"<festival> is around <weekday>. Want any changes?\". "
  + "Always as a question: dates of lunar festivals can be off by a day. Never change the plan for it yourself. No such day: send nothing more.";

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
  // A Flock whose SDK gives the app no model call cannot plan: the family is told to update it.
  if (!model && !hasModel(ctx.platform)) {
    await wake(ctx, DELIVER_PROMPT(false), { week_start: weekStart, message: stopSaid("not_declared") });
    return;
  }
  const r = await makePlan({ db, emit: ctx.kit.emitChange, model: model ?? sdkModel(ctx.platform), weekStart, today: todayStr(now), basePath: routineEnv.basePath,
    budgetMs: ROUTINE_BUDGET_MS, peers: platformPeers(ctx.platform), sqlite });
  if (r.ok) {
    // What the festival question is judged from: the people's names and the family's own words about fasts and observances.
    const family = db.select().from(people).orderBy(asc(people.created_at)).all().filter((p) => p.active !== 0).map((p) => p.name);
    const observances = listRules(db).filter((x) => x.what === "fasting" || (x.what === "note" && !!x.days?.length)).map((x) => (x.who ? `${x.who}: ${x.quote}` : x.quote));
    await wake(ctx, `${DELIVER_PROMPT(!!r.intro)} ${FESTIVAL_PROMPT(weekStart)}`,
      { week_start: weekStart, message: r.message, ...(r.intro ? { intro: r.intro } : {}), family, ...(observances.length ? { observances } : {}) });
    return;
  }
  // No week this time (no credits, the day's budget, nothing known to plan from): the family is told so, plainly.
  await wake(ctx, DELIVER_PROMPT(false), { week_start: weekStart, message: r.say });
}
