#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

RESULT=$(_slack_api "auth.test")

TEAM=$(echo "$RESULT" | jq -r '.team // ""')
USER=$(echo "$RESULT" | jq -r '.user // ""')
TEAM_ID=$(echo "$RESULT" | jq -r '.team_id // ""')
USER_ID=$(echo "$RESULT" | jq -r '.user_id // ""')

jq -nc \
  --arg team "$TEAM" \
  --arg user "$USER" \
  --arg teamId "$TEAM_ID" \
  --arg userId "$USER_ID" \
  '{healthy: true, team: $team, user: $user, teamId: $teamId, userId: $userId}'
