// Restore a thread's UNREAD state after a write that has to open the thread view (a reply only
// threads when composed from it, and opening it marks the thread read). Pure: in-page strings +
// a parser. Accepted limits (spec 3b): a thread beyond the first 50 unread rows is not seen and
// ends up read (today's behaviour); restore marks the latest message unread, not the exact set.
//
// A LEAF MODULE, no entrypoint: it is imported for its exports only and must have no side effect
// at import (same rule as _gmailNav.ts / _threadCache.ts).

import { parsePollResult } from "./_gmailNav";

export function unreadProbeQuery(): string {
  return "in:unread";
}

/**
 * In-page: EVERY id form an UNREAD row carries, flattened into one array — not just the legacy
 * id. Fix round 1 (Important #2): a caller may match threads by a different id form than the
 * probe returns (getThreads' `rowsExpr` prefers the `.xT a[href]` permalink id and falls back to
 * `data-legacy-thread-id` / `data-thread-id`), so a probe that only ever emitted the legacy id
 * could silently miss a match and report a thread read when it was actually unread. Collecting
 * every form a row carries — legacy id, `data-thread-id` (with any `#thread-f:` prefix stripped,
 * mirroring getThreads' own parse), and the permalink id — means a caller matching on ANY of
 * those forms still finds the row. Mirrors getThreads.ts's `rowsExpr` id extraction verbatim so
 * the two never drift apart.
 */
export function unreadIdsExpr(): string {
  return `JSON.stringify(Array.from(document.querySelectorAll('tr.zA.zE')).reduce(function (acc, r) {
    var legacyEl = r.querySelector('[data-legacy-thread-id]');
    var legacyId = legacyEl ? legacyEl.getAttribute('data-legacy-thread-id') || '' : '';
    if (legacyId) acc.push(legacyId);
    var threadEl = r.querySelector('[data-thread-id]');
    var rawThreadId = threadEl ? threadEl.getAttribute('data-thread-id') || '' : '';
    if (rawThreadId) {
      var stripped = rawThreadId.indexOf('#thread-f:') === 0 ? rawThreadId.slice('#thread-f:'.length) : rawThreadId;
      if (stripped) acc.push(stripped);
    }
    var link = r.querySelector('.xT a[href]');
    var href = link ? link.getAttribute('href') || '' : '';
    var m = href.match(/#[^/]+\\/(.+)/);
    if (m && m[1]) acc.push(m[1]);
    return acc;
  }, []))`;
}

/**
 * Parse a pollInPageScript result (built on unreadIdsExpr) into the set of unread legacy ids.
 * Fails closed: an unsettled poll, a non-string result, or unparseable JSON all yield an EMPTY
 * set — never a guess that would leave `wasUnread` claiming a thread was unread when the probe
 * simply never got an answer.
 */
