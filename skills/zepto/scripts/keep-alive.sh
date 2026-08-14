#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

STATUS_FILE="/tmp/skill-${SKILL_ID}-keepalive.json"

_write_status() {
  local status="$1" detail="${2:-}"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -nc \
    --arg service "$SKILL_ID" \
    --arg session "${BROWSER_SESSION:-zepto}" \
    --arg status "$status" \
    --arg detail "$detail" \
    --arg checkedAt "$now" \
    '{service: $service, session: $session, status: $status, detail: $detail, checkedAt: $checkedAt}'
}

_require_browser_session

RESULT=$(_browser_navigate "$BASE_URL" 2>&1) || {
  status_json=$(_write_status "unreachable" "Could not reach Zepto")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
}

FINAL_URL=$(echo "$RESULT" | jq -r '.url // ""')

if echo "$FINAL_URL" | grep -qiE "$LOGIN_PATTERN"; then
  SESSION_NAME="${BROWSER_SESSION:-zepto}"
  AGENT_ID="${FLOCK_AGENT_ID:-}"
  curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${SESSION_NAME}/mark-outdated" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg agent "$AGENT_ID" --arg reason "Keep-alive: Zepto session expired — redirected to login" \
          '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true

  status_json=$(_write_status "expired" "Session redirected to login — marked as outdated")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
fi

status_json=$(_write_status "healthy" "Session active — cookies refreshed")
echo "$status_json" > "$STATUS_FILE"
echo "$status_json"
