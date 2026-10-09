#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
SUMMARY=$(echo "$PARAMS" | jq -r '.summary // ""')
START=$(echo "$PARAMS" | jq -r '.start // ""')
END=$(echo "$PARAMS" | jq -r '.end // ""')
DESCRIPTION=$(echo "$PARAMS" | jq -r '.description // ""')
LOCATION=$(echo "$PARAMS" | jq -r '.location // ""')
CALENDAR_ID=$(echo "$PARAMS" | jq -r '.calendarId // "primary"')

if [ -z "$SUMMARY" ] || [ -z "$START" ] || [ -z "$END" ]; then
  _error_json "MISSING_PARAM" "summary, start, and end are required"
fi

_require_browser_session

_format_gcal_time() {
  local input="$1"
  if [[ "$input" == *Z ]]; then
    echo "$input" | sed 's/[-:]//g'
  elif [[ "$input" =~ \+[0-9]{2}:[0-9]{2}$ ]] || [[ "$input" =~ -[0-9]{2}:[0-9]{2}$ ]]; then
    echo "$input" | sed 's/[-:]//g; s/+[0-9]\{4\}$//; s/-[0-9]\{4\}$//'
  else
    echo "$input" | sed 's/[-:]//g'
  fi
}
URL_START=$(_format_gcal_time "$START")
URL_END=$(_format_gcal_time "$END")

EDIT_URL="https://calendar.google.com/calendar/r/eventedit?text=$(printf '%s' "$SUMMARY" | jq -sRr @uri)&dates=${URL_START}/${URL_END}"
[ -n "$DESCRIPTION" ] && EDIT_URL="${EDIT_URL}&details=$(printf '%s' "$DESCRIPTION" | jq -sRr @uri)"
[ -n "$LOCATION" ] && EDIT_URL="${EDIT_URL}&location=$(printf '%s' "$LOCATION" | jq -sRr @uri)"

CLICK_SAVE='(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=btns[i].textContent.trim();if(t==="Save"||t==="save"){btns[i].click();return{ok:true,message:"Event created via browser"}}}var alt=document.querySelector("[aria-label=Save]");if(alt){alt.click();return{ok:true,message:"Event created via browser"}}return{ok:false,message:"Save button not found"}})()'
PAGE_ACTIONS=$(jq -nc --arg clickScript "$CLICK_SAVE" '[
  {action: "wait", delay: 3000},
  {action: "evaluate", script: $clickScript},
  {action: "wait", delay: 2000}
]')
RESULT=$(_browser_interact "$EDIT_URL" "$PAGE_ACTIONS")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
SAVE_OK=$(echo "$CONTENT" | jq -r '.ok // false')

if [ "$SAVE_OK" = "true" ]; then
  jq -nc --arg summary "$SUMMARY" --arg start "$START" --arg end "$END" \
    '{ok: true, summary: $summary, start: $start, end: $end, source: "browser_session"}'
else
  SAVE_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to create event via browser: $SAVE_MSG"
fi
