#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
LABEL_NAME=$(echo "$PARAMS" | jq -r '.name // ""')

_require_browser_session

if [ -z "$LABEL_NAME" ]; then
  _error_json "MISSING_PARAM" "name is required"
fi

LABEL_NAME_JSON=$(echo "$LABEL_NAME" | jq -Rs '.')

ACTIONS=$(jq -nc --argjson labelName "$LABEL_NAME_JSON" '[
  {"action":"wait","delay":2000},
  {"action":"evaluate","script":"(() => { const moreBtn = document.querySelector(\".CL[aria-label=\\\"More\\\"]\") || document.querySelector(\".aim .TN[data-tooltip=\\\"More\\\"]\"); if (moreBtn) moreBtn.click(); return {ok:true}; })()"},
  {"action":"wait","delay":1000},
  {"action":"evaluate","script":"(() => { const createBtn = Array.from(document.querySelectorAll(\".aHS-bnq, [role=menuitem]\")).find(el => el.textContent?.includes(\"Create new label\")); if (createBtn) { createBtn.click(); return {ok:true}; } return {ok:false,message:\"Create new label option not found\"}; })()"},
  {"action":"wait","delay":1500},
  {"action":"evaluate","script":("(() => { const input = document.querySelector(\".xx input[type=text]\") || document.querySelector(\"[aria-label*=\\\"label name\\\"] input\") || document.querySelector(\".Kj-JD-Jl input\"); if (input) { input.value = " + $labelName + "; input.dispatchEvent(new Event(\"input\", {bubbles:true})); return {ok:true}; } return {ok:false,message:\"Label name input not found\"}; })()")},
  {"action":"wait","delay":500},
  {"action":"evaluate","script":"(() => { const btns = document.querySelectorAll(\"button[name=ok], .Kj-JD-K7-K0 button, button.J-at1-auR\"); for (const b of btns) { if (b.textContent?.trim() === \"Create\" || b.textContent?.trim() === \"OK\") { b.click(); return {ok:true}; } } return {ok:false,message:\"Create/OK button not found\"}; })()"},
  {"action":"wait","delay":2000}
]')

EVAL_SCRIPT=$(jq -nc --argjson labelName "$LABEL_NAME_JSON" \
  '"(() => { return JSON.stringify({ success: true, name: " + $labelName + ", message: \"Label creation attempted via browser session\" }); })()"')
EVAL_SCRIPT=$(echo "$EVAL_SCRIPT" | jq -r '.')

RESULT=$(_browser_interact "https://mail.google.com/mail/u/0/#inbox" "$ACTIONS" "" "$EVAL_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
