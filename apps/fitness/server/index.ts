import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { spreadSampleReadings } from "./db/seed";
import { trackerRoutes } from "./trackers/routes";
import { kitStore } from "./trackers/store";
import { SYNC_ROUTINE, syncNow } from "./trackers/sync-now";
import { CALL_TIMEOUT_MS, runTrackers, type ConnectorState, type ListConnectors } from "./trackers/run";
import { TRACKERS } from "./trackers";
import type { Tracker } from "./trackers/types";
import { LOOKBACK_DAYS } from "./trackers/zepp/config";
import { paceParams, paceSettings } from "./pace/params";
import { kitPaceStore } from "./pace/store";
import { paceService } from "./pace/service";
import { paceRoutes } from "./pace/routes";
import { todayRoutes } from "./today/routes";
import { loggingGuard } from "./guard/logging";
import { exerciseRoutes } from "./exercises/routes";
import { kitPlanStore } from "./exercises/store";
import { mealPlanRoutes, type PlannedMeal } from "./meals/routes";
import { kitMealPlanStore } from "./meals/store";
import { ESTIMATE_INTENT } from "./meals/config";
import { focusSetting } from "./today/focus";
import { nutritionRoutes } from "./nutrition/routes";
import { PERSON_SETTING, TIMEZONE_SETTING, personName, profileSettings } from "./profile/settings";
import { apiPath } from "./profile/app-url";
import { useTimezone } from "./time/dates";

const flock = createFlockApp();
// Before the kit's data routes: a write the dashboard would never count is refused, not stored. The stored row is read on use.
const stored = (table: string, id: string) => kit.sqlite.query(`SELECT * FROM "${table}" WHERE id = ?1`).get(id) as Record<string, unknown> | null;
flock.hono.use("/api/_data/*", loggingGuard(stored));
// person/timezone/exercises_note: who the dashboard is for (server/profile); focus: the goals the Today page shows;
// pace.*: when the hourly sync wakes the coach for being well behind (server/pace/params.ts)
const kit = await mountKit(flock, { schema, settings: [...profileSettings, focusSetting, ...paceSettings] });
useTimezone(() => kit.settings.get<string>(TIMEZONE_SETTING));
const person = () => personName(kit.settings.get<string>(PERSON_SETTING));
spreadSampleReadings(kit);   // a plan's sample readings arrive with one stamp: spread them so the trend has a time axis
// App-specific routes go here. Agents use /api/_data for rows.
// Tracker sync, run by the app itself through the coach's connectors: the button and the scheduled routine share one pass
// over every tracker whose connector is granted and ready (none: a quiet no-op). Each fresh pass keeps today's running
// totals for the pace check; only the scheduled one may wake the coach, and only when a tracker read today's activity.
const listConnectors: ListConnectors = async () => {
  const list = (flock.platform.connectors as { list?: () => Promise<ConnectorState[]> }).list;
  return list ? list.call(flock.platform.connectors) : [];   // a Flock without connectors.list(): no tracker is known ready
};
const context = (t: Tracker) => ({
  call: (tool: string, args: Record<string, unknown>) =>
    flock.platform.connectors.exec({ skillId: t.skillId, functionName: tool, params: args, timeoutMs: CALL_TIMEOUT_MS }),
  store: kitStore(kit, t.id),
  now: new Date(),
});
const pace = paceService(kitPaceStore(kit), () => paceParams(kit.settings.get), person);
const sync = syncNow(async () => {
  const report = await runTrackers(TRACKERS, listConnectors, context, LOOKBACK_DAYS);
  if (report.todayAsOf) await pace.sample(report.todayAsOf);
  return report;
});
flock.setRoutines({
  [SYNC_ROUTINE]: async (ctx) => {
    const report = await sync.run();
    if (!report.ok) throw new Error(report.message);
    if (!report.todayAsOf) return;   // no activity numbers today: nothing to judge the pace by
    await pace.check(report.todayAsOf, async (message, data) => {
      const woken = await ctx.wakeAgent(message, { ...(data as object), api: apiPath() });
      return woken.ok ? { ok: true } : { ok: false, reason: woken.reason };
    });
  },
});
flock.hono.route("/api/trackers", trackerRoutes(sync));
flock.hono.route("/api", paceRoutes(pace, () => sync.status().last?.todayAsOf ?? null));   // the pace check's parameters and what it decides now
flock.hono.route("/api", todayRoutes(kit));                   // the day's numbers against their targets: today, and past days
// a tapped planned meal with no numbers yet: `api` is this app's own path for the coach's logging call
const askCoach = (meal: PlannedMeal) => flock.platform.agent.intent(ESTIMATE_INTENT, { ...meal, api: apiPath() });
flock.hono.route("/api", mealPlanRoutes(kitMealPlanStore(kit), askCoach));   // the day's planned meals
flock.hono.route("/api", exerciseRoutes(kitPlanStore(kit)));   // the exercise library and the day's workout plan
flock.hono.route("/api", nutritionRoutes(kit));                // every nutrient of the logged meals, day by day, for review
flock.listen();
