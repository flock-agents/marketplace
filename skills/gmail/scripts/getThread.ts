// getThread.ts — per-message recipients for reply-all (task-14 brief).
//
// getEmail returns one joined string across a whole thread with no recipient
// fields at all, which makes reply-all impossible — Ghostwriter §2b computes
// its to/cc lists off the triggering message's own To/Cc lines. This script
// expands every message in the thread (a collapsed message renders neither
// its `to` nor its `cc`) and returns per-message { from, to, cc, date, body },
// oldest first.
//
// The pure parser (messagesFromThreadDom) is exported and unit-tested against
// a fixture (gmail-thread-parse.test.ts) with no browser involved. The
// browser-driving script body only runs when this file executes as a skill
// script — gated on SKILL_PARAMS, same posture as checkEngagedDomains.ts — so
// importing this module for its pure export never touches the browser.

import {
  errorJson,
  emitResult,
  requireBrowserSession,
  validateId,
  urlencode,
  persistentCreate,
  persistentInteract,
  persistentInteractRaw,
  persistentClose,
} from "../../_shared/_google_helpers";
import {
  messagesFromThreadDom,
  assessThreadCompleteness,
  THREAD_EXPAND_SCRIPT,
  THREAD_DETAILS_SCRIPT,
  THREAD_SCRAPE_SCRIPT,
} from "./_threadScrape";
import { gmailViewUrl, searchViewReadyExpr, pollInPageScript } from "./_gmailNav";
import { printViewUrl, PRINT_BLOCKS_EXPR, rowsFromPrintBlocks, PRINT_VIEW_SHOWS_DRAFTS } from "./_printView";
import { readCachedThread, writeCachedThread } from "./_threadCache";
import { unreadProbeQuery, unreadIdsExpr, wasUnread, probeSummary, MARK_UNREAD_SCRIPT, parseMarkResult, type MarkResult, type UnreadDiag } from "./_unreadState";

// Fix round 1 (Critical + Important #3): getThread runs under the same 90s
// SLOW_SKILL_TIMEOUT_MS ceiling as every other slow skill function (server/src/skill-executor.ts).
// RESTORE_WAIT_MS is a tight ceiling, not a delay; RESTORE_BUDGET_MS skips the restore outright
// once too much of that budget is already spent on the read itself.
// Final review I1: the probe must never be able to FAIL the operation it rides on. It used to open
// with a `waitForSelector ".AO"` action -- a timeout there makes persistentCreate call errorJson and
// the process exits, so a slow Gmail load killed a draft/read that used to succeed. The session is now
// established by the navigation alone, and the readiness wait lives INSIDE the probe poll, which
// returns ready:false instead of throwing; an unsettled probe counts as "not unread" (fail-closed).
// 20s is the skill's usual cold-load ceiling.
const PROBE_POLL_MS = 20_000;
const RESTORE_WAIT_MS = 10_000;
const RESTORE_BUDGET_MS = 60_000;

// --- Pure types + parsing (unit-tested, no browser) ---
//
// One copy, in _threadScrape.ts, shared with getThreads (Task 27). getThread used to carry its own
// verbatim duplicate of the types, parsers and in-page scripts; a fix to one (the message text
// keeping its line breaks) would have silently missed the other. Re-exported here so this module's
// tests and callers keep their imports.
export {
  messagesFromThreadDom,
  assessThreadCompleteness,
  looksLikeUnsubscribeLink,
  UNSUBSCRIBE_LINK_RE_SOURCE,
  type RawRecipient,
  type RawThreadRow,
  type ThreadMessage,
  type ThreadCompleteness,
} from "./_threadScrape";

