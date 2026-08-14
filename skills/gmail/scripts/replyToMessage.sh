#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
MESSAGE_ID=$(echo "$PARAMS" | jq -r '.messageId // ""')
BODY_TEXT=$(echo "$PARAMS" | jq -r '.body // ""')

_require_browser_session

if [ -z "$MESSAGE_ID" ] || [ -z "$BODY_TEXT" ]; then
  _error_json "MISSING_PARAM" "messageId and body are required"
fi
_validate_id "$MESSAGE_ID" "messageId"

SESSION_RESULT=$(_persistent_create "https://mail.google.com/mail/u/0/#inbox/${MESSAGE_ID}")
PERSISTENT_ID=$(echo "$SESSION_RESULT" | jq -r '.persistentSessionId // ""')

if [ -z "$PERSISTENT_ID" ]; then
  _error_json "SESSION_ERROR" "Failed to create persistent session for Gmail reply"
fi

REPLY_OPEN_ACTIONS=$(jq -nc '[
  {"action":"waitForSelector","selector":"[aria-label=\"Reply\"],.T-I-JW[data-tooltip=\"Reply\"]","delay":5000},
  {"action":"evaluate","script":"(() => { const replyBtns = document.querySelectorAll(\"[aria-label=\\\"Reply\\\"]\"); const btn = replyBtns[replyBtns.length - 1]; if (btn) { btn.click(); return {ok:true}; } const altBtn = document.querySelector(\".T-I-JW[data-tooltip=\\\"Reply\\\"]\"); if (altBtn) { altBtn.click(); return {ok:true}; } return {ok:false,message:\"Reply button not found\"}; })()"},
  {"action":"waitForSelector","selector":"div[aria-label*=\"Message\"][contenteditable=true]","delay":5000}
]')

_persistent_interact "$PERSISTENT_ID" "$REPLY_OPEN_ACTIONS" "false" "" >/dev/null 2>&1

BODY_JSON=$(echo "$BODY_TEXT" | jq -Rs '.')
TYPE_ACTIONS=$(jq -nc --argjson body "$BODY_JSON" '[
  {"action":"click","selector":"div[aria-label*=\"Message\"][contenteditable=true]"},
  {"action":"insertText","text":$body},
  {"action":"wait","delay":500}
]')

_persistent_interact "$PERSISTENT_ID" "$TYPE_ACTIONS" "false" "" >/dev/null 2>&1

EVAL_SCRIPT="(() => {
  return JSON.stringify({ success: true, message: 'Reply sent via browser session' });
})()"

SEND_ACTIONS=$(jq -nc '[
  {"action":"waitForSelector","selector":"[aria-label*=\"Send\"]:not([aria-label*=\"Schedule\"])"},
  {"action":"click","selector":"[aria-label*=\"Send\"]:not([aria-label*=\"Schedule\"])"},
  {"action":"wait","delay":3000},
  {"action":"screenshot"}
]')

RESULT=$(_persistent_interact "$PERSISTENT_ID" "$SEND_ACTIONS" "true" "$EVAL_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
