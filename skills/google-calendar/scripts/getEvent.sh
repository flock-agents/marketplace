#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
EVENT_ID=$(echo "$PARAMS" | jq -r '.eventId // ""')
CALENDAR_ID=$(echo "$PARAMS" | jq -r '.calendarId // "primary"')

if [ -z "$EVENT_ID" ]; then
  _error_json "MISSING_PARAM" "eventId is required"
fi

_require_browser_session

_validate_id "$EVENT_ID" "eventId"

EID_RAW="${EVENT_ID} ${CALENDAR_ID}"
EID_B64=$(printf '%s' "$EID_RAW" | base64 -w0 2>/dev/null || printf '%s' "$EID_RAW" | base64)
EVENT_URL="https://calendar.google.com/calendar/event?eid=${EID_B64}"

EXTRACT_SCRIPT='(function(){
  function t(sel){var el=document.querySelector(sel);return el?el.textContent.trim():"";}
  function ta(sel){return Array.from(document.querySelectorAll(sel)).map(function(e){return e.textContent.trim()}).filter(Boolean);}
  var title = t("[data-eventid] [data-key=\"title\"]") || t("[data-key=\"title\"]") || t("span[data-eventid]") || t("[data-eventchip] span") || "";
  var when = t("[data-key=\"when\"]") || t("[data-datekey]") || "";
  var where = t("[data-key=\"where\"]") || t("[data-key=\"location\"]") || "";
  var desc = t("[data-key=\"description\"]") || "";
  var guests = ta("[data-key=\"guests\"] [data-email]").concat(ta("[data-key=\"guests\"] span[dir]"));
  if(!title){
    title = t("h1") || t("[role=\"heading\"]") || t(".r4nke.yYSgeb");
    var spans = document.querySelectorAll("span");
    for(var i=0;i<spans.length;i++){
      var txt=spans[i].textContent.trim();
      if(!when && /\d{1,2}[:\s]?\d{2}/.test(txt) && /[ap]m|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(txt)) when=txt;
      if(!where && spans[i].closest("[data-location]")) where=txt;
    }
  }
  if(!title) return JSON.stringify({ok:false, message:"Could not extract event details. The event page may not have loaded correctly."});
  return JSON.stringify({ok:true, title:title, when:when, location:where, description:desc, guests:guests});
})()'

PAGE_ACTIONS=$(jq -nc --arg script "$EXTRACT_SCRIPT" '[
  {action: "wait", delay: 3000},
  {action: "evaluate", script: $script}
]')

RESULT=$(_browser_interact "$EVENT_URL" "$PAGE_ACTIONS")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null || echo '{}')
EVENT_OK=$(echo "$PARSED" | jq -r '.ok // false')

if [ "$EVENT_OK" = "true" ]; then
  echo "$PARSED" | jq -c --arg eventId "$EVENT_ID" '. + {eventId: $eventId, source: "browser_session"}'
else
  EVENT_MSG=$(echo "$PARSED" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to get event: $EVENT_MSG"
fi
