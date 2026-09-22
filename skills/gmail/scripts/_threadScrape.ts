// Shared thread scrape+parse logic for the Gmail THREAD view. Both getThread (one thread, one
// session) and getThreads (many threads, ONE reused session) use the exact same in-page scrape and
// the exact same pure parsers, so they live here — a skill SCRIPT (getThreads) cannot import
// getThread.ts, because getThread's SKILL_PARAMS gate would fire on import and run the wrong scrape.
// This module is un-gated (pure — no browser, no SKILL_PARAMS), so both can import it safely and
// getThread.ts re-exports the pieces its own tests reference.
//
// The in-page SCRIPT strings are verbatim what getThread had verified live (CC extraction
// 2026-09-09, draft/expansion guards) — do not "improve" them without re-verifying against real
// Gmail; the comments record which live failures each line exists to prevent.

import { composeFrom } from "../../_shared/_gmail-sender";

// --- Pure types ------------------------------------------------------------

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
  /** Did the recipients come from Gmail's LABELLED header rows, not the merged collapsed summary? */
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
  /** False when To and Cc could not be told apart — the To-only rule must refuse rather than guess. */
  recipientsVerified: boolean;
  /** Bulk-mail signal: the body holds an unsubscribe/opt-out/manage-preferences link. */
  unsubscribeLink: boolean;
}

export interface ThreadCompleteness {
  incomplete: boolean;
  reason: string | null;
}

// --- Pure parsers (unit-tested via gmail-thread-parse.test.ts, no browser) --

/** "Rahul <rahul@x.com>" -> "rahul@x.com"; a bare address passes through unchanged. */
function extractAddress(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const m = s.match(/<([^>]+)>\s*$/);
  return (m ? m[1] : s).trim();
}

/**
 * The words that mark a bulk-mail footer link, matched against BOTH the link's href and its text.
 * Kept as a SOURCE string so the in-page scrape embeds the identical pattern — one definition.
 */
export const UNSUBSCRIBE_LINK_RE_SOURCE =
  "unsubscribe|opt[\\s_-]?out|manage[\\s_-]?(?:your[\\s_-]?)?(?:e-?mail[\\s_-]?)?preferences|e-?mail[\\s_-]?preferences";

export function looksLikeUnsubscribeLink(href: unknown, text: unknown): boolean {
  const re = new RegExp(UNSUBSCRIBE_LINK_RE_SOURCE, "i");
  const h = typeof href === "string" ? href : "";
  const t = typeof text === "string" ? text : "";
  return re.test(h) || re.test(t);
}

/** Turn scraped per-message rows into { from, to, cc, date, body }, oldest first. */
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
 * Reply-all recipients are computed from these to/cc lists, so a thread that scraped incompletely
 * must SAY so. Flags incomplete when fewer messages scraped than counted pre-expansion, or when a
 * message has an empty `to` while others in the thread have recipients (a message that never
 * expanded). `expectedCount <= 0` (undeterminable) alone never forces incomplete.
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

// --- In-page scrape scripts (executed via an `evaluate` pageAction) --------

/** Expand every message before scraping — a collapsed message renders neither its `to` nor `cc`.
 *  Stashes the pre-expansion container count on `window` for the completeness comparison. */
export const THREAD_EXPAND_SCRIPT = `(() => {
    const beforeEls = Array.from(document.querySelectorAll('.adn, div[role="listitem"]'));
    const before = beforeEls.filter((el) => !beforeEls.some((other) => other !== el && other.contains(el))).length;
    window.__flockThreadExpectedCount = before;
    const expandAllBtn = document.querySelector('[aria-label="Expand all"]');
    if (expandAllBtn) { expandAllBtn.click(); return 'expand-all'; }
    const collapsed = document.querySelectorAll('.kQ, tr.kv');
    collapsed.forEach((el) => el.click());
    return 'clicked-' + collapsed.length;
  })()`;

/** Open every message's "Show details" panel — Gmail renders the labelled to:/cc: rows only then. */
export const THREAD_DETAILS_SCRIPT = `(() => {
    const carets = document.querySelectorAll('[aria-label="Show details"]');
    carets.forEach((c) => c.click());
    return 'details-' + carets.length;
  })()`;

/** Scrape the expanded thread into { subject, rows, expectedCount, hasDraft }. Recipients come from
 *  Gmail's OWN labelled header rows (verified live 2026-09-09), never guessed from region classes. */
export const THREAD_SCRAPE_SCRIPT = `(() => {
    const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
    const expectedCount = window.__flockThreadExpectedCount || 0;
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
      if (!recipientsVerified) {
        el.querySelectorAll('.hb span[email], .g2 span[email]').forEach((s) => {
          recipients.push({ raw: s.getAttribute('email') || s.textContent.trim(), kind: 'to' });
        });
      }
      rows.push({ fromEmail, fromName, date, body, recipients, recipientsVerified, unsubscribeLink });
    });
    return JSON.stringify({ subject, rows, expectedCount, hasDraft });
  })()`;

/**
 * "This thread view has finished rendering" — a message body (`.a3s.aiL`) holds real text. Used to
 * poll after an IN-SESSION hop to a thread (getThreads), where there is no fresh page load to wait
 * on. `.a3s.aiL` with content exists only inside a rendered thread, so it separates "landed" from
 * "the list/previous thread is still on screen".
 */
export const THREAD_BODY_READY_EXPR = `(function(){
  var bodies = document.querySelectorAll('.a3s.aiL');
  for (var i = 0; i < bodies.length; i++) {
    if (((bodies[i].innerText) || '').trim().length > 0) return true;
  }
  return false;
})()`;
