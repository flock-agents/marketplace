#!/bin/bash
# Slack skill helpers — browser session token extraction + Slack Web API via xoxc/xoxd.

# Self-contained: marketplace-installed skills live under DATA_DIR/skills where
# there is no ../../_shared/_helpers.sh (that only exists in the platform's
# bundled skills tree). Slack only needs FLOCK_API from it, so define it here
# directly — keeps the skill working whether installed from the marketplace or
# bundled. FLOCK_API_URL is injected by the skill executor.
FLOCK_API="${FLOCK_API_URL:-http://localhost:35625}"
if [[ ! "$FLOCK_API" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
  jq -nc --arg api "$FLOCK_API" \
    '{error:true, code:"BAD_FLOCK_API", message:("FLOCK_API_URL must be localhost — refusing to send auth token to " + $api)}' >&2
  exit 1
fi

SLACK_API_BASE="https://slack.com/api"
SLACK_ORIGIN="https://app.slack.com"
SKILL_ID="${SKILL_ID:-slack}"

_SLACK_TOKEN_DIR="${SKILL_DATA_DIR:-/tmp}/slack-tokens-$$"
mkdir -p "$_SLACK_TOKEN_DIR" 2>/dev/null || true
chmod 700 "$_SLACK_TOKEN_DIR" 2>/dev/null || true
TOKEN_FILE="${_SLACK_TOKEN_DIR}/tokens.json"

RATE_FILE="${_SLACK_TOKEN_DIR}/rate"
TOKEN_TTL_SECONDS=14400

# Error JSON goes to STDERR (not stdout) and exits non-zero. The skill executor
# returns a script's STDOUT as the success payload on exit 0, and its STDERR as the
# error on any non-zero exit (skill-executor.ts). Writing errors to stdout would get
# them discarded on the failure path; writing to stderr surfaces the real reason to
# the agent. This also means the entry scripts' `RESULT=$(_slack_api ...)` capture
# (stdout only) never swallows an error — it lands on stderr and set -e aborts, with
# the reason already delivered.
_error_json() {
  local code="$1" msg="$2"
  jq -nc --arg code "$code" --arg msg "$msg" '{error:true, code:$code, message:$msg}' >&2
  exit 1
}

_validate_param() {
  local value="$1" name="$2"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    _error_json "MISSING_PARAM" "${name} is required"
  fi
}

_validate_slack_id() {
  local value="$1" name="${2:-id}"
  if ! [[ "$value" =~ ^[A-Z0-9]{1,20}$ ]]; then
    _error_json "INVALID_ID" "${name} contains invalid characters (expected Slack ID format)"
  fi
}

_validate_slack_ts() {
  local value="$1" name="${2:-ts}"
  if ! [[ "$value" =~ ^[0-9]+\.[0-9]+$ ]]; then
    _error_json "INVALID_TS" "${name} is not a valid Slack timestamp (expected format: 1234567890.123456)"
  fi
}

_require_browser_session() {
  if [ -z "${BROWSER_SESSION:-}" ]; then
    _error_json "NO_AUTH" "No Slack browser session available. Connect Slack via the dashboard browser session."
  fi
}

_rate_delay() {
  local min_delay="${1:-3}"
  local now last diff
  now=$(date +%s)
  (
    flock -w 5 200 || exit 0
    last=$(cat "$RATE_FILE" 2>/dev/null || echo 0)
    diff=$((now - last))
    if [ "$diff" -lt "$min_delay" ]; then
      sleep "$min_delay"
    fi
    date +%s > "$RATE_FILE"
  ) 200>"${RATE_FILE}.lock"
}

_check_session_expired() {
  local content="$1"
  local session_name="${BROWSER_SESSION:-slack}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if echo "$content" | grep -qiE 'sign.in.to.slack|signin_find|signin_team'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Slack returned sign-in page instead of authenticated content" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Slack session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi
}

_save_tokens() {
  local xoxc="$1" xoxd="$2"
  local tmpfile
  tmpfile=$(mktemp "${_SLACK_TOKEN_DIR}/tokens.XXXXXX") || _error_json "FS_ERROR" "Could not create token temp file"
  (umask 077; jq -nc --arg xoxc "$xoxc" --arg xoxd "$xoxd" --arg ts "$(date +%s)" \
    '{xoxc: $xoxc, xoxd: $xoxd, extractedAt: $ts}' > "$tmpfile")
  chmod 600 "$tmpfile"
  mv -f "$tmpfile" "$TOKEN_FILE"
}

_load_tokens() {
  if [ ! -f "$TOKEN_FILE" ]; then
    echo ""
    return
  fi
  if [ -L "$TOKEN_FILE" ]; then
    rm -f "$TOKEN_FILE"
    echo ""
    return
  fi
  local extracted_at now age
  extracted_at=$(jq -r '.extractedAt // "0"' < "$TOKEN_FILE" 2>/dev/null || echo "0")
  now=$(date +%s)
  age=$((now - extracted_at))
  if [ "$age" -gt "$TOKEN_TTL_SECONDS" ]; then
    rm -f "$TOKEN_FILE"
    echo ""
    return
  fi
  cat "$TOKEN_FILE"
}

_get_xoxc() {
  local tokens
  tokens=$(_load_tokens)
  [ -z "$tokens" ] && echo "" && return
  echo "$tokens" | jq -r '.xoxc // ""'
}

_get_xoxd() {
  local tokens
  tokens=$(_load_tokens)
  [ -z "$tokens" ] && echo "" && return
  echo "$tokens" | jq -r '.xoxd // ""'
}

_validate_xoxd() {
  local value="$1"
  if echo "$value" | grep -qP '[\x00-\x1f]'; then
    _error_json "INVALID_TOKEN" "xoxd cookie contains control characters"
  fi
}

_extract_tokens_from_browser() {
  _require_browser_session

  local session_name="${BROWSER_SESSION:-slack}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local extract_script
  extract_script='(() => {
    try {
      const keys = Object.keys(localStorage);
      let token = "";
      for (const k of keys) {
        if (k.startsWith("localConfig_v2")) {
          try {
            const val = JSON.parse(localStorage.getItem(k));
            const teams = val.teams || {};
            for (const tid of Object.keys(teams)) {
              const t = teams[tid];
              if (t && t.token && t.token.startsWith("xoxc-")) {
                token = t.token;
                break;
              }
            }
          } catch (e) {}
        }
      }
      if (!token) {
        for (const k of keys) {
          if (!k.startsWith("localConfig_v2")) continue;
          try {
            const v = localStorage.getItem(k);
            if (v && v.includes("xoxc-")) {
              const m = v.match(/(xoxc-[a-zA-Z0-9-]+)/);
              if (m) { token = m[1]; break; }
            }
          } catch (e) {}
        }
      }
      const cookies = document.cookie;
      let dCookie = "";
      const parts = cookies.split(";");
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed.startsWith("d=")) {
          dCookie = trimmed.substring(2);
          break;
        }
      }
      return JSON.stringify({ xoxc: token, xoxd: dCookie });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  })()'

  local payload
  payload=$(jq -n \
    --arg url "https://app.slack.com" \
    --arg session "$session_name" \
    --arg agent "$agent_id" \
    --arg evalScript "$extract_script" \
    '{url: $url, sessionName: $session, agentId: $agent, evaluateScript: $evalScript}')

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
      _error_json "SESSION_NOT_READY" "Slack browser session is not ready. User needs to log in via the dashboard."
    fi
    _error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "CRAWL_ERROR" "Failed to extract tokens (HTTP $http_code): $err_msg"
  fi

  local content final_url
  content=$(echo "$body" | jq -r '.content // ""')
  final_url=$(echo "$body" | jq -r '.url // ""')

  if echo "$final_url" | grep -qiE 'signin|sign_in|login'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Slack redirected to sign-in during token extraction" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "SESSION_OUTDATED" "Slack session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi

  local xoxc xoxd
  xoxc=$(echo "$content" | jq -r '.xoxc // ""' 2>/dev/null || echo "")
  xoxd=$(echo "$content" | jq -r '.xoxd // ""' 2>/dev/null || echo "")

  if [ -z "$xoxc" ]; then
    _error_json "TOKEN_NOT_FOUND" "Could not extract xoxc token from Slack localStorage. The user may need to open Slack in the browser session and ensure they are logged in."
  fi

  if [ -z "$xoxd" ]; then
    _error_json "TOKEN_NOT_FOUND" "Extracted xoxc token but could not find xoxd cookie. The browser session may need to be refreshed."
  fi

  _validate_xoxd "$xoxd"
  _save_tokens "$xoxc" "$xoxd"
}

