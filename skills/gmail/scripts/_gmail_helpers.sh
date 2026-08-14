#!/bin/bash
# Shared helpers for Google skill scripts.
# Source this at the top of each script: source "$(dirname "$0")/_gmail_helpers.sh"

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

_error_json() {
  local code="$1" msg="$2"
  jq -nc --arg code "$code" --arg msg "$msg" '{error:true, code:$code, message:$msg}'
  exit 1
}

_validate_id() {
  local id="$1" name="${2:-id}"
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    _error_json "INVALID_ID" "${name} contains invalid characters"
  fi
}

_crawl_url() {
  local url="$1"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
          '{url: $url, sessionName: $session, agentId: $agent, extractText: true}')")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "CRAWL_ERROR" "Failed to fetch page (HTTP $http_code): $err_msg"
  fi

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')

  if echo "$page_content" | grep -qi 'sign.in\|accounts\.google\.com/signin\|accounts\.google\.com/v3/signin'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Google returned sign-in page instead of authenticated content" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Google session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  echo "$page_content"
}

_require_browser_session() {
  if [ -z "${BROWSER_SESSION:-}" ]; then
    _error_json "NO_AUTH" "No authentication available. Connect Gmail via App Password (IMAP) or browser session login in the dashboard."
  fi
}

_has_browser_session() {
  [ -n "${BROWSER_SESSION:-}" ]
}

_browser_api() {
  local url="$1"
  local method="${2:-GET}"
  local req_body="${3:-}"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local payload
  if [ -n "$req_body" ]; then
    payload=$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
      --arg method "$method" --arg body "$req_body" \
      '{url: $url, sessionName: $session, agentId: $agent, apiMode: true, apiMethod: $method, apiBody: $body}')
  else
    payload=$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
      --arg method "$method" \
      '{url: $url, sessionName: $session, agentId: $agent, apiMode: true, apiMethod: $method}')
  fi

  local response http_code
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$payload")
  http_code=$(echo "$response" | tail -1)
  local resp_body
  resp_body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$resp_body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$resp_body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "BROWSER_API_ERROR" "Browser API call failed (HTTP $http_code): $err_msg"
  fi

  local content status_code
  content=$(echo "$resp_body" | jq -r '.content // ""')
  status_code=$(echo "$resp_body" | jq -r '.statusCode // 0')

  if [ "$status_code" -ge 400 ]; then
    local api_err
    api_err=$(echo "$content" | jq -r '.error.message // ""' 2>/dev/null || echo "")
    [ -n "$api_err" ] && _error_json "API_ERROR" "Google API returned ${status_code}: ${api_err}"
    _error_json "API_ERROR" "Google API returned HTTP ${status_code}"
  fi

  echo "$content"
}

_browser_navigate() {
  local url="$1"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local response http_code
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
          '{url: $url, sessionName: $session, agentId: $agent, extractText: false}')")
  http_code=$(echo "$response" | tail -1)
  local resp_body
  resp_body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$resp_body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$resp_body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "CRAWL_ERROR" "Failed to navigate (HTTP $http_code): $err_msg"
  fi

  echo "$resp_body"
}

_browser_write() {
  local url="$1"
  local eval_script="${2:-}"
  local wait_for="${3:-}"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local payload
  payload=$(jq -n \
    --arg url "$url" \
    --arg session "$session_name" \
    --arg agent "$agent_id" \
    --arg evalScript "$eval_script" \
    --arg waitFor "$wait_for" \
    '{url: $url, sessionName: $session, agentId: $agent}
    | if $evalScript != "" then . + {evaluateScript: $evalScript} else . end
    | if $waitFor != "" then . + {waitFor: $waitFor} else . end')

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$payload")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    _error_json "BROWSER_ERROR" "Browser operation failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if echo "$final_url" | grep -qi 'accounts\.google\.com'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Google redirected to sign-in during write operation" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Google session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  echo "$body"
}

_browser_interact() {
  local url="$1"
  local page_actions="$2"
  local wait_for="${3:-}"
  local eval_script="${4:-}"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local payload
  payload=$(jq -n \
    --arg url "$url" \
    --arg session "$session_name" \
    --arg agent "$agent_id" \
    --argjson pageActions "$page_actions" \
    --arg waitFor "$wait_for" \
    --arg evalScript "$eval_script" \
    '{url: $url, sessionName: $session, agentId: $agent, pageActions: $pageActions}
    | if $waitFor != "" then . + {waitFor: $waitFor} else . end
    | if $evalScript != "" then . + {evaluateScript: $evalScript} else . end')

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$payload")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.error // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    _error_json "BROWSER_ERROR" "Browser interaction failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if echo "$final_url" | grep -qi 'accounts\.google\.com'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Google redirected to sign-in during interaction" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Google session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  echo "$body"
}

_persistent_create() {
  local url="$1"
  local page_actions="${2:-}"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local payload
  payload=$(jq -n \
    --arg url "$url" \
    --arg session "$session_name" \
    --arg agent "$agent_id" \
    '{url: $url, sessionName: $session, agentId: $agent, createPersistentSession: true, extractText: true}')

  if [ -n "$page_actions" ]; then
    payload=$(echo "$payload" | jq --argjson pa "$page_actions" '. + {pageActions: $pa}')
  fi

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$payload")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "PERSISTENT_SESSION_ERROR" "Failed to create persistent session (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if echo "$final_url" | grep -qi 'accounts\.google\.com'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Google redirected to sign-in during persistent session creation" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Google session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  echo "$body"
}

_persistent_interact() {
  local persistent_id="$1"
  local page_actions="$2"
  local close="${3:-false}"
  local eval_script="${4:-}"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local payload
  payload=$(jq -n \
    --arg session "$session_name" \
    --arg agent "$agent_id" \
    --arg pid "$persistent_id" \
    --argjson pageActions "$page_actions" \
    '{sessionName: $session, agentId: $agent, persistentSessionId: $pid, pageActions: $pageActions, extractText: true}')

  if [ "$close" = "true" ]; then
    payload=$(echo "$payload" | jq '. + {closePersistentSession: true}')
  fi

  if [ -n "$eval_script" ]; then
    payload=$(echo "$payload" | jq --arg es "$eval_script" '. + {evaluateScript: $es}')
  fi

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$payload")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Google browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    _error_json "BROWSER_ERROR" "Persistent session interaction failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if echo "$final_url" | grep -qi 'accounts\.google\.com'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Google redirected to sign-in during persistent session interaction" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Google session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  echo "$body"
}

_persistent_close() {
  local persistent_id="$1"
  local session_name="${BROWSER_SESSION:-google}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  curl -s -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg session "$session_name" --arg agent "$agent_id" --arg pid "$persistent_id" \
          '{sessionName: $session, agentId: $agent, persistentSessionId: $pid, closePersistentSession: true}')" >/dev/null 2>&1 || true
}
