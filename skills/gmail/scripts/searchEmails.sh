#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
MAX_RESULTS=$(echo "$PARAMS" | jq -r '.maxResults // 10')
if ! [[ "$MAX_RESULTS" =~ ^[0-9]+$ ]]; then MAX_RESULTS=10; fi

_require_browser_session

if [ -z "$QUERY" ]; then
  _error_json "MISSING_PARAM" "query is required"
fi

ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)

EVAL_SCRIPT="(() => {
  const maxResults = ${MAX_RESULTS};
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
})()"

RESULT=$(_browser_write "https://mail.google.com/mail/u/0/#search/${ENCODED_QUERY}" "$EVAL_SCRIPT" ".AO")
CONTENT=$(echo "$RESULT" | jq -r '.content // "[]"')
echo "$CONTENT" | jq -c '.'
