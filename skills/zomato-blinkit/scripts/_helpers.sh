#!/bin/bash
# Zomato Blinkit skill helpers — sources shared helpers, adds browser-specific functions.

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

BASE_URL="https://blinkit.com"
# Anchored: a bare `accounts\.google\.com` matched the string anywhere in a URL.
LOGIN_PATTERN="^https?://accounts\.google\.com([:/]|$)|blinkit\.com/auth|blinkit\.com/login"
SKILL_ID="${SKILL_ID:-zomato-blinkit}"

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

_sanitize_scraped_content() {
  local content="$1" max_len="${2:-200}"
  content=$(echo "$content" | sed 's/<[^>]*>//g')
  echo "$content" | head -c "$max_len"
}

_require_browser_session() {
  if [ -z "${BROWSER_SESSION:-}" ]; then
    _error_json "NO_AUTH" "No Blinkit browser session available. Connect Blinkit via the dashboard browser session."
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

# Test LOGIN_PATTERN against the AUTHORITY + PATH only, never the query or fragment.
#
# LOGIN_PATTERN is host+path shaped, but it used to be grepped against the WHOLE final
# URL — so any `?redirect=…%2Flogin` or `continue=` parameter, which is exactly what a
# login redirect carries, read as "we are ON the login page" and marked a working session
# outdated. Same class of bug as the Google substring match documented on isSignInUrl in
# skills/_shared/_google_helpers.ts.
_matches_login_url() {
  local raw="${1:-}" destination
  [ -n "$raw" ] || return 1
  destination="${raw%%[?#]*}"
  echo "$destination" | grep -qiE "$LOGIN_PATTERN"
}

# Flock's OWN 403 from /api/internal/browser-fetch — never Blinkit's.
#
# WRONG FIELD (fixed 2026-09-28): server.ts answers
# `{ error: "session_not_ready", state, message }` — the discriminator is `error`, not
# `code`. Reading `.code` made the SESSION_NOT_READY branch dead, so every not-ready 403
# fell through to "Access denied (HTTP 403)" — and the ingest guard read \b403\b out of
# THAT and quarantined the account, for a status produced by Flock's own access list
# (`access_denied`: "Agent X does not have the 'Y' skill required for this session"), with
# Blinkit never contacted. A connector may only be demoted when a request REACHED the
# provider and the PROVIDER answered auth-shaped. `access_denied` and `session_not_found`
# were never read at all; all three are now named, and the fallthrough keeps Flock's own
# status readable under the caller's code, which guard-anomaly.ts treats as
# non-quarantining (NON_QUARANTINING_CODES).
#
# PRECEDENCE, CAREFULLY: test BOTH fields, never one over the other. `error` carries the
# discriminator on the paths server.ts names but a bare human MESSAGE on others (its 500
# path answers `{ error: e.message }`), and a caller can put the code in `code` while
# `error` holds prose — `.error // .code` silently loses the code in the other field.
# _shared/checkout.ts has always tested both.
_check_flock_403() {
  local body="$1" unknown_code="${2:-CRAWL_ERROR}"
  local err_field code_field detail
  err_field=$(echo "$body" | jq -r '.error // ""' 2>/dev/null || echo "")
  code_field=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
  detail=$(echo "$body" | jq -r '.message // .error // "(no error message)"' 2>/dev/null || echo "(unparseable response)")

  if [ "$err_field" = "session_not_ready" ] || [ "$code_field" = "session_not_ready" ]; then
    _error_json "SESSION_NOT_READY" "Blinkit browser session is not ready — Flock has either not finished connecting it or already marked it outdated. Log in via the dashboard."
  fi
  if [ "$err_field" = "access_denied" ] || [ "$code_field" = "access_denied" ]; then
    _error_json "ACCESS_DENIED" "Flock refused this request and never contacted Blinkit: $detail"
  fi
  if [ "$err_field" = "session_not_found" ] || [ "$code_field" = "session_not_found" ]; then
    _error_json "SESSION_NOT_FOUND" "Flock has no such browser session: $detail"
  fi

  _error_json "$unknown_code" "Request refused inside Flock's browser-fetch endpoint (Flock status 403): $detail"
}

_check_session_expired() {
  local final_url="$1"
  local session_name="${BROWSER_SESSION:-blinkit}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if _matches_login_url "$final_url"; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Blinkit redirected to login page — session expired" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Blinkit session has expired. Marked as outdated — user needs to re-login via the dashboard."
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "CRAWL_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "BROWSER_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "BROWSER_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "CRAWL_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "CRAWL_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
    _check_flock_403 "$body" "BROWSER_ERROR"
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
  local session_name="${BROWSER_SESSION:-blinkit}"
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
