#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
MESSAGE_ID=$(echo "$PARAMS" | jq -r '.messageId // ""')

_require_browser_session

if [ -z "$MESSAGE_ID" ]; then
  _error_json "MISSING_PARAM" "messageId is required"
fi
_validate_id "$MESSAGE_ID" "messageId"

EVAL_SCRIPT="(() => {
  const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
  const senders = Array.from(document.querySelectorAll('.gD')).map(s => ({
    name: s.textContent?.trim() || '',
    email: s.getAttribute('email') || ''
  }));
  const dates = Array.from(document.querySelectorAll('.g3')).map(d => d.textContent?.trim() || '');
  const messages = Array.from(document.querySelectorAll('.a3s.aiL')).map(b => b.textContent?.trim() || '');
  const from = senders.length > 0
    ? (senders[0].name ? senders[0].name + ' <' + senders[0].email + '>' : senders[0].email)
    : '';
  const body = messages.join('\\n---\\n');
  return JSON.stringify({
    subject,
    from,
    date: dates[0] || '',
    body: body || '',
    snippet: (body || '').substring(0, 200),
    senders,
    messageCount: messages.length
  });
})()"

RESULT=$(_browser_write "https://mail.google.com/mail/u/0/#inbox/${MESSAGE_ID}" "$EVAL_SCRIPT" ".a3s.aiL")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c --arg id "$MESSAGE_ID" '. + {id: $id}'
