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
// Navigation is the PROVEN forced-reload (gmailViewUrl) on the held page, not a bare fragment: a
// fragment-only goto on a reused persistent page leaves the previous view up (see getThread /
// _gmailNav). Skipping the reload entirely (true in-session hops, the further ~9s-per-thread win) is
// deliberately NOT attempted blind here — it is exactly the wrong-thread class of risk getThread
// avoided, and it needs live validation before it can be trusted.
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
import {
  THREAD_EXPAND_SCRIPT,
  THREAD_DETAILS_SCRIPT,
  THREAD_SCRAPE_SCRIPT,
  messagesFromThreadDom,
  assessThreadCompleteness,
  type ThreadMessage,
} from "./_threadScrape";
import { readCachedThread, writeCachedThread } from "./_threadCache";

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 15;
// Per-message body cap (chars). A batch result is MANY threads in ONE payload, and the platform
// caps a skill result's size; full bodies (one measured at 12.5K chars) overflowed it and the
// caller received an unparseable result. The caller says how much body it needs (`maxBodyChars`);
// this default keeps a 25-thread page comfortably inside the cap.
const DEFAULT_MAX_BODY_CHARS = 8_000;
// Per-thread wall-clock budget the WHOLE crawl is scaled from, so an unset call still terminates and
// returns a partial rather than being killed. A forced-reload read is ~9-12s + pacing.
const PER_THREAD_BUDGET_MS = 20_000;
const MAX_BUDGET_MS = 5 * 60_000;
const PACE_MIN_MS = 2_000;
const PACE_MAX_MS = 6_000;
const SEARCH_READY_TIMEOUT_MS = 20_000;

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

