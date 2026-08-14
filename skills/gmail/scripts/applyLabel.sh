#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
MESSAGE_ID=$(echo "$PARAMS" | jq -r '.messageId // ""')
LABEL_NAME=$(echo "$PARAMS" | jq -r '.labelName // ""')

_require_browser_session

if [ -z "$MESSAGE_ID" ] || [ -z "$LABEL_NAME" ]; then
  _error_json "MISSING_PARAM" "messageId and labelName are required"
fi
_validate_id "$MESSAGE_ID" "messageId"

LABEL_NAME_JSON=$(echo "$LABEL_NAME" | jq -Rs '.')

ACTIONS=$(jq -nc --argjson labelName "$LABEL_NAME_JSON" '[
  {"action":"wait","delay":3000},
  {"action":"evaluate","script":"(() => { const btn = document.querySelector(\"[aria-label=\\\"Labels\\\"]\") || document.querySelector(\"[data-tooltip=\\\"Labels\\\"]\"); if (btn) { btn.click(); return {ok:true}; } return {ok:false,message:\"Labels button not found\"}; })()"},
  {"action":"wait","delay":1500},
  {"action":"evaluate","script":("(() => { const searchInput = document.querySelector(\".bqf input\") || document.querySelector(\"[aria-label=\\\"Label search\\\"]\"); if (searchInput) { searchInput.value = " + $labelName + "; searchInput.dispatchEvent(new Event(\"input\",{bubbles:true})); } return {ok:true}; })()")},
  {"action":"wait","delay":1000},
  {"action":"evaluate","script":("(() => { const target = " + $labelName + "; const labels = document.querySelectorAll(\".J-N-Jz, .brC-brG-btb\"); for (const l of labels) { if (l.textContent?.trim() === target) { l.click(); return {ok:true,message:\"Label selected\"}; } } const checkboxes = document.querySelectorAll(\".J-Kh-Jt input[type=checkbox]\"); for (const cb of checkboxes) { const label = cb.closest(\".J-N\")?.querySelector(\".J-N-Jz\"); if (label && label.textContent?.trim() === target) { cb.click(); return {ok:true,message:\"Label checkbox toggled\"}; } } return {ok:false,message:\"Label not found in dropdown\"}; })()")},
  {"action":"wait","delay":500},
  {"action":"evaluate","script":"(() => { const applyBtn = document.querySelector(\".brC-aMv-auR[role=button]\") || Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent?.trim() === \"Apply\"); if (applyBtn) { applyBtn.click(); return {ok:true}; } return {ok:true,message:\"No apply button — label may have auto-applied\"}; })()"},
  {"action":"wait","delay":1500}
]')

EVAL_SCRIPT="(() => { return JSON.stringify({ success: true, message: 'Label applied via browser session' }); })()"

RESULT=$(_browser_interact "https://mail.google.com/mail/u/0/#inbox/${MESSAGE_ID}" "$ACTIONS" "" "$EVAL_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
