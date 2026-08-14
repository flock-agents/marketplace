#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
TO=$(echo "$PARAMS" | jq -r '.to // ""')
SUBJECT=$(echo "$PARAMS" | jq -r '.subject // ""')
BODY_TEXT=$(echo "$PARAMS" | jq -r '.body // ""')
CC=$(echo "$PARAMS" | jq -r '.cc // ""')
BCC=$(echo "$PARAMS" | jq -r '.bcc // ""')
ATTACHMENTS=$(echo "$PARAMS" | jq -r '
  if .attachments == null then ""
  elif (.attachments | type) == "array" then .attachments | map(select(. != null and . != "")) | join("\n")
  elif (.attachments | type) == "string" then .attachments
  else ""
  end
')

_require_browser_session

if [ -z "$TO" ] || [ -z "$SUBJECT" ]; then
  _error_json "MISSING_PARAM" "to and subject are required"
fi

SESSION_RESULT=$(_persistent_create "https://mail.google.com/mail/u/0/#inbox")
PERSISTENT_ID=$(echo "$SESSION_RESULT" | jq -r '.persistentSessionId // ""')

if [ -z "$PERSISTENT_ID" ]; then
  _error_json "SESSION_ERROR" "Failed to create persistent session for Gmail"
fi

COMPOSE_ACTIONS=$(jq -nc '[
  {"action":"waitForSelector","selector":".T-I.T-I-KE.L3","delay":5000},
  {"action":"click","selector":".T-I.T-I-KE.L3"},
  {"action":"waitForSelector","selector":"[aria-label*=\"To\"] input, textarea[aria-label*=\"To\"], [name=to]","delay":5000}
]')

_persistent_interact "$PERSISTENT_ID" "$COMPOSE_ACTIONS" "false" "" >/dev/null 2>&1

TO_JSON=$(echo "$TO" | jq -Rs '.')
RECIPIENT_ACTIONS=$(jq -nc --argjson to "$TO_JSON" '[
  {"action":"insertText","text":$to},
  {"action":"press","key":"Tab"},
  {"action":"wait","delay":1000}
]')

_persistent_interact "$PERSISTENT_ID" "$RECIPIENT_ACTIONS" "false" "" >/dev/null 2>&1

# CC — Gmail hides this by default; expand via the toggle link, then fill
if [ -n "$CC" ]; then
  CC_EXPAND='(() => {
    const c = document.querySelector("[role=dialog],.AD") || document;
    const f = c.querySelector("textarea[name=cc],input[name=cc]");
    if (f) return "visible";
    for (const el of c.querySelectorAll("span,a,[role=link],[role=button]")) {
      const t = el.textContent.trim();
      if (t === "Cc" || t === "Cc Bcc") { el.click(); return "expanded"; }
    }
    return "not-found";
  })()'
  CC_EXPAND_ACTIONS=$(jq -nc --arg s "$CC_EXPAND" '[
    {"action":"evaluate","script":$s},
    {"action":"wait","delay":500}
  ]')
  _persistent_interact "$PERSISTENT_ID" "$CC_EXPAND_ACTIONS" "false" "" >/dev/null 2>&1

  CC_JSON=$(echo "$CC" | jq -Rs '.')
  CC_FILL=$(jq -nc --argjson cc "$CC_JSON" '[
    {"action":"click","selector":"textarea[name=\"cc\"], input[name=\"cc\"], [aria-label=\"Cc\"] input"},
    {"action":"insertText","text":$cc},
    {"action":"press","key":"Tab"},
    {"action":"wait","delay":500}
  ]')
  _persistent_interact "$PERSISTENT_ID" "$CC_FILL" "false" "" >/dev/null 2>&1
fi

# BCC — same pattern; may need separate expansion if CC didn't reveal it
if [ -n "$BCC" ]; then
  BCC_EXPAND='(() => {
    const c = document.querySelector("[role=dialog],.AD") || document;
    const f = c.querySelector("textarea[name=bcc],input[name=bcc]");
    if (f) return "visible";
    for (const el of c.querySelectorAll("span,a,[role=link],[role=button]")) {
      if (el.textContent.trim() === "Bcc") { el.click(); return "expanded"; }
    }
    return "not-found";
  })()'
  BCC_EXPAND_ACTIONS=$(jq -nc --arg s "$BCC_EXPAND" '[
    {"action":"evaluate","script":$s},
    {"action":"wait","delay":500}
  ]')
  _persistent_interact "$PERSISTENT_ID" "$BCC_EXPAND_ACTIONS" "false" "" >/dev/null 2>&1

  BCC_JSON=$(echo "$BCC" | jq -Rs '.')
  BCC_FILL=$(jq -nc --argjson bcc "$BCC_JSON" '[
    {"action":"click","selector":"textarea[name=\"bcc\"], input[name=\"bcc\"], [aria-label=\"Bcc\"] input"},
    {"action":"insertText","text":$bcc},
    {"action":"press","key":"Tab"},
    {"action":"wait","delay":500}
  ]')
  _persistent_interact "$PERSISTENT_ID" "$BCC_FILL" "false" "" >/dev/null 2>&1
fi

SUBJECT_JSON=$(echo "$SUBJECT" | jq -Rs '.')
BODY_JSON=$(echo "$BODY_TEXT" | jq -Rs '.')
CONTENT_ACTIONS=$(jq -nc --argjson subj "$SUBJECT_JSON" --argjson body "$BODY_JSON" '[
  {"action":"click","selector":"input[name=subjectbox]"},
  {"action":"insertText","text":$subj},
  {"action":"click","selector":"div[aria-label*=\"Message\"]"},
  {"action":"insertText","text":$body},
  {"action":"wait","delay":1000}
]')

_persistent_interact "$PERSISTENT_ID" "$CONTENT_ACTIONS" "false" "" >/dev/null 2>&1

# Attachments — upload each file via the hidden file input
if [ -n "$ATTACHMENTS" ]; then
  while IFS= read -r APATH; do
    APATH=$(echo "$APATH" | xargs)
    [ -z "$APATH" ] && continue
    [ ! -f "$APATH" ] && continue
    ATTACH_ACTIONS=$(jq -nc --arg path "$APATH" '[
      {"action":"upload","selector":"input[type=\"file\"]","filePath":$path},
      {"action":"wait","delay":2000}
    ]')
    _persistent_interact "$PERSISTENT_ID" "$ATTACH_ACTIONS" "false" "" >/dev/null 2>&1
  done <<< "$ATTACHMENTS"
fi

EVAL_SCRIPT="(() => {
  return JSON.stringify({ success: true, message: 'Draft created via browser session' });
})()"

CLOSE_ACTIONS=$(jq -nc '[
  {"action":"evaluate","script":"(() => { const closeBtn = document.querySelector('"'"'.Ha img.Ha-Jj'"'"') || document.querySelector('"'"'[aria-label=\"Save & close\"]'"'"') || document.querySelector('"'"'.og.T-I-J3'"'"'); if (closeBtn) { closeBtn.click(); return {ok:true}; } return {ok:true,message:\"Draft saved (compose left open)\"}; })()"},
  {"action":"wait","delay":1500},
  {"action":"screenshot"}
]')

RESULT=$(_persistent_interact "$PERSISTENT_ID" "$CLOSE_ACTIONS" "true" "$EVAL_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
