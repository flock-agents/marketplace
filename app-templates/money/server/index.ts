import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { mountMoneyRoutes } from "./money-routes";

const flock = createFlockApp();
const kit = await mountKit(flock, { schema, seed });
// App-specific routes: budget-status and monthly-totals (server/money-routes.ts). Agents use /api/_data for rows.
mountMoneyRoutes(flock.hono, kit.db, kit.flagSamples);
flock.listen();
