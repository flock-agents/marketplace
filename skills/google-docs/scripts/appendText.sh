#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
DOCUMENT_ID=$(echo "$PARAMS" | jq -r '.documentId // ""')
TEXT=$(echo "$PARAMS" | jq -r '.text // ""')

if [ -z "$DOCUMENT_ID" ] || [ -z "$TEXT" ]; then
  _error_json "MISSING_PARAM" "documentId and text are required"
fi
_validate_id "$DOCUMENT_ID" "documentId"

_require_browser_session

DOC_URL="https://docs.google.com/document/d/${DOCUMENT_ID}/edit"
PAGE_ACTIONS=$(jq -nc --arg text "$TEXT" '[
  {action: "wait", delay: 2000},
  {action: "click", selector: ".kix-page"},
  {action: "wait", delay: 500},
  {action: "press", key: "Control+End"},
  {action: "wait", delay: 500},
  {action: "type", text: $text},
  {action: "wait", delay: 2000},
  {action: "evaluate", script: "({ok:true,message:\"Text appended via browser\"})"}
]')
RESULT=$(_browser_interact "$DOC_URL" "$PAGE_ACTIONS" ".kix-page")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
OP_OK=$(echo "$CONTENT" | jq -r '.ok // false')
if [ "$OP_OK" = "true" ]; then
  jq -nc --arg id "$DOCUMENT_ID" '{documentId: $id, ok: true, method: "browser"}'
else
  OP_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to append text via browser: $OP_MSG"
fi
