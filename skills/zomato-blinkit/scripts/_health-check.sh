#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

STATUS_FILE="/tmp/skill-${SKILL_ID}-health.json"
SEARCH_URL="${BASE_URL}/s/?q=milk"

_write_health() {
  local status="$1" site_ok="$2" session_ok="$3" search_ok="$4" detail="${5:-}"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -nc \
    --arg service "$SKILL_ID" \
    --arg session "${BROWSER_SESSION:-blinkit}" \
    --arg status "$status" \
    --argjson siteReachable "$site_ok" \
    --argjson sessionValid "$session_ok" \
    --argjson searchWorks "$search_ok" \
    --arg detail "$detail" \
    --arg checkedAt "$now" \
    '{service: $service, session: $session, status: $status, siteReachable: $siteReachable, sessionValid: $sessionValid, searchWorks: $searchWorks, detail: $detail, checkedAt: $checkedAt}'
}

_mark_degraded() {
  local reason="$1"
  local session_name="${BROWSER_SESSION:-blinkit}"
  local agent_id="${FLOCK_AGENT_ID:-}"
  curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg agent "$agent_id" --arg reason "$reason" \
          '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
}

_require_browser_session

RESULT=$(_browser_navigate "$BASE_URL" 2>&1) || {
  status_json=$(_write_health "down" false false false "Could not reach Blinkit")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
}

FINAL_URL=$(echo "$RESULT" | jq -r '.url // ""')

if echo "$FINAL_URL" | grep -qiE "$LOGIN_PATTERN"; then
  _mark_degraded "Health-check: Blinkit session expired — redirected to login"
  status_json=$(_write_health "degraded" true false false "Session expired — redirected to login")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
fi

SEARCH_RESULT=$(_browser_navigate "$SEARCH_URL" 2>&1) || {
  status_json=$(_write_health "degraded" true true false "Site reachable and session valid but search failed")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
}

SEARCH_FINAL_URL=$(echo "$SEARCH_RESULT" | jq -r '.url // ""')
if echo "$SEARCH_FINAL_URL" | grep -qiE "$LOGIN_PATTERN"; then
  _mark_degraded "Health-check: Blinkit session expired during search"
  status_json=$(_write_health "degraded" true false false "Session expired during search navigation")
  echo "$status_json" > "$STATUS_FILE"
  echo "$status_json"
  exit 1
fi

status_json=$(_write_health "healthy" true true true "All checks passed")
echo "$status_json" > "$STATUS_FILE"
echo "$status_json"
