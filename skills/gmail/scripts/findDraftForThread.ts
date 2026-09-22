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

import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentClose,
} from "../../_shared/_google_helpers";
import { draftRowForThread, DRAFT_ROWS_EXPR, type DraftListRow } from "./_draftRows";
import { gmailViewUrl, pollInPageScript, parsePollResult, DRAFTS_VIEW_READY_EXPR } from "./_gmailNav";

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
    let psId = "";
    try {
      // ONE CALL: navigate and scrape together, never create-then-interact.
      //
      // WHY (2026-09-09, caught live): a persistent session is a shared page, and
      // although the platform now serializes individual operations, a SPLIT
      // sequence still leaves a window between them for another caller's
      // navigation. Reproduced with five concurrent callers: this lookup returned
      // draftId:null for a thread whose draft was demonstrably there -- the same
      // call in a quiet window returned it, message id and all.
      //
      // A false "no draft" here is not a cosmetic miss. This is the C3 recovery
      // lookup: its answer decides whether a write that could not name its own
      // draft gets recorded, and "no draft" means nothing is recorded, which is
      // precisely how the 2026-09-08 incident put two drafts on one thread. It
      // now also answers "is the draft on this thread ours?" for the replace
      // guard.
      //
      // One read, no retry loop: this runs after a write that already had its own
      // bounded poll, so if the row still is not there, "no draft" is honest.
      // DRAFTS_VIEW_READY_EXPR, not LIST_SETTLED_EXPR: the latter is satisfied by
      // ANY rendered list, so on a reused persistent page it reads whatever view
      // the previous caller left up -- the inbox, or someone else's search -- and
      // finds no row for this thread. That is a false "no draft", and it is the
      // answer that decides whether a retry may write a second one. The hash check
      // is the difference; createReplyDraft's own confirmation has always used it.
      //
      // Land the drafts view for real and wait for it to RENDER before reading
      // (see _gmailNav.ts) -- the old fragment-only navigation plus a 1500ms sleep
      // is the other way this lookup used to report drafts that existed as absent.
      const result = await persistentCreate(gmailViewUrl("#drafts"), [
        { action: "evaluate", script: pollInPageScript(DRAFTS_VIEW_READY_EXPR, DRAFT_ROWS_EXPR, 25000) },
      ]);
      psId = result?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for the Gmail drafts list");
      }
      const { result: scraped } = parsePollResult<DraftListRow[]>(result?.content);
      const rows: DraftListRow[] = Array.isArray(scraped) ? scraped : [];

      const row = draftRowForThread(rows, threadId);
      // draftMessageId identifies the DRAFT (draftId identifies the thread), so a
      // caller can tell its own draft from one the owner wrote.
      console.log(JSON.stringify({
        threadId,
        draftId: row ? row.draftId : null,
        draftMessageId: row?.draftMessageId || "",
      }));
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }
  })().catch((err: any) => {
    // Could not LOOK. Distinct from "looked, found nothing" above: the caller
    // must not read this as "no draft exists" and let a retry write a second
    // one, so it exits non-zero and the executor leaves the record alone.
    errorJson("BROWSER_ERROR", `Could not read the drafts list: ${err?.message || err}`);
  });
}
