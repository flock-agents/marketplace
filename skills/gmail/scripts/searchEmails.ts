// Gmail search, on the PERSISTENT browser path.
//
// WHY IT MOVED (2026-09-09). This was the last caller in the skill still using
// `browserWrite`, the one-shot path: every call re-establishes authentication
// from the stored cookies, opens a page, and throws the context away. The
// drafting routine makes up to FOUR of these back to back per email (Ghostwriter
// §1: one `from:me to:<sender>` plus at most three `from:me <item>` searches),
// and that is the shape that kept landing on accounts.google.com's account
// chooser while a persistent context on the SAME browser session was loading
// Gmail perfectly well. getThread and checkEngagedDomains were both migrated for
// this exact symptom; their notes carry the evidence.
//
// It is worth being precise about what this does and does not fix. The
// sign-out that cost 2026-09-09 an afternoon was NOT the one-shot path: it was
// checkUrlRedirect matching `accounts.google.com` inside our OWN search URL and
// marking the session outdated. That is fixed elsewhere. What remains, and what
// this addresses, is that the one-shot path was measurably the less reliable of
// the two under a long live session.
//
// A page that did not finish rendering is NEVER reported as a search with no
// results. An empty result here is evidence the caller acts on -- the drafting
// prompt brackets a value as a GAP precisely because a search for it came back
// empty -- so "the page never rendered" and "there is nothing to find" must not
// collapse into the same `[]`.

import {
  errorJson,
  emitResult,
  requireBrowserSession,
  urlencode,
  persistentCreate,
  persistentClose,
} from "../../_shared/_google_helpers";
import { gmailViewUrl, pollInPageScript, parsePollResult, searchViewReadyExpr } from "./_gmailNav";

// --- Pure helpers (unit-tested, no browser) ---

/**
 * The URL for a search view. `gmailViewUrl`, not a bare `#search/...`: a
 * persistent session reuses its page, and two URLs differing only in the
 * fragment are ONE document to `page.goto` -- it resolves immediately and the
 * scrape reads whatever search was on screen before (see _gmailNav.ts).
 */
export function searchViewUrl(query: string, nonce: string | number = Date.now()): string {
  return gmailViewUrl(`#search/${urlencode(query)}`, nonce);
}

/**
 * Read the poll response back: did the results view settle, and what rows were
 * on it. Anything unreadable is "not ready with nothing found", never a throw
 * and never a bare empty list -- see the header note on why those differ.
 */
export function parseSearchOutcome(content: unknown): { ready: boolean; emails: unknown[] } {
  const { ready, result } = parsePollResult<string>(content);
  if (!ready) return { ready: false, emails: [] };
  try {
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    if (!Array.isArray(parsed)) return { ready: false, emails: [] };
    return { ready: true, emails: parsed };
  } catch {
    return { ready: false, emails: [] };
  }
}

// --- Script entrypoint (browser-driven search) ---

// Scrape the result rows. `tr.zA` is the row selector the rest of this skill
// uses. A hoisted FUNCTION rather than a module-level `const`, deliberately: a
// const is not hoisted, and a page script held in one below the invocation guard
// is what broke checkEngagedDomains' first live call with "Cannot access
// 'COUNT_ROWS_SCRIPT' before initialization". See gmail-scripts-load.test.ts.
function rowsExpr(maxResults: number): string {
  return `(() => {
  const maxResults = ${maxResults};
  const rows = document.querySelectorAll('tr.zA');
  const emails = [];
  rows.forEach((row, i) => {
    if (i >= maxResults) return;
    const from = row.querySelector('.yW span')?.getAttribute('email') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const fromName = row.querySelector('.yW span')?.getAttribute('name') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const dateEl = row.querySelector('.xW span');
    const date = dateEl?.textContent?.trim() || '';
    // Same as listInbox: the visible text is a bare time (today) or a bare date, but
    // the title carries the full "Mon, 21 Sept 2026, 19:04". The sweep lists up to
    // 100 threads through this expression and orders them by message time, so it
    // needs the precise one too (owner, 2026-09-22).
    const dateFull = dateEl?.getAttribute('title') || dateEl?.getAttribute('data-tooltip') || '';
    const isUnread = row.classList.contains('zE');
    const link = row.querySelector('.xT a[href]')?.href || '';
    const idMatch = link.match(/#[^/]+\\/(.+)/);
    let id = idMatch ? idMatch[1] : '';
    // The SENT view (and possibly others) renders no '.xT a[href]' permalink at
    // all -- probed live, 50 tr.zA rows, zero anchors. The thread id is instead
    // on a descendant's data attribute: prefer the already-unprefixed legacy id
    // (confirmed live: getThread accepts it directly), and fall back to the
    // '#thread-f:'-prefixed one, stripped, only if that is all there is.
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
    emails.push({ id, from: fromName ? fromName + ' <' + from + '>' : from, subject, snippet, date, dateFull, isUnread });
  });
  return JSON.stringify(emails);
})()`;
}

// Gated on SKILL_PARAMS so importing this module for its pure exports in a test
// never touches the browser -- skill-executor always sets SKILL_PARAMS (even
// "{}") on the spawned process; a plain `import` from a test does not.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const query: string = params.query || "";
  let maxResults = parseInt(params.maxResults, 10);
  if (isNaN(maxResults) || maxResults <= 0) maxResults = 10;

  requireBrowserSession();

  if (!query) {
    errorJson("MISSING_PARAM", "query is required");
  }

  (async () => {
    let psId = "";
    let result: any;
    try {
      // `.AO` is the results CONTAINER and it renders ~1s before the rows do, so
      // waiting on it alone counts an empty list on a search that has plenty of
      // matches (measured: checkEngagedDomains read 0 for a domain Gmail showed 9
      // conversations for). The in-page poll below is what actually decides the
      // view has settled; this selector is only the cheap first gate.
      result = await persistentCreate(searchViewUrl(query), [
        { action: "waitForSelector", selector: ".AO", delay: 20000 },
        { action: "evaluate", script: pollInPageScript(searchViewReadyExpr(query), rowsExpr(maxResults), 20000) },
      ]);
      psId = result?.persistentSessionId || "";
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }

    const { ready, emails } = parseSearchOutcome(result?.content);
    if (!ready) {
      errorJson("BROWSER_ERROR", `Gmail search for "${query}" did not finish rendering — refusing to report it as no results.`);
    }
    emitResult(emails);
  })().catch((err: any) => {
    errorJson("BROWSER_ERROR", `Gmail search failed: ${err?.message || err}`);
  });
}
