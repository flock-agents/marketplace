#!/bin/bash
# usergroups_list.sh — list Slack user groups (handles).
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
INCLUDE_USERS=$(echo "$PARAMS" | jq -r '.include_users // false')
INCLUDE_COUNT=$(echo "$PARAMS" | jq -r '.include_count // true')
INCLUDE_DISABLED=$(echo "$PARAMS" | jq -r '.include_disabled // false')

API_PARAMS="include_users=${INCLUDE_USERS}&include_count=${INCLUDE_COUNT}&include_disabled=${INCLUDE_DISABLED}"

RESULT=$(_slack_api "usergroups.list" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  usergroups: [.usergroups[]? | {
    id:          .id,
    name:        .name,
    handle:      .handle,
    description: (.description // ""),
    is_external: (.is_external // false),
    is_usergroup:(.is_usergroup // true),
    user_count:  (.user_count // 0),
    users:       (.users // null),
    date_create: (.date_create // 0),
    date_update: (.date_update // 0)
  }]
}'
