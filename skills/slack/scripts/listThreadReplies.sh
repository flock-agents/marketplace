#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL=$(echo "$PARAMS" | jq -r '.channel // ""')
TS=$(echo "$PARAMS" | jq -r '.ts // ""')
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 50')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')

_validate_param "$CHANNEL" "channel"
_validate_slack_id "$CHANNEL" "channel"
_validate_param "$TS" "ts"
_validate_slack_ts "$TS" "ts"

API_PARAMS="channel=${CHANNEL}&ts=${TS}&limit=${LIMIT}"
if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
  API_PARAMS="${API_PARAMS}&cursor=${CURSOR}"
fi

RESULT=$(_slack_api "conversations.replies" "$API_PARAMS")

MESSAGES=$(echo "$RESULT" | jq -c '[.messages[]? | {ts: .ts, user: (.user // ""), text: (.text // ""), type: (.type // "message"), thread_ts: (.thread_ts // null), bot_id: (.bot_id // null)}]')
NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')
HAS_MORE=$(echo "$RESULT" | jq -r '.has_more // false')

jq -nc \
  --argjson messages "$MESSAGES" \
  --arg nextCursor "$NEXT_CURSOR" \
  --argjson hasMore "$HAS_MORE" \
  --arg channel "$CHANNEL" \
  --arg threadTs "$TS" \
  '{channel: $channel, threadTs: $threadTs, messages: $messages, nextCursor: $nextCursor, hasMore: $hasMore}'
