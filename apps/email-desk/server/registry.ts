// Every op the app serves: the declared agent ops (create/update/discard_draft, reply_context), send_draft (reached only by
// the card's Send) and the platform ops (reached only by Flock's server). Which of them an agent may call is the manifest's
// declaration plus Flock's rule, not this list.
import type { OpHandler } from "@flock/app-sdk";
import { ops as draftOps } from "./ops";
import { replyContext } from "./reply-context";
import { platformOps } from "./platform-ops";

export const allOps: Record<string, OpHandler> = {
  ...draftOps,
  reply_context: (p, ctx) => replyContext(p, ctx),
  ...platformOps,
};
