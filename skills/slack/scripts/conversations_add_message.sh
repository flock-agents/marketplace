#!/bin/bash
# conversations_add_message.sh — post a message to a channel or thread.
# Requires SLACK_MCP_ADD_MESSAGE_TOOL=true env var to enable.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

if [ "${SLACK_MCP_ADD_MESSAGE_TOOL:-}" != "true" ]; then
  jq -nc '{error:"add_message_disabled", message:"Set SLACK_MCP_ADD_MESSAGE_TOOL=true to enable posting messages"}' >&2
  exit 1
fi

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL_ID=$(echo "$PARAMS" | jq -r '.channel_id // ""')
PAYLOAD=$(echo "$PARAMS" | jq -r '.payload // ""')
THREAD_TS=$(echo "$PARAMS" | jq -r '.thread_ts // ""')
CONTENT_TYPE=$(echo "$PARAMS" | jq -r '.content_type // "text/plain"')

_validate_param "$CHANNEL_ID" "channel_id"
_validate_slack_id "$CHANNEL_ID" "channel_id"
_validate_param "$PAYLOAD" "payload"

# Build API params
ENCODED_TEXT=$(printf '%s' "$PAYLOAD" | jq -sRr @uri)
API_PARAMS="channel=${CHANNEL_ID}&text=${ENCODED_TEXT}"

if [ -n "$THREAD_TS" ] && [ "$THREAD_TS" != "null" ]; then
  _validate_slack_ts "$THREAD_TS" "thread_ts"
  API_PARAMS="${API_PARAMS}&thread_ts=${THREAD_TS}"
fi

# mrkdwn rendering: enable for markdown content type
if [ "$CONTENT_TYPE" = "text/markdown" ]; then
  API_PARAMS="${API_PARAMS}&mrkdwn=true"
fi

RESULT=$(_slack_api "chat.postMessage" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  ok:         .ok,
  channel:    .channel,
  ts:         .ts,
  message_id: ((.channel // "") + ":" + (.ts // ""))
}'
