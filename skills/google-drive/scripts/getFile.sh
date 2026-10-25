#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
FILE_ID=$(echo "$PARAMS" | jq -r '.fileId // ""')

if [ -z "$FILE_ID" ]; then
  _error_json "MISSING_PARAM" "fileId is required"
fi
_validate_id "$FILE_ID" "fileId"

_require_browser_session

# Try export URL for Google workspace files, fall back to view page
CONTENT=$(_crawl_url "https://docs.google.com/document/d/${FILE_ID}/export?format=txt" 2>/dev/null) || \
CONTENT=$(_crawl_url "https://drive.google.com/file/d/${FILE_ID}/view")
jq -nc --arg content "$CONTENT" --arg fileId "$FILE_ID" --arg source "browser_session" \
  '{source: $source, fileId: $fileId, content: $content}'
