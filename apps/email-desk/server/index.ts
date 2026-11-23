// email-desk subprocess ENTRYPOINT. The platform injects PORT, APP_ID, APP_DATA_DIR and, once paired,
// FLOCK_API_URL / FLOCK_APP_TOKEN / FLOCK_WEBHOOK_SECRET. Lifecycle hooks and ops are filled in by later tasks; this
// boots, answers /health, runs the routines it has, and prints the ready line.
import { createFlockApp } from "@flock/app-sdk";
import { memoryExtraction } from "./routines/memory-extraction";
import { ops } from "./ops";
import { handleCardClosed } from "./drafts/send";

const flock = createFlockApp({
  lifecycle: {},
  // One run per account of the paired agent's Gmail (flock.app.json routines, event trigger per account).
  routines: { "memory-extraction": memoryExtraction },
  // The draft ops and send_draft (ops.ts); reply_context and the platform read ops join them in later tasks.
  ops,
  // A draft card the person dismissed discards its draft (drafts/send.ts); a sent or expired one changes nothing.
  onCardClosed: (event, ctx) => handleCardClosed(event, ctx),
});
flock.listen();