export function unreadIdsFrom(content: unknown): Set<string> {
  const { ready, result } = parsePollResult<string>(content);
  if (!ready || typeof result !== "string") return new Set();
  try {
    const ids = JSON.parse(result);
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

/** Was `threadId` unread in the probe? Anything short of a settled, parseable answer is false:
 *  a wrong "true" would mark mail unread that the owner has read. */
export function wasUnread(content: unknown, threadId: string): boolean {
  return unreadIdsFrom(content).has(threadId);
}

/**
 * Diagnostic evidence for the live "still ends up read" bug: what the probe itself saw, apart
 * from any particular threadId. Built on parsePollResult (via unreadIdsFrom, itself built on it)
 * so a caller never has to poke at the raw poll envelope directly. `ready` answers "did the probe
 * settle within its ceiling at all" and `count` is how many unread ids it collected — together they
 * tell apart a probe that never saw the thread as unread (count includes it or not) from one that
 * never settled (ready:false, count always 0) from one whose id form didn't match (ready:true,
 * count>0, but the specific id absent — see wasUnread for that last check).
 */
export function probeSummary(content: unknown): { ready: boolean; count: number } {
  const { ready } = parsePollResult<string>(content);
  return { ready, count: unreadIdsFrom(content).size };
}

/**
 * What the restore click reported, or why it was never attempted. `http-<code>` covers a failed
 * persistentInteractRaw call (mirrors interactOrThrow's own "HTTP <code>: ..." message); "error"
 * covers everything else that threw (a network hiccup, a closed session).
 */
export type MarkResult = "marked" | "no-control" | "skipped-budget" | "error" | `http-${number}`;

/** The unreadDiag object every thread-view read/write emits on its JSON result (never replayed
 *  from the connector's thread cache — see _threadCache.ts's PROVENANCE_FIELDS). */
export interface UnreadDiag {
  probeReady: boolean;
  probeIds: number;
  wasUnread: boolean;
  markResult?: MarkResult;
  /** Short (<=300 char) summary of MARK_UNREAD_SCRIPT's `cands` diagnostics, for the live "no
   *  candidate passes the visibility test" class of bug. Absent when the script never ran or its
   *  result carried no candidate evidence (legacy plain-string result). */
  markCands?: string;
  /** Which confirmation signal MARK_UNREAD_SCRIPT saw after dispatching the click --
   *  "toast" | "nav" | "gone" | "timeout" (see the script's own doc comment). Absent when the
   *  script never dispatched a click at all (no-control). */
  markConfirm?: string;
  /** How long (ms) MARK_UNREAD_SCRIPT waited after dispatching the click -- confirmation poll plus
   *  the fixed 1500ms flush wait. Absent alongside markConfirm when no click was dispatched. */
  markWaitedMs?: number;
}

/**
 * In-page, with the thread OPEN: fire real mouse events at Gmail's "Mark as unread" toolbar
 * control. Live-verified 2026-09-24: Gmail's toolbar buttons are divs that ignore a synthetic
 * `.click()` — it leaves the thread read. Dispatching mousedown/mouseup/click MouseEvents is what
 * Gmail's own listeners actually respond to.
 *
 * Fix round 2 (live 2026-09-24): `offsetParent !== null` was the visibility test, and in Flock's
 * headless Chromium (1280x800) it found NO candidate on 3/3 reads even though the probe located
 * the thread as unread — `wasUnread=true mark=no-control`. `offsetParent` is null for a
 * `position:fixed` element (among other cases), which the owner's desktop Chrome never hit but
 * headless apparently does for this control. Visibility is now: the element's own
 * getBoundingClientRect() has width>0 and height>0, AND its computed visibility isn't 'hidden'.
 * A display:none ancestor already yields a zero-size rect for every descendant, so the rect check
 * alone also covers that case — no separate ancestor walk needed. Which visible match gets clicked
 * is set out under CANDIDATES below.
 *
 * Returns a JSON string (not a bare 'marked'/'no-control') so a live "still ends up read" report
 * carries its own evidence: every candidate this run saw, capped at 8, with its box, computed
 * visibility/display and whether offsetParent would have found it — offsetParent appears here only
 * as diagnostic data, never as part of selection.
 *
 * CANDIDATES (fix round 3, live 2026-09-24): an element whose aria-label, data-tooltip, OR title
 * matches /mark as unread/i (case-insensitive: headless Gmail's label differs in case). `title` is
 * back as a match source -- live diagnostics from a headless Gmail thread view showed the real
 * toolbar button carries the label ONLY in `title` (`20x20 visible via=title ok=false` was the sole
 * candidate, so the run reported `no-control`); a matcher that included `title` clicked it
 * (`confirm=toast`) and the thread stayed unread. `title` is safe to accept here because it is
 * gated by the SAME structural rules as aria/tip -- a candidate must also:
 *   - be a button: `role="button"` itself, or inside a `[role="button"]` or `[gh="mtb"]` (thread
 *     toolbar) ancestor;
 *   - not be an `<a>`, and not sit inside a message body/list container (`.a3s`, `.ii`, `.adn`,
 *     `[role="listitem"]`, `.gs`).
 * Those rules are what keep an email carrying `<a title="Mark as unread">` -- or even a
 * `div[role="button"][title="Mark as unread"]` planted inside the message body -- unclickable.
 * Among visible candidates, the FIRST one inside `[gh="mtb"]` wins; failing that, the LAST one.
 *
 * DIAGNOSTICS carry no page text: `n` counts every element whose aria-label/data-tooltip/title
 * matches (eligible or not), and `cands` describes up to 8 of them by box, visibility, which
 * attribute matched (`via`) and whether it was eligible (`ok`) -- every string capped at 40 chars.
 * The result is built small; the JSON string is never sliced (a slice can make it unparseable).
 *
 * ASYNC CONFIRMATION (live 2026-09-24, round 3): the click reported `marked`, and a later probe in
 * the SAME run still saw the thread as unread -- yet the thread ended up READ after the caller's
 * restore was immediately followed by a session close/navigate. Gmail applies "mark as unread"
 * through an async request; closing the page right after the click aborts it. So after dispatching
 * the click, this script polls every 250ms for up to 5000ms for ANY of three signals -- (a) a toast
 * (`[role="alert"]` or `.bAq`) whose text matches /marked as unread/i, (b) the location hash no
 * longer pointing at a single thread (Gmail returns to the list; a hash that only swaps the thread
 * id form, still `#all/<id>` or `#inbox/<id>`, does not count), (c) no eligible visible control
 * left on the page -- and then waits a FURTHER fixed 1500ms regardless, so the request can flush.
 * `confirm` records which signal fired (or "timeout") and `waitedMs` the whole wait. No click means
 * no wait: `confirm`/`waitedMs` only appear on a `result: 'marked'` outcome.
 */
export const MARK_UNREAD_SCRIPT = `(async () => {
  var MARK_UNREAD_RE = /mark as unread/i;
  var TOAST_RE = /marked as unread/i;
  var SINGLE_THREAD_HASH_RE = /#(?:all|inbox)\\/[A-Za-z0-9_-]+/;
  var BODY_SEL = '.a3s, .ii, .adn, [role="listitem"], .gs';
  var TOOLBAR_SEL = '[gh="mtb"]';
  function cap(v) {
    var s = String(v == null ? '' : v);
    return s.length > 40 ? s.slice(0, 40) : s;
  }
  function matchVia(el) {
    if (MARK_UNREAD_RE.test(el.getAttribute('aria-label') || '')) return 'aria';
    if (MARK_UNREAD_RE.test(el.getAttribute('data-tooltip') || '')) return 'tip';
    if (MARK_UNREAD_RE.test(el.getAttribute('title') || '')) return 'title';
    return '';
  }
  function isEligible(el) {
    var via = matchVia(el);
    if (via !== 'aria' && via !== 'tip' && via !== 'title') return false;
    if (String(el.tagName || '').toUpperCase() === 'A') return false;
    if (el.closest(BODY_SEL)) return false;
    return el.getAttribute('role') === 'button' || !!el.closest('[role="button"], ' + TOOLBAR_SEL);
  }
  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }
  function matching() {
    return [...document.querySelectorAll('[aria-label], [data-tooltip], [title]')].filter(function (el) { return matchVia(el) !== ''; });
  }
  function visibleEligible() {
    return matching().filter(isEligible).filter(isVisible);
  }
  function hasToast() {
    var nodes = document.querySelectorAll('[role="alert"], .bAq');
    for (var i = 0; i < nodes.length; i++) {
      if (TOAST_RE.test(nodes[i].innerText || '')) return true;
    }
    return false;
  }
  var all = matching();
  var cands = all.slice(0, 8).map(function (el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      op: el.offsetParent !== null,
      vis: cap(cs.visibility),
      disp: cap(cs.display),
      via: cap(matchVia(el)),
      ok: isEligible(el),
    };
  });
  var pool = all.filter(isEligible).filter(isVisible);
  var b = pool.filter(function (el) { return !!el.closest(TOOLBAR_SEL); })[0] || pool[pool.length - 1];
  var result = b ? 'marked' : 'no-control';
  var confirm, waitedMs;
  if (b) {
    var hashBefore = location.hash;
    ['mousedown', 'mouseup', 'click'].forEach((t) => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    var started = Date.now();
    var deadline = started + 5000;
    confirm = 'timeout';
    while (Date.now() < deadline) {
      if (hasToast()) { confirm = 'toast'; break; }
      var hashNow = location.hash;
      if (hashNow !== hashBefore && !SINGLE_THREAD_HASH_RE.test(hashNow)) { confirm = 'nav'; break; }
      if (visibleEligible().length === 0) { confirm = 'gone'; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 1500));
    waitedMs = Date.now() - started;
  }
  var out = { result: result, n: all.length, cands: cands };
  if (confirm !== undefined) { out.confirm = confirm; out.waitedMs = waitedMs; }
  return JSON.stringify(out);
})()`;

/**
 * Summarize MARK_UNREAD_SCRIPT's `cands` diagnostics into one string, capped at 300 chars, for
 * `UnreadDiag.markCands`.
 */
function summarizeCands(cands: unknown, n: unknown): string {
  const total = typeof n === "number" && Number.isFinite(n) ? n : Array.isArray(cands) ? cands.length : 0;
  if (!Array.isArray(cands) || cands.length === 0) return `n=${total}`;
  const parts = cands.slice(0, 8).map((c) => {
    if (!c || typeof c !== "object") return "?";
    const x = c as Record<string, unknown>;
    const via = typeof x.via === "string" && x.via ? ` via=${x.via} ok=${x.ok === true}` : "";
    return `${x.w}x${x.h} op=${x.op} vis=${x.vis} disp=${x.disp}${via}`;
  });
  const summary = `n=${total} [${parts.join("; ")}]`;
  return summary.length > 300 ? summary.slice(0, 300) : summary;
}

/**
 * Parse a MARK_UNREAD_SCRIPT result — the page-action content a caller reads off
 * `persistentInteractRaw`'s `body.content`, which may arrive JSON-string-wrapped (an extra layer
 * of JSON.stringify around the script's own return value). The current script returns a JSON
 * object string (`{"result":...,"n":...,"cands":[...]}`). Anything that is not such an object is
 * `marked` only when it is exactly the legacy `marked` / `"marked"` string -- never a substring
 * guess, which a truncated or garbled result could satisfy.
 */
export function parseMarkResult(content: unknown): { marked: boolean; cands: string; confirm: string; waitedMs: number } {
  if (typeof content !== "string" || !content) return { marked: false, cands: "", confirm: "", waitedMs: 0 };
  let value: unknown = content;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    const v = value as { result?: unknown; n?: unknown; cands?: unknown; confirm?: unknown; waitedMs?: unknown };
    const confirm = typeof v.confirm === "string" && v.confirm ? v.confirm : "";
    const waitedMs = typeof v.waitedMs === "number" && Number.isFinite(v.waitedMs) ? v.waitedMs : 0;
    return { marked: v.result === "marked", cands: summarizeCands(v.cands, v.n), confirm, waitedMs };
  }
  const legacy = content.trim();
  return { marked: legacy === "marked" || legacy === '"marked"', cands: "", confirm: "", waitedMs: 0 };
}
