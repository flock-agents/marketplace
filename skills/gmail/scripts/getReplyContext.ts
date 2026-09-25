// getReplyContext.ts — everything a reply on a thread should be written from.
// ANSWERED BY THE PLATFORM.
//
// skill-executor.ts intercepts gmail.getReplyContext before any script is
// resolved and gathers the context through the skill's own reads (getThread,
// getThreads), memory and the voice; see server/src/reply-context.ts. This file
// exists because an agent's ALLOWED FUNCTIONS line is built from this folder's
// scripts: without one, a function is invisible to the agent (live, getVoice
// was reported as "not available" for exactly that reason).
//
// If this body ever runs, the intercept was bypassed; say so plainly.

import { errorJson } from "../../_shared/_google_helpers";

if (process.env.SKILL_PARAMS !== undefined) {
  errorJson("NOT_INTERCEPTED", "getReplyContext is answered by the Flock platform, not by this script. Call it through gmail-exec.sh.");
}
