#!/bin/bash
# usergroups_create.sh — create a new Slack user group.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
NAME=$(echo "$PARAMS" | jq -r '.name // ""')
HANDLE=$(echo "$PARAMS" | jq -r '.handle // ""')
DESCRIPTION=$(echo "$PARAMS" | jq -r '.description // ""')
CHANNELS=$(echo "$PARAMS" | jq -r '.channels // ""')

_validate_param "$NAME" "name"

ENCODED_NAME=$(printf '%s' "$NAME" | jq -sRr @uri)
API_PARAMS="name=${ENCODED_NAME}"

if [ -n "$HANDLE" ] && [ "$HANDLE" != "null" ]; then
  ENCODED_HANDLE=$(printf '%s' "$HANDLE" | jq -sRr @uri)
  API_PARAMS="${API_PARAMS}&handle=${ENCODED_HANDLE}"
fi

if [ -n "$DESCRIPTION" ] && [ "$DESCRIPTION" != "null" ]; then
  ENCODED_DESC=$(printf '%s' "$DESCRIPTION" | jq -sRr @uri)
  API_PARAMS="${API_PARAMS}&description=${ENCODED_DESC}"
fi

if [ -n "$CHANNELS" ] && [ "$CHANNELS" != "null" ]; then
  API_PARAMS="${API_PARAMS}&channels=${CHANNELS}"
fi

RESULT=$(_slack_api "usergroups.create" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  ok:         .ok,
  usergroup: {
    id:          .usergroup.id,
    name:        .usergroup.name,
    handle:      .usergroup.handle,
    description: (.usergroup.description // "")
  }
}'
