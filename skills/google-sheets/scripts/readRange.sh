#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
SPREADSHEET_ID=$(echo "$PARAMS" | jq -r '.spreadsheetId // ""')
RANGE=$(echo "$PARAMS" | jq -r '.range // ""')

if [ -z "$SPREADSHEET_ID" ] || [ -z "$RANGE" ]; then
  _error_json "MISSING_PARAM" "spreadsheetId and range are required"
fi
_validate_id "$SPREADSHEET_ID" "spreadsheetId"

_require_browser_session

SHEET_URL="https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit"

EXTRACT_RANGE='(function(){
  var range = "'"$(echo "$RANGE" | sed "s/'/\\\\'/g")"'";
  var nameBox = document.querySelector("input.jfk-textinput[type=\"text\"]") ||
                document.querySelector("#t-name-box") ||
                document.querySelector("input[aria-label=\"Name Box\"]");
  if (!nameBox) return JSON.stringify({ok:false, message:"Name Box not found — spreadsheet may not have loaded"});
  nameBox.focus();
  nameBox.value = "";
  document.execCommand("insertText", false, range);
  nameBox.dispatchEvent(new Event("input", {bubbles:true}));
  return JSON.stringify({ok:true, step:"navigated"});
})()'

SELECT_AND_READ='(function(){
  var sel = document.querySelector(".selection.active-cell-border") ||
            document.querySelector("[aria-label*=\"selection\"]");
  var cells = [];
  var active = document.querySelectorAll(".cell-input, .softmerge-inner");
  if (active.length > 0) {
    active.forEach(function(c) { cells.push(c.textContent.trim()); });
    if (cells.length > 0) return JSON.stringify({ok:true, values:cells});
  }
  document.execCommand("copy");
  return JSON.stringify({ok:true, message:"Range selected and copied. Extracting via clipboard."});
})()'

CLIPBOARD_READ='(function(){
  try {
    var rows = [];
    var table = document.querySelector("table.waffle");
    if (table) {
      var trs = table.querySelectorAll("tr");
      trs.forEach(function(tr){
        var row = [];
        tr.querySelectorAll("td, th").forEach(function(td){ row.push(td.textContent.trim()); });
        if (row.some(function(c){return c !== "";})) rows.push(row);
      });
      if (rows.length > 0) return JSON.stringify({ok:true, values:rows, rows:rows.length, cols:rows[0].length});
    }
    return JSON.stringify({ok:false, message:"Could not extract cell data from the spreadsheet view"});
  } catch(e) {
    return JSON.stringify({ok:false, message:"Error extracting: " + e.message});
  }
})()'

PAGE_ACTIONS=$(jq -nc --arg navScript "$EXTRACT_RANGE" --arg readScript "$CLIPBOARD_READ" '[
  {action: "wait", delay: 3000},
  {action: "evaluate", script: $navScript},
  {action: "press", key: "Enter"},
  {action: "wait", delay: 1500},
  {action: "evaluate", script: $readScript}
]')

RESULT=$(_browser_interact "$SHEET_URL" "$PAGE_ACTIONS")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null || echo '{}')
READ_OK=$(echo "$PARSED" | jq -r '.ok // false')

if [ "$READ_OK" = "true" ]; then
  echo "$PARSED" | jq -c --arg spreadsheetId "$SPREADSHEET_ID" --arg range "$RANGE" \
    '. + {spreadsheetId: $spreadsheetId, range: $range, source: "browser_session"}'
else
  FALLBACK=$(_crawl_url "https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv")
  jq -nc --arg content "$FALLBACK" --arg spreadsheetId "$SPREADSHEET_ID" --arg range "$RANGE" \
    '{source: "browser_export_fallback", spreadsheetId: $spreadsheetId, requestedRange: $range, note: "Range navigation failed; full spreadsheet exported as CSV.", content: $content}'
fi
