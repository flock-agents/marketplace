import {
  requireBrowserSession,
  browserWrite,
  urlencode,
  errorJson,
  emitResult,
} from "../../_shared/_google_helpers";
import { classifyInboxScrape } from "../../_shared/_inbox-classify";
import { composeFrom, senderExtractionFailed } from "../../_shared/_gmail-sender";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
let maxResults = parseInt(params.maxResults, 10);
if (isNaN(maxResults) || maxResults <= 0) maxResults = 10;
const query: string = params.query || "";

requireBrowserSession();

let gmailUrl = "https://mail.google.com/mail/u/0/#inbox";
if (query) {
  gmailUrl = `https://mail.google.com/mail/u/0/#search/${urlencode(query)}`;
}

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const rows = document.querySelectorAll('tr.zA');
  const emails = [];
  rows.forEach((row, i) => {
    if (i >= maxResults) return;
    const isUnread = row.classList.contains('zE');
    // The sender attributes live on the INNER span, not the outer one:
    //   <div class="yW"><span class="bA4"><span class="yP" email="..." name="...">
    // '.yW span' matches the outer span.bA4, which carries no attributes — so the
    // lookup returned null, fell through to textContent, and every row was emitted
    // as "Google <Google>". Select the element that actually holds the address.
    const senderEl = row.querySelector('.yW span[email]') || row.querySelector('.yW .yP');
    const email = senderEl?.getAttribute('email') || '';
    const name = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || '';
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const dateEl = row.querySelector('.xW span');
    const date = dateEl?.textContent?.trim() || '';
    // The FULL datetime. The visible text is a time only for today and a bare date otherwise;
    // Gmail keeps the complete "Mon, 21 Sept 2026, 19:04" on the element's title (the hover text),
    // which is what a per-thread last-message timestamp has to be built from (owner, 2026-09-22).
    const dateFull = dateEl?.getAttribute('title') || dateEl?.getAttribute('data-tooltip') || '';
    const starred = !!row.querySelector('.T-KT-Jp[aria-label*="Starred"]');
    // The message id is the Gmail legacy thread id (stable, 16-hex, and what the
    // #inbox/<id> permalink uses). The old '.xT a[href]' link is gone from current
    // Gmail DOM — no anchor in the row at all — so it yielded an empty id, which
    // collapsed every row to the same journal event and broke dedupe/storage.
    const idEl = row.querySelector('[data-legacy-thread-id]') || row.querySelector('[data-thread-id]');
    const id = idEl?.getAttribute('data-legacy-thread-id') || idEl?.getAttribute('data-thread-id') || '';
    // Emit the parts raw. Composition happens in TypeScript (composeFrom) so it is
    // testable and can never fabricate an address out of a display name.
    emails.push({ id, email, name, subject, snippet, date, dateFull, isUnread, starred });
  });
  return JSON.stringify(emails);
})()`;

(async () => {
  // Wait for an actual inbox ROW, not the Gmail app shell. The shell (".AO") paints
  // well before the thread list populates over XHR, so waiting on it let the scrape
  // run against an empty DOM and silently return zero rows. Waiting on "tr.zA" holds
  // until the first row renders (fast for a non-empty inbox); a genuinely empty inbox
  // hits the wait timeout, then the title check below confirms it as legitimately
  // empty rather than a failed render.
  const result = await browserWrite(gmailUrl, evalScript, "tr.zA");

  // Classify the scrape: a missing/non-JSON result, or zero rows while the title
  // reports unread mail, is a FAILED read that must surface visibly — never a silent
  // "no mail". See _inbox-classify.ts (pure + unit-tested).
  const cls = classifyInboxScrape(result?.content, typeof result?.title === "string" ? result.title : "");
  if (cls.kind === "failed") {
    errorJson(cls.code, cls.message);
  }

  // Rows that scraped but yielded no sender address at all means the sender selector
  // has drifted again — surface it rather than emitting rows whose actor is a display
  // name, which no @-anchored rule can match (spec §3).
  const rows = (Array.isArray(cls.data) ? cls.data : []) as Array<Record<string, any>>;
  if (senderExtractionFailed(rows)) {
    errorJson(
      "SCRAPE_INCOMPLETE",
      `Scraped ${rows.length} inbox rows but not one sender address — the sender selector no longer matches Gmail's DOM.`,
    );
  }

  // Explicit exit (emitResult): this read is the one that lingered after finishing its work.
  emitResult(rows.map((r) => ({
    id: r.id,
    from: composeFrom(r.email ?? "", r.name ?? ""),
    subject: r.subject,
    snippet: r.snippet,
    date: r.date,
    dateFull: r.dateFull,
    isUnread: r.isUnread,
    starred: r.starred,
  })));
})();
