import {
  requireBrowserSession,
  browserWrite,
  urlencode,
} from "../../_shared/_google_helpers";

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
    const from = row.querySelector('.yW span')?.getAttribute('email') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const fromName = row.querySelector('.yW span')?.getAttribute('name') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const date = row.querySelector('.xW span')?.textContent?.trim() || '';
    const starred = !!row.querySelector('.T-KT-Jp[aria-label*="Starred"]');
    const link = row.querySelector('.xT a[href]')?.href || '';
    const idMatch = link.match(/#[^/]+\\/(.+)/);
    const id = idMatch ? idMatch[1] : '';
    emails.push({ id, from: fromName ? fromName + ' <' + from + '>' : from, subject, snippet, date, isUnread, starred });
  });
  return JSON.stringify(emails);
})()`;

(async () => {
  const result = await browserWrite(gmailUrl, evalScript, ".AO");
  const content = result?.content || "[]";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
