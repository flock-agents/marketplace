#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

_require_browser_session
_extract_tokens_from_browser

XOXC=$(_get_xoxc)

AUTH_RESULT=$(_slack_api "auth.test")
TEAM=$(echo "$AUTH_RESULT" | jq -r '.team // ""')
USER=$(echo "$AUTH_RESULT" | jq -r '.user // ""')
TEAM_ID=$(echo "$AUTH_RESULT" | jq -r '.team_id // ""')
USER_ID=$(echo "$AUTH_RESULT" | jq -r '.user_id // ""')

jq -nc \
  --arg team "$TEAM" \
  --arg user "$USER" \
  --arg teamId "$TEAM_ID" \
  --arg userId "$USER_ID" \
  --argjson tokenPrefix "$(echo "$XOXC" | head -c 15 | jq -Rs '.')" \
  '{success: true, team: $team, user: $user, teamId: $teamId, userId: $userId, tokenPrefix: $tokenPrefix, message: "Tokens extracted and validated"}'
