import {
  errorJson,
  requireBrowserSession,
  urlencode,
  browserWrite,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const query: string = params.query || "";
let maxResults = parseInt(params.maxResults, 10);
if (isNaN(maxResults) || maxResults <= 0) maxResults = 10;

requireBrowserSession();

if (!query) {
  errorJson("MISSING_PARAM", "query is required");
}

const encodedQuery = urlencode(query);

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const rows = document.querySelectorAll('tr.zA');
  const emails = [];
  rows.forEach((row, i) => {
    if (i >= maxResults) return;
    const from = row.querySelector('.yW span')?.getAttribute('email') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const fromName = row.querySelector('.yW span')?.getAttribute('name') || row.querySelector('.yW span')?.textContent?.trim() || '';
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const date = row.querySelector('.xW span')?.textContent?.trim() || '';
    const isUnread = row.classList.contains('zE');
    const link = row.querySelector('.xT a[href]')?.href || '';
    const idMatch = link.match(/#[^/]+\\/(.+)/);
    const id = idMatch ? idMatch[1] : '';
    emails.push({ id, from: fromName ? fromName + ' <' + from + '>' : from, subject, snippet, date, isUnread });
  });
  return JSON.stringify(emails);
})()`;

(async () => {
  const result = await browserWrite(
    `https://mail.google.com/mail/u/0/#search/${encodedQuery}`,
    evalScript,
    ".AO",
  );
  const content = result?.content || "[]";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
