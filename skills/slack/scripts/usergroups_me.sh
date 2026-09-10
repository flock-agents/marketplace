#!/bin/bash
# usergroups_me.sh — manage own user group membership.
# action: "list" — groups I belong to
#         "join" — add self to a group
#         "leave" — remove self from a group
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
ACTION=$(echo "$PARAMS" | jq -r '.action // ""')
USERGROUP_ID=$(echo "$PARAMS" | jq -r '.usergroup_id // ""')

_validate_param "$ACTION" "action"

case "$ACTION" in
  list|join|leave) ;;
  *) _error_json "INVALID_PARAM" "action must be one of: list, join, leave" ;;
esac

if [ "$ACTION" != "list" ]; then
  _validate_param "$USERGROUP_ID" "usergroup_id"
  if ! [[ "$USERGROUP_ID" =~ ^S[A-Z0-9]{1,19}$ ]]; then
    _error_json "INVALID_ID" "usergroup_id must be a valid Slack usergroup ID (format: S...)"
  fi
fi

# Get current user
AUTH=$(_slack_api "auth.test")
CURRENT_USER=$(echo "$AUTH" | jq -r '.user_id')

if [ "$ACTION" = "list" ]; then
  # List all groups with users, filter to ones containing current user
  RESULT=$(_slack_api "usergroups.list" "include_users=true&include_count=true&include_disabled=false")
  echo "$RESULT" | jq -c \
    --arg uid "$CURRENT_USER" \
    '{
      user_id: $uid,
      usergroups: [.usergroups[]? | select(.users != null and (.users | index($uid)) != null) | {
        id:          .id,
        name:        .name,
        handle:      .handle,
        description: (.description // ""),
        user_count:  (.user_count // 0)
      }]
    }'
  exit 0
fi

# For join/leave: get current members of the group
MEMBERS_RESULT=$(_slack_api "usergroups.users.list" "usergroup=${USERGROUP_ID}")
CURRENT_MEMBERS=$(echo "$MEMBERS_RESULT" | jq -r '[.users[]?] | join(",")')

if [ "$ACTION" = "join" ]; then
  # Add current user if not already a member
  if echo ",$CURRENT_MEMBERS," | grep -q ",${CURRENT_USER},"; then
    jq -nc --arg ug "$USERGROUP_ID" --arg u "$CURRENT_USER" \
      '{ok: true, action: "join", already_member: true, usergroup_id: $ug, user_id: $u}'
    exit 0
  fi
  NEW_MEMBERS="${CURRENT_MEMBERS:+${CURRENT_MEMBERS},}${CURRENT_USER}"
else
  # leave: remove current user
  NEW_MEMBERS=$(echo "$CURRENT_MEMBERS" | tr ',' '\n' | grep -v "^${CURRENT_USER}$" | tr '\n' ',' | sed 's/,$//')
fi

RESULT=$(_slack_api "usergroups.users.update" "usergroup=${USERGROUP_ID}&users=${NEW_MEMBERS}")

jq -nc \
  --arg ug "$USERGROUP_ID" \
  --arg u "$CURRENT_USER" \
  --arg action "$ACTION" \
  --argjson members "$(echo "$RESULT" | jq '.usergroup.users // []')" \
  '{ok: true, action: $action, usergroup_id: $ug, user_id: $u, members: $members}'
