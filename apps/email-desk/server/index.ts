// email-desk subprocess ENTRYPOINT. The platform injects PORT, APP_ID, APP_DATA_DIR and, once paired,
// FLOCK_API_URL / FLOCK_APP_TOKEN / FLOCK_WEBHOOK_SECRET. Lifecycle hooks and ops are filled in by later tasks; this
// boots, answers /health, runs the routines it has, and prints the ready line.
import { createFlockApp } from "@flock/app-sdk";
import { memoryExtraction } from "./routines/memory-extraction";

const flock = createFlockApp({
  lifecycle: {},
  // One run per account of the paired agent's Gmail (flock.app.json routines, event trigger per account).
  routines: { "memory-extraction": memoryExtraction },
  ops: {},
});
flock.listen();
