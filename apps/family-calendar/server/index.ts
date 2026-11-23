import { createFlockApp } from "@flock/app-sdk";
import { mountKit, schemaModeFromEnv } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { prepareV1Data } from "./db/migrate-v1";
import { agentOps, closest } from "./agentOps";
import { mountEventRoutes } from "./events";
import { routines } from "./routines";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
// An install updated from 1.x: its tables move aside (kept) and their rows become the boot import mountKit applies.
const v1 = prepareV1Data(flock.env.dataDir, { writeImport: schemaModeFromEnv() === "apply" });
const kit = await mountKit(flock, { schema, seed, keepTables: v1.keep, routines });
// Many events in one call (add_events); the pages and single-row edits use /api/_data.
mountEventRoutes(flock.hono, kit, { near: closest });
flock.listen();
