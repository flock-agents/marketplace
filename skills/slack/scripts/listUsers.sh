#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 100')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')

API_PARAMS="limit=${LIMIT}"
if [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; then
  API_PARAMS="${API_PARAMS}&cursor=${CURSOR}"
fi

RESULT=$(_slack_api "users.list" "$API_PARAMS")

USERS=$(echo "$RESULT" | jq -c '[.members[]? | select(.deleted != true) | {id: .id, name: .name, real_name: (.real_name // ""), display_name: (.profile.display_name // ""), email: (.profile.email // ""), title: (.profile.title // ""), is_bot: (.is_bot // false), is_admin: (.is_admin // false), tz: (.tz // "")}]')
NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')

jq -nc \
  --argjson users "$USERS" \
  --arg nextCursor "$NEXT_CURSOR" \
  '{users: $users, nextCursor: $nextCursor, hasMore: ($nextCursor != "")}'
