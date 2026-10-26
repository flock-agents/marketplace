#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
FOLDER_ID=$(echo "$PARAMS" | jq -r '.folderId // ""')

if [ -n "$FOLDER_ID" ]; then
  _validate_id "$FOLDER_ID" "folderId"
fi

_require_browser_session

URL="https://drive.google.com/drive/my-drive"
if [ -n "$FOLDER_ID" ]; then
  URL="https://drive.google.com/drive/folders/${FOLDER_ID}"
fi
if [ -n "$QUERY" ]; then
  ENCODED_Q=$(printf '%s' "$QUERY" | jq -sRr @uri)
  URL="https://drive.google.com/drive/search?q=${ENCODED_Q}"
fi

CONTENT=$(_crawl_url "$URL")
jq -nc --arg source "drive_list" --arg content "$CONTENT" \
  '{source: $source, content: $content}'