// --- Script entrypoint (browser-DOM scrape) ---
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  // Fix round 1 (Important #3): clocked from the very top of the script, so the restore-budget
  // check below measures against the SAME ceiling skill-executor.ts is about to enforce.
  const startedAt = Date.now();
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const threadId: string = params.threadId || "";

  requireBrowserSession();

  if (!threadId) {
    errorJson("MISSING_PARAM", "threadId is required");
  }
  validateId(threadId, "threadId");

  // Serve a cached copy before opening a browser (the connector's own 20-minute thread cache).
  // A caller that must see live state passes `forceRefresh`/`bypassCache`, or `freshAfter` when it
  // knows a message landed at a given instant; both are honoured inside readCachedThread. A cache
  // miss (or an unusable store) simply falls through to the live scrape below.
  const cached = readCachedThread(threadId, params);
  if (cached) emitResult(cached);

  // PRINT VIEW is the default read path (a read that leaves the thread unread, see _printView.ts) —
  // the whole point of Task 3. `view: "thread"` opts back into the conversation-view scrape below,
  // which DOES mark the thread read; Task 4 adds an unread-restore to that branch.
  const view: "print" | "thread" = params.view === "thread" ? "thread" : "print";
  if (view === "print") {
    (async () => {
      let psId = "";
      let result: any;
      try {
        result = await persistentCreate(printViewUrl(threadId), [
          { action: "waitForSelector", selector: "table.message", delay: 20000 },
          { action: "evaluate", script: PRINT_BLOCKS_EXPR },
        ]);
        psId = result?.persistentSessionId || "";
        if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for the Gmail print view");
      } finally {
        if (psId) await persistentClose(psId).catch(() => {});
      }
      let parsed: any;
      try { parsed = JSON.parse(typeof result?.content === "string" ? result.content : "{}"); }
      catch { parsed = { subject: "", blocks: [], draftMarker: false }; }
      const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      const messages = messagesFromThreadDom(rowsFromPrintBlocks(blocks));
      // Print view renders every message expanded, so the only completeness signal left is the
      // blank-`to` rule; expectedCount = blocks.length.
      const completeness = assessThreadCompleteness(messages, blocks.length);
      const threadResult = {
        threadId,
        subject: parsed.subject || "",
        messages,
        incomplete: completeness.incomplete || messages.length === 0,
        reason: messages.length === 0 ? "print view returned no messages" : completeness.reason,
        hasDraft: PRINT_VIEW_SHOWS_DRAFTS ? parsed.draftMarker === true : false,
        readVia: "print",
      };
      writeCachedThread(threadId, threadResult);
      emitResult(threadResult);
    })();
    return;
  }

  // Expand every message before scraping — a collapsed message renders
  // neither its `to` nor its `cc`. Gmail exposes a single "Expand all"
  // control when a thread has multiple messages; fall back to clicking each
  // collapsed row individually when it isn't present (e.g. Gmail's markup
  // has drifted, or there's exactly one message and no control renders).
  //
  // Expansion is never verified past this point on its own — a missed
  // message is only caught by comparing counts once the scrape runs. Stash
  // the pre-expansion container count on `window` (both scripts run in the
  // same page/JS realm within this one browserInteract call) so the
  // trailing scrapeScript can compare "how many messages did we see before
  // clicking anything" against "how many did we actually scrape".
  const expandScript = THREAD_EXPAND_SCRIPT;

  // Open every message's "Show details" panel. Gmail renders the labelled
  // header rows ("from:", "to:", "cc:") ONLY once this is expanded -- the
  // collapsed header shows a single merged summary ("to Shiva, me") in which a
  // Cc recipient is indistinguishable from a To one. Verified live on a
  // deliberately cc-only message: the collapsed DOM put both addresses in the
  // same `.hb span[email]` list with no marker, so the old classifier called
  // both "to" and the To-only rule could never fire.
  const detailsScript = THREAD_DETAILS_SCRIPT;

  // ".adn.ads" is Gmail's historical class for an expanded message container.
  //
  // CC EXTRACTION IS NOW VERIFIED LIVE (2026-09-09). It previously was not, and
  // it was wrong: recipients were classified by looking for an ancestor Gmail
  // labels as Cc (`[aria-label^="Cc"]`, `.cc`, `[data-recipient-kind="cc"]`),
  // and live Gmail uses none of those on a received message. Every cc'd address
  // came back as "to", so the To-only rule saw the owner as a direct recipient
  // of mail they were merely cc'd on and would have drafted a reply to it.
  // Caught by a real cc-only message whose Gmail headers read
  // "to: shiva@bimacred.com / cc: shiva@gostych.cc" while getThread returned
  // to: [both], cc: [].
  const scrapeScript = THREAD_SCRAPE_SCRIPT;

  (async () => {
    // 20s, not the original 5s: a thread genuinely took 19.6s to render on a
    // measured, authenticated load. This is a CEILING, not a delay -- it resolves
    // the instant the selector appears, so a fast load still returns in ~2s, and
    // getThread is on SLOW_SKILL_FUNCTIONS (90s) so there is budget.
    //
    // DIAGNOSTIC TRAP, worth knowing before you raise this number again: when the
    // Google browser session has lapsed, Gmail serves accounts.google.com's
    // account chooser instead of the thread, so h2.hP NEVER appears and this
    // surfaces as a plain "Timeout Nms exceeded" -- indistinguishable from a slow
    // page. Raising the timeout does nothing for that case (verified live: 45s
    // timed out identically). browserInteract's checkUrlRedirect would catch it,
    // but it only runs on a 2xx; a selector timeout returns HTTP 500 first, so the
    // redirect is never inspected. If this times out repeatedly, check the final
    // URL before assuming the page is slow.
    const pageActions = [
      { action: "waitForSelector", selector: "h2.hP", delay: 20000 },
      { action: "evaluate", script: expandScript },
      { action: "wait", delay: 800 },
      { action: "evaluate", script: detailsScript },
      // The details panel renders asynchronously after the click; without this
      // the scrape reads the collapsed header and every recipient falls back to
      // the unverified path.
      { action: "wait", delay: 1500 },
    ];
    // PERSISTENT path, like every other Gmail read/write in this skill
    // (getDraft, findDraftForThread, createReplyDraft, discardDraft). getThread
    // was the last one still using the one-shot browserInteract, and measured
    // across a long live session that path was markedly less reliable: it
    // repeatedly landed on accounts.google.com's chooser, or timed out waiting
    // for h2.hP, at moments when a persistent context on the SAME browser
    // session was loading Gmail perfectly well. A persistent context holds an
    // authenticated page rather than re-establishing one per call.
    // ONE CALL: navigate and scrape in a single persistentCreate, never
    // create-then-interact.
    //
    // WHY (2026-09-09, observed live): a persistent session is a SHARED page --
    // a second caller asking for the same browser session is handed this exact
    // page. The platform now serializes individual operations, but a split
    // sequence still leaves a window BETWEEN them, and another caller's
    // navigation lands in it. Reproduced with three concurrent calls: this
    // function returned a scrape of a DIFFERENT thread while echoing back the
    // requested threadId, so the wrong conversation looked like the right one.
    //
    // That is the worst failure this function has, because its answer decides
    // draft eligibility AND the reply-all recipient list -- a plausible draft on
    // someone else's thread, with no error anywhere. Passing the page actions to
    // persistentCreate closes the window entirely: navigation and scrape are one
    // locked operation. checkEngagedDomains has always done it this way.
    //
    // gmailViewUrl, not a bare fragment: on a reused persistent page a
    // fragment-only goto is a same-document navigation that leaves the previous
    // view up (see _gmailNav.ts).
    // Task 4: opening the thread view marks the thread READ. Probe whether it was unread BEFORE
    // that happens (the probe establishes the held session, so nothing else can interleave
    // between "was it unread" and "mark it read"), then restore afterwards on the SAME session.
    let psId = "";
    let result: any;
    let restoredUnread = false;
    // Evidence trail (2026-09-24): a live report of a thread that still ends up read despite
    // restoredUnread:false, with no way to tell which step failed. Hoisted out of the try so the
    // threadResult built after it can carry them; stderr on a successful call is discarded, so
    // this has to travel in the JSON result itself.
    let probeReady = false;
    let probeIds = 0;
    let threadWasUnreadFlag = false;
    let markResult: MarkResult | undefined;
    let markCands: string | undefined;
    let markConfirm: string | undefined;
    let markWaitedMs: number | undefined;
    try {
      const probeQuery = unreadProbeQuery();
      const probeResult = await persistentCreate(
        gmailViewUrl(`#search/${urlencode(probeQuery)}`),
        [
          { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(probeQuery), unreadIdsExpr(), PROBE_POLL_MS) },
        ],
        { holdLock: true },
      );
      psId = probeResult?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for the Gmail thread");
      }
      const threadWasUnread = wasUnread(probeResult?.content, threadId);
      threadWasUnreadFlag = threadWasUnread;
      const probe = probeSummary(probeResult?.content);
      probeReady = probe.ready;
      probeIds = probe.count;

      // `#all/<id>`, not `#inbox/<id>` (2026-09-22, live): the inbox route resolves only while
      // the thread is still IN the inbox. A thread the owner replied to and archived — the one
      // a reply-card reconcile most needs to read — rendered nothing for 20s under #inbox and
      // the read failed. getThreads' by-id path has used #all since it was written.
      result = await persistentInteract(psId, [
        ...pageActions,
        { action: "evaluate", script: scrapeScript },
      ], false, undefined, gmailViewUrl(`#all/${threadId}`));

      // Fix round 1 (Critical): persistentInteractRaw, never persistentInteract — persistentInteract
      // exits the process (errorJson -> process.exit(1)) on an HTTP >= 400, which makes the
      // surrounding catch dead code. The thread was just read successfully; a slow/failed restore
      // must degrade to restoredUnread:false, never take the read itself down with it (`finally`'s
      // persistentClose, and the cache write below, must still run).
      //
      // Fix round 1 (Important #3): skipped outright once too much of the 90s
      // SLOW_SKILL_TIMEOUT_MS ceiling is already spent — the read's own result matters far more
      // than restoring unread.
      if (threadWasUnread) {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > RESTORE_BUDGET_MS) {
          console.error(`[getThread] skipping unread restore — ${elapsedMs}ms elapsed, past the ${RESTORE_BUDGET_MS}ms restore budget`);
          markResult = "skipped-budget";
        } else {
          try {
            const { httpCode, body } = await persistentInteractRaw(psId, [{ action: "evaluate", script: MARK_UNREAD_SCRIPT }]);
            if (httpCode >= 400) {
              markResult = `http-${httpCode}`;
            } else {
              const c = typeof body?.content === "string" ? body.content : "";
              const parsedMark = parseMarkResult(c);
              markResult = parsedMark.marked ? "marked" : "no-control";
              markCands = parsedMark.cands;
              if (parsedMark.confirm) markConfirm = parsedMark.confirm;
              markWaitedMs = parsedMark.waitedMs;
              restoredUnread = parsedMark.marked;
            }
          } catch {
            markResult = "error";
            restoredUnread = false;
          }
        }
      }
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }
    const content = result?.content || "{}";
    let parsed: any;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      parsed = { subject: "", rows: [], expectedCount: 0 };
    }
    const messages = messagesFromThreadDom(Array.isArray(parsed.rows) ? parsed.rows : []);
    const completeness = assessThreadCompleteness(messages, Number(parsed.expectedCount) || 0);
    const unreadDiag: UnreadDiag = {
      probeReady,
      probeIds,
      wasUnread: threadWasUnreadFlag,
      ...(markResult !== undefined ? { markResult } : {}),
      ...(markCands !== undefined ? { markCands } : {}),
      ...(markConfirm !== undefined ? { markConfirm } : {}),
      ...(markWaitedMs !== undefined ? { markWaitedMs } : {}),
    };
    const threadResult = {
      threadId,
      subject: parsed.subject || "",
      messages,
      incomplete: completeness.incomplete,
      reason: completeness.reason,
      hasDraft: parsed.hasDraft === true,
      readVia: "thread",
      restoredUnread,
      unreadDiag,
    };
    // Store the fresh read for the next caller (writeCachedThread stores only COMPLETE reads and
    // swallows any fs failure), then hand back the result untouched — a cache write never affects it.
    writeCachedThread(threadId, threadResult);
    emitResult(threadResult);
  })();
}
