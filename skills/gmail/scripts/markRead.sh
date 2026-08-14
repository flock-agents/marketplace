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
  return JSON.stringify({ ok: true, message: 'Email opened (marked as read)', subject });
})()"

RESULT=$(_browser_write "https://mail.google.com/mail/u/0/#inbox/${MESSAGE_ID}" "$EVAL_SCRIPT" ".a3s.aiL")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
