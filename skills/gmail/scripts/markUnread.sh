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

ACTIONS="[{\"action\":\"wait\",\"delay\":3000}"
ACTIONS="${ACTIONS},{\"action\":\"evaluate\",\"script\":\"(() => { const btn = document.querySelector('[aria-label=\\\"Mark as unread\\\"]') || document.querySelector('[data-tooltip=\\\"Mark as unread\\\"]'); if (btn) { btn.click(); return {ok:true,message:'Email marked as unread'}; } return {ok:false,message:'Mark-as-unread button not found. This may only work from within a thread view.'}; })()\"}"
ACTIONS="${ACTIONS},{\"action\":\"wait\",\"delay\":1000}"
ACTIONS="${ACTIONS}]"

RESULT=$(_browser_interact "https://mail.google.com/mail/u/0/#inbox/${MESSAGE_ID}" "$ACTIONS" "")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
