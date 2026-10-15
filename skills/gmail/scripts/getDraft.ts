// getDraft.ts — read back a draft's composed body (task-11 brief).
//
// Lets a caller detect an owner edit to an agent-authored draft: read the
// draft back, compare against what was written, and treat a difference as
// the owner having taken over. Navigates to #drafts/<id> — the same id
// format createReplyDraft returns and sendDraft already expects there.
//
// The pure body extractor (extractDraftBody) is exported and unit-tested
// against an HTML fixture (gmail-draft-id.test.ts) with no browser. The
// browser-driving script body only runs when this file executes as a skill
// script — gated on SKILL_PARAMS, same posture as checkEngagedDomains.ts — so
// importing this module for its pure export never touches the browser.

import { extractDraftBody as extract, COMPOSE_BODY_SCRAPE } from "./_draftBody";
import { gmailViewUrl, pollInPageScript, parsePollResult, COMPOSE_OPEN_EXPR } from "./_gmailNav";
import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentClose,
} from "../../_shared/_google_helpers";

// extractDraftBody moved to _draftBody.ts so the WRITERS can use it too:
// createReplyDraft/updateDraft now scrape what Gmail actually saved through the
// same extractor before they close, and the caller records THAT as the compare
// baseline. Re-exported here because this module was its original home and
// gmail-draft-id.test.ts imports it from here.
export { extractDraftBody } from "./_draftBody";

// --- Script entrypoint (browser-DOM scrape) ---
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const draftId: string = params.draftId || "";

  requireBrowserSession();

  if (!draftId) {
    errorJson("MISSING_PARAM", "draftId is required (use the id returned by createReplyDraft or createDraft)");
  }
  validateId(draftId, "draftId");

  // The compose scrape is shared with the writers (_draftBody.ts) so a draft
  // read here goes through the identical selectors and transformation the
  // baseline went through when it was written.
  const scrapeExpr = `(function(){
    const bodyHtml = ${COMPOSE_BODY_SCRAPE};
    // A reply draft's own legacy id IS its thread's legacy id (see
    // createReplyDraft.ts); fall back to any thread id element present on
    // the page for a standalone (non-reply) draft.
    const threadEl = document.querySelector('[data-legacy-thread-id]');
    return { bodyHtml: bodyHtml, threadId: threadEl ? threadEl.getAttribute('data-legacy-thread-id') : '' };
  })()`;

  (async () => {
    // gmailViewUrl + a wait for the compose to actually OPEN. A fragment-only
    // navigation on a reused persistent page does not reload (see
    // _gmailNav.ts), so the old 1500ms sleep routinely scraped whatever view
    // was on screen before this call.
    // ONE CALL: navigate and scrape together, never create-then-interact. A
    // persistent session is a shared page; operations are serialized, but a SPLIT
    // sequence leaves a window between them that another caller's navigation
    // lands in. Caught live on findDraftForThread (it reported "no draft" for a
    // draft that was plainly there), and this read is on the same footing --
    // worse, in fact: draftStatus reads its answer as the OWNER-EDIT baseline, so
    // a scrape of the wrong page reports "owner-edited" and freezes the thread,
    // or reports someone else's text as our own.
    let psId = "";
    let result: any;
    try {
      result = await persistentCreate(gmailViewUrl(`#drafts/${draftId}`), [
        { action: "evaluate", script: pollInPageScript(COMPOSE_OPEN_EXPR, scrapeExpr, 25000) },
      ]);
      psId = result?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail draft");
      }
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }
    const { ready, result: parsed } = parsePollResult<{ bodyHtml?: string; threadId?: string }>(result?.content);

    // body MUST be null, never "", when the draft's compose never opened.
    // draftStatus (draft-records.ts) reads null as "missing" and any string as
    // something to compare -- so returning "" for a draft we could not read
    // reports it as OWNER-EDITED, which is what made the owner-edit guard
    // refuse to touch drafts nobody had touched. A draft that no longer exists
    // lands on the drafts list with no compose open, which is exactly the
    // ready:false case, and "missing" is the honest answer for it.
    console.log(JSON.stringify({
      draftId,
      body: ready ? extract(parsed?.bodyHtml || "") : null,
      threadId: parsed?.threadId || draftId,
    }));
  })();
}
