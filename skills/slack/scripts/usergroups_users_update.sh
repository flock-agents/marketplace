#!/bin/bash
# usergroups_users_update.sh — set the members of a user group.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
USERGROUP_ID=$(echo "$PARAMS" | jq -r '.usergroup_id // ""')
USERS=$(echo "$PARAMS" | jq -r '.users // ""')

_validate_param "$USERGROUP_ID" "usergroup_id"
_validate_param "$USERS" "users"

if ! [[ "$USERGROUP_ID" =~ ^S[A-Z0-9]{1,19}$ ]]; then
  _error_json "INVALID_ID" "usergroup_id must be a valid Slack usergroup ID (format: S...)"
fi

RESULT=$(_slack_api "usergroups.users.update" "usergroup=${USERGROUP_ID}&users=${USERS}")

echo "$RESULT" | jq -c \
  --arg ug "$USERGROUP_ID" \
  '{
    ok:        .ok,
    usergroup: $ug,
    users:     (.usergroup.users // [])
  }'
