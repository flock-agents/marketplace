#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
DOCUMENT_ID=$(echo "$PARAMS" | jq -r '.documentId // ""')
FIND=$(echo "$PARAMS" | jq -r '.find // ""')
REPLACE=$(echo "$PARAMS" | jq -r '.replace // ""')

if [ -z "$DOCUMENT_ID" ] || [ -z "$FIND" ]; then
  _error_json "MISSING_PARAM" "documentId and find are required"
fi
_validate_id "$DOCUMENT_ID" "documentId"

_require_browser_session

DOC_URL="https://docs.google.com/document/d/${DOCUMENT_ID}/edit"

CLICK_REPLACE_ALL='(function(){
  var dlg = document.querySelector(".docs-findandreplace-content") ||
            document.querySelector("[role=\"dialog\"]");
  if (!dlg) return {ok:false, message:"Find and Replace dialog not found"};
  var btns = dlg.querySelectorAll("button");
  for (var i = 0; i < btns.length; i++) {
    if (/replace.all/i.test(btns[i].textContent)) {
      btns[i].click();
      return {ok:true, message:"Replace all executed via browser"};
    }
  }
  var ariaBtn = dlg.querySelector("[aria-label*=\"Replace all\"], [aria-label*=\"replace all\"]");
  if (ariaBtn) { ariaBtn.click(); return {ok:true, message:"Replace all executed via browser"}; }
  return {ok:false, message:"Replace All button not found in dialog"};
})()'

PAGE_ACTIONS=$(jq -nc --arg find "$FIND" --arg replace "$REPLACE" --arg clickScript "$CLICK_REPLACE_ALL" '[
  {action: "wait", delay: 2000},
  {action: "click", selector: ".kix-page"},
  {action: "wait", delay: 500},
  {action: "press", key: "Control+h"},
  {action: "waitForSelector", selector: ".docs-findandreplace-content, [role=\"dialog\"]", delay: 5000},
  {action: "wait", delay: 500},
  {action: "click", selector: ".docs-findandreplace-content input[type=\"text\"]:first-of-type, [role=\"dialog\"] input:first-of-type"},
  {action: "press", key: "Control+a"},
  {action: "type", text: $find},
  {action: "press", key: "Tab"},
  {action: "press", key: "Control+a"},
  {action: "type", text: $replace},
  {action: "wait", delay: 300},
  {action: "evaluate", script: $clickScript},
  {action: "wait", delay: 1000}
]')

RESULT=$(_browser_interact "$DOC_URL" "$PAGE_ACTIONS" ".kix-page")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
OP_OK=$(echo "$CONTENT" | jq -r '.ok // false')
if [ "$OP_OK" = "true" ]; then
  jq -nc --arg id "$DOCUMENT_ID" '{documentId: $id, ok: true, method: "browser"}'
else
  OP_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to replace text via browser: $OP_MSG"
fi
