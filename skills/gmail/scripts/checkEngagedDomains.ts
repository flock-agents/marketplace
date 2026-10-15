// The read-through lookup behind the drafting gate (spec §4.2). Answers ONE
// question per domain: has the owner ever sent mail to anyone at it?
//
//   `in:sent to:@acme.com` -> any row at all -> engaged
//
// Measured on a real inbox: "domains the owner has SENT mail to" alone
// out-performed the entire ported regex denylist 3x. This is why it is the
// PRIMARY signal, not a subordinate check.
//
// This replaced listSentDomains.ts, which bulk-scraped 90 days of Sent mail and
// paginated to a cutoff so the platform could cache a whole domain SET. The
// platform now caches per-domain positives and asks only about the domains a
// batch actually contains (engaged-domains.ts), so the pagination, the cutoff,
// the "Older" pager selector that could never be verified against live Gmail, and
// the 20-page/30s budget that could silently truncate the set all go away with it.
//
// ONE NAVIGATION PER DOMAIN, sequential, on the ordinary leased PERSISTENT
// path: one authenticated context for the whole lookup (changed 2026-09-09). It previously used the one-shot browserWrite path, on the
// reasoning that a persistent session keyed by (sessionName, agentId) could be
// handed to a second caller mid-flight. That reasoning lost to the evidence:
// each one-shot fetch re-authenticates from the stored cookies, and partway
// through a multi-domain lookup Google served the account chooser instead of
// Gmail. checkUrlRedirect then marked the whole browser session OUTDATED, which
// broke every other caller -- the draft gate silently fell open, the agent's own
// calls 403'd, and the owner had to re-login. Observed repeatedly: two searches
// returning 200, then mark-outdated on the third.
//
// This is the same migration getThread already made for the same symptom (see
// its own note): the persistent context stays authenticated across navigations
// instead of re-establishing auth per call.
//
// ALL OR NOTHING, deliberately. An absent domain in the returned list means "the
// owner has never emailed it" -- a real negative the caller acts on by suppressing
// that sender. So a search that FAILED must never be reported as one that found
// nothing: any failure, at any point in the list, exits non-zero and discards the
// partial answer. The platform then treats every requested domain as UNRESOLVED
// and the gate fails open. Returning the domains confirmed before the failure
// would silently convert the unsearched remainder into negatives and suppress
// real mail -- the one outcome this gate may never produce.
//
// Input  (SKILL_PARAMS): { domains: string[] }
// Output (stdout JSON):  string[]  -- the subset that is engaged

import {
  requireBrowserSession,
  persistentCreate,
  persistentInteract,
  persistentClose,
  urlencode,
  errorJson,
} from "../../_shared/_google_helpers";
import { gmailViewUrl, pollInPageScript, parsePollResult, searchViewReadyExpr } from "./_gmailNav";

// --- Pure helpers (unit-tested, no browser) ---

/**
 * How long to wait between two engaged-domain searches.
 *
 * WHY THIS EXISTS (2026-09-09): this loop fired one full Gmail search per
 * domain back to back with no gap, and that is what kept getting the Google
 * session logged out. Verified live, repeatedly: the dispatch ran
 * checkEngagedDomains, the call died after ~17s, and the very next log line was
 * `POST /api/internal/browser-sessions/<name>/mark-outdated`. Everything
 * downstream then failed -- the draft-eligibility gate silently fell open (its
 * reads fail and it keeps entries on failure), the agent's own calls 403'd, and
 * the routine could not draft at all. One lookup is fine; it is the rapid
 * succession that trips Google.
 *
 * The cache is positives-only by owner decision, so every UNENGAGED domain is
 * re-searched on every tick, forever -- which is why this loop runs so often and
 * why pacing it matters more than it would for a one-off.
 *
 * Randomised rather than a fixed interval: an exact 5000ms cadence is itself a
 * machine signature. Bounds are deliberately modest -- with the measured ~8.3s
 * per search, a 4-domain batch lands near 50s, inside the 90s slow-function
 * budget. A batch big enough to exceed it times out, which the caller already
 * treats as unresolved and fails OPEN; that is wasteful but safe, and it is the
 * existing behaviour for any failure here.
 */
export function nextPauseMs(rand: number = Math.random()): number {
  const MIN_MS = 3000;
  const MAX_MS = 7000;
  const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 1) : 0.5;
  return Math.round(MIN_MS + r * (MAX_MS - MIN_MS));
}

// Normalize + dedupe the requested domains. Anything that isn't a plausible bare
// domain is dropped rather than turned into a search: `to:@` with a junk operand
// returns Gmail's whole Sent folder, which would confirm EVERY malformed domain
// as engaged -- a false positive that silently disables the gate for that sender.
// A bare domain is what the caller extracts from an address' local@domain split,
// so anything with whitespace, an "@", or no dot is not one.
export function normalizeDomains(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const domain = value.trim().toLowerCase();
    if (!domain || seen.has(domain)) continue;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

// Did this search find at least one sent message? The eval below returns the row
// count as a JSON number; anything else (an empty body, a parse failure, a
// negative) reads as "no", never as a throw -- a single unreadable page must not
// abort the remaining domains.
export function hasSentRows(content: unknown): boolean {
  if (typeof content === "number") return content > 0;
  if (typeof content !== "string" || !content.trim()) return false;
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "number" && parsed > 0;
  } catch {
    return false;
  }
}