/** Trim each message body to the caller's cap. Applied once, where a thread joins the result. */
function capBodies(messages: ThreadMessage[], maxChars: number): ThreadMessage[] {
  return messages.map((m) => (m.body.length > maxChars ? { ...m, body: m.body.slice(0, maxChars) } : m));
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

/** IN-SESSION readiness: the thread view switched to a NEW thread (not the one on screen before this
 *  hop) AND its bodies rendered. Setting location.hash fires Gmail's SPA route; polling for "subject
 *  present, DIFFERENT from the previous thread, and body text rendered" is what proves the route
 *  actually happened rather than leaving the previous thread up (getThread's stale-view warning).
 *  `prevSubject` is the last thread scraped — empty on the first hop, when the search list is up. */
function threadChangedReadyExpr(prevSubject: string): string {
  return `(function(){
  var h = document.querySelector('h2.hP');
  var subj = h ? ((h.textContent) || '').trim() : '';
  if (!subj) return false;
  if (subj === ${JSON.stringify(prevSubject)}) return false;
  var bodies = document.querySelectorAll('.a3s.aiL');
  for (var i = 0; i < bodies.length; i++) {
    if (((bodies[i].innerText) || '').trim().length > 0) return true;
  }
  return false;
})()`;
}

/** The identity guard. Loose equality between the search-row subject (.bog, often truncated) and the
 *  thread-view subject (h2.hP): normalise case/whitespace, strip Re:/Fwd:, accept on equality or a
 *  shared >=6-char prefix. A mismatch means the in-session hop landed on the wrong/stale thread, so
 *  the caller re-reads THAT thread with a forced reload. */
function subjectMatches(scraped: string, expected: string): boolean {
  const norm = (s: string) => (s || "").toLowerCase().replace(/^\s*(re|fwd|fw):\s*/i, "").replace(/\s+/g, " ").trim();
  const a = norm(scraped), b = norm(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  const key = (a.length < b.length ? a : b).slice(0, 24);
  return key.length >= 6 && a.startsWith(key) && b.startsWith(key);
}

const THREAD_READY_TIMEOUT_MS = 8_000; // in-session render is ~2-3s; past this, fall back to reload
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

  const filters: ThreadFilters = (params.filters && typeof params.filters === "object") ? params.filters : {};
  // BY ID (the harvest's shape): the caller already knows WHICH threads it owes — rows it
  // claimed from its ledger — so there is no search; each id is opened on the one held session
  // with the proven forced-reload read. Capped like a page; the caller chunks the rest.
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
        //    each opened by the forced-reload read. `listed` is the whole chunk (all ids were known).
        listed = threadIds.length;
        const missIds = threadIds.filter((id) => !pushCacheHit(id));
        if (missIds.length === 0) {
          rows = []; // nothing left to read — skip session establishment entirely
        } else {
          const shellRes = await persistentCreate(
            gmailViewUrl("#inbox"),
            [{ action: "waitForSelector", selector: ".AO", delay: 20000 }],
            { holdLock: true, holdMaxMs: budgetMs + HOLD_GRACE_MS },
          );
          psId = shellRes?.persistentSessionId || "";
          if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for getThreads");
          rows = missIds.map((id) => ({ id, subject: "" }));
        }
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

      // 2. Read each thread IN THE SAME held session. Primary path is IN-SESSION nav: set the hash
      //    (Gmail SPA-routes, no full app reload, ~2-3s) and poll until the view actually switched to
      //    a NEW thread with rendered bodies. Then the exact getThread scrape. The IDENTITY GUARD
      //    (subject matches the search row) catches a stale/wrong hop; on any doubt — mismatch, empty,
      //    incomplete, or a poll that never confirmed — the thread is re-read with the PROVEN forced
      //    reload, so correctness is never traded for speed. Budget-gated; paced between opens.
      let prevSubject = "";
      // Whether a THREAD is on screen (vs the list). Gates the "leave the previous thread" step: it
      // used to be `i > 0`, which was right only while every row was opened — a cache hit skips the
      // open, and a history.back() from the LIST would leave the search altogether (2026-09-21).
      let threadOpen = false;
      for (let i = 0; i < windowRows.length; i++) {
        const threadId = windowRows[i].id;
        const expectedSubject = windowRows[i].subject || "";

        // CACHE FIRST (filters mode). A hit is served without touching the browser, so it never spends
        // the budget or a pace gap, and it leaves `prevSubject` untouched — the on-screen thread did
        // not change. byId misses were already cache-checked above, so only the filters path looks here.
        if (!byId && pushCacheHit(threadId)) { stoppedAt = offset + i + 1; continue; }

        if (Date.now() - startedAt >= budgetMs) { truncated = true; break; }

        let r: any = null;
        let parsed = parseScrape(null);
        let messages = messagesFromThreadDom(parsed.rows as never);
        let completeness = assessThreadCompleteness(messages, parsed.expectedCount);
        let nav = "in-session";
        // By id there is no list to click through: every thread takes the reload read below.
        let inSessionOk = false;

        // ONE THREAD'S FAILURE IS ONE THREAD'S FAILURE (live, 2026-09-20). A page evaluate hung for
        // the browser layer's 30s while Gmail was mid-navigation, the throw left this loop, and the
        // whole batch — 193s of reads — was lost, because the result is emitted only at the end.
        // Now an in-session failure falls to the reload read, and a reload failure records THAT
        // thread as failed and moves on; the batch always returns what it read.
        if (!byId) {
          try {
            // --- IN-SESSION hop. A THREAD view ignores location.hash changes (proven via diag), so to
            //     leave the previous thread we use history.back() — a popstate Gmail DOES honor — landing
            //     back on the search list, from which list→thread hash-nav routes reliably. The first
            //     thread starts already on the list (from the search persistentCreate), so no back().
            const navActions: any[] = [];
            if (threadOpen) {
              // Leave the previous thread the way a person does — click Gmail's back-to-list arrow.
              navActions.push({ action: "evaluate", script: `(() => { var b = document.querySelector('[aria-label="Back to Search results"]') || document.querySelector('[aria-label^="Back to"]') || document.querySelector('div[role="button"][aria-label*="Back"]'); if (b) { b.click(); return 'back-click'; } history.back(); return 'histback'; })()` });
              navActions.push({ action: "evaluate", script: pollInPageScript(searchViewReadyExpr(query), "'list'", 6000) });
            }
            // Open the thread by CLICKING its row in the list (list order matches the scraped rows). This
            // is Gmail's intended interaction and routes reliably where a thread-view hash change does not.
            navActions.push({ action: "evaluate", script: `(() => { var rows = document.querySelectorAll('tr.zA'); var row = rows[${offset + i}]; if (row) { row.click(); return 'row-click'; } return 'no-row'; })()` });
            navActions.push({ action: "evaluate", script: pollInPageScript(threadChangedReadyExpr(prevSubject), "'ready'", THREAD_READY_TIMEOUT_MS) });
            await interactOrThrow(psId, navActions);
            r = await interactOrThrow(psId, [
              { action: "evaluate", script: THREAD_EXPAND_SCRIPT },
              { action: "wait", delay: 800 },
              { action: "evaluate", script: THREAD_DETAILS_SCRIPT },
              { action: "wait", delay: 1200 },
              { action: "evaluate", script: THREAD_SCRAPE_SCRIPT },
            ]);
            parsed = parseScrape(r?.content);
            messages = messagesFromThreadDom(parsed.rows as never);
            completeness = assessThreadCompleteness(messages, parsed.expectedCount);
            inSessionOk = messages.length > 0 && !completeness.incomplete &&
              (!expectedSubject || subjectMatches(parsed.subject, expectedSubject));
          } catch (e: any) {
            if ((e as StepError)?.fatal) throw e;
            console.error(`[getThreads] in-session read of ${threadId} failed (${e?.message || e}) — reloading it`);
            inSessionOk = false;
          }
        }

        if (!inSessionOk) {
          // --- FALLBACK: forced reload of THIS thread on the held session (the proven getThread nav) ---
          nav = "reload";
          try {
            r = await interactOrThrow(psId, [
              { action: "waitForSelector", selector: "h2.hP", delay: 20000 },
              { action: "evaluate", script: THREAD_EXPAND_SCRIPT },
              { action: "wait", delay: 800 },
              { action: "evaluate", script: THREAD_DETAILS_SCRIPT },
              { action: "wait", delay: 1500 },
              { action: "evaluate", script: THREAD_SCRAPE_SCRIPT },
            ], gmailViewUrl(`#all/${threadId}`));
            parsed = parseScrape(r?.content);
            messages = messagesFromThreadDom(parsed.rows as never);
            completeness = assessThreadCompleteness(messages, parsed.expectedCount);
          } catch (e: any) {
            if ((e as StepError)?.fatal) throw e;
            const reason = `read_failed: ${e?.message || e}`;
            console.error(`[getThreads] reload read of ${threadId} failed — recorded, moving on (${reason})`);
            threads.push({ threadId, subject: expectedSubject, messages: [], incomplete: true, reason, hasDraft: false, nav: "failed" });
            failed++;
            stoppedAt = offset + i + 1;
            if (i < windowRows.length - 1 && paceMaxMs > 0) await sleep(jitter(paceMinMs, paceMaxMs, i));
            continue;
          }
        }

        // Store the FULL (uncapped) read for the next caller, exactly as getThread would. writeCachedThread
        // stores only complete reads and swallows any fs failure, so a failed/partial read above is never
        // cached and a cache write never affects this batch's result. The pushed copy is still body-capped.
        writeCachedThread(threadId, {
          threadId,
          subject: parsed.subject,
          messages,
          incomplete: completeness.incomplete,
          reason: completeness.reason,
          hasDraft: parsed.hasDraft,
        });
        threads.push({
          threadId,
          subject: parsed.subject,
          messages: capBodies(messages, maxBodyChars),
          incomplete: completeness.incomplete,
          reason: completeness.reason,
          hasDraft: parsed.hasDraft,
          nav, // "in-session" or "reload" — which path this thread actually took
        });
        prevSubject = parsed.subject || prevSubject;
        threadOpen = true; // every browser path above (in-session, reload, even a failed one) leaves the list
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
    });
  })().catch((err: any) => {
    // A failure OUTSIDE a thread read (the search, the session). Hand back whatever was read
    // rather than nothing; with nothing read, it is the error it always was.
    const message = `getThreads aborted: ${err?.message || err}`;
    if (threads.length === 0) errorJson("BROWSER_ERROR", message);
    emitResult({ query, listed, read: threads.length, failed, offset, limit, threads, truncated: true, nextOffset: stoppedAt, error: message });
  });
}
