import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";

const flock = createFlockApp();
await mountKit(flock, { schema, seed });
// App-specific routes go here. Agents and the pages use the uniform /api/_data/<table> routes.
flock.listen();
