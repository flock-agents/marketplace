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
SKILL_ID="${SKILL_ID:-slack}"

_SLACK_TOKEN_DIR="${SKILL_DATA_DIR:-/tmp}/slack-tokens"
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
  local now last diff lockdir
  now=$(date +%s)
  lockdir="${RATE_FILE}.lockdir"

  # Atomic lock via mkdir (POSIX-portable; works on macOS + Linux without flock)
  if mkdir "$lockdir" 2>/dev/null; then
    last=$(cat "$RATE_FILE" 2>/dev/null || echo 0)
    diff=$((now - last))
    if [ "$diff" -lt "$min_delay" ]; then
      sleep "$((min_delay - diff))"
    fi
    date +%s > "$RATE_FILE"
    rmdir "$lockdir" 2>/dev/null || true
  fi
  # If mkdir fails (lock held by concurrent call), skip delay — browser session
  # serializes requests anyway via its own queue.
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
    --arg url "https://app.slack.com/client" \
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

  local xoxc
  xoxc=$(echo "$content" | jq -r '.xoxc // ""' 2>/dev/null || echo "")

  if [ -z "$xoxc" ]; then
    _error_json "TOKEN_NOT_FOUND" "Could not extract xoxc token from Slack localStorage. The user may need to open Slack in the browser session and ensure they are logged in."
  fi

  # xoxd (the `d=` cookie) is httpOnly, so document.cookie can't see it. But the
  # server captured it when the session was established — read it back via the
  # session-cookie endpoint. With both tokens in hand we call the Slack Web API
  # directly (see _slack_api), avoiding a ~20s SPA navigation per call.
  local cookie_resp cookie_http cookie_body xoxd
  cookie_resp=$(curl -s -w "\n%{http_code}" -X POST \
    "${FLOCK_API}/api/internal/browser-sessions/${session_name}/cookie" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg agent "$agent_id" '{agentId: $agent, cookieName: "d", domain: "slack.com"}')")
  cookie_http=$(echo "$cookie_resp" | tail -1)
  cookie_body=$(echo "$cookie_resp" | sed '$d')

  if [ "$cookie_http" -ge 400 ]; then
    local cookie_err
    cookie_err=$(echo "$cookie_body" | jq -r '.message // .error // "(no message)"' 2>/dev/null || echo "(unparseable)")
    _error_json "COOKIE_READ_FAILED" "Could not read Slack session cookie (HTTP $cookie_http): $cookie_err"
  fi

  xoxd=$(echo "$cookie_body" | jq -r 'if .found then .value else "" end' 2>/dev/null || echo "")
  if [ -z "$xoxd" ]; then
    _error_json "TOKEN_NOT_FOUND" "Slack session is missing the 'd' auth cookie. The user may need to reconnect Slack via the dashboard browser session."
  fi
  _validate_xoxd "$xoxd"

  _save_tokens "$xoxc" "$xoxd"
}

_ensure_tokens() {
  # Both tokens are required for a direct API call. They're saved atomically, so
  # normally it's both-or-neither — but a token file cached by an older skill
  # version may carry an empty xoxd, so check both and re-extract if either is missing.
  local xoxc xoxd
  xoxc=$(_get_xoxc)
  xoxd=$(_get_xoxd)

  if [ -z "$xoxc" ] || [ -z "$xoxd" ]; then
    _extract_tokens_from_browser
    xoxc=$(_get_xoxc)
    xoxd=$(_get_xoxd)
  fi

  if [ -z "$xoxc" ] || [ -z "$xoxd" ]; then
    _error_json "NO_TOKENS" "Could not obtain Slack tokens (xoxc/xoxd). Connect Slack via the dashboard browser session."
  fi
}

# Single direct call to the Slack Web API. Emits the raw JSON response body on
# stdout (no ok/error interpretation — the caller does that so it can decide
# whether to re-extract tokens and retry). xoxc goes in the POST body as `token`;
# xoxd rides along as the `d=` cookie.
#
# Caller params arrive as an unencoded url-style string ("query=foo bar&count=20").
# We split on "&", each pair on its FIRST "=", and hand each to --data-urlencode so
# curl encodes the VALUE (spaces, "#", ":", "<@...>") but not the key — matching the
# browser path's URLSearchParams.append() and tolerating values that contain "="
# (e.g. cursor tokens). Pairs without "=" are skipped, as the JSON conversion did.
_slack_api_call() {
  local method="$1" params="$2" xoxc="$3" xoxd="$4"
  local response http_code body
  local -a curl_data=(--data-urlencode "token=${xoxc}")
  if [ -n "$params" ]; then
    local pair
    # `|| [ -n "$pair" ]` so the final pair isn't dropped (tr output has no
    # trailing newline, and plain `read` returns non-zero on the last line).
    while IFS= read -r pair || [ -n "$pair" ]; do
      [ -z "$pair" ] && continue
      [[ "$pair" != *=* ]] && continue
      curl_data+=(--data-urlencode "$pair")
    done < <(printf '%s' "$params" | tr '&' '\n')
  fi
  response=$(curl -s -w "\n%{http_code}" -X POST "${SLACK_API_BASE}/${method}" \
    -H "Cookie: d=${xoxd}" \
    "${curl_data[@]}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -ge 400 ]; then
    _error_json "SLACK_HTTP_ERROR" "Slack API returned HTTP $http_code for ${method}"
  fi
  if [ -z "$body" ]; then
    _error_json "EMPTY_RESPONSE" "Slack API returned an empty body for ${method}"
  fi
  echo "$body"
}

_slack_api() {
  local method="$1"
  local params="${2:-}"

  _require_browser_session
  local session_name="${BROWSER_SESSION:-slack}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    _error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  local tier_delay=3
  case "$method" in
    conversations.history|conversations.replies) tier_delay=2 ;;
    users.info|auth.test) tier_delay=1 ;;
  esac
  _rate_delay "$tier_delay"

  _ensure_tokens
  local xoxc xoxd
  xoxc=$(_get_xoxc)
  xoxd=$(_get_xoxd)

  # Call directly, no browser navigation. On an auth failure re-extract tokens
  # from the live session once (the cached xoxc/xoxd may have rotated) and retry.
  local attempt content ok err
  for attempt in 1 2; do
    content=$(_slack_api_call "$method" "$params" "$xoxc" "$xoxd")
    ok=$(echo "$content" | jq -r '.ok // false' 2>/dev/null || echo "false")
    err=$(echo "$content" | jq -r '.error // ""' 2>/dev/null || echo "")
    if [ "$ok" = "true" ]; then
      echo "$content"
      return
    fi
    if [ "$attempt" = "1" ] && { [ "$err" = "invalid_auth" ] || [ "$err" = "not_authed" ] || [ "$err" = "token_expired" ]; }; then
      rm -f "$TOKEN_FILE"
      _extract_tokens_from_browser
      xoxc=$(_get_xoxc)
      xoxd=$(_get_xoxd)
      continue
    fi
    break
  done

  # Persisted failure: if it's still an auth error after a fresh extract, the
  # session itself is dead — mark it outdated so the user is prompted to re-login.
  if [ "$err" = "invalid_auth" ] || [ "$err" = "token_revoked" ] || [ "$err" = "not_authed" ] || [ "$err" = "token_expired" ]; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "Slack API returned ${err}" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    _error_json "AUTH_EXPIRED" "Slack authentication failed (${err}). User needs to re-login via the dashboard."
  fi
  _error_json "SLACK_API_ERROR" "Slack API error: ${err:-unknown}"
}
