#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
SPREADSHEET_ID=$(echo "$PARAMS" | jq -r '.spreadsheetId // ""')

if [ -z "$SPREADSHEET_ID" ]; then
  _error_json "MISSING_PARAM" "spreadsheetId is required"
fi
_validate_id "$SPREADSHEET_ID" "spreadsheetId"

_require_browser_session

CONTENT=$(_crawl_url "https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv")
jq -nc --arg content "$CONTENT" --arg spreadsheetId "$SPREADSHEET_ID" --arg source "browser_export" \
  '{source: $source, spreadsheetId: $spreadsheetId, note: "Spreadsheet exported as CSV via browser session.", content: $content}'
