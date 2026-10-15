// Skill-declared observe EXTRACTOR (Gmail). Runs IN the open observer page via
// page.evaluate — it reads the currently-rendered inbox rows straight from the DOM and
// returns them as a JSON array. NO navigation, NO network: the page's own live channel
// already put this data on screen; we only read it. Must be a single expression that
// evaluates to a JSON string, and must produce the SAME item shape as gmail's listInbox
// (id, from, subject, snippet, date, isUnread, starred) so the platform's poll adapter
// normalizes it identically (the journal's dedupe folds any overlap).
(() => {
  const rows = document.querySelectorAll('tr.zA');
  const emails = [];
  rows.forEach((row, i) => {
    if (i >= 25) return;
    const isUnread = row.classList.contains('zE');
    // Sender attributes live on the INNER span (span.yP), not the outer span.bA4 that
    // '.yW span' matches — see skills/_shared/_gmail-sender.ts for what that cost.
    const senderEl = row.querySelector('.yW span[email]') || row.querySelector('.yW .yP');
    const from = senderEl?.getAttribute('email') || '';
    const fromName = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || '';
    const subject = row.querySelector('.bog')?.textContent?.trim() || '';
    const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
    const date = row.querySelector('.xW span')?.textContent?.trim() || '';
    const starred = !!row.querySelector('.T-KT-Jp[aria-label*="Starred"]');
    // The '.xT a[href]' anchor is gone from current Gmail DOM — there is no anchor in
    // the row at all — so this yielded an empty id, which collapses every row to the
    // same journal event id and makes appendEvents drop the lot. Same fix as listInbox.
    const idEl = row.querySelector('[data-legacy-thread-id]') || row.querySelector('[data-thread-id]');
    const id = idEl?.getAttribute('data-legacy-thread-id') || idEl?.getAttribute('data-thread-id') || '';
    // Mirrors composeFrom() in skills/_shared/_gmail-sender.ts — must never emit a
    // display name in the address slot, nor an empty "Name <>" pair. Kept inline
    // because this source is evaluated in the page and cannot import.
    const sender = from ? (fromName ? fromName + ' <' + from + '>' : from) : fromName;
    emails.push({ id, from: sender, subject, snippet, date, isUnread, starred });
  });
  return JSON.stringify(emails);
})()
