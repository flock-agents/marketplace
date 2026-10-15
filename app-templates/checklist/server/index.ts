import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";

const flock = createFlockApp();
await mountKit(flock, { schema, seed });
// App-specific routes go here, e.g. flock.hono.get("/api/summary", …). Agents use /api/_data for rows.
flock.listen();
