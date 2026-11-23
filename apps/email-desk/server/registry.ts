// Every op and routine handler the app serves (contract.test.ts holds them against flock.app.json). The ops: the declared
// agent ops (create/update/discard_draft, reply_context), send_draft (reached only by the card's Send) and the platform ops
// (reached only by Flock's server). Which of them an agent may call is the manifest's declaration plus Flock's rule, not
// this list.
import type { OpHandler, RoutineHandler } from "@flock/app-sdk";
import { ops as draftOps } from "./ops";
import { replyContext } from "./reply-context";
import { platformOps } from "./platform-ops";
import { voiceBlockOrNull } from "./voice/block";
import { memoryExtraction } from "./routines/memory-extraction";
import { followUp } from "./routines/follow-up";

export const allOps: Record<string, OpHandler> = {
  ...draftOps,
  reply_context: (p, ctx) => replyContext(p, ctx, voiceBlockOrNull),
  ...platformOps,
};

/** One handler per flock.app.json routine (`handler`): one run per account of the paired agent's Gmail. */
export const routineHandlers: Record<string, RoutineHandler> = {
  "memory-extraction": memoryExtraction,
  "follow-up": (ctx) => followUp(ctx),
};
