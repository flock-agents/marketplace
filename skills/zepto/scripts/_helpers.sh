#!/bin/bash
# Zepto skill helpers — sources shared helpers, adds browser-specific functions.

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

BASE_URL="https://www.zepto.com"
LOGIN_PATTERN="accounts\.google\.com|zepto\.com/auth|auth\.zepto\.co\.in|zepto\.com/login"
SKILL_ID="${SKILL_ID:-zepto}"

_error_json() {
  local code="$1" msg="$2"
  jq -nc --arg code "$code" --arg msg "$msg" '{error:true, code:$code, message:$msg}'
  exit 1
}

_validate_param() {
  local value="$1" name="$2"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    _error_json "MISSING_PARAM" "${name} is required"
  fi
}

_validate_positive_int() {
  local value="$1" name="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    _error_json "INVALID_PARAM" "${name} must be a positive integer"
  fi
}

_validate_id() {
  local id="$1" name="${2:-id}"
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    _error_json "INVALID_ID" "${name} contains invalid characters"
  fi
}

_sanitize_scraped_content() {
  local content="$1" max_len="${2:-200}"
  content=$(echo "$content" | sed 's/<[^>]*>//g')
  echo "$content" | head -c "$max_len"
}

_require_browser_session() {
  if [ -z "${BROWSER_SESSION:-}" ]; then
    _error_json "NO_AUTH" "No Zepto browser session available. Connect Zepto via the dashboard browser session."
  fi
}

_rate_delay() {
  local rate_file="/tmp/skill-${SKILL_ID}-rate"
  local now last diff
  now=$(date +%s)
  last=$(cat "$rate_file" 2>/dev/null || echo 0)
  diff=$((now - last))
  if [ "$diff" -lt 2 ]; then
    sleep 2
  fi
  echo "$now" > "$rate_file"
}

_check_session_expired() {
  local final_url="$1"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if echo "$final_url" | grep -qiE "$LOGIN_PATTERN"; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Zepto redirected to login page — session expired" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Zepto session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi
}

_check_captcha() {
  local content="$1"
  if echo "$content" | grep -qiE 'captcha|recaptcha|challenge|verify you.re human'; then
    _error_json "CAPTCHA_DETECTED" "The service is showing a CAPTCHA. Please solve it via the dashboard browser session, then try again."
  fi
}

_crawl_url() {
  local url="$1"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

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
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" = "429" ]; then
    _error_json "RATE_LIMITED" "The service is temporarily limiting requests. Try again in a few minutes."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "CRAWL_ERROR" "Failed to fetch page (HTTP $http_code): $err_msg"
  fi

  local page_content final_url
  page_content=$(echo "$body" | jq -r '.content // ""')
  final_url=$(echo "$body" | jq -r '.url // ""')

  _check_session_expired "$final_url"
  _check_captcha "$page_content"

  echo "$page_content"
}

_browser_write() {
  local url="$1"
  local eval_script="${2:-}"
  local wait_for="${3:-}"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

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
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" = "429" ]; then
    _error_json "RATE_LIMITED" "The service is temporarily limiting requests. Try again in a few minutes."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    _error_json "BROWSER_ERROR" "Browser operation failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  _check_session_expired "$final_url"

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')
  _check_captcha "$page_content"

  echo "$body"
}

_browser_interact() {
  local url="$1"
  local page_actions="$2"
  local wait_for="${3:-}"
  local eval_script="${4:-}"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

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
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" = "429" ]; then
    _error_json "RATE_LIMITED" "The service is temporarily limiting requests. Try again in a few minutes."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    _error_json "BROWSER_ERROR" "Browser interaction failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  _check_session_expired "$final_url"

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')
  _check_captcha "$page_content"

  echo "$body"
}

_browser_navigate() {
  local url="$1"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
          '{url: $url, sessionName: $session, agentId: $agent, extractText: false}')")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "CRAWL_ERROR" "Failed to navigate (HTTP $http_code): $err_msg"
  fi

  echo "$body"
}

_persistent_create() {
  local url="$1"
  local page_actions="${2:-}"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

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
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" = "429" ]; then
    _error_json "RATE_LIMITED" "The service is temporarily limiting requests. Try again in a few minutes."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    err_msg=$(echo "$err_msg" | head -c 200)
    _error_json "PERSISTENT_SESSION_ERROR" "Failed to create persistent session (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  _check_session_expired "$final_url"

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')
  _check_captcha "$page_content"

  echo "$body"
}

_persistent_interact() {
  local persistent_id="$1"
  local page_actions="$2"
  local close="${3:-false}"
  local eval_script="${4:-}"
  local session_name="${BROWSER_SESSION:-zepto}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  _rate_delay

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
      _error_json "SESSION_NOT_READY" "Zepto browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" = "429" ]; then
    _error_json "RATE_LIMITED" "The service is temporarily limiting requests. Try again in a few minutes."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    err_msg=$(echo "$err_msg" | head -c 200)
    _error_json "BROWSER_ERROR" "Persistent session interaction failed (HTTP $http_code): $err_msg"
  fi

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  _check_session_expired "$final_url"

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')
  _check_captcha "$page_content"

  echo "$body"
}

_persistent_close() {
  local persistent_id="$1"
  local session_name="${BROWSER_SESSION:-zepto}"
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
