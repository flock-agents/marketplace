#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
DOCUMENT_ID=$(echo "$PARAMS" | jq -r '.documentId // ""')

if [ -z "$DOCUMENT_ID" ]; then
  _error_json "MISSING_PARAM" "documentId is required"
fi
_validate_id "$DOCUMENT_ID" "documentId"

_require_browser_session

# Export URL: returns plain text directly via browser session cookies
CONTENT=$(_crawl_url "https://docs.google.com/document/d/${DOCUMENT_ID}/export?format=txt")
jq -nc --arg content "$CONTENT" --arg documentId "$DOCUMENT_ID" --arg source "browser_export" \
  '{source: $source, documentId: $documentId, content: $content}'
