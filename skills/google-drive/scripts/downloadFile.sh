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

CONTENT=$(_crawl_url "https://drive.google.com/file/d/${FILE_ID}/view")
jq -nc --arg content "$CONTENT" --arg fileId "$FILE_ID" --arg source "browser_session" \
  '{source: $source, fileId: $fileId, note: "File content extracted from Google Drive web view. Binary files may not render correctly.", content: $content}'
