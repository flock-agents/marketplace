#!/bin/bash
# conversations_unreads.sh — get unread messages across channels.
# WARNING: This is inherently slow — it makes many sequential API calls
# (each ~10s via browser session). Expect 1-5+ minutes for large workspaces.
# Params:
#   channel_types:           "all"|"im"|"mpim"|"public"|"private" (default "all")
#   max_channels:            max channels to check (default 50)
#   max_messages_per_channel: messages per unread channel (default 10)
#   mentions_only:           bool, only channels with @mentions (default false)
#   include_messages:        bool, include message content (default true)
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
CHANNEL_TYPES=$(echo "$PARAMS" | jq -r '.channel_types // "all"')
MAX_CHANNELS=$(echo "$PARAMS" | jq -r '.max_channels // 50')
MAX_MSG=$(echo "$PARAMS" | jq -r '.max_messages_per_channel // 10')
MENTIONS_ONLY=$(echo "$PARAMS" | jq -r '.mentions_only // false')
INCLUDE_MESSAGES=$(echo "$PARAMS" | jq -r '.include_messages // true')

# Resolve type string to Slack API types param
case "$CHANNEL_TYPES" in
  all)     TYPES="public_channel,private_channel,mpim,im" ;;
  im)      TYPES="im" ;;
  mpim)    TYPES="mpim" ;;
  public)  TYPES="public_channel" ;;
  private) TYPES="private_channel" ;;
  *)       TYPES="$CHANNEL_TYPES" ;;
esac

# Get current user ID (needed for mentions filter)
CURRENT_USER_ID="U0BJ1T78T6X"
if [ "$MENTIONS_ONLY" = "true" ]; then
  AUTH=$(_slack_api "auth.test") || true
  CURRENT_USER_ID=$(echo "$AUTH" | jq -r '.user_id // "U0BJ1T78T6X"')
fi

# Fetch channel list — xoxc tokens return unread_count in conversations.list
LIST_RESULT=$(_slack_api "conversations.list" \
  "types=${TYPES}&limit=200&exclude_archived=true")

# Extract channels with unread activity, sorted by priority
# Priority: DMs (is_im) > group DMs (is_mpim) > channels
UNREAD_CHANNELS=$(echo "$LIST_RESULT" | jq -c \
  --argjson max "$MAX_CHANNELS" \
  '[.channels[]? |
    select(.is_member == true or .is_im == true or .is_mpim == true) |
    select((.unread_count // 0) > 0 or (.mention_count // 0) > 0)
  ] | sort_by(
    if .is_im      then 0
    elif .is_mpim  then 1
    else               2 end
  ) | .[:($max | tonumber)] | map({
    id:            .id,
    name:          (.name // .user // "dm"),
    is_im:         (.is_im // false),
    is_mpim:       (.is_mpim // false),
    unread_count:  (.unread_count // 0),
    mention_count: (.mention_count // 0)
  })')

CHANNEL_COUNT=$(echo "$UNREAD_CHANNELS" | jq 'length')

# Fetch messages for each unread channel
RESULTS="[]"
if [ "$INCLUDE_MESSAGES" = "true" ] && [ "$CHANNEL_COUNT" -gt 0 ]; then
  while IFS= read -r CH_OBJ; do
    CH_ID=$(echo "$CH_OBJ" | jq -r '.id')
    { [ -z "$CH_ID" ] || [ "$CH_ID" = "null" ]; } && continue

    HIST=$(_slack_api "conversations.history" \
      "channel=${CH_ID}&limit=${MAX_MSG}") || continue

    MESSAGES=$(echo "$HIST" | jq -c --arg cid "$CH_ID" --arg uid "$CURRENT_USER_ID" \
      --argjson mentionsOnly "$MENTIONS_ONLY" \
      '[.messages[]? |
        select(if $mentionsOnly then (.text // "") | contains("<@" + $uid + ">") else true end) |
        {
          ts:        .ts,
          user:      (.user // ""),
          text:      (.text // ""),
          thread_ts: (.thread_ts // null)
        }
      ]')

    CH_RESULT=$(echo "$CH_OBJ" | jq -c --argjson msgs "$MESSAGES" '. + {messages: $msgs}')
    RESULTS=$(echo "$RESULTS" | jq -c --argjson ch "$CH_RESULT" '. + [$ch]')
  done < <(echo "$UNREAD_CHANNELS" | jq -c '.[]')
else
  # No message fetch, just return channel metadata
  RESULTS=$(echo "$UNREAD_CHANNELS" | jq -c 'map(. + {messages: []})')
fi

jq -nc \
  --argjson channels "$RESULTS" \
  --arg types "$CHANNEL_TYPES" \
  '{
    channel_types:    $types,
    unread_channels:  ($channels | length),
    channels:         $channels
  }'
