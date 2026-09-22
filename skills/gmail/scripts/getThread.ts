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
  persistentCreate,
  persistentClose,
} from "../../_shared/_google_helpers";
import { composeFrom } from "../../_shared/_gmail-sender";
import { gmailViewUrl } from "./_gmailNav";
import { readCachedThread, writeCachedThread } from "./_threadCache";

// --- Pure types + parsing (unit-tested, no browser) ---

export interface RawRecipient {
  raw: string;
  kind: "to" | "cc";
}

export interface RawThreadRow {
  fromEmail?: string;
  fromName?: string;
  date?: string;
  body?: string;
  recipients?: RawRecipient[];
  /**
   * Did the recipients come from Gmail's LABELLED header rows ("to:" / "cc:"),
   * rather than from the collapsed summary where To and Cc are indistinguishable?
   * Only a labelled read can answer "is the owner a direct recipient".
   */
  recipientsVerified?: boolean;
  /** The message body carries an unsubscribe / opt-out / manage-preferences link. */
  unsubscribeLink?: boolean;
}

export interface ThreadMessage {
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
  /**
   * False when To and Cc could not be told apart for this message. The To-only
   * rule MUST refuse on it rather than guess: guessing means replying to mail
   * the owner was only cc'd on, which is the one thing that rule exists to stop.
   */
  recipientsVerified: boolean;
  /**
   * BULK-MAIL SIGNAL (owner decision, 2026-09-10). True when the body holds an
   * unsubscribe / opt-out / manage-preferences link. The browser scrape never
   * sees List-Unsubscribe or Precedence, and Gmail's "Show details" panel
   * mostly does not surface them either; the footer link is what every bulk
   * sender actually renders. draft-eligibility refuses to draft a reply to a
   * message that carries one -- and that is deliberate for a HUMAN sender too:
   * a founder mailing from their own address through a campaign tool is
   * impersonating bulk mail, and the owner ruled it draws no draft.
   */
  unsubscribeLink: boolean;
}

export interface ThreadCompleteness {
  incomplete: boolean;
  reason: string | null;
}

/**
 * Pull the bare address out of a display-name-plus-address recipient form
 * ("Rahul <rahul@x.com>" -> "rahul@x.com"). A bare address passes through
 * unchanged.
 */
function extractAddress(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const m = s.match(/<([^>]+)>\s*$/);
  return (m ? m[1] : s).trim();
}

/**
 * The words that mark a bulk-mail footer link, matched against BOTH the link's
 * href and its text: "Unsubscribe" is usually the text over an opaque tracking
 * href, while "click here" is sometimes the text over a `/unsubscribe` href.
 * Kept as a SOURCE string so the in-page scrape below can embed the very same
 * pattern -- one definition, tested here, run in the browser.
 */
export const UNSUBSCRIBE_LINK_RE_SOURCE =
  "unsubscribe|opt[\\s_-]?out|manage[\\s_-]?(?:your[\\s_-]?)?(?:e-?mail[\\s_-]?)?preferences|e-?mail[\\s_-]?preferences";

export function looksLikeUnsubscribeLink(href: unknown, text: unknown): boolean {
  const re = new RegExp(UNSUBSCRIBE_LINK_RE_SOURCE, "i");
  const h = typeof href === "string" ? href : "";
  const t = typeof text === "string" ? text : "";
  return re.test(h) || re.test(t);
}

/**
 * Turn scraped per-message thread rows into { from, to, cc, date, body},
 * oldest first — the order the rows already arrive in, since Gmail's thread
 * view lists messages top-to-bottom oldest first. A message with no Cc
 * yields `cc: []`, never a missing key, so a caller can always read
 * `.cc.length` without a null check.
 */
export function messagesFromThreadDom(rows: RawThreadRow[]): ThreadMessage[] {
  return (rows || []).map((row) => {
    const to: string[] = [];
    const cc: string[] = [];
    for (const r of row.recipients || []) {
      const addr = extractAddress(r.raw);
      if (!addr) continue;
      (r.kind === "cc" ? cc : to).push(addr);
    }
    return {
      from: composeFrom(row.fromEmail || "", row.fromName || ""),
      to,
      cc,
      date: row.date || "",
      body: row.body || "",
      recipientsVerified: row.recipientsVerified === true,
      unsubscribeLink: row.unsubscribeLink === true,
    };
  });
}

