import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { mountMoneyRoutes } from "./money-routes";
import { SETTINGS } from "./db/constants";

const flock = createFlockApp();
const kit = await mountKit(flock, { schema, seed, settings: SETTINGS });
// overviewLead is an app setting: what the Overview leads with, changed without code (PATCH /api/_app/settings).
// App-specific routes: budget-status and monthly-totals (server/money-routes.ts). Agents use /api/_data for rows.
mountMoneyRoutes(flock.hono, kit.db, kit.flagSamples);
flock.listen();
