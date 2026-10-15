// getThreads.ts — read MANY threads in ONE held, authenticated browser session.
//
// THE POINT. Today a caller that wants N threads makes N separate getThread calls, and each one is a
// full persistentCreate + persistentClose — it establishes an authenticated Gmail page and tears it
// down, PER THREAD. getThreads establishes the session ONCE, holds the lock, walks every thread on
// that same page, and closes once. One session for the whole crawl means: no per-thread
// re-establishment, one paced human-shaped session instead of N cold ones (bot-safety), and — because
// the lock is HELD for the whole crawl — no window for another caller to interleave and make a thread
// read scrape the wrong conversation (getThread's documented worst failure).
//
// Each thread is read through Gmail's PRINT VIEW by default (see _printView.ts) — a static document,
// one navigation per thread, that does not mark the thread read and needs no row click, no
// in-session hop, and no identity guard (a fresh navigation to `th=<id>` can't land on the wrong
// thread the way a stale in-session view could). This replaced an earlier in-session-hop-with-
// reload-fallback design (see git history) once the print-view parser (Task 1) made a same-page read
// available.
//
// `params.view: "thread"` opts back into a real conversation-view read (forced reload per thread, no
// in-session hop, no identity guard — those stay retired). A print read ALWAYS reports
// `hasDraft:false` (PRINT_VIEW_SHOWS_DRAFTS is false by owner ruling, 2026-09-24 — see _printView.ts), so any
// caller whose judgment depends on a trustworthy `hasDraft` MUST pass `view: "thread"` — the
// owner-mandated draft_exists safety rule still does. reply-card-reconcile does NOT: as of
// 2026-09-24 it no longer reads a thread's `hasDraft` at all — draft presence comes from the
// drafts list itself (listDraftThreads, #drafts page by page, opens no conversation), and its
// print read here only supplies messages for the sent/discarded judgment. `view: "thread"` has no
// current caller.
//
// The caller declares WHAT it wants — declarative `filters` + `limit` + `offset`. The connector owns
// HOW (search, hold, pace, scrape). Reuses the exact proven scrape via _threadScrape.

import {
  errorJson,
  emitResult,
  requireBrowserSession,
  urlencode,
  persistentCreate,
  persistentInteractRaw,
  persistentClose,
} from "../../_shared/_google_helpers";
import { buildThreadsQuery, type ThreadFilters } from "./_gmailQuery";
import { gmailViewUrl, searchViewReadyExpr, pollInPageScript, parsePollResult } from "./_gmailNav";
import { unreadProbeQuery, unreadIdsExpr, unreadIdsFrom, probeSummary, MARK_UNREAD_SCRIPT, parseMarkResult, type MarkResult, type UnreadDiag } from "./_unreadState";
import {
  THREAD_EXPAND_SCRIPT,
  THREAD_DETAILS_SCRIPT,
  THREAD_SCRAPE_SCRIPT,
  messagesFromThreadDom,
  assessThreadCompleteness,
  type ThreadMessage,
} from "./_threadScrape";
import { printViewUrl, PRINT_BLOCKS_EXPR, rowsFromPrintBlocks, PRINT_VIEW_SHOWS_DRAFTS, type PrintBlock } from "./_printView";
import { readCachedThread, writeCachedThread } from "./_threadCache";

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 15;
// Per-message body cap (chars). A batch result is MANY threads in ONE payload, and the platform
// caps a skill result's size; full bodies (one measured at 12.5K chars) overflowed it and the
// caller received an unparseable result. The caller says how much body it needs (`maxBodyChars`);
// this default keeps a 25-thread page comfortably inside the cap.
const DEFAULT_MAX_BODY_CHARS = 8_000;
// Per-thread wall-clock budget the WHOLE crawl is scaled from, so an unset call still terminates and
// returns a partial rather than being killed. A print-view read is ~9-12s + pacing.
const PER_THREAD_BUDGET_MS = 20_000;
const MAX_BUDGET_MS = 5 * 60_000;
const PACE_MIN_MS = 2_000;
const PACE_MAX_MS = 6_000;
const SEARCH_READY_TIMEOUT_MS = 20_000;
// Final review I1: the probe must never be able to FAIL the operation it rides on. It used to open
// with a `waitForSelector ".AO"` action -- a timeout there makes persistentCreate call errorJson and
// the process exits, so a slow Gmail load killed a draft/read that used to succeed. The session is now
// established by the navigation alone, and the readiness wait lives INSIDE the probe poll, which
// returns ready:false instead of throwing; an unsettled probe counts as "not unread" (fail-closed).
// 20s is the skill's usual cold-load ceiling.
const PROBE_POLL_MS = 20_000;

