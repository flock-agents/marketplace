// Shared, PURE Gmail navigation helpers. No browser, no side effects, no script
// entrypoint — safe to import from another skill script (same rule as
// _draftRows.ts / _draftBody.ts / _composeSave.ts).
//
// WHY THIS EXISTS — the second half of the 2026-09-09 draft bug
// ------------------------------------------------------------
// Every lookup in this skill navigated by Gmail HASH and then slept:
//
//   persistentCreate("https://mail.google.com/mail/u/0/#drafts")
//   persistentInteract(ps, [{ action: "wait", delay: 1500 }], false, SCRAPE)
//
// Both halves are wrong, and together they made healthy drafts invisible.
//
// 1. A persistent session REUSES its page (persistent-browser-sessions.ts:
//    createPersistentSession takes the `existing` branch and calls
//    page.goto(url) on the page that is already open). Two Gmail URLs differ
//    only in the fragment, so that goto is a SAME-DOCUMENT navigation: it
//    resolves immediately, returns no response, and leaves Gmail's SPA to
//    re-route on its own, asynchronously. The script then scrapes whatever
//    view was on screen BEFORE.
//
//    Verified live: a call that asked for `#trash` came back holding the
//    Drafts list, title "Drafts (1)" and all.
//
// 2. 1500ms is not a page load. A cold authenticated Gmail took ~19.6s to
//    render a thread in this same environment, and the drafts list is no
//    faster. The sleep expired long before there was anything to scrape.
//
// The result was a lookup that answered "there is no draft for this thread"
// while the draft sat in Gmail — which is how a draft that HAD been saved
// still came back as `draftId: null`, and why the C3 recovery that exists to
// catch exactly that could not see it either.
//
// THE RULE: land the view, then prove it is ready. Never sleep and hope.

/**
 * A Gmail URL that a reused persistent page cannot satisfy with a same-document
 * hash change. The query string differs from whatever is currently open, so
 * `page.goto` performs a REAL cross-document load and the view we asked for is
 * the view we get.
 *
 * The parameter is ignored by Gmail (verified live across drafts, thread and
 * trash views); it exists purely to make the URL different.
 */
export function gmailViewUrl(hash: string, nonce: string | number = Date.now()): string {
  const fragment = hash.startsWith("#") ? hash : `#${hash}`;
  return `https://mail.google.com/mail/u/0/?flockview=${nonce}${fragment}`;
}

/**
 * Poll IN THE PAGE until a condition holds, then return a result — one round
 * trip, no gap between "ready" and "read", and no fixed sleep. `readyExpr` and
 * `resultExpr` are in-page JS expressions; `readyExpr` must be cheap and must
 * never throw.
 *
 * Returns JSON: { ready: boolean, waitedMs: number, result: <resultExpr> }.
 * A timeout is NOT an error — it returns ready:false with the result read
 * anyway, so a caller can still tell "nothing there" from "never rendered".
 */
export function pollInPageScript(readyExpr: string, resultExpr: string, timeoutMs = 25000): string {
  return pollScript("", readyExpr, resultExpr, timeoutMs);
}

/** pollInPageScript with `prelude` (in-page statements) run once before polling starts, in the
 *  same scope as `readyExpr`, so the readiness test can use what the prelude captured. */
function pollScript(prelude: string, readyExpr: string, resultExpr: string, timeoutMs: number): string {
  return `(async () => {${prelude ? `\n  ${prelude}` : ""}
  const started = Date.now();
  const deadline = started + ${Math.max(0, Math.floor(timeoutMs))};
  const ready = () => { try { return !!(${readyExpr}); } catch (e) { return false; } };
  let ok = false;
  while (Date.now() < deadline) {
    if (ready()) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  let result = null;
  try { result = ${resultExpr}; } catch (e) { result = null; }
  return JSON.stringify({ ready: ok, waitedMs: Date.now() - started, result: result });
})()`;
}

/**
 * The mail-list rows ON SCREEN. Gmail keeps earlier list views in the DOM, hidden (probed
 * 2026-09-24: #drafts held 61 tr.zA for 11 drafts, 50 of them the hidden inbox), so a
 * document-wide count can be another view's rows. Same visibility rule as _draftList.ts.
 */
