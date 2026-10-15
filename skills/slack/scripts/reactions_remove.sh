#!/bin/bash
# reactions_remove.sh — remove an emoji reaction from a message.
# Requires SLACK_MCP_REACTION_TOOL=true env var to enable.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

if [ "${SLACK_MCP_REACTION_TOOL:-}" != "true" ]; then
  jq -nc '{error:"reactions_disabled", message:"Set SLACK_MCP_REACTION_TOOL=true to enable removing reactions"}' >&2
  exit 1
fi

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL_ID=$(echo "$PARAMS" | jq -r '.channel_id // ""')
TIMESTAMP=$(echo "$PARAMS" | jq -r '.timestamp // ""')
EMOJI=$(echo "$PARAMS" | jq -r '.emoji // ""')

_validate_param "$CHANNEL_ID" "channel_id"
_validate_slack_id "$CHANNEL_ID" "channel_id"
_validate_param "$TIMESTAMP" "timestamp"
_validate_slack_ts "$TIMESTAMP" "timestamp"
_validate_param "$EMOJI" "emoji"

EMOJI="${EMOJI#:}"
EMOJI="${EMOJI%:}"

RESULT=$(_slack_api "reactions.remove" "channel=${CHANNEL_ID}&timestamp=${TIMESTAMP}&name=${EMOJI}")

jq -nc \
  --arg channel "$CHANNEL_ID" \
  --arg ts "$TIMESTAMP" \
  --arg emoji "$EMOJI" \
  '{ok: true, channel: $channel, timestamp: $ts, emoji: $emoji}'
