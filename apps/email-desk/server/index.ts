// email-desk subprocess ENTRYPOINT. The platform injects PORT, APP_ID, APP_DATA_DIR and, once paired,
// FLOCK_API_URL / FLOCK_APP_TOKEN / FLOCK_WEBHOOK_SECRET. Lifecycle hooks, routine handlers and ops are
// filled in by later tasks; this skeleton boots, answers /health and prints the ready line.
import { createFlockApp } from "@flock/app-sdk";

const flock = createFlockApp({ lifecycle: {}, routines: {}, ops: {} });
flock.listen();