export const VISIBLE_ROWS_EXPR = `Array.prototype.filter.call(document.querySelectorAll('tr.zA'), function (r) {
    var b = r.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  })`;

/** Gmail's own "this folder is empty" copy. */
const EMPTY_FOLDER_RE_SOURCE = "don't have any saved drafts|no saved drafts|No conversations";

/** Gmail's own "this search found nothing" copy, every phrasing seen live (see searchViewReadyExpr). */
const EMPTY_SEARCH_RE_SOURCE = "No exact matches|No matches|No messages matched|didn't match any|no results found|no results";

/**
 * "A VISIBLE div[role=main] shows this copy." Gmail keeps several mains, earlier views' hidden,
 * and a hidden one's "No matches" is not this view's answer (same pattern as _draftList.ts
 * VISIBLE_EMPTY_DRAFTS_MSG_EXPR).
 */
function visibleMainSaysExpr(reSource: string): string {
  return `Array.prototype.some.call(document.querySelectorAll('div[role="main"]'), function (m) {
    var b = m.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && /${reSource}/i.test(m.innerText || '');
  })`;
}

/**
 * "The mail list has finished rendering" — either it has rows, or Gmail is
 * showing its own empty-folder message. Waiting for rows ALONE would burn the
 * whole ceiling every time a folder is legitimately empty, and then report the
 * same "not ready" a genuinely slow load reports.
 *
 * Deliberately UNCHANGED by the in-app navigation work (2026-11-25): it only backs
 * DRAFTS_VIEW_READY_EXPR, the draft write/update/discard paths' own check, which no in-app
 * navigation uses. Those paths stay byte-for-byte as they were live-verified.
 */
export const LIST_SETTLED_EXPR = `(function(){
  if (document.querySelectorAll('tr.zA').length > 0) return true;
  const main = document.querySelector('div[role="main"]');
  const text = main ? (main.innerText || '') : '';
  return /don't have any saved drafts|no saved drafts|No conversations/i.test(text);
})()`;

// The two ways searchViewReadyExpr reads "rows, else read the main's text". DOCUMENT is the
// live-verified original every search caller uses (createReplyDraft's unread probe among them,
// left exactly as it was). VISIBLE reads only what is on screen: Gmail keeps earlier views, and
// several mains, hidden. It is what an in-app navigation needs (checkEngagedDomains), where the
// previous search's rows or "No matches" are still in the page.
const DOCUMENT_SEARCH_EVIDENCE = `if (document.querySelectorAll('tr.zA').length > 0) return true;
  var main = document.querySelector('div[role="main"]');
  var text = main ? (main.innerText || '') : '';`;
const VISIBLE_SEARCH_EVIDENCE = `if (${VISIBLE_ROWS_EXPR}.length > 0) return true;`;

/**
 * "The search we ASKED FOR is the view on screen, and it has finished rendering."
 *
 * Two independent traps, both observed live on 2026-09-09, and it takes both
 * halves to close them.
 *
 * 1. `.AO` is the results CONTAINER and exists the moment the view renders; the
 *    rows arrive 0.8-1.6s later, measured. Counting straight after
 *    waitForSelector('.AO') counted an empty list for a domain that had plenty
 *    of sent mail -- `in:sent to:@gmail.com` returned 0 while Gmail showed 9
 *    conversations for the identical query in the same mailbox.
 *
 * 2. "Has rows" is not "has THIS query's rows". A persistent session reuses its
 *    page, and after a cross-document load Gmail's SPA renders the previous view
 *    (or the inbox) before it routes to the search -- so `tr.zA` rows exist
 *    immediately and they belong to the wrong query. Caught by a concurrent
 *    probe: `from:me to:shiva@bimacred.com` came back holding an inbox row from
 *    Razorpay. The hash check is what separates the two, exactly as
 *    DRAFTS_VIEW_READY_EXPR does for the drafts list.
 *
 * Getting this wrong is a silent wrong answer in both callers, and each acts on
 * it: checkEngagedDomains reads an empty result as "the owner has never emailed
 * this domain" and SUPPRESSES the sender; the drafting prompt reads it as a GAP
 * and brackets the value as missing. Neither can tell a stale page from a true
 * answer, so this expression has to.
 *
 * Distinct from LIST_SETTLED_EXPR: an empty FOLDER and an empty SEARCH are
 * different Gmail messages ("No conversations" vs "No messages matched...").
 */
