// The app's four routines, by the handler each one is named with in flock.app.json. Flock decides when a run is due; the
// handler decides whether there is anything to say, and wakes the agent only then.
import { gateRoutines } from "../gate";
import type { RoutineCtx } from "./ctx";
import { orderClock } from "./order-clock";
import { afternoonReminder, eveningReminder } from "./reminders";
import { weeklyPlan } from "./weekly-plan";

/** Before the family has a person, only the weekly run does anything, and only to have a profile carried over from 2.0
 *  structured (gate.ts). The reminders and the order clock need a person, and check that themselves: a reminder has
 *  something to do on every run, family or not (it records when it runs). `now` is the time, for tests. */
export const routines: Record<string, (ctx: RoutineCtx, now?: Date) => void | Promise<void>> = {
  ...gateRoutines<RoutineCtx>({ "weekly-plan": weeklyPlan }),
  "afternoon-reminder": afternoonReminder,
  "evening-reminder": eveningReminder,
  "order-clock": orderClock,
};
