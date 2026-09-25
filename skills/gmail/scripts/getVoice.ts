// getVoice.ts — the user's writing voice for a mailbox. ANSWERED BY THE PLATFORM.
//
// skill-executor.ts intercepts gmail.getVoice before any script is resolved:
// the voice lives in the wiki, not in Gmail, so there is nothing for a browser
// to fetch. This file exists because an agent's ALLOWED FUNCTIONS line is built
// from this folder's scripts (skills-registry getSkillScripts), and without it
// a live agent told to call getVoice answered that no such function existed.
//
// If this body ever runs, the intercept was bypassed; say so plainly.

import { errorJson } from "../../_shared/_google_helpers";

if (process.env.SKILL_PARAMS !== undefined) {
  errorJson("NOT_INTERCEPTED", "getVoice is answered by the Flock platform, not by this script. Call it through gmail-exec.sh.");
}
