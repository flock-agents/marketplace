// Gmail's PRINT VIEW — a thread read that does NOT mark the thread read (owner-verified live,
// 2026-09-23: full body rendered, thread stayed bold in the inbox). Pure module: no browser, no
// SKILL_PARAMS gate, safe to import from any script. The in-page expression only COLLECTS raw
// text; every decision is in rowsFromPrintBlocks, which is unit-tested without a DOM.
//
// Print view is a static HTML document (not the Gmail SPA): one `table.message` per message,
// oldest first; the sender line, a right-aligned date cell, a `.recipient` block of
// "To: …" / "Cc: …" lines, then the body. Selectors verified against a live capture in Task 2.

import { UNSUBSCRIBE_LINK_RE_SOURCE, messagePartsExpr, type RawThreadRow, type RawRecipient } from "./_threadScrape";

export interface PrintBlock {
  header: string;
  date: string;
  recipientLines: string[];
  bodyText: string;
  /** Set only when the body's trailing quoted history was split off; bodyText then starts with it (Task 27). */
  bodyMain?: string;
  linkTexts: string[];
  linkHrefs: string[];
}

export function printViewUrl(threadId: string, nonce: string | number = Date.now()): string {
  return `https://mail.google.com/mail/u/0/?flockview=${nonce}&view=pt&search=all&th=${encodeURIComponent(threadId)}`;
}

/** "Mon, Sep 21, 2026 at 7:04 PM" -> "Mon, Sep 21, 2026, 7:04 PM" (parseGmailDateTime's US form). */
export function normalizePrintDate(s: string): string {
  return (s || "").trim().replace(/\s+at\s+(?=\d{1,2}:\d{2})/i, ", ");
}

/** V1: does print view show an unsent draft? The owner ruled (2026-09-24) that print reads never
 *  answer "is a draft open"; callers needing it read view:"thread" (which restores unread). */
export const PRINT_VIEW_SHOWS_DRAFTS = false;

const ADDR_RE = /([^<>,\s]+@[^<>,\s]+)/;

function splitHeader(header: string): { fromEmail: string; fromName: string } {
  const h = (header || "").trim();
  const angled = h.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angled) return { fromName: angled[1].replace(/^"|"$/g, "").trim(), fromEmail: angled[2].trim() };
  const bare = h.match(ADDR_RE);
  return { fromName: "", fromEmail: bare ? bare[1] : "" };
}

/** "Rahul <rahul@acme.com>, ops@acme.com" -> each address entry as written. */
function splitAddressList(list: string): string[] {
  return list
    .split(/,(?![^<]*>)/)
    .map((s) => s.trim())
    .filter((s) => ADDR_RE.test(s));
}

export function rowsFromPrintBlocks(blocks: PrintBlock[]): RawThreadRow[] {
  const unsubRe = new RegExp(UNSUBSCRIBE_LINK_RE_SOURCE, "i");
  return (blocks || []).map((b) => {
    const { fromEmail, fromName } = splitHeader(b.header);
    const recipients: RawRecipient[] = [];
    let recipientsVerified = false;
    // Bcc lines are dropped entirely (final review m2). Print view shows Bcc on the owner's own
    // sent mail, but Gmail's Reply all never includes Bcc'd people, so counting them as cc made
    // them reply-all "others" and put them on the card's Cc. A Bcc line alone does not verify
    // recipients either. (The thread-view scrape is unchanged.)
    for (const line of b.recipientLines || []) {
      const m = line.match(/^\s*(to|cc)\s*:\s*(.*)$/i);
      if (!m) continue;
      const kind: RawRecipient["kind"] = m[1].toLowerCase() === "to" ? "to" : "cc";
      for (const raw of splitAddressList(m[2])) {
        recipients.push({ raw, kind });
        recipientsVerified = true;
      }
    }
    const unsubscribeLink =
      (b.linkTexts || []).some((t) => unsubRe.test(t)) || (b.linkHrefs || []).some((h) => unsubRe.test(h));
    return {
      fromEmail,
      fromName,
      date: normalizePrintDate(b.date),
      body: (b.bodyText || "").trim(),
      ...(typeof b.bodyMain === "string" && b.bodyMain ? { bodyMain: b.bodyMain } : {}),
      recipients,
      recipientsVerified,
      unsubscribeLink,
    };
  });
}

/**
 * In-page: collect raw text per message. A hoisted-safe string constant (it is only ever read
 * after module evaluation). `draftMarker` records whether print view shows an unsent draft — see
 * `PRINT_VIEW_SHOWS_DRAFTS` above for why callers ignore it.
 */
export const PRINT_BLOCKS_EXPR = `(() => {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const subject = txt(document.querySelector('.maincontent font[size="+1"] b, .maincontent b'));
  const blocks = [];
  document.querySelectorAll('table.message').forEach((t) => {
    // t.rows is HTMLTableElement.rows: only THIS table's own direct rows, never a row
    // belonging to a table nested inside the body (a generic tr-descendant selector would
    // match those too, which is why the date used to come back empty).
    const headRow = t.rows[0];
    const header = headRow ? txt(headRow.cells[0]) : '';
    const date = headRow ? txt(headRow.cells[1]) : '';
    const recipRow = t.rows[1];
    const recipientLines = recipRow
      ? Array.from(recipRow.querySelectorAll('.recipient div')).map((d) => txt(d)).filter(Boolean)
      : [];
    const bodyEl = t.querySelector('table[cellpadding="12"] td') || t.rows[2] || null;
    const links = bodyEl ? Array.from(bodyEl.querySelectorAll('a[href]')) : [];
    // Task 27: when the body has trailing quoted history, its text comes from the converter, so
    // bodyText starts with bodyMain exactly; otherwise innerText, as before.
    const parts = ${messagePartsExpr("bodyEl")};
    const split = !!(parts.body && parts.quoted);
    blocks.push({
      header, date, recipientLines,
      bodyText: split ? parts.body : txt(bodyEl),
      bodyMain: split ? parts.bodyMain : '',
      linkTexts: links.map((a) => txt(a)),
      linkHrefs: links.map((a) => a.getAttribute('href') || ''),
    });
  });
  const draftMarker = /\\[\\s*draft\\s*\\]|\\bDraft\\b/.test(txt(document.querySelector('.maincontent')));
  return JSON.stringify({ subject, blocks, draftMarker });
})()`;
