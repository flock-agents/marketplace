import { createFlockApp } from "@flock/app-sdk";
import { mountKit, schemaModeFromEnv } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { prepareV1Data } from "./db/migrate-v1";

const flock = createFlockApp();
// An install updated from 1.x: its tables move aside (kept) and their rows become the boot import mountKit applies.
const v1 = prepareV1Data(flock.env.dataDir, { writeImport: schemaModeFromEnv() === "apply" });
await mountKit(flock, { schema, seed, keepTables: v1.keep });
// App-specific routes go here, e.g. flock.hono.get("/api/summary", …). Agents use /api/_data for rows.
flock.listen();
