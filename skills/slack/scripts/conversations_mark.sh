#!/bin/bash
# conversations_mark.sh — mark a channel as read up to a given timestamp.
# Requires SLACK_MCP_MARK_TOOL=true env var to enable.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

if [ "${SLACK_MCP_MARK_TOOL:-}" != "true" ]; then
  jq -nc '{error:"mark_disabled", message:"Set SLACK_MCP_MARK_TOOL=true to enable marking channels as read"}' >&2
  exit 1
fi

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL_ID=$(echo "$PARAMS" | jq -r '.channel_id // ""')
TS=$(echo "$PARAMS" | jq -r '.ts // ""')

_validate_param "$CHANNEL_ID" "channel_id"
_validate_slack_id "$CHANNEL_ID" "channel_id"

# Default ts to current time if not provided
if [ -z "$TS" ] || [ "$TS" = "null" ]; then
  TS="$(date +%s).000000"
else
  _validate_slack_ts "$TS" "ts"
fi

RESULT=$(_slack_api "conversations.mark" "channel=${CHANNEL_ID}&ts=${TS}")

jq -nc \
  --arg channel "$CHANNEL_ID" \
  --arg ts "$TS" \
  '{ok: true, channel: $channel, ts: $ts}'
