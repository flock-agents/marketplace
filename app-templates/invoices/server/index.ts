import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { guardInvoiceWrites, mountInvoiceRoutes, SERVER_COLUMNS } from "./invoice-routes";
import { SETTINGS } from "./db/constants";

const flock = createFlockApp();
let db: Awaited<ReturnType<typeof mountKit>>["db"] | null = null;
let kitSettings: Awaited<ReturnType<typeof mountKit>>["settings"] | null = null;
guardInvoiceWrites(flock.hono, () => db, () => kitSettings);   // before the kit's routes: only drafts can be deleted; bill_to and seller are the server's own (serverColumns)
// The business, its GST state code and the number prefix are settings (also listed in template.json), each with its own check.
const kit = await mountKit(flock, { schema, seed, serverColumns: SERVER_COLUMNS, settings: SETTINGS });
db = kit.db;
kitSettings = kit.settings;
// App-specific routes (server/invoice-routes.ts): invoice-list, invoice/:id, invoice-summary, next-number. They add up the money and keep each issued invoice's copy of its customer and seller; agents write rows through /api/_data.
mountInvoiceRoutes(flock.hono, kit.db, kit.settings, kit.ctx.events, kit.status, kit.flagSamples);
flock.listen();
