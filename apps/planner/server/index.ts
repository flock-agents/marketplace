import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import { agentOps } from "./agentOps";
import * as schema from "./db/schema";
import { OLD_TABLES, SETTINGS } from "./db/constants";
import { mountFamilyRoutes } from "./family";
import { mountMealRoutes } from "./meals";
import { mountRegularRoutes, moveRegulars } from "./regulars";
import { mountProductRoutes } from "./products";
import { mountRecipeRoutes } from "./recipes";
import { mountDishBookRoutes } from "./dishBook";
import { mountItemRoutes } from "./items";
import { mountCartRoutes } from "./cartRoutes";
import { mountReminderRoutes } from "./reminder";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";
import { routineEnv } from "./routines/ctx";
import { mountMakePlanRoute } from "./makePlan";
import { sdkModel } from "./model";
import { mountSetupRoute } from "./setup";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
// Meal Planner 2.0's tables are kept as they are beside the new ones, so an upgrade is never a destructive change.
const kit = await mountKit(flock, { schema, settings: SETTINGS, keepTables: OLD_TABLES, routines });

// An install upgraded from 2.0 has its family as profile text only: it is carried over for the agent to structure (gate.ts).
// Only once the schema landed: a boot that is still waiting on it has no house table to write.
if (kit.status.state === "ok") {
  migrateOldProfile(kit.sqlite);
  // An installed copy's everyday items become item cycles, once.
  try { moveRegulars(kit.sqlite, kit.db); } catch (e) { console.warn("[planner] the everyday items were not moved to item cycles", e); }
}

mountFamilyRoutes(flock.hono, kit.db, kit.emitChange, { appToken: flock.env.token ?? process.env.FLOCK_APP_TOKEN ?? null });
mountMealRoutes(flock.hono, kit.db, kit.emitChange, { basePath: flock.env.basePath });
// make_plan: the week planned in steps with the model call Flock gives the app (model.ts), the same as the Sunday run.
mountMakePlanRoute(flock.hono, kit.db, kit.emitChange, { basePath: flock.env.basePath, model: (req) => sdkModel(flock.platform)(req) });
// apply_setup: the whole interview read once by the model and saved by the app's code (setup.ts).
mountSetupRoute(flock.hono, kit.db, kit.emitChange, { model: (req) => sdkModel(flock.platform)(req) });
routineEnv.basePath = flock.env.basePath;
// set_regular, the older way to state an item's cycle (regulars.ts).
mountRegularRoutes(flock.hono, kit.db, kit.emitChange);
mountProductRoutes(flock.hono, kit.db, kit.emitChange);
mountRecipeRoutes(flock.hono, kit.db, kit.emitChange);
// Each dish's video and how it went, kept by its name across weeks (dishBook.ts).
mountDishBookRoutes(flock.hono, kit.db, kit.emitChange);
mountItemRoutes(flock.hono, kit.db, kit.emitChange);
// The app's real carts are copied by the agent: an edit on the page asks it (the sync-cart intent) once the taps stop.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const schedule = (key: string, run: (() => void) | null, ms: number) => {
  clearTimeout(timers.get(key));
  timers.delete(key);
  if (run) timers.set(key, setTimeout(() => { timers.delete(key); run(); }, ms));
};
mountCartRoutes(flock.hono, kit.db, kit.emitChange, { askAgent: (name, p) => flock.platform.agent.intent(name, p), schedule });
// The reminder the agent sends at 15:00 and 19:00 (get_reminder); a cart it orders drops the copy to its app still waiting.
mountReminderRoutes(flock.hono, kit.db, kit.emitChange, { schedule });

flock.listen();
