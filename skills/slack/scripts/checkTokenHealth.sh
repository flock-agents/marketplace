#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

RESULT=$(_slack_api "auth.test")

TEAM=$(echo "$RESULT" | jq -r '.team // ""')
USER=$(echo "$RESULT" | jq -r '.user // ""')
TEAM_ID=$(echo "$RESULT" | jq -r '.team_id // ""')
USER_ID=$(echo "$RESULT" | jq -r '.user_id // ""')
# The workspace's own base URL ("https://<workspace>.slack.com/"). auth.test has always
# returned it; dropping it meant nothing downstream could build a message permalink, because
# a permalink is <workspace url>archives/<channel>/p<ts> and the workspace host cannot be
# derived from the team NAME. Kept trailing-slash-normalised so callers can concatenate.
URL=$(echo "$RESULT" | jq -r '.url // ""' | sed 's#/*$#/#; s#^/$##')

jq -nc \
  --arg team "$TEAM" \
  --arg user "$USER" \
  --arg teamId "$TEAM_ID" \
  --arg userId "$USER_ID" \
  --arg url "$URL" \
  '{healthy: true, team: $team, user: $user, teamId: $teamId, userId: $userId, url: $url}'
