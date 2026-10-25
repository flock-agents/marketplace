#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')

if [ -z "$QUERY" ]; then
  _error_json "MISSING_PARAM" "query is required"
fi

_require_browser_session

ENCODED_Q=$(printf '%s' "$QUERY" | jq -sRr @uri)
CONTENT=$(_crawl_url "https://drive.google.com/drive/search?q=${ENCODED_Q}")
jq -nc --arg source "drive_search" --arg query "$QUERY" --arg content "$CONTENT" \
  '{source: $source, query: $query, content: $content}'
