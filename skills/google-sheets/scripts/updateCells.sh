#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
SPREADSHEET_ID=$(echo "$PARAMS" | jq -r '.spreadsheetId // ""')
RANGE=$(echo "$PARAMS" | jq -r '.range // ""')
VALUES=$(echo "$PARAMS" | jq -c '.values // []')

if [ -z "$SPREADSHEET_ID" ] || [ -z "$RANGE" ] || [ "$VALUES" = "[]" ]; then
  _error_json "MISSING_PARAM" "spreadsheetId, range, and non-empty values are required"
fi
_validate_id "$SPREADSHEET_ID" "spreadsheetId"

_require_browser_session

SHEET_URL="https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit"
CELL_REF=$(echo "$RANGE" | sed 's/.*!//')
CELL_ACTIONS=$(echo "$VALUES" | jq -c '[
  .[] as $row | $row | to_entries[] | (
    {action: "type", text: (.value | tostring)},
    if .key == (($row | length) - 1) then {action: "press", key: "Enter"}
    else {action: "press", key: "Tab"} end
  )
]')
NAME_BOX='input#t-name-box, .jfk-textinput-label.label-input-label, input[aria-label="Name Box"]'
PAGE_ACTIONS=$(jq -nc --arg nb "$NAME_BOX" --arg ref "$CELL_REF" --argjson cells "$CELL_ACTIONS" '[
  {action: "wait", delay: 2000},
  {action: "click", selector: $nb},
  {action: "wait", delay: 300},
  {action: "press", key: "Control+a"},
  {action: "type", text: $ref},
  {action: "press", key: "Enter"},
  {action: "wait", delay: 500}
] + $cells + [
  {action: "wait", delay: 2000},
  {action: "evaluate", script: "({ok:true,message:\"Cells updated via browser\"})"}
]')
RESULT=$(_browser_interact "$SHEET_URL" "$PAGE_ACTIONS" ".grid-container")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
OP_OK=$(echo "$CONTENT" | jq -r '.ok // false')
if [ "$OP_OK" = "true" ]; then
  jq -nc --arg id "$SPREADSHEET_ID" --arg range "$RANGE" '{spreadsheetId: $id, updatedRange: $range, ok: true, method: "browser"}'
else
  OP_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to update cells via browser: $OP_MSG"
fi
