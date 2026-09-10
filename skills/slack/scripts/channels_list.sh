#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 100')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')
TYPES=$(echo "$PARAMS" | jq -r '.types // "public_channel,private_channel,mpim,im"')
SORT=$(echo "$PARAMS" | jq -r '.sort // ""')

API_PARAMS="types=${TYPES}&limit=${LIMIT}&exclude_archived=true"
if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
  API_PARAMS="${API_PARAMS}&cursor=${CURSOR}"
fi

RESULT=$(_slack_api "conversations.list" "$API_PARAMS")

CHANNELS=$(echo "$RESULT" | jq -c \
  --arg sort "$SORT" \
  '[.channels[]? | {
    id: .id,
    name: (.name // .user // "dm"),
    is_channel: (.is_channel // false),
    is_group:   (.is_group // false),
    is_im:      (.is_im // false),
    is_mpim:    (.is_mpim // false),
    is_private: (.is_private // false),
    is_member:  (.is_member // false),
    num_members:(.num_members // 0),
    topic:      (.topic.value // ""),
    purpose:    (.purpose.value // "")
  }] | if $sort == "name" then sort_by(.name)
       elif $sort == "members" then sort_by(-.num_members)
       else . end')
NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')

jq -nc \
  --argjson channels "$CHANNELS" \
  --arg nextCursor "$NEXT_CURSOR" \
  '{channels: $channels, nextCursor: $nextCursor, hasMore: ($nextCursor != "")}'