/**
 * Reply-all recipients are computed from exactly these to/cc lists (Ghostwriter
 * §2b), so a thread that scraped incompletely must say so rather than look like
 * a clean, complete thread — the caller must be able to refuse to draft rather
 * than draft to a truncated recipient list.
 *
 * Flags incomplete when either:
 *  - fewer messages were scraped than were counted in the DOM before expansion
 *    (expansion silently missed at least one message), or
 *  - some message scraped with an empty `to` while at least one other message
 *    in the same thread has a non-empty `to` (a message that never fully
 *    expanded still yields a row, just with no recipients).
 *
 * `expectedCount <= 0` means the pre-expansion count could not be determined
 * (e.g. the counting selector matched nothing) — that alone never forces
 * `incomplete`, since there's nothing trustworthy to compare against.
 */
export function assessThreadCompleteness(
  messages: ThreadMessage[],
  expectedCount: number,
): ThreadCompleteness {
  if (expectedCount > 0 && messages.length < expectedCount) {
    return {
      incomplete: true,
      reason: `Expected ${expectedCount} message(s) in this thread but only scraped ${messages.length} — at least one message likely failed to expand.`,
    };
  }

  const anyToPresent = messages.some((m) => m.to.length > 0);
  if (anyToPresent) {
    const blankTo = messages.filter((m) => m.to.length === 0);
    if (blankTo.length > 0) {
      return {
        incomplete: true,
        reason: `${blankTo.length} of ${messages.length} message(s) scraped with an empty "to" while others in this thread have recipients — likely a message that never fully expanded.`,
      };
    }
  }

  return { incomplete: false, reason: null };
}

