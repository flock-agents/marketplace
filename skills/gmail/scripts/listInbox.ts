import {
  requireBrowserSession,
  browserWrite,
  urlencode,
  errorJson,
  emitResult,
} from "../../_shared/_google_helpers";
import { classifyInboxScrape } from "../../_shared/_inbox-classify";
import { composeFrom, senderExtractionFailed, latestSender, participantAddresses } from "../../_shared/_gmail-sender";

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
    // One chip per PARTICIPANT, in thread order: <div class="yW"><span class="bA4"><span class="yP|zF"
    // email="…" name="…">me</span>, …</span></div>. The first chip is whoever started the thread —
    // reading it as "the sender" journaled every reply on an owner-started thread as the owner's
    // own mail (F8a). Emit every chip; the TypeScript side picks the latest (latestSender).
    // '.yW .yP' keeps a name-only chip ("Google", no email attribute) so latestSender can fall
    // back to its display name; querySelectorAll returns each element once, in DOM order.
    const chips = Array.from(row.querySelectorAll('.yW span[email], .yW .yP')).map((s) => ({
      email: s.getAttribute('email') || '',
      name: s.getAttribute('name') || '',
      text: (s.textContent || '').trim(),
      // The chip's classes, journaled as evidence: Gmail marks the sender of an UNREAD message
      // differently from a read one, and that mark (not chip order) says who wrote last.
      cls: s.getAttribute('class') || '',
    }));
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
    // Emit the parts raw. Composition happens in TypeScript (composeFrom / latestSender) so it is
    // testable and can never fabricate an address out of a display name.
    emails.push({ id, chips, subject, snippet, date, dateFull, isUnread, starred });
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
  const senderOf = (r: Record<string, any>) => latestSender(Array.isArray(r.chips) ? r.chips : []);
  if (senderExtractionFailed(rows.map((r) => ({ email: senderOf(r).email })))) {
    errorJson(
      "SCRAPE_INCOMPLETE",
      `Scraped ${rows.length} inbox rows but not one sender address — the sender selector no longer matches Gmail's DOM.`,
    );
  }

  // Explicit exit (emitResult): this read is the one that lingered after finishing its work.
  emitResult(rows.map((r) => {
    const s = senderOf(r);
    return {
      id: r.id,
      from: composeFrom(s.email, s.name),
      subject: r.subject,
      snippet: r.snippet,
      date: r.date,
      dateFull: r.dateFull,
      isUnread: r.isUnread,
      starred: r.starred,
      // Every address on the row: the actor is the latest writer, so memory's cold-outreach
      // gate reads this to see the owner spoke on a thread they started.
      participants: participantAddresses(Array.isArray(r.chips) ? r.chips : []),
    // Every chip as scraped (address, name, text, classes): evidence for the sender rule.
    chips: Array.isArray(r.chips) ? r.chips : [],
    };
  }));
})();
