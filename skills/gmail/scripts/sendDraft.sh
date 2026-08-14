#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
DRAFT_ID=$(echo "$PARAMS" | jq -r '.draftId // ""')

_require_browser_session

if [ -z "$DRAFT_ID" ]; then
  _error_json "MISSING_PARAM" "draftId is required (use the draft's thread/message ID from Gmail)"
fi
_validate_id "$DRAFT_ID" "draftId"

OPEN_AND_SEND='(function(){
  var compose = document.querySelector("div[aria-label=\"Message Body\"][contenteditable=\"true\"]") ||
                document.querySelector(".Am.Al.editable") ||
                document.querySelector("[role=\"textbox\"][aria-label*=\"Message\"]");
  if (!compose) return {ok:false, message:"Draft compose area not found. The draft may not have opened correctly."};
  var sendBtn = document.querySelector("[aria-label*=\"Send\"]:not([aria-label*=\"Schedule\"])") ||
                document.querySelector(".T-I.J-J5-Ji.aoO.v7.T-I-atl.L3");
  if (!sendBtn) return {ok:false, message:"Send button not found in draft compose window"};
  sendBtn.click();
  return {ok:true, message:"Draft sent successfully"};
})()'

RESULT=$(_persistent_create "https://mail.google.com/mail/u/0/#drafts/${DRAFT_ID}")
PS_ID=$(echo "$RESULT" | jq -r '.persistentSessionId // ""')
if [ -z "$PS_ID" ]; then
  _error_json "SESSION_ERROR" "Failed to create persistent session for draft"
fi

SEND_RESULT=$(_persistent_interact "$PS_ID" "$(jq -nc --arg script "$OPEN_AND_SEND" '[
  {action: "wait", delay: 3000},
  {action: "evaluate", script: $script},
  {action: "wait", delay: 2000}
]')" "true")

CONTENT=$(echo "$SEND_RESULT" | jq -r '.content // "{}"')
SEND_OK=$(echo "$CONTENT" | jq -r '.ok // false')
if [ "$SEND_OK" = "true" ]; then
  jq -nc --arg draftId "$DRAFT_ID" '{ok: true, draftId: $draftId, message: "Draft sent successfully"}'
else
  SEND_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to send draft: $SEND_MSG"
fi
