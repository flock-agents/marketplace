#!/bin/bash
# Shared helpers for Google skill scripts.
# Source this at the top of each script: source "$(dirname "$0")/_google_helpers.sh"

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

_error_json() {
  local code="$1" msg="$2"
  # jq, not printf: the message now carries server-supplied text, and a single `"` in it
  # produced an unparseable envelope — which the executor reports as a bare exec_error
  # with the reason thrown away. (Matches gmail/scripts/_gmail_helpers.sh.)
  jq -nc --arg code "$code" --arg msg "$msg" '{error:true, code:$code, message:$msg}'
  exit 1
}

_validate_id() {
  local id="$1" name="${2:-id}"
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    _error_json "INVALID_ID" "${name} contains invalid characters"
  fi
}

# A 4xx/5xx from /api/internal/browser-fetch is FLOCK refusing us, not Google.
#
# TWO BUGS LIVED HERE, and they compounded (fixed 2026-09-28).
#   1. WRONG FIELD. server.ts answers `{ error: "session_not_ready", state, message }` --
#      the discriminator is `error`, not `code`. These helpers read `.code`, so the
#      SESSION_NOT_READY branch was DEAD and every not-ready 403 fell through to
#      CRAWL_ERROR "Access denied (HTTP 403)".
#   2. WHOSE 403? That message reached the ingest guard, which read \b(401|403)\b out of
#      it and quarantined the account -- for a status produced by FLOCK's own access
#      list (`access_denied`: "Agent X does not have the 'Y' skill required for this
#      session") or by Flock's own not-ready check. The provider was never contacted.
#      A connector may only be demoted when a request REACHED the provider and the
#      PROVIDER answered auth-shaped.
#
# So: read `error` first with `code` as a fallback, name the local refusals explicitly,
# and keep the status readable for humans under a code the guard treats as
# non-quarantining (see NON_QUARANTINING_CODES in server/src/guard-anomaly.ts).
#
# PRECEDENCE, CAREFULLY: test BOTH fields, never one over the other. `error` carries the
# discriminator on the paths server.ts names but a bare human MESSAGE on others (its 500
# path answers `{ error: e.message }`), and a caller can put the code in `code` while
# `error` holds prose — `.error // .code` silently loses the code in the other field.
# _shared/checkout.ts has always tested both.
_check_flock_refusal() {
  local http_code="$1" body="$2" unknown_code="$3" what="$4"
  [ "$http_code" -ge 400 ] 2>/dev/null || return 0

  local err_field code_field detail
  err_field=$(echo "$body" | jq -r '.error // ""' 2>/dev/null || echo "")
  code_field=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
  detail=$(echo "$body" | jq -r '.message // .error // "(no error message)"' 2>/dev/null || echo "(unparseable response)")

  if [ "$err_field" = "session_not_ready" ] || [ "$code_field" = "session_not_ready" ]; then
    _error_json "SESSION_NOT_READY" "Google browser session is not ready — Flock has either not finished connecting it or already marked it outdated. Log in via the dashboard."
  fi
  if [ "$err_field" = "access_denied" ] || [ "$code_field" = "access_denied" ]; then
    _error_json "ACCESS_DENIED" "Flock refused this request and never contacted Google: $detail"
  fi
  if [ "$err_field" = "session_not_found" ] || [ "$code_field" = "session_not_found" ]; then
    _error_json "SESSION_NOT_FOUND" "Flock has no such browser session: $detail"
  fi

  _error_json "$unknown_code" "$what failed inside Flock's browser-fetch endpoint (Flock status $http_code): $detail"
}

# Is this URL actually Google's sign-in page? HOST-EXACT, authority only.
#
# `grep -qi 'accounts\.google\.com'` on the final URL is a SUBSTRING match, so any URL
# merely CONTAINING that string triggered a mark-outdated -- and Google puts it in
# `continue=` / `redirect_uri=` query parameters constantly, as does a Gmail search for
# mail to an @accounts.google.com address. See isSignInUrl in
# skills/_shared/_google_helpers.ts for what that cost: five re-logins in one afternoon
# and three fixes aimed at a cause that was never there.
_is_signin_url() {
  local raw="${1:-}" authority host
  [ -n "$raw" ] || return 1
  authority="${raw#*://}"          # drop the scheme
  authority="${authority%%[/?#]*}" # authority ONLY -- never past / ? or #
  host="${authority##*@}"          # drop userinfo
  host="${host%%:*}"               # drop port
  host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
  case "$host" in
    accounts.google.com|*.accounts.google.com) return 0 ;;
  esac
  return 1
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

  _check_flock_refusal "$http_code" "$body" "CRAWL_ERROR" "Fetch page"

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')

  # The final URL is the STRONG signal (host-exact); page text is the weak one. The
  # first alternative here used to be `sign.in` -- an unescaped `.`, so it matched
  # "sign in"/"sign-in"/"signin" ANYWHERE in the extracted text, which Google's own
  # authenticated chrome (account switcher, help and footer links) carries routinely.
  local final_page_url
  final_page_url=$(echo "$body" | jq -r '.url // ""')
  if _is_signin_url "$final_page_url" || echo "$page_content" | grep -qiE 'accounts\.google\.com/(v3/)?signin|accounts\.google\.com/ServiceLogin'; then
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
    _error_json "NO_AUTH" "No browser session available. Set up a Google browser session via the dashboard."
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

  _check_flock_refusal "$http_code" "$resp_body" "BROWSER_API_ERROR" "Browser API call"

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

  _check_flock_refusal "$http_code" "$resp_body" "CRAWL_ERROR" "Navigate"

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

  _check_flock_refusal "$http_code" "$body" "BROWSER_ERROR" "Browser operation"

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if _is_signin_url "$final_url"; then
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

  _check_flock_refusal "$http_code" "$body" "BROWSER_ERROR" "Browser interaction"

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if _is_signin_url "$final_url"; then
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

  _check_flock_refusal "$http_code" "$body" "PERSISTENT_SESSION_ERROR" "Persistent session creation"

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if _is_signin_url "$final_url"; then
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

  _check_flock_refusal "$http_code" "$body" "BROWSER_ERROR" "Persistent session interaction"

  local final_url
  final_url=$(echo "$body" | jq -r '.url // ""')
  if _is_signin_url "$final_url"; then
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
