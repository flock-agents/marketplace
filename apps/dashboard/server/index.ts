import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed, spreadSampleReadings } from "./db/seed";

const flock = createFlockApp();
const kit = await mountKit(flock, { schema, seed });
spreadSampleReadings(kit);   // a plan's sample readings arrive with one stamp: spread them so the trend has a time axis
// App-specific routes go here, e.g. flock.hono.get("/api/summary", …). Agents use /api/_data for rows.
flock.listen();