/**
 * WHAT THE PAGE WAS when a search did (or did not) settle. Three landings in a row
 * (2026-09-21) failed on the FIRST domain of the batch after the full 20s poll, with
 * the shell painted, and the error said only "did not finish rendering" — the one
 * fact that would name the cause (was the hash a different search? were there rows
 * but no hash? a login page?) was thrown away. The poll now returns this object
 * instead of a bare count; the count still drives the verdict.
 */
export interface SearchDiag { rows: number; hash: string; title: string; text: string }

/** Read the poll's result: the diagnostic object, or the legacy bare row count. Pure. */
export function readSearchDiag(content: unknown): SearchDiag {
  const none: SearchDiag = { rows: -1, hash: "", title: "", text: "" };
  let value: unknown = content;
  if (typeof content === "string") {
    if (!content.trim()) return none;
    try { value = JSON.parse(content); } catch { return none; }
  }
  if (typeof value === "number") return { ...none, rows: value };
  if (!value || typeof value !== "object") return none;
  const v = value as Partial<SearchDiag>;
  return {
    rows: typeof v.rows === "number" ? v.rows : -1,
    hash: typeof v.hash === "string" ? v.hash : "",
    title: typeof v.title === "string" ? v.title : "",
    text: typeof v.text === "string" ? v.text : "",
  };
}

/** One line a human can act on, for the error message and the log. Pure. */
export function describeSearchDiag(d: SearchDiag): string {
  const text = d.text.replace(/\s+/g, " ").trim().slice(0, 160);
  return `hash=${JSON.stringify(d.hash)} rows=${d.rows} title=${JSON.stringify(d.title)} text=${JSON.stringify(text)}`;
}

// --- Script entrypoint (browser-driven search) ---

// Count result rows. `tr.zA` is the same row selector searchEmails.ts and the
// rest of this skill use; the count is all we need -- we never read who or when.
//
// DECLARED ABOVE THE INVOCATION GUARD ON PURPOSE. `runScript()` is a hoisted
// function declaration, but a `const` is not hoisted -- it sits in the temporal
// dead zone until its own line runs. With this below the guard, the very first
// live call died with "Cannot access 'COUNT_ROWS_SCRIPT' before initialization".
// Unit tests cannot catch that: they import the module WITHOUT SKILL_PARAMS, so
// runScript() never runs. Keep every module-level const the script body reads
// above the guard.
const SEARCH_DIAG_EXPR = `(function(){
  var main = document.querySelector('div[role="main"]');
  return JSON.stringify({
    rows: document.querySelectorAll('tr.zA').length,
    hash: location.hash,
    title: document.title,
    text: main ? String(main.innerText || '').slice(0, 300) : ''
  });
})()`;

// Gated on SKILL_PARAMS so importing this module for its pure exports in a test
// never touches the browser -- skill-executor always sets SKILL_PARAMS (even
// "{}") on the spawned process; a plain `import` from a test does not.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const domains = normalizeDomains(params.domains);

  requireBrowserSession();

  if (domains.length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  (async () => {
    const engaged: string[] = [];
    // `.AO` is Gmail's results container -- the same waitFor searchEmails.ts
    // uses, so an empty result set still settles rather than timing out.
    const searchActions = [{ action: "waitForSelector", selector: ".AO", delay: 20000 }];
    const searchUrl = (domain: string) => gmailViewUrl(`#search/${urlencode(`in:sent to:@${domain}`)}`);

    let psId = "";
    try {
      for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        // Human-shaped gap BETWEEN searches (never before the first, never after
        // the last, so a single-domain lookup costs nothing extra) -- see
        // nextPauseMs.
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, nextPauseMs()));

        const settle = pollInPageScript(searchViewReadyExpr(`in:sent to:@${domain}`), SEARCH_DIAG_EXPR, 20000);
        let result: any;
        if (!psId) {
          const created = await persistentCreate(searchUrl(domain), [...searchActions, { action: "evaluate", script: settle }]);
          psId = created?.persistentSessionId || "";
          if (!psId) errorJson("SESSION_ERROR", "Failed to create persistent session for the engaged-domain lookup");
          result = created;
        } else {
          // Re-navigate the SAME authenticated context. A nonce'd URL forces a
          // real cross-document load, so the results we scrape are this domain's
          // and never the previous query's still on screen (_gmailNav.ts).
          result = await persistentInteract(psId, searchActions, false, settle, searchUrl(domain));
        }

        const { ready, result: raw } = parsePollResult<unknown>(result?.content);
        const diag = readSearchDiag(raw);
        if (!ready) {
          // Never guess. A search that did not finish rendering is NOT "no sent
          // mail to this domain" — reporting it as such would suppress the
          // sender. Fail, so the platform treats the whole batch as unresolved
          // and the gate fails open (see the ALL OR NOTHING note above).
          await persistentClose(psId).catch(() => {});
          psId = "";
          errorJson("BROWSER_ERROR", `Engaged-domain search for ${domain} did not finish rendering — refusing to report it as unengaged. Page at 20s: ${describeSearchDiag(diag)}`);
        }
        if (hasSentRows(diag.rows)) engaged.push(domain);
      }
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }
    console.log(JSON.stringify(engaged));
  })().catch((err: any) => {
    // A throw before ANY answer means the lookup could not run at all (no
    // session, browser unreachable). Exit non-zero so the platform sees a failed
    // call and treats every requested domain as UNRESOLVED -- the gate then fails
    // open. Printing a partial "[]" here instead would read as "none of these are
    // engaged" and suppress real mail.
    errorJson("BROWSER_ERROR", `Engaged-domain lookup failed: ${err?.message || err}`);
  });
}