export function searchViewReadyExpr(query: string, opts: { visibleOnly?: boolean } = {}): string {
  return `(function(){
  if (location.hash.indexOf('#search/') !== 0) return false;
  var want = ${JSON.stringify(query)};
  var raw = location.hash.slice('#search/'.length);
  var got = raw;
  try { got = decodeURIComponent(raw); } catch (e) { got = raw; }
  // Gmail re-encodes the fragment it routes to (spaces as '+', some operators
  // escaped), so compare loosely rather than byte-for-byte -- a false "not ready"
  // here burns the whole ceiling on a search that did render.
  var norm = function (s) { return String(s).replace(/\\+/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase(); };
  if (norm(got) !== norm(want)) return false;
  ${opts.visibleOnly ? VISIBLE_SEARCH_EVIDENCE : DOCUMENT_SEARCH_EVIDENCE}
  // Gmail's empty-search copy has changed, TWICE. Under "Showing most recent" it says "No exact
  // matches" (with "To get your top matches, switch to most relevant"); under "Showing most
  // relevant" it says just "No matches" / "Try a different search" — read live 2026-09-21 on a
  // checkEngagedDomains probe ("Showing most relevant Conversations No matches Try a different
  // search"), which is why three landings in a row failed the batch on the FIRST never-written-to
  // domain after the full 20s. Neither older phrasing appeared. Match every copy we have seen.
  return ${opts.visibleOnly ? visibleMainSaysExpr(EMPTY_SEARCH_RE_SOURCE) : `/${EMPTY_SEARCH_RE_SOURCE}/i.test(text)`};
})()`;
}

/**
 * "The drafts list is the view on screen AND it has finished rendering."
 * The hash check matters: Gmail routes a fragment change asynchronously, so a
 * settled-looking list can still be the PREVIOUS folder for a moment after the
 * navigation.
 */
export const DRAFTS_VIEW_READY_EXPR = `(function(){
  if (location.hash.indexOf('#drafts') !== 0) return false;
  return ${LIST_SETTLED_EXPR};
})()`;

/**
 * Switch the CURRENT Gmail page to the drafts list, in-SPA. Used instead of a
 * fresh navigation when a session is already on Gmail: it is also exactly what
 * a person does to commit an inline reply -- click away from the compose.
 */
export const NAV_TO_DRAFTS_SCRIPT = `(() => {
  if (location.hash.indexOf('#drafts') !== 0) location.hash = '#drafts';
  return 'nav';
})()`;

/** "A compose/draft editor is open on screen." */
export const COMPOSE_OPEN_EXPR = `(function(){
  return !!(document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
            document.querySelector('.Am.Al.editable') ||
            document.querySelector('[role="textbox"][aria-label*="Message"]'));
})()`;

/**
 * Read `{ ready, waitedMs, result }` back out of a pollInPageScript response
 * without throwing on anything — a lookup that cannot parse its own reply must
 * degrade to "not ready, nothing found", never to an exception in a writer.
 */
export function parsePollResult<T>(content: unknown): { ready: boolean; waitedMs: number; result: T | null } {
  const fallback = { ready: false, waitedMs: 0, result: null };
  if (typeof content !== "string" || !content) return fallback;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      ready: parsed.ready === true,
      waitedMs: typeof parsed.waitedMs === "number" ? parsed.waitedMs : 0,
      result: (parsed.result ?? null) as T | null,
    };
  } catch {
    return fallback;
  }
}

// IN-APP NAVIGATION (2026-11-25). Every gmailViewUrl load re-downloads Gmail's app shell, and on a
// cloud Flock that traffic goes through the paid proxy. When a session's page is ALREADY the loaded
// Gmail app, routing it by hash costs one data request instead. A hash change is the
// same-document navigation the 2026-09-09 note above warns about, so it is only trusted once it
// has PROVABLY landed: every row and empty-view message that was on screen before the hash
// changed has left the screen, AND the caller's own readiness test holds. With no such evidence
// at all there is nothing to prove the change by, so it never counts as landed. Otherwise the
// view is loaded the old way (a real load, the caller's own verification). A page whose old view
// never left the screen turns in-app off for the rest of that navigator's session, so it costs
// one short wait; a page that left it but was slow to settle keeps trying in-app.

