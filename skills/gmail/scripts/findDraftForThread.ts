// findDraftForThread.ts — which draft, if any, does Gmail currently hold for
// this thread?
//
// WHY (the 2026-09-08 incident, C3): createReplyDraft's duplicate guard reads
// its record BEFORE the browser write and writes it AFTER, with 8-90s of DOM
// work in between. Two paths land a draft in Gmail and record nothing:
//
//   - the write is killed by a timeout while it is actually succeeding. Gmail
//     has autosaved the compose; the executor's catch returns skill_timeout
//     and never reaches the record.
//   - createReplyDraft returns {draftId: null} because the #drafts row was not
//     visible within its bounded 5-attempt poll. The draft exists; we
//     deliberately do not record an id we could not read.
//
// In both cases the retry sees no record and writes a SECOND draft. A marker
// written before the write would only guess at what happened. This asks Gmail
// instead: the executor calls this after either outcome and records whatever
// actually exists, so the retry short-circuits on a real id.
//
// NOTHING NEW IS BEING TRUSTED HERE. This is the same #drafts scrape
// createReplyDraft.ts already performs (pollForDraftRow), against the same
// verified attribute -- #drafts rows carry data-legacy-thread-id exactly as
// inbox rows do, confirmed against three existing drafts including a reply
// draft inside a thread -- reusing that file's own unit-tested
// draftIdFromRows matcher rather than a second copy of the rule -- both now
// live in _draftRows.ts precisely so the two can never drift apart. For a reply
// draft the draft's own legacy id IS the thread's legacy id, which is what
// makes "find the draft for this thread" a lookup rather than a search.
//
// Returns a normal result either way: {draftId: null} means "Gmail holds no
// draft for this thread", which is a real answer the caller acts on, not a
// failure. Only an inability to LOOK exits non-zero.
//
// Input  (SKILL_PARAMS): { threadId: string }
// Output (stdout JSON):  { threadId, draftId: string | null, draftMessageId: string }

import { errorJson, requireBrowserSession, validateId } from "../../_shared/_google_helpers";
import { readDraftList, lookupFromRead, browserDraftListIo } from "./_draftList";

if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const threadId: string = params.threadId || "";

  requireBrowserSession();

  if (!threadId) {
    errorJson("MISSING_PARAM", "threadId is required");
  }
  validateId(threadId, "threadId");

  (async () => {
    // PAGED (2026-09-24): the whole list, not just its first page — Flock lands drafts itself,
    // so a mailbox can hold more than 50 and every older one used to read as "no draft". Stops
    // at the page holding this thread. No match on a walk that did not reach the end is "could
    // not look" and exits non-zero, exactly like a failed read (see the catch below).
    const read = await readDraftList(browserDraftListIo(), { stopAtThreadId: threadId });
    const answer = lookupFromRead(read, threadId);
    if (answer === "incomplete") {
      errorJson("BROWSER_ERROR", `Could not read the whole drafts list (${read.reason} after ${read.pages} page(s))`);
    }
    console.log(JSON.stringify(answer));
  })().catch((err: any) => {
    // Could not LOOK. Distinct from "looked, found nothing" above: the caller
    // must not read this as "no draft exists" and let a retry write a second
    // one, so it exits non-zero and the executor leaves the record alone.
    errorJson("BROWSER_ERROR", `Could not read the drafts list: ${err?.message || err}`);
  });
}