/** Scrape the search result rows into [{ id, subject, ... }] — VERBATIM the proven rowsExpr from
 *  searchEmails.ts (a skill script we cannot import). `tr.zA` rows; the id prefers the `.xT a[href]`
 *  permalink and falls back to `data-legacy-thread-id` (the SENT view renders no permalink at all).
 *  A hoisted function, not a const, so the guard below can reference it (const-TDZ bug, see
 *  gmail-scripts-load.test.ts). */
function rowsExpr(maxResults: number): string {
  return `(() => {
  const maxResults = ${maxResults};
  const rows = document.querySelectorAll('tr.zA');
  const emails = [];
  rows.forEach((row, i) => {
    if (i >= maxResults) return;
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const link = row.querySelector('.xT a[href]')?.href || '';
    const idMatch = link.match(/#[^/]+\\/(.+)/);
    let id = idMatch ? idMatch[1] : '';
    if (!id) {
      const legacyEl = row.querySelector('[data-legacy-thread-id]');
      const legacyId = legacyEl ? legacyEl.getAttribute('data-legacy-thread-id') || '' : '';
      if (legacyId) {
        id = legacyId;
      } else {
        const threadEl = row.querySelector('[data-thread-id]');
        const rawThreadId = threadEl ? threadEl.getAttribute('data-thread-id') || '' : '';
        id = rawThreadId.indexOf('#thread-f:') === 0 ? rawThreadId.slice('#thread-f:'.length) : rawThreadId;
      }
    }
    if (id) emails.push({ id: id, subject: subject });
  });
  return JSON.stringify(emails);
})()`;
}

const clampLimit = (n: unknown): number => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(v, MAX_LIMIT);
};

const bodyCapFrom = (n: unknown): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_BODY_CHARS;
};

/** Inter-thread pace, overridable by the caller. A background crawl keeps the human-shaped 2-6s;
 *  an INTERACTIVE one (onboarding — a user is watching) passes 0: the in-session click, the render
 *  poll and the scrape's own waits are already a person's rhythm, and 19 gaps of 2-6s were ~70s of
 *  pure waiting on a 20-thread voice crawl. */
const paceFrom = (n: unknown, fallback: number): number => {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
};

/** Trim each message body to the caller's cap. Applied once, where a thread joins the result.
 *  bodyMain (Task 27) is a prefix of body, so it is cut at the same length; once nothing of the
 *  quoted history is left after it, it says nothing and is dropped. */