/** How long an in-app navigation may take to land before falling back to a full load. */
export const IN_APP_NAV_TIMEOUT_MS = 8_000;

/** What an in-app navigation reports as its result: did the old view leave, and the caller's result. */
export interface InAppResult<T> {
  landed: boolean;
  value: T | null;
}

/** NodeFilter.SHOW_TEXT, spelled out so the script needs no NodeFilter global. */
const SHOW_TEXT = 4;

/**
 * Route the loaded Gmail app to `hash` and poll until it has landed (see above). pollInPageScript's
 * reply shape, with `result` an InAppResult. Captures the old view's on-screen evidence BEFORE the
 * hash changes: visible rows, and every visible TEXT node of Gmail's empty copy in any visible
 * main (the copy is mixed content, e.g. "No messages matched your search. Try using <span>...").
 * If the hash is already `hash`, Gmail does not re-route, the evidence stays, and the poll times
 * out (the caller then reloads).
 */
export function inAppNavScript(hash: string, readyExpr: string, resultExpr: string, timeoutMs = IN_APP_NAV_TIMEOUT_MS): string {
  const target = hash.startsWith("#") ? hash : `#${hash}`;
  const prelude = `const emptyRe = new RegExp(${JSON.stringify(`${EMPTY_FOLDER_RE_SOURCE}|${EMPTY_SEARCH_RE_SOURCE}`)}, 'i');
  const onScreen = (el) => { if (!el.isConnected) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const leftBehind = Array.prototype.filter.call(document.querySelectorAll('tr.zA'), onScreen);
  Array.prototype.filter.call(document.querySelectorAll('div[role="main"]'), onScreen).forEach((main) => {
    const walker = document.createTreeWalker(main, ${SHOW_TEXT});
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (el && emptyRe.test(node.nodeValue || '') && onScreen(el)) leftBehind.push(el);
    }
  });
  const landed = () => leftBehind.length > 0 && leftBehind.every((el) => !onScreen(el));
  location.hash = ${JSON.stringify(target)};`;
  return pollScript(prelude, `landed() && (${readyExpr})`, `({ landed: landed(), value: (${resultExpr}) })`, timeoutMs);
}

/** One step on a persistent session: run `actions`, after loading `url` when one is given.
 *  Resolves to the step's page content; rejects when the step failed. */
export type SessionStep = (actions: unknown[], url?: string) => Promise<unknown>;

export interface GmailView {
  hash: string;
  readyExpr: string;
  resultExpr: string;
  /** The poll ceiling for the full-load fallback (the caller's existing ceiling). */
  reloadTimeoutMs: number;
  /** Actions before the poll on a full load only (e.g. waiting for the results container). */
  reloadActions?: unknown[];
}

export interface LandedView<T> {
  ready: boolean;
  waitedMs: number;
  result: T | null;
  via: "in-app" | "reload";
}

export interface GmailNavigator {
  go<T>(view: GmailView): Promise<LandedView<T>>;
}

/**
 * Moves ONE already-loaded Gmail page between views: in-app first, a full gmailViewUrl load when
 * that does not land (or fails). A failed full load rejects, exactly as the caller's step did
 * before this existed.
 */
export function createGmailNavigator(step: SessionStep): GmailNavigator {
  let inAppLands = true;
  const tryInApp = async <T>(view: GmailView) => {
    try {
      return parsePollResult<InAppResult<T>>(await step([{ action: "evaluate", script: inAppNavScript(view.hash, view.readyExpr, view.resultExpr) }]));
    } catch {
      return null;
    }
  };
  return {
    async go<T>(view: GmailView): Promise<LandedView<T>> {
      if (inAppLands) {
        const inApp = await tryInApp<T>(view);
        if (inApp?.ready) return { ready: true, waitedMs: inApp.waitedMs, result: inApp.result?.value ?? null, via: "in-app" };
        // Only a page whose old view never left is a page in-app cannot work on; slow is not that.
        if (inApp?.result?.landed !== true) inAppLands = false;
      }
      const actions = [...(view.reloadActions ?? []), { action: "evaluate", script: pollInPageScript(view.readyExpr, view.resultExpr, view.reloadTimeoutMs) }];
      return { ...parsePollResult<T>(await step(actions, gmailViewUrl(view.hash))), via: "reload" };
    },
  };
}
