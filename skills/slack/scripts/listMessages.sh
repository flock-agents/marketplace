#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL=$(echo "$PARAMS" | jq -r '.channel // ""')
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 25')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')
OLDEST=$(echo "$PARAMS" | jq -r '.oldest // ""')
LATEST=$(echo "$PARAMS" | jq -r '.latest // ""')

_validate_param "$CHANNEL" "channel"
_validate_slack_id "$CHANNEL" "channel"

API_PARAMS="channel=${CHANNEL}&limit=${LIMIT}"
if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
  API_PARAMS="${API_PARAMS}&cursor=${CURSOR}"
fi
if [ -n "$OLDEST" ] && [ "$OLDEST" != "null" ]; then
  _validate_slack_ts "$OLDEST" "oldest"
  API_PARAMS="${API_PARAMS}&oldest=${OLDEST}"
fi
if [ -n "$LATEST" ] && [ "$LATEST" != "null" ]; then
  _validate_slack_ts "$LATEST" "latest"
  API_PARAMS="${API_PARAMS}&latest=${LATEST}"
fi

RESULT=$(_slack_api "conversations.history" "$API_PARAMS")

MESSAGES=$(echo "$RESULT" | jq -c --arg ch "$CHANNEL" '[.messages[]? | {message_id: ($ch + ":" + .ts), ts: .ts, user: (.user // ""), text: (.text // ""), type: (.type // "message"), subtype: (.subtype // null), thread_ts: (.thread_ts // null), reply_count: (.reply_count // 0), reply_users_count: (.reply_users_count // 0), bot_id: (.bot_id // null), channel: $ch}]')
NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')
HAS_MORE=$(echo "$RESULT" | jq -r '.has_more // false')

jq -nc \
  --argjson messages "$MESSAGES" \
  --arg nextCursor "$NEXT_CURSOR" \
  --argjson hasMore "$HAS_MORE" \
  --arg channel "$CHANNEL" \
  '{channel: $channel, messages: $messages, nextCursor: $nextCursor, hasMore: $hasMore}'
