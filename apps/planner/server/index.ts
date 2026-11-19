import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import { agentOps } from "./agentOps";
import * as schema from "./db/schema";
import { OLD_TABLES, SETTINGS } from "./db/constants";
import { mountFamilyRoutes } from "./family";
import { mountMealRoutes } from "./meals";
import { mountRegularRoutes } from "./regulars";
import { mountProductRoutes } from "./products";
import { mountRecipeRoutes } from "./recipes";
import { mountItemRoutes } from "./items";
import { mountCartRoutes } from "./cartRoutes";
import { migrateOldProfile } from "./gate";
import { routines } from "./routines";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
// Meal Planner 2.0's tables are kept as they are beside the new ones, so an upgrade is never a destructive change.
const kit = await mountKit(flock, { schema, settings: SETTINGS, keepTables: OLD_TABLES, routines });

// An install upgraded from 2.0 has its family as profile text only: it is carried over for the agent to structure (gate.ts).
// Only once the schema landed: a boot that is still waiting on it has no house table to write.
if (kit.status.state === "ok") migrateOldProfile(kit.sqlite);

mountFamilyRoutes(flock.hono, kit.db, kit.emitChange, { appToken: flock.env.token ?? process.env.FLOCK_APP_TOKEN ?? null });
// Until carts and the reminder come (a later revision 2 step) a plan or an everyday item changes nothing beyond itself.
mountMealRoutes(flock.hono, kit.db, kit.emitChange, { basePath: flock.env.basePath });
mountRegularRoutes(flock.hono, kit.db, kit.emitChange, { onChanged: () => {} });
mountProductRoutes(flock.hono, kit.db, kit.emitChange);
mountRecipeRoutes(flock.hono, kit.db, kit.emitChange);
mountItemRoutes(flock.hono, kit.db, kit.emitChange);
// The app's real carts are copied by the agent: an edit on the page asks it (the sync-cart intent) once the taps stop.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
mountCartRoutes(flock.hono, kit.db, kit.emitChange, {
  askAgent: (name, p) => flock.platform.agent.intent(name, p),
  schedule: (key, run, ms) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (run) timers.set(key, setTimeout(() => { timers.delete(key); run(); }, ms));
  },
});

flock.listen();
