import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import { agentOps } from "./agentOps";
import * as schema from "./db/schema";
import { OLD_TABLES, SETTINGS } from "./db/constants";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
// Meal Planner 2.0's tables are kept as they are beside the new ones, so an upgrade is never a destructive change.
await mountKit(flock, { schema, settings: SETTINGS, keepTables: OLD_TABLES, routines: {} });

flock.listen();
