#!/bin/bash
# usergroups_update.sh — update an existing Slack user group.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
USERGROUP_ID=$(echo "$PARAMS" | jq -r '.usergroup_id // ""')
NAME=$(echo "$PARAMS" | jq -r '.name // ""')
HANDLE=$(echo "$PARAMS" | jq -r '.handle // ""')
DESCRIPTION=$(echo "$PARAMS" | jq -r '.description // ""')
CHANNELS=$(echo "$PARAMS" | jq -r '.channels // ""')

_validate_param "$USERGROUP_ID" "usergroup_id"
# Usergroup IDs start with S
if ! [[ "$USERGROUP_ID" =~ ^S[A-Z0-9]{1,19}$ ]]; then
  _error_json "INVALID_ID" "usergroup_id must be a valid Slack usergroup ID (format: S...)"
fi

API_PARAMS="usergroup=${USERGROUP_ID}"

if [ -n "$NAME" ] && [ "$NAME" != "null" ]; then
  API_PARAMS="${API_PARAMS}&name=$(printf '%s' "$NAME" | jq -sRr @uri)"
fi

if [ -n "$HANDLE" ] && [ "$HANDLE" != "null" ]; then
  API_PARAMS="${API_PARAMS}&handle=$(printf '%s' "$HANDLE" | jq -sRr @uri)"
fi

if [ -n "$DESCRIPTION" ] && [ "$DESCRIPTION" != "null" ]; then
  API_PARAMS="${API_PARAMS}&description=$(printf '%s' "$DESCRIPTION" | jq -sRr @uri)"
fi

if [ -n "$CHANNELS" ] && [ "$CHANNELS" != "null" ]; then
  API_PARAMS="${API_PARAMS}&channels=${CHANNELS}"
fi

RESULT=$(_slack_api "usergroups.update" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  ok: .ok,
  usergroup: {
    id:          .usergroup.id,
    name:        .usergroup.name,
    handle:      .usergroup.handle,
    description: (.usergroup.description // "")
  }
}'
