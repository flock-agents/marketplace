#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
USER_ID=$(echo "$PARAMS" | jq -r '.user // ""')

_validate_param "$USER_ID" "user"
_validate_slack_id "$USER_ID" "user"

RESULT=$(_slack_api "users.info" "user=${USER_ID}")

echo "$RESULT" | jq -c '{user: {id: .user.id, name: .user.name, real_name: (.user.real_name // ""), display_name: (.user.profile.display_name // ""), email: (.user.profile.email // ""), title: (.user.profile.title // ""), status_text: (.user.profile.status_text // ""), status_emoji: (.user.profile.status_emoji // ""), is_bot: (.user.is_bot // false), is_admin: (.user.is_admin // false), tz: (.user.tz // ""), image_72: (.user.profile.image_72 // "")}}'