// --- Script entrypoint (browser-DOM scrape) ---
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

  // Serve a cached copy before opening a browser (the connector's own 20-minute thread cache).
  // A caller that must see live state passes `forceRefresh`/`bypassCache`, or `freshAfter` when it
  // knows a message landed at a given instant; both are honoured inside readCachedThread. A cache
  // miss (or an unusable store) simply falls through to the live scrape below.
  const cached = readCachedThread(threadId, params);
  if (cached) emitResult(cached);

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
  const expandScript = `(() => {
    // Same nested-match dedupe as the scrape below -- the two counts are
    // compared against each other, so they must count the same way or the
    // incomplete flag becomes meaningless.
    const beforeEls = Array.from(document.querySelectorAll('.adn, div[role="listitem"]'));
    const before = beforeEls.filter((el) => !beforeEls.some((other) => other !== el && other.contains(el))).length;
    window.__flockThreadExpectedCount = before;
    const expandAllBtn = document.querySelector('[aria-label="Expand all"]');
    if (expandAllBtn) { expandAllBtn.click(); return 'expand-all'; }
    const collapsed = document.querySelectorAll('.kQ, tr.kv');
    collapsed.forEach((el) => el.click());
    return 'clicked-' + collapsed.length;
  })()`;

  // Open every message's "Show details" panel. Gmail renders the labelled
  // header rows ("from:", "to:", "cc:") ONLY once this is expanded -- the
  // collapsed header shows a single merged summary ("to Shiva, me") in which a
  // Cc recipient is indistinguishable from a To one. Verified live on a
  // deliberately cc-only message: the collapsed DOM put both addresses in the
  // same `.hb span[email]` list with no marker, so the old classifier called
  // both "to" and the To-only rule could never fire.
  const detailsScript = `(() => {
    const carets = document.querySelectorAll('[aria-label="Show details"]');
    carets.forEach((c) => c.click());
    return 'details-' + carets.length;
  })()`;

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
  const scrapeScript = `(() => {
    const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
    const expectedCount = window.__flockThreadExpectedCount || 0;
    // DEDUPE NESTED MATCHES (verified live 2026-09-09): Gmail renders a message
    // as a div[role="listitem"] wrapper CONTAINING an .adn.ads node, so this
    // selector matched both and every message was scraped TWICE -- a 2-message
    // thread came back as 4 identical-in-pairs entries. Keep only the OUTERMOST
    // match: drop any node that has another matched node as an ancestor. One
    // element per message, whichever of the two shapes Gmail is rendering.
    //
    // This is not cosmetic. assessThreadCompleteness compares the scraped count
    // against the pre-expansion count to decide the incomplete flag, the guard
    // that stops reply-all recipients being computed off a truncated thread; a
    // doubled count can hide a message that genuinely failed to expand.
    // AN OPEN DRAFT ON THE THREAD (2026-09-10). Gmail renders an unsent draft in
    // the conversation view as a compose editor under the last message: an
    // editable message body, with a "Discard draft" control beside it. Either
    // one is the signal; nothing this script clicks (expand, show details)
    // opens an editor, so their presence means a draft was already there.
    const hasDraft = !!(
      document.querySelector('[aria-label="Discard draft"], [data-tooltip="Discard draft"]') ||
      document.querySelector('div[aria-label="Message Body"][contenteditable="true"], .Am.Al.editable[contenteditable="true"]')
    );
    const rawEls = Array.from(document.querySelectorAll('.adn.ads, div[role="listitem"]'));
    const messageEls = rawEls.filter((el) => !rawEls.some((other) => other !== el && other.contains(el)));
    const rows = [];
    messageEls.forEach((el) => {
      const senderEl = el.querySelector('.gD, span[email]');
      const fromEmail = senderEl?.getAttribute('email') || '';
      const fromName = senderEl?.textContent?.trim() || '';
      const dateEl = el.querySelector('.g3, span.g3');
      const date = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';
      const bodyEl = el.querySelector('.a3s.aiL');
      const body = bodyEl?.textContent?.trim() || '';
      // Bulk-mail signal: any link in the body whose href or text reads
      // unsubscribe / opt out / manage preferences (see ThreadMessage.unsubscribeLink).
      // Same pattern as looksLikeUnsubscribeLink, embedded from its source string.
      const unsubRe = new RegExp(${JSON.stringify(UNSUBSCRIBE_LINK_RE_SOURCE)}, 'i');
      let unsubscribeLink = false;
      if (bodyEl) {
        bodyEl.querySelectorAll('a[href]').forEach((a) => {
          if (unsubscribeLink) return;
          const href = a.getAttribute('href') || '';
          const text = (a.textContent || '').trim();
          if (unsubRe.test(href) || unsubRe.test(text)) unsubscribeLink = true;
        });
      }
      // Classify recipients from Gmail's OWN labelled header rows. Each row of
      // the expanded details table reads "to: Name <addr>" / "cc: Name <addr>",
      // so the label the row starts with IS the classification -- no guessing
      // from region classes, which is what the previous version did and got
      // wrong. bcc counts as cc here: both mean "not a direct recipient", which
      // is the only distinction the To-only rule draws.
      const recipients = [];
      let recipientsVerified = false;
      el.querySelectorAll('tr').forEach((tr) => {
        const label = (tr.innerText || '').trim().toLowerCase();
        let kind = '';
        if (label.indexOf('to:') === 0) kind = 'to';
        else if (label.indexOf('cc:') === 0) kind = 'cc';
        else if (label.indexOf('bcc:') === 0) kind = 'cc';
        if (!kind) return;
        tr.querySelectorAll('span[email]').forEach((s) => {
          recipients.push({ raw: s.getAttribute('email') || s.textContent.trim(), kind: kind });
          recipientsVerified = true;
        });
      });

      // FALLBACK: the collapsed summary, where To and Cc cannot be told apart.
      // These are still returned -- reply-all needs the addresses -- but the row
      // is marked UNVERIFIED so the To-only rule refuses rather than assuming
      // everyone here was a direct recipient.
      if (!recipientsVerified) {
        el.querySelectorAll('.hb span[email], .g2 span[email]').forEach((s) => {
          recipients.push({ raw: s.getAttribute('email') || s.textContent.trim(), kind: 'to' });
        });
      }
      rows.push({ fromEmail, fromName, date, body, recipients, recipientsVerified, unsubscribeLink });
    });
    return JSON.stringify({ subject, rows, expectedCount, hasDraft });
  })()`;

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
    let psId = "";
    let result: any;
    try {
      // `#all/<id>`, not `#inbox/<id>` (2026-09-22, live): the inbox route resolves only while
      // the thread is still IN the inbox. A thread the owner replied to and archived — the one
      // a reply-card reconcile most needs to read — rendered nothing for 20s under #inbox and
      // the read failed. getThreads' by-id path has used #all since it was written.
      result = await persistentCreate(gmailViewUrl(`#all/${threadId}`), [
        ...pageActions,
        { action: "evaluate", script: scrapeScript },
      ]);
      psId = result?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for the Gmail thread");
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
    const threadResult = {
      threadId,
      subject: parsed.subject || "",
      messages,
      incomplete: completeness.incomplete,
      reason: completeness.reason,
      hasDraft: parsed.hasDraft === true,
    };
    // Store the fresh read for the next caller (writeCachedThread stores only COMPLETE reads and
    // swallows any fs failure), then hand back the result untouched — a cache write never affects it.
    writeCachedThread(threadId, threadResult);
    emitResult(threadResult);
  })();
}
