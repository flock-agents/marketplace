// The coach's scheduled runs. They are app routines, not plain model runs, so the app decides whether each one spends a
// model run: none until the app is set up. A wake hands the coach the routine's own manifest prompt, then the message.
import type { RoutineContext } from "@flock/app-sdk";

export const DAILY_PLAN_ROUTINE = "daily-plan";
export const WEEKLY_REVIEW_ROUTINE = "weekly-review";

/** Wakes the coach with `message` and this app's API path, but only once `setUp()`; before that the run ends at once. */
export const coachRoutine = (setUp: () => boolean, message: string, api: () => string) =>
  async (ctx: Pick<RoutineContext, "wakeAgent">): Promise<void> => {
    if (!setUp()) return;
    const woken = await ctx.wakeAgent(message, { api: api() });
    if (!woken.ok) throw new Error(`could not wake the coach: ${woken.reason}`);
  };
