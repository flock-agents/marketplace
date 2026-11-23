// email-desk subprocess ENTRYPOINT. The platform injects PORT, APP_ID, APP_DATA_DIR and, once paired,
// FLOCK_API_URL / FLOCK_APP_TOKEN / FLOCK_WEBHOOK_SECRET. Lifecycle hooks and ops are filled in by later tasks; this
// boots, answers /health, runs the routines it has, and prints the ready line.
import { createFlockApp, type PlatformContext } from "@flock/app-sdk";
import { memoryExtraction } from "./routines/memory-extraction";
import { followUp } from "./routines/follow-up";
import { allOps } from "./registry";
import { handleCardClosed } from "./drafts/send";
import { voiceRoutes } from "./routes/voice";
import { removalRoutes } from "./removal";
import { createEmailDeskHooks } from "./lifecycle";

// The platform context is the app's own, read by the hooks that are not handed one (progress rows).
let platformRef: PlatformContext | null = null;
const flock = createFlockApp({
  // First read, progress and owed work (lifecycle.ts).
  lifecycle: createEmailDeskHooks({ platform: () => platformRef as PlatformContext }),
  // One run per account of the paired agent's Gmail (flock.app.json routines, event trigger per account).
  routines: { "memory-extraction": memoryExtraction, "follow-up": followUp },
  // reply_context, the draft ops, send_draft and the platform read ops (registry.ts).
  ops: allOps,
  // A draft card the person dismissed discards its draft (drafts/send.ts); a sent or expired one changes nothing.
  onCardClosed: (event, ctx) => handleCardClosed(event, ctx),
});
// The settings page and the person's voice editor (Task 2.9): GET /settings, GET/PUT /api/voice (routes/voice.ts).
// The linked SDK resolves its own hono copy; the types differ nominally, the runtime is one Hono (as calendar-desk).
flock.hono.route("/", voiceRoutes(flock.platform) as never);
// "Delete my mail data" (Task 2.10): POST /api/mail-data/delete {confirm: true}, the person only (routes/voice.ts person()).
flock.hono.route("/", removalRoutes() as never);
platformRef = flock.platform;
flock.listen();
