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
import { htmlToText } from "./_draftBody";

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
  /** The body without its trailing quoted history; set only when one was split off (Task 27). */
  bodyMain?: string;
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
  /** The FULL message text, quoted history included, with its line breaks. */
  body: string;
  /**
   * Present only when Gmail's quoted history (`.gmail_quote` / `.gmail_extra`) was split off the
   * END of the body: the new text alone. `body` always starts with it, and the quoted history is
   * the rest of `body` (see quotedOf). Carried as one short field rather than a second copy of the
   * history, so a thread read does not double in size against the result cap.
   */
  bodyMain?: string;
  /**
   * False when To and Cc could not be told apart for this message. The To-only rule MUST refuse on
   * it rather than guess: guessing means replying to mail the owner was only cc'd on, which is the
   * one thing that rule exists to stop.
   */
  recipientsVerified: boolean;
  /**
   * BULK-MAIL SIGNAL (owner decision, 2026-09-10). True when the body holds an unsubscribe /
   * opt-out / manage-preferences link. The browser scrape never sees List-Unsubscribe or
   * Precedence; the footer link is what every bulk sender renders. draft-eligibility refuses to
   * draft a reply to a message that carries one, deliberately for a HUMAN sender too: a founder
   * mailing through a campaign tool is impersonating bulk mail, and the owner ruled it draws no draft.
   */
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
      ...(splitMain(row.body, row.bodyMain) !== null ? { bodyMain: row.bodyMain } : {}),
      recipientsVerified: row.recipientsVerified === true,
      unsubscribeLink: row.unsubscribeLink === true,
    };
  });
}

/** `bodyMain` when it is a real split of `body` (a non-empty prefix with something after it), else null. */
function splitMain(body: unknown, bodyMain: unknown): string | null {
  if (typeof body !== "string" || typeof bodyMain !== "string" || !bodyMain) return null;
  return body.length > bodyMain.length && body.startsWith(bodyMain) && body.slice(bodyMain.length).trim() ? bodyMain : null;
}

/** The quoted history of a message: the rest of `body` after `bodyMain`, or "" when none was split off. */
export function quotedOf(m: { body: string; bodyMain?: string }): string {
  return splitMain(m.body, m.bodyMain) !== null ? m.body.slice(m.bodyMain!.length).trim() : "";
}

/**
 * Split a message body's HTML into its text, its new text and its quoted history (Task 27).
 * Gmail wraps a reply's history in `div.gmail_quote` (with `blockquote.gmail_quote` inside, and
 * `div.gmail_extra` around it in older mail); a class merely CONTAINING the name counts, because
 * Gmail prefixes classes in quoted copies (`m_123…gmail_quote`). Only the outermost match is cut:
 * a nested quote goes with its outer one.
 *
 *  - `body`: the full text, history included, with line breaks.
 *  - `bodyMain`: the text with the history cut out, ONLY when the history trails it — body then
 *    starts with bodyMain. An inline reply (text after a quote) is not split: hiding the quote
 *    would hide the question being answered mid-text.
 *  - `quoted`: the rest of body after bodyMain; "" when nothing was split. A message that is all
 *    quote (a plain forward) is not split either: bodyMain = body.
 *
 * SELF-CONTAINED: runs in the page too, inlined by source with the converter passed in
 * (`(${messageTextParts})(el.innerHTML, ${htmlToText})`), so it references nothing outside itself.
 */
export function messageTextParts(
  html: string,
  toText: (html: string) => string,
): { body: string; bodyMain: string; quoted: string } {
  const src = String(html || "");
  const body = toText(src);
  const openRe = /<([a-zA-Z][\w-]*)\b[^>]*?\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/g;
  let main = "";
  let last = 0;
  let cut = false;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(src))) {
    if (!/gmail_quote|gmail_extra/i.test(m[2] || m[3] || m[4] || "")) continue;
    const start = m.index;
    let end = openRe.lastIndex;
    if (!/\/>$/.test(m[0])) {
      const tagRe = new RegExp("<(/?)" + m[1] + "\\b[^>]*>", "gi");
      tagRe.lastIndex = end;
      let depth = 1;
      let t: RegExpExecArray | null;
      while (depth > 0 && (t = tagRe.exec(src))) {
        if (t[1]) depth--;
        else if (!/\/>$/.test(t[0])) depth++;
        end = tagRe.lastIndex;
      }
      if (depth > 0) end = src.length;
    }
    main += src.slice(last, start);
    last = end;
    openRe.lastIndex = end;
    cut = true;
  }
  if (!cut) return { body, bodyMain: body, quoted: "" };
  const bodyMain = toText(main + src.slice(last));
  const quoted = bodyMain && body.startsWith(bodyMain) ? body.slice(bodyMain.length).trim() : "";
  return quoted ? { body, bodyMain, quoted } : { body, bodyMain: body, quoted: "" };
}

/** The in-page expression for one message body element's parts (null element -> empty parts). */
export function messagePartsExpr(elExpr: string): string {
  return `(${elExpr} ? (${messageTextParts.toString()})(${elExpr}.innerHTML, ${htmlToText.toString()}) : { body: '', bodyMain: '', quoted: '' })`;
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
// Live lessons this script encodes (moved from getThread.ts's former copy, Task 27):
//  - NESTED MATCHES (2026-09-09): Gmail renders a message as div[role=listitem] CONTAINING .adn.ads,
//    so both matched and every message was scraped twice; only the outermost match is kept. A doubled
//    count would also hide a message that failed to expand from assessThreadCompleteness.
//  - AN OPEN DRAFT (2026-09-10): an unsent draft renders as an editable body with a "Discard draft"
//    control under the last message; nothing this script clicks opens one, so either means a draft.
//  - CC (2026-09-09): the labelled "to:"/"cc:" rows of the details panel ARE the classification;
//    ancestor-class guesses called every cc'd address "to". bcc counts as cc. Without labelled rows
//    the collapsed summary is used and the row is marked unverified.
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
      // Task 27: textContent dropped every line break; the parts keep them and split off the
      // trailing quoted history. textContent stays the fallback for markup the converter empties.
      const parts = ${messagePartsExpr("bodyEl")};
      const body = parts.body || bodyEl?.textContent?.trim() || '';
      const bodyMain = parts.body && parts.quoted ? parts.bodyMain : '';
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
      rows.push({ fromEmail, fromName, date, body, bodyMain, recipients, recipientsVerified, unsubscribeLink });
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
