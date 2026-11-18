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
import { mountOrderRoutes } from "./orderRoutes";
import { migrateOldProfile } from "./gate";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
// Meal Planner 2.0's tables are kept as they are beside the new ones, so an upgrade is never a destructive change.
const kit = await mountKit(flock, { schema, settings: SETTINGS, keepTables: OLD_TABLES, routines: {} });

// An install upgraded from 2.0 has its family as profile text only: it is carried over for the agent to structure (gate.ts).
// Only once the schema landed: a boot that is still waiting on it has no house table to write.
if (kit.status.state === "ok") migrateOldProfile(kit.sqlite);

mountFamilyRoutes(flock.hono, kit.db, kit.emitChange);
// The orders follow the plan: a final week builds its orders, and a change to a meal, a dish or an everyday item, through
// these routes or by the family on a page (the kit's change events), rebuilds the ones not yet placed.
const orders = mountOrderRoutes(flock.hono, kit.db, kit.emitChange, { events: kit.ctx.events });
mountMealRoutes(flock.hono, kit.db, kit.emitChange, orders.mealHooks);
mountRegularRoutes(flock.hono, kit.db, kit.emitChange, orders.regularHooks);
mountProductRoutes(flock.hono, kit.db, kit.emitChange);
mountRecipeRoutes(flock.hono, kit.db, kit.emitChange);

flock.listen();
