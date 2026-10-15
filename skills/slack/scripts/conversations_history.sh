#!/bin/bash
# conversations_history.sh — fetch message history for a channel.
# limit param: accepts "1d","7d","30d","2w" (time range → oldest=) or a number (message count).
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL=$(echo "$PARAMS" | jq -r '.channel // ""')
LIMIT_RAW=$(echo "$PARAMS" | jq -r '.limit // "25"')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')
OLDEST=$(echo "$PARAMS" | jq -r '.oldest // ""')
LATEST=$(echo "$PARAMS" | jq -r '.latest // ""')

_validate_param "$CHANNEL" "channel"
_validate_slack_id "$CHANNEL" "channel"

# Parse smart limit: if it matches NNd / NNw / NNh, treat as time range
API_LIMIT=25
OLDEST_COMPUTED=""

if [[ "$LIMIT_RAW" =~ ^([0-9]+)([dhw])$ ]]; then
  NUM="${BASH_REMATCH[1]}"
  UNIT="${BASH_REMATCH[2]}"
  case "$UNIT" in
    d) OLDEST_COMPUTED=$(date -v-"${NUM}d" +%s 2>/dev/null || date -d "-${NUM} days" +%s) ;;
    w) OLDEST_COMPUTED=$(date -v-"${NUM}w" +%s 2>/dev/null || date -d "-${NUM} weeks" +%s) ;;
    h) OLDEST_COMPUTED=$(date -v-"${NUM}H" +%s 2>/dev/null || date -d "-${NUM} hours" +%s) ;;
  esac
  # When fetching by time range, request up to 100 messages
  API_LIMIT=100
else
  API_LIMIT="$LIMIT_RAW"
fi

# oldest param: explicit param wins over computed
if [ -n "$OLDEST" ] && [ "$OLDEST" != "null" ]; then
  _validate_slack_ts "$OLDEST" "oldest"
  OLDEST_COMPUTED=""
fi

API_PARAMS="channel=${CHANNEL}&limit=${API_LIMIT}"

if [ -n "$OLDEST_COMPUTED" ]; then
  API_PARAMS="${API_PARAMS}&oldest=${OLDEST_COMPUTED}.000000"
elif [ -n "$OLDEST" ] && [ "$OLDEST" != "null" ]; then
  API_PARAMS="${API_PARAMS}&oldest=${OLDEST}"
fi

if [ -n "$LATEST" ] && [ "$LATEST" != "null" ]; then
  _validate_slack_ts "$LATEST" "latest"
  API_PARAMS="${API_PARAMS}&latest=${LATEST}"
fi

if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
  API_PARAMS="${API_PARAMS}&cursor=${CURSOR}"
fi

RESULT=$(_slack_api "conversations.history" "$API_PARAMS")

MESSAGES=$(echo "$RESULT" | jq -c --arg ch "$CHANNEL" '[.messages[]? | {
  message_id:        ($ch + ":" + .ts),
  ts:                .ts,
  user:              (.user // ""),
  text:              (.text // ""),
  type:              (.type // "message"),
  subtype:           (.subtype // null),
  thread_ts:         (.thread_ts // null),
  reply_count:       (.reply_count // 0),
  reply_users_count: (.reply_users_count // 0),
  bot_id:            (.bot_id // null),
  channel:           $ch
}]')
NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')
HAS_MORE=$(echo "$RESULT" | jq -r '.has_more // false')

jq -nc \
  --argjson messages "$MESSAGES" \
  --arg nextCursor "$NEXT_CURSOR" \
  --argjson hasMore "$HAS_MORE" \
  --arg channel "$CHANNEL" \
  '{channel: $channel, messages: $messages, nextCursor: $nextCursor, hasMore: $hasMore}'