function capBodies(messages: ThreadMessage[], maxChars: number): ThreadMessage[] {
  return messages.map((m) => {
    if (m.body.length <= maxChars) return m;
    const { bodyMain, ...rest } = m;
    const body = m.body.slice(0, maxChars);
    return bodyMain !== undefined && bodyMain.length < body.length ? { ...rest, body, bodyMain } : { ...rest, body };
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const jitter = (min: number, max: number, i: number): number => {
  const lo = Math.max(0, min), hi = Math.max(lo, max), spread = hi - lo;
  return Math.round(lo + spread * (((i * 2654435761) % 1000) / 1000)); // deterministic, non-flat
};

/** Parse the scrape evaluate's content into { subject, rows, expectedCount, hasDraft }, tolerant of
 *  either a JSON string or an already-parsed object, and of a hollow read. */
function parseScrape(content: unknown): { subject: string; rows: unknown[]; expectedCount: number; hasDraft: boolean } {
  let parsed: any;
  try { parsed = typeof content === "string" ? JSON.parse(content) : content; } catch { parsed = null; }
  return {
    subject: parsed?.subject || "",
    rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
    expectedCount: Number(parsed?.expectedCount) || 0,
    hasDraft: parsed?.hasDraft === true,
  };
}

/** Parse the print-view evaluate's content into { subject, blocks, draftMarker }, tolerant of either
 *  a JSON string or an already-parsed object, and of a hollow read. A hoisted `function`, not a
 *  `const`, for the same TDZ reason as `rowsExpr` above (see gmail-scripts-load.test.ts). */
function parsePrint(content: unknown): { subject: string; blocks: PrintBlock[]; draftMarker: boolean } {
  try {
    const p = JSON.parse(typeof content === "string" ? content : "{}");
    return { subject: String(p?.subject ?? ""), blocks: Array.isArray(p?.blocks) ? p.blocks : [], draftMarker: p?.draftMarker === true };
  } catch { return { subject: "", blocks: [], draftMarker: false }; }
}

// The hold on the session must outlive the crawl's own budget, or the platform's default cap
// (sized for a six-step compose) releases it mid-crawl — measured at exactly 180s, twice.
const HOLD_GRACE_MS = 30_000;

type StepError = Error & { fatal?: boolean };

/** One browser step that THROWS on failure instead of exiting the process, so one thread's
 *  failure stays one thread's failure. A 403 (session not ready, access denied) is fatal for
 *  the whole crawl — nothing after it can read either. */
async function interactOrThrow(psId: string, actions: any[], url?: string): Promise<any> {
  const { httpCode, body } = await persistentInteractRaw(psId, actions, false, undefined, url);
  if (httpCode >= 400) {
    const err: StepError = new Error(`HTTP ${httpCode}: ${body?.error || body?.message || "(unknown)"}`);
    err.fatal = httpCode === 403;
    throw err;
  }
  return body;
}

if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  requireBrowserSession();

  // "print" (default) reads through print view, leaving the thread unread but always with
  // hasDraft:false; "thread" opts into a real conversation-view read (forced reload, no in-session
  // hop, no identity guard) for a caller whose judgment needs a trustworthy hasDraft.
  const view: "print" | "thread" = params.view === "thread" ? "thread" : "print";
  const filters: ThreadFilters = (params.filters && typeof params.filters === "object") ? params.filters : {};
  // BY ID (the harvest's shape): the caller already knows WHICH threads it owes — rows it
  // claimed from its ledger — so there is no search; each id is opened on the one held session
  // with its own per-thread read (print-view or conversation-view, per `view`). Capped like a page;
  // the caller chunks the rest.
  const threadIds: string[] | null = Array.isArray(params.threadIds)
    ? params.threadIds.map((v: unknown) => String(v ?? "").trim()).filter(Boolean).slice(0, MAX_LIMIT)
    : null;
  const byId = threadIds !== null;
  const limit = byId ? Math.max(1, threadIds.length) : clampLimit(params.limit);
  const offset = byId ? 0 : Math.max(0, Math.floor(Number(params.offset) || 0));
  const maxBodyChars = bodyCapFrom(params.maxBodyChars);
  const paceMinMs = paceFrom(params.paceMinMs, PACE_MIN_MS);
  const paceMaxMs = Math.max(paceMinMs, paceFrom(params.paceMaxMs, PACE_MAX_MS));
  const budgetMs = Number.isFinite(params.timeoutMs) && Number(params.timeoutMs) > 0
    ? Number(params.timeoutMs)
    : Math.min(limit * PER_THREAD_BUDGET_MS, MAX_BUDGET_MS);
  const startedAt = Date.now();

  // Crawl state lives OUTSIDE the async body, so the catch at its end can hand back a partial result.
  const query = byId ? `ids:${threadIds.length}` : buildThreadsQuery(filters);
  let psId = "";
  // Task 4 (Ruling R11): legacy ids that were UNREAD before this crawl opened any thread view — a
  // forced reload marks a thread read, so this is captured by an `in:unread` probe on the SAME
  // held session before the first thread-view read. Stays empty for `view: "print"` (never
  // probed — print never marks a thread read) and for a byId crawl with no cache miss.
  let unreadIds: Set<string> = new Set();
  // Evidence trail (2026-09-24): what the ONE probe that covers this whole crawl actually saw —
  // reported once at the batch level (emitResult below), alongside each thread's own wasUnread /
  // markResult in its entry's unreadDiag (see the per-thread loop). Stays null for `view: "print"`
  // (never probed) and for a byId crawl with no cache miss (no session, no probe, ever established).
  let batchProbeSummary: { probeReady: boolean; probeIds: number } | null = null;
  const threads: unknown[] = [];
  let listed = 0;
  let truncated = false;
  let stoppedAt = offset;
  let failed = 0;

  // Serve one thread from the connector's cache, pushing it as a read with nav "cache" (bodies capped
  // like every other entry). The whole batch honours `forceRefresh`/`bypassCache`/`freshAfter` because
  // readCachedThread reads them off `params`. A hit costs no browser work and no pace gap.
  const pushCacheHit = (threadId: string): boolean => {
    const hit = readCachedThread(threadId, params);
    if (!hit) return false;
    const cachedMessages = Array.isArray(hit.messages) ? (hit.messages as ThreadMessage[]) : [];
    threads.push({ ...hit, messages: capBodies(cachedMessages, maxBodyChars), nav: "cache" });
    return true;
  };

  (async () => {
    try {
      let rows: Array<{ id: string; subject: string }> = [];
      if (byId) {
        // 1 (by id). CACHE FIRST — every id served from the connector's cache needs no browser at all;
        //    a fully-cached chunk establishes no session. Only the misses require the held page below,
        //    each opened by its own per-thread read. `listed` is the whole chunk (all ids were known).
        //    view "print": the session is established directly on the first miss's print view rather
        //    than a generic shell — the per-thread loop below still issues its own navigation per id.
        //    view "thread" (Ruling R11): establishment goes to the UNREAD PROBE instead of the plain
        //    `#inbox` shell — a cache miss means at least one thread WILL be opened by the per-thread
        //    loop below, and that forced reload marks it read, so the probe must run first on this
        //    same session. `unreadIds` is parsed once here.
        listed = threadIds.length;
        const missIds = threadIds.filter((id) => !pushCacheHit(id));
        if (missIds.length === 0) {
          rows = []; // nothing left to read — skip session establishment entirely
        } else if (view === "thread") {
          const probeQuery = unreadProbeQuery();
          const shellRes = await persistentCreate(
            gmailViewUrl(`#search/${urlencode(probeQuery)}`),
            [
              { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(probeQuery), unreadIdsExpr(), PROBE_POLL_MS) },
            ],
            { holdLock: true, holdMaxMs: budgetMs + HOLD_GRACE_MS },
          );
          psId = shellRes?.persistentSessionId || "";
          if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for getThreads");
          unreadIds = unreadIdsFrom(shellRes?.content);
          const probe = probeSummary(shellRes?.content);
          batchProbeSummary = { probeReady: probe.ready, probeIds: probe.count };
          rows = missIds.map((id) => ({ id, subject: "" }));
        } else {
          const shellRes = await persistentCreate(
            printViewUrl(missIds[0]),
            [{ action: "waitForSelector", selector: "table.message", delay: 20000 }],
            { holdLock: true, holdMaxMs: budgetMs + HOLD_GRACE_MS },
          );
          psId = shellRes?.persistentSessionId || "";
          if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for getThreads");
          rows = missIds.map((id) => ({ id, subject: "" }));
        }
      } else if (view === "thread") {
        // 1 (filters, view "thread", Ruling R11). The session is established on the UNREAD PROBE
        // first — same reasoning as the byId branch above: a thread-view crawl opens (and marks
        // read) every thread it reads, so the probe must land before the first one does. The
        // existing search (offset+limit rows) then runs as an in-session navigation on the SAME
        // held session, exactly the read the "print"/else branch below does directly.
        const probeQuery = unreadProbeQuery();
        const probeRes = await persistentCreate(
          gmailViewUrl(`#search/${urlencode(probeQuery)}`),
          [
            { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(probeQuery), unreadIdsExpr(), PROBE_POLL_MS) },
          ],
          { holdLock: true, holdMaxMs: budgetMs + HOLD_GRACE_MS },
        );
        psId = probeRes?.persistentSessionId || "";
        if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for getThreads");
        unreadIds = unreadIdsFrom(probeRes?.content);
        const probe = probeSummary(probeRes?.content);
        batchProbeSummary = { probeReady: probe.ready, probeIds: probe.count };

        const searchBody = await interactOrThrow(
          psId,
          [
            { action: "waitForSelector", selector: ".AO", delay: 20000 },
            { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(query), rowsExpr(offset + limit), SEARCH_READY_TIMEOUT_MS) },
          ],
          gmailViewUrl(`#search/${urlencode(query)}`),
        );
        const poll = parsePollResult<string>(searchBody?.content);
        try { rows = JSON.parse(poll.result || "[]"); } catch { rows = []; }
        listed = rows.length; // byId already set listed to the whole chunk before any cache lookup
      } else {
        // 1. ESTABLISH + SEARCH, holding the lock for the whole crawl. One poll: wait until the search
        //    we asked for is the view on screen (searchViewReadyExpr guards against a stale prior view),
        //    then scrape the rows in the same round trip.
        const searchRes = await persistentCreate(
          gmailViewUrl(`#search/${urlencode(query)}`),
          [
            // `.AO` is the results container; it renders ~1s before the rows, so the poll below is what
            // decides the view settled (mirrors searchEmails.ts exactly). Scrape offset+limit rows.
            { action: "waitForSelector", selector: ".AO", delay: 20000 },
            { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(query), rowsExpr(offset + limit), SEARCH_READY_TIMEOUT_MS) },
          ],
          { holdLock: true, holdMaxMs: budgetMs + HOLD_GRACE_MS },
        );
        psId = searchRes?.persistentSessionId || "";
        if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for getThreads");

        const poll = parsePollResult<string>(searchRes?.content);
        try { rows = JSON.parse(poll.result || "[]"); } catch { rows = []; }
        listed = rows.length; // byId already set listed to the whole chunk before any cache lookup
      }

      const windowRows = rows.slice(offset, offset + limit);
      stoppedAt = offset;

      // 2. Read each thread IN THE SAME held session, one navigation per thread — both modes (byId and
      //    filters) alike, no in-session hop, no identity guard (retired: a fresh navigation, whether
      //    to print view or to `#all/<id>`, can't land on the wrong thread the way a stale in-session
      //    view could). `view` picks WHICH navigation: print view (default) or a forced reload of the
      //    real conversation view (`view: "thread"`, for a caller that needs a trustworthy hasDraft).
      //    ONE THREAD'S FAILURE IS ONE THREAD'S FAILURE (live, 2026-09-20): a failed read is recorded
      //    and the loop moves on rather than losing the whole batch. Budget-gated; paced between opens.
      for (let i = 0; i < windowRows.length; i++) {
        const threadId = windowRows[i].id;
        const expectedSubject = windowRows[i].subject || "";

        // CACHE FIRST (filters mode). A hit is served without touching the browser, so it never spends
        // the budget or a pace gap. byId misses were already cache-checked above, so only the filters
        // path looks here. readCachedThread itself refuses to serve a print-view entry to a `view:
        // "thread"` caller (see _threadCache.ts), so this is never a false hit.
        if (!byId && pushCacheHit(threadId)) { stoppedAt = offset + i + 1; continue; }

        if (Date.now() - startedAt >= budgetMs) { truncated = true; break; }

        let r: any = null;
        let parsed = parseScrape(null);
        let messages = messagesFromThreadDom(parsed.rows as never);
        let completeness = assessThreadCompleteness(messages, parsed.expectedCount);
        const nav = view;
        // Task 4: set only for a live (non-cache, non-failed) `view: "thread"` read of a thread that
        // was in `unreadIds` — undefined for every other case, so the field is simply absent rather
        // than a misleading `false` on an entry the restore was never attempted for.
        let restoredUnread: boolean | undefined;
        // Evidence trail (2026-09-24): per-thread unreadDiag, set only on a live `view: "thread"`
        // read (undefined for print/cache/failed) — this thread's own wasUnread + what the mark
        // click reported, alongside the ONE probe's ready/count that covers the whole crawl.
        let threadUnreadDiag: UnreadDiag | undefined;
        let threadMarkResult: MarkResult | undefined;
        let threadMarkCands: string | undefined;
        let threadMarkConfirm: string | undefined;
        let threadMarkWaitedMs: number | undefined;

        try {
          if (view === "print") {
            r = await interactOrThrow(psId, [
              { action: "waitForSelector", selector: "table.message", delay: 20000 },
              { action: "evaluate", script: PRINT_BLOCKS_EXPR },
            ], printViewUrl(threadId));
            const p = parsePrint(r?.content);
            parsed = { subject: p.subject, rows: rowsFromPrintBlocks(p.blocks), expectedCount: p.blocks.length, hasDraft: PRINT_VIEW_SHOWS_DRAFTS ? p.draftMarker : false };
          } else {
            // FORCED RELOAD of THIS thread on the held session (the proven getThread nav) — the
            // in-session hop and its identity guard stay retired; every thread-view read pays this.
            r = await interactOrThrow(psId, [
              { action: "waitForSelector", selector: "h2.hP", delay: 20000 },
              { action: "evaluate", script: THREAD_EXPAND_SCRIPT },
              { action: "wait", delay: 800 },
              { action: "evaluate", script: THREAD_DETAILS_SCRIPT },
              { action: "wait", delay: 1500 },
              { action: "evaluate", script: THREAD_SCRAPE_SCRIPT },
            ], gmailViewUrl(`#all/${threadId}`));
            parsed = parseScrape(r?.content);

            // Task 4: put the unread state back, still on this held session, still on this thread's
            // page — right after the forced reload that just marked it read. A failed mark never
            // fails the thread read (this is the read the caller actually asked for).
            const threadWasUnread = unreadIds.has(threadId);
            if (threadWasUnread) {
              try {
                const back = await interactOrThrow(psId, [{ action: "evaluate", script: MARK_UNREAD_SCRIPT }]);
                const c = typeof back?.content === "string" ? back.content : "";
                const parsedMark = parseMarkResult(c);
                threadMarkResult = parsedMark.marked ? "marked" : "no-control";
                threadMarkCands = parsedMark.cands;
                if (parsedMark.confirm) threadMarkConfirm = parsedMark.confirm;
                threadMarkWaitedMs = parsedMark.waitedMs;
                restoredUnread = parsedMark.marked;
              } catch {
                // interactOrThrow already exits on HTTP >= 400, so only a thrown error reaches here.
                threadMarkResult = "error";
                restoredUnread = false;
              }
            }
            threadUnreadDiag = {
              probeReady: batchProbeSummary?.probeReady ?? false,
              probeIds: batchProbeSummary?.probeIds ?? 0,
              wasUnread: threadWasUnread,
              ...(threadMarkResult !== undefined ? { markResult: threadMarkResult } : {}),
              ...(threadMarkCands !== undefined ? { markCands: threadMarkCands } : {}),
              ...(threadMarkConfirm !== undefined ? { markConfirm: threadMarkConfirm } : {}),
              ...(threadMarkWaitedMs !== undefined ? { markWaitedMs: threadMarkWaitedMs } : {}),
            };
          }
          messages = messagesFromThreadDom(parsed.rows as never);
          completeness = assessThreadCompleteness(messages, parsed.expectedCount);
        } catch (e: any) {
          if ((e as StepError)?.fatal) throw e;
          const reason = `read_failed: ${e?.message || e}`;
          console.error(`[getThreads] ${view} read of ${threadId} failed — recorded, moving on (${reason})`);
          threads.push({ threadId, subject: expectedSubject, messages: [], incomplete: true, reason, hasDraft: false, nav: "failed", readVia: view });
          failed++;
          stoppedAt = offset + i + 1;
          if (i < windowRows.length - 1 && paceMaxMs > 0) await sleep(jitter(paceMinMs, paceMaxMs, i));
          continue;
        }

        // Store the FULL (uncapped) read for the next caller, exactly as getThread would. writeCachedThread
        // stores only complete reads and swallows any fs failure, so a failed/partial read above is never
        // cached and a cache write never affects this batch's result. The pushed copy is still body-capped.
        // `readVia` travels into the cache entry (not stripped — see _threadCache.ts's PROVENANCE_FIELDS)
        // so a later `view: "thread"` reader can refuse a cached print read.
        writeCachedThread(threadId, {
          threadId,
          subject: parsed.subject,
          messages,
          incomplete: completeness.incomplete,
          reason: completeness.reason,
          hasDraft: parsed.hasDraft,
          readVia: view,
        });
        threads.push({
          threadId,
          subject: parsed.subject,
          messages: capBodies(messages, maxBodyChars),
          incomplete: completeness.incomplete,
          reason: completeness.reason,
          hasDraft: parsed.hasDraft,
          nav, // "print"/"thread" (or "cache"/"failed" — see pushCacheHit and the catch above)
          readVia: view,
          ...(restoredUnread !== undefined ? { restoredUnread } : {}),
          ...(threadUnreadDiag !== undefined ? { unreadDiag: threadUnreadDiag } : {}),
        });
        stoppedAt = offset + i + 1;

        if (i < windowRows.length - 1 && paceMaxMs > 0) await sleep(jitter(paceMinMs, paceMaxMs, i));
      }
    } finally {
      // Release the hold FIRST, whatever happened: a hold that outlives the script blocks the next
      // caller on this mailbox until it idles out (measured: the fallback's own search waited 30s).
      if (psId) await persistentClose(psId).catch((e: any) => console.error(`[getThreads] session close failed: ${e?.message || e}`));
    }

    emitResult({
      query,
      listed,
      read: threads.length,
      failed,
      offset,
      limit,
      threads,
      truncated,
      nextOffset: truncated ? stoppedAt : null, // where to resume; null when the window is exhausted
      // Batch-level probe summary (2026-09-24 evidence trail): the ONE probe that covers this
      // whole crawl, reported once here — each thread's own wasUnread/markResult lives in its
      // entry's own unreadDiag above. Absent for `view: "print"` and a fully-cached byId chunk,
      // neither of which ever establishes a probe.
      ...(batchProbeSummary ? { unreadDiag: batchProbeSummary } : {}),
    });
  })().catch((err: any) => {
    // A failure OUTSIDE a thread read (the search, the session). Hand back whatever was read
    // rather than nothing; with nothing read, it is the error it always was.
    const message = `getThreads aborted: ${err?.message || err}`;
    if (threads.length === 0) errorJson("BROWSER_ERROR", message);
    emitResult({
      query, listed, read: threads.length, failed, offset, limit, threads, truncated: true, nextOffset: stoppedAt, error: message,
      ...(batchProbeSummary ? { unreadDiag: batchProbeSummary } : {}),
    });
  });
}
