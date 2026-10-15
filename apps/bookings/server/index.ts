import { createFlockApp } from "@flock/app-sdk";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed, addPlanSampleBookings } from "./db/seed";
import { mountBookingRoutes } from "./bookings-routes";
import { SETTINGS } from "./db/constants";

const flock = createFlockApp();
// bookings is private: only the routes below write it, so a booking can never overlap another.
// Opening hours and slot length are settings (also listed in template.json): the owner or an agent changes them without code,
// and the kit refuses values the slot loop cannot use (SETTINGS' checks).
const kit = await mountKit(flock, { schema, seed, settings: SETTINGS, privateTables: { bookings: "GET/POST/PATCH/DELETE /api/bookings and GET /api/slots (see TEMPLATE.md)" } });
// Agents read and write services through /api/_data, and bookings through /api/bookings and /api/slots (see TEMPLATE.md).
addPlanSampleBookings(kit);   // a plan's sample services arrive without bookings: give Today something to show
mountBookingRoutes(flock.hono, kit.db, kit.emitChange, kit.settings, kit.flagSamples);
flock.listen();
