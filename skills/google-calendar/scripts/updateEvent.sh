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

SUMMARY=$(echo "$PARAMS" | jq -r '.summary // ""')
DESCRIPTION=$(echo "$PARAMS" | jq -r '.description // ""')
LOCATION=$(echo "$PARAMS" | jq -r '.location // ""')
START=$(echo "$PARAMS" | jq -r '.start // ""')
END=$(echo "$PARAMS" | jq -r '.end // ""')

EID_RAW="${EVENT_ID} ${CALENDAR_ID}"
EID_B64=$(printf '%s' "$EID_RAW" | base64 -w0 2>/dev/null || printf '%s' "$EID_RAW" | base64)
EDIT_URL="https://calendar.google.com/calendar/event?action=EDIT&eid=${EID_B64}"

CLICK_SAVE='(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=btns[i].textContent.trim();if(t==="Save"||t==="save"){btns[i].click();return{ok:true,message:"Event updated via browser"}}}var alt=document.querySelector("[aria-label=Save]");if(alt){alt.click();return{ok:true,message:"Event updated via browser"}}return{ok:false,message:"Save button not found"}})()'
TITLE_SELECTOR='[data-key="title"] input, input[aria-label="Title"]'

PAGE_ACTIONS='[]'
PAGE_ACTIONS=$(echo "$PAGE_ACTIONS" | jq -c '. + [{action: "wait", delay: 3000}]')

if [ -n "$SUMMARY" ]; then
  PAGE_ACTIONS=$(echo "$PAGE_ACTIONS" | jq -c --arg sel "$TITLE_SELECTOR" --arg text "$SUMMARY" '. + [
    {action: "click", selector: $sel},
    {action: "press", key: "Control+a"},
    {action: "type", text: $text}
  ]')
fi

if [ -n "$LOCATION" ]; then
  PAGE_ACTIONS=$(echo "$PAGE_ACTIONS" | jq -c --arg text "$LOCATION" '. + [
    {action: "click", selector: "input[aria-label=\"Location\"], [data-key=\"location\"] input, input[placeholder*=\"location\" i]"},
    {action: "press", key: "Control+a"},
    {action: "type", text: $text},
    {action: "wait", delay: 500},
    {action: "press", key: "Escape"}
  ]')
fi

if [ -n "$DESCRIPTION" ]; then
  PAGE_ACTIONS=$(echo "$PAGE_ACTIONS" | jq -c --arg text "$DESCRIPTION" '. + [
    {action: "click", selector: "[data-key=\"description\"] [contenteditable=\"true\"], [aria-label=\"Description\"], textarea[aria-label=\"Description\"]"},
    {action: "press", key: "Control+a"},
    {action: "insertText", text: $text}
  ]')
fi

PAGE_ACTIONS=$(echo "$PAGE_ACTIONS" | jq -c --arg clickScript "$CLICK_SAVE" '. + [
  {action: "wait", delay: 1000},
  {action: "evaluate", script: $clickScript},
  {action: "wait", delay: 2000}
]')
RESULT=$(_browser_interact "$EDIT_URL" "$PAGE_ACTIONS")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
OP_OK=$(echo "$CONTENT" | jq -r '.ok // false')
if [ "$OP_OK" = "true" ]; then
  jq -nc --arg id "$EVENT_ID" '{ok: true, eventId: $id, method: "browser"}'
else
  OP_MSG=$(echo "$CONTENT" | jq -r '.message // "unknown error"')
  _error_json "BROWSER_ERROR" "Failed to update event via browser: $OP_MSG"
fi
