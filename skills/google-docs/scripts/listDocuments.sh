#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

_require_browser_session

CONTENT=$(_crawl_url "https://docs.google.com/document/")
jq -nc --arg content "$CONTENT" --arg source "browser_session" \
  '{source: $source, note: "Document list from Google Docs web UI.", content: $content}'