_ensure_tokens() {
  local xoxc xoxd
  xoxc=$(_get_xoxc)
  xoxd=$(_get_xoxd)

  if [ -z "$xoxc" ] || [ -z "$xoxd" ]; then
    _extract_tokens_from_browser
    xoxc=$(_get_xoxc)
    xoxd=$(_get_xoxd)
  fi

  if [ -z "$xoxc" ] || [ -z "$xoxd" ]; then
    _error_json "NO_TOKENS" "Could not obtain Slack tokens. Connect Slack via the dashboard browser session."
  fi
}

_slack_api() {
  local method="$1"
  local params="${2:-}"

  _ensure_tokens

  local tier_delay=3
  case "$method" in
    conversations.history|conversations.replies) tier_delay=2 ;;
    users.info|auth.test) tier_delay=1 ;;
  esac
  _rate_delay "$tier_delay"

  local xoxc xoxd
  xoxc=$(_get_xoxc)
  xoxd=$(_get_xoxd)

  local response http_code body retry_after
  if [ -n "$params" ]; then
    response=$(curl -s -w "\n%{http_code}" -D /tmp/slack-headers-$$ \
      -X POST "${SLACK_API_BASE}/${method}" \
      -H "Authorization: Bearer ${xoxc}" \
      -H "Cookie: d=${xoxd}" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -H "Origin: ${SLACK_ORIGIN}" \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      -d "$params")
  else
    response=$(curl -s -w "\n%{http_code}" -D /tmp/slack-headers-$$ \
      -X POST "${SLACK_API_BASE}/${method}" \
      -H "Authorization: Bearer ${xoxc}" \
      -H "Cookie: d=${xoxd}" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -H "Origin: ${SLACK_ORIGIN}" \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
  fi
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "429" ]; then
    retry_after=$(grep -i '^Retry-After:' /tmp/slack-headers-$$ 2>/dev/null | awk '{print $2}' | tr -d '\r' || echo "30")
    [ -z "$retry_after" ] && retry_after=30
    rm -f /tmp/slack-headers-$$
    sleep "$retry_after"
    _slack_api "$method" "$params"
    return $?
  fi
  rm -f /tmp/slack-headers-$$

  if [ "$http_code" -ge 400 ]; then
    _error_json "HTTP_ERROR" "Slack API returned HTTP ${http_code}"
  fi

  local ok err
  ok=$(echo "$body" | jq -r '.ok // false' 2>/dev/null || echo "false")
  err=$(echo "$body" | jq -r '.error // ""' 2>/dev/null || echo "")

  if [ "$ok" = "false" ]; then
    if [ "$err" = "invalid_auth" ] || [ "$err" = "token_revoked" ] || [ "$err" = "not_authed" ]; then
      rm -f "$TOKEN_FILE"
      _extract_tokens_from_browser 2>/dev/null || true
      xoxc=$(_get_xoxc)
      xoxd=$(_get_xoxd)
      if [ -z "$xoxc" ] || [ -z "$xoxd" ]; then
        _error_json "AUTH_EXPIRED" "Slack tokens expired and re-extraction failed. User needs to re-login via the dashboard."
      fi

      if [ -n "$params" ]; then
        response=$(curl -s -w "\n%{http_code}" \
          -X POST "${SLACK_API_BASE}/${method}" \
          -H "Authorization: Bearer ${xoxc}" \
          -H "Cookie: d=${xoxd}" \
          -H "Content-Type: application/x-www-form-urlencoded" \
          -H "Origin: ${SLACK_ORIGIN}" \
          -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
          -d "$params")
      else
        response=$(curl -s -w "\n%{http_code}" \
          -X POST "${SLACK_API_BASE}/${method}" \
          -H "Authorization: Bearer ${xoxc}" \
          -H "Cookie: d=${xoxd}" \
          -H "Content-Type: application/x-www-form-urlencoded" \
          -H "Origin: ${SLACK_ORIGIN}" \
          -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
      fi
      http_code=$(echo "$response" | tail -1)
      body=$(echo "$response" | sed '$d')

      ok=$(echo "$body" | jq -r '.ok // false' 2>/dev/null || echo "false")
      err=$(echo "$body" | jq -r '.error // ""' 2>/dev/null || echo "")

      if [ "$ok" = "false" ]; then
        _error_json "SLACK_API_ERROR" "Slack API error after token refresh: ${err}"
      fi
    else
      _error_json "SLACK_API_ERROR" "Slack API error: ${err}"
    fi
  fi

  echo "$body"
}
