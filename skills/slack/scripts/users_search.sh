#!/bin/bash
# users_search.sh — search workspace users by name/email, include DM channel ID.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 10')
INCLUDE_DM_CHANNEL=$(echo "$PARAMS" | jq -r '.include_dm_channel // true')

_validate_param "$QUERY" "query"

# Fetch all users (paginate if needed, up to 500)
RESULT=$(_slack_api "users.list" "limit=200")
ALL_USERS=$(echo "$RESULT" | jq -c '[.members[]? | select(.deleted != true and .is_bot != true)]')

# Filter by query (case-insensitive match on name, real_name, display_name, email)
QUERY_LOWER=$(echo "$QUERY" | tr '[:upper:]' '[:lower:]')
MATCHED=$(echo "$ALL_USERS" | jq -c \
  --arg q "$QUERY_LOWER" \
  --argjson maxResults "$LIMIT" \
  '[.[] | select(
    ((.name // "") | ascii_downcase | contains($q)) or
    ((.real_name // "") | ascii_downcase | contains($q)) or
    ((.profile.display_name // "") | ascii_downcase | contains($q)) or
    ((.profile.email // "") | ascii_downcase | contains($q))
  )] | .[:($maxResults | tonumber)] | map({
    id:           .id,
    name:         .name,
    real_name:    (.real_name // ""),
    display_name: (.profile.display_name // ""),
    email:        (.profile.email // ""),
    title:        (.profile.title // ""),
    is_bot:       (.is_bot // false),
    is_admin:     (.is_admin // false),
    tz:           (.tz // ""),
    dm_channel_id: null
  })')

MATCHED_COUNT=$(echo "$MATCHED" | jq 'length')

# Optionally resolve DM channel IDs (one API call per user — slow for many results)
if [ "$INCLUDE_DM_CHANNEL" = "true" ] && [ "$MATCHED_COUNT" -gt 0 ]; then
  RESULT_WITH_DM="[]"
  while IFS= read -r USER_OBJ; do
    USER_ID=$(echo "$USER_OBJ" | jq -r '.id')
    DM_ID="null"
    if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
      DM_RESULT=$(_slack_api "conversations.open" "users=${USER_ID}&return_im=true") || true
      DM_ID=$(echo "$DM_RESULT" | jq -r '.channel.id // "null"')
      [ "$DM_ID" = "null" ] && DM_ID="null" || DM_ID="\"${DM_ID}\""
    fi
    USER_UPDATED=$(echo "$USER_OBJ" | jq -c --argjson dm "$DM_ID" '.dm_channel_id = $dm')
    RESULT_WITH_DM=$(echo "$RESULT_WITH_DM" | jq -c --argjson u "$USER_UPDATED" '. + [$u]')
  done < <(echo "$MATCHED" | jq -c '.[]')
  MATCHED="$RESULT_WITH_DM"
fi

jq -nc \
  --argjson users "$MATCHED" \
  --arg query "$QUERY" \
  '{query: $query, users: $users, count: ($users | length)}'
