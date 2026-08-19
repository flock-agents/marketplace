#!/bin/bash
set -euo pipefail

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

RATE_FILE="/tmp/skill-linkedin-rate"
DRAFTS_DIR="${SKILL_DATA_DIR:-/tmp}/linkedin-drafts"
mkdir -p "$DRAFTS_DIR"

rate_limit() {
  local now last diff
  now=$(date +%s)
  last=$(cat "$RATE_FILE" 2>/dev/null || echo 0)
  diff=$((now - last))
  if [ "$diff" -lt 3 ]; then
    sleep 3
  fi
  echo "$now" > "$RATE_FILE"
}

error_json() {
  local code="$1" msg="$2"
  printf '{"error":true,"code":"%s","message":"%s"}\n' "$code" "$msg"
  exit 1
}

check_session_expired() {
  local page_content="$1"
  local session_name="${BROWSER_SESSION:-linkedin}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if echo "$page_content" | grep -qi 'sign in\|log in\|login\|session_redirect\|"authwall"'; then
    curl -s -X POST "${FLOCK_API}/api/internal/browser-sessions/${session_name}/mark-outdated" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
      -d "$(jq -n --arg agent "$agent_id" --arg reason "LinkedIn returned login/auth page instead of authenticated content" \
            '{agentId: $agent, reason: $reason}')" >/dev/null 2>&1 || true
    error_json "SESSION_OUTDATED" "LinkedIn session has expired. Marked as outdated — user needs to re-login via the dashboard."
  fi
}

crawl_url() {
  local url="$1"
  local session_name="${BROWSER_SESSION:-linkedin}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  rate_limit

  local response http_code
  response=$(curl -s -w "\n%{http_code}" -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg url "$url" --arg session "$session_name" --arg agent "$agent_id" \
          '{url: $url, sessionName: $session, agentId: $agent, extractText: true}')")
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "403" ]; then
    local err_code
    err_code=$(echo "$body" | jq -r '.code // ""' 2>/dev/null || echo "")
    if [ "$err_code" = "session_not_ready" ]; then
      error_json "SESSION_NOT_READY" "LinkedIn browser session is not ready. User needs to log in or re-authenticate via the dashboard."
    fi
    error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable response)")
    error_json "CRAWL_ERROR" "Failed to fetch LinkedIn page (HTTP $http_code): $err_msg"
  fi

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')

  check_session_expired "$page_content"

  echo "$page_content"
}

persistent_create() {
  local url="$1"
  local page_actions="${2:-}"
  local session_name="${BROWSER_SESSION:-linkedin}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  rate_limit

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
      error_json "SESSION_NOT_READY" "LinkedIn browser session is not ready. User needs to log in or re-authenticate via the dashboard."
    fi
    error_json "CRAWL_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // "(no error message)"' 2>/dev/null || echo "(unparseable)")
    error_json "PERSISTENT_SESSION_ERROR" "Failed to create persistent session (HTTP $http_code): $err_msg"
  fi

  local page_content
  page_content=$(echo "$body" | jq -r '.content // ""')
  check_session_expired "$page_content"

  echo "$body"
}

persistent_interact() {
  local persistent_id="$1"
  local page_actions="$2"
  local close="${3:-false}"
  local eval_script="${4:-}"
  local session_name="${BROWSER_SESSION:-linkedin}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  rate_limit

  # A verify eval_script becomes a TRAILING `evaluate` page-action — top-level
  # evaluateScript is ignored when pageActions is present. (CRAFO-988/989)
  if [ -n "$eval_script" ]; then
    page_actions=$(echo "$page_actions" | jq --arg es "$eval_script" '. + [{action:"evaluate", script:$es}]')
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
      error_json "SESSION_NOT_READY" "LinkedIn browser session is not ready. User needs to log in or re-authenticate via the dashboard."
    fi
    error_json "BROWSER_ERROR" "Access denied (HTTP 403). Check browser session access settings."
  fi

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.error // .message // "(unknown)"' 2>/dev/null || echo "HTTP $http_code")
    error_json "BROWSER_ERROR" "Persistent session interaction failed (HTTP $http_code): $err_msg"
  fi

  echo "$body"
}

persistent_close() {
  local persistent_id="$1"
  local session_name="${BROWSER_SESSION:-linkedin}"
  local agent_id="${FLOCK_AGENT_ID:-}"

  if [ -z "$agent_id" ]; then
    error_json "MISSING_AGENT" "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec"
  fi

  curl -s -X POST "${FLOCK_API}/api/internal/browser-fetch" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
    -d "$(jq -n --arg session "$session_name" --arg agent "$agent_id" --arg pid "$persistent_id" \
          '{sessionName: $session, agentId: $agent, persistentSessionId: $pid, closePersistentSession: true}')" >/dev/null 2>&1 || true
}

cmd_notifications() {
  local content
  content=$(crawl_url "https://www.linkedin.com/notifications/")

  if [ -z "$content" ]; then
    error_json "NO_CONTENT" "Could not load notifications. Session may have expired."
  fi

  content=$(echo "$content" | head -c 20480)
  jq -n --arg content "$content" '{source: "linkedin_notifications", format: "raw_text", content: $content}'
}

cmd_feed() {
  local count="${1:-10}"

  # Plain extractText (crawl_url), NO pageActions: passing pageActions makes
  # browser-fetch return content "{"ok":true}" and drop the rendered feed text
  # (CRAFO-986). extractText alone returns the rendered viewport of the feed.
  local content
  content=$(crawl_url "https://www.linkedin.com/feed/")

  local trimmed
  trimmed=$(printf '%s' "$content" | tr -d '[:space:]')
  if [ -z "$trimmed" ] || printf '%s' "$trimmed" | grep -q '^{"ok":'; then
    error_json "NO_CONTENT" "LinkedIn feed returned no extractable text — the session may be logged out or blocked. Reconnect the LinkedIn browser session via the Flock dashboard."
  fi

  content=$(printf '%s' "$content" | head -c 20480)
  jq -n --arg content "$content" --argjson count "$count" '{source: "linkedin_feed", format: "raw_text", content: $content, requestedCount: $count}'
}

cmd_profile() {
  local profile_url="$1"

  if [[ ! "$profile_url" =~ ^https://www\.linkedin\.com/(in|company)/ ]]; then
    error_json "INVALID_URL" "Profile URL must be a LinkedIn profile or company page (https://www.linkedin.com/in/... or /company/...)"
  fi

  local content
  content=$(crawl_url "$profile_url")

  if [ -z "$content" ]; then
    error_json "NO_CONTENT" "Could not load profile. Session may have expired."
  fi

  content=$(echo "$content" | head -c 20480)
  jq -n --arg content "$content" --arg url "$profile_url" '{source: "linkedin_profile", format: "raw_text", url: $url, content: $content}'
}

cmd_post() {
  local text="$1"
  local char_count=${#text}

  if [ "$char_count" -gt 3000 ]; then
    error_json "TOO_LONG" "Post exceeds 3000 characters ($char_count chars)"
  fi

  local text_json
  text_json=$(echo "$text" | jq -Rs '.')

  local session_result persistent_id
  session_result=$(persistent_create "https://www.linkedin.com/feed/")
  persistent_id=$(echo "$session_result" | jq -r '.persistentSessionId // ""')

  if [ -z "$persistent_id" ]; then
    error_json "SESSION_ERROR" "Failed to create persistent session for posting"
  fi

  COMPOSE_ACTIONS=$(jq -nc '[
    {"action":"waitForSelector","selector":"button.share-box-feed-entry__trigger, .share-box-feed-entry__trigger, [data-control-name=\"share.feedEntry\"]"},
    {"action":"click","selector":"button.share-box-feed-entry__trigger, .share-box-feed-entry__trigger, [data-control-name=\"share.feedEntry\"]"},
    {"action":"waitForSelector","selector":".ql-editor[contenteditable=true], .share-creation-state__text-editor .ql-editor, [role=\"textbox\"]","delay":5000}
  ]')

  persistent_interact "$persistent_id" "$COMPOSE_ACTIONS" "false" "" >/dev/null 2>&1

  TYPE_ACTIONS=$(jq -nc --argjson text "$text_json" '[
    {"action":"click","selector":".ql-editor[contenteditable=true], .share-creation-state__text-editor .ql-editor, [role=\"textbox\"]"},
    {"action":"insertText","text":$text},
    {"action":"wait","delay":500}
  ]')

  persistent_interact "$persistent_id" "$TYPE_ACTIONS" "false" "" >/dev/null 2>&1

  POST_ACTIONS=$(jq -nc '[
    {"action":"waitForSelector","selector":"button.share-actions__primary-action, .share-box_actions button.artdeco-button--primary"},
    {"action":"click","selector":"button.share-actions__primary-action, .share-box_actions button.artdeco-button--primary"},
    {"action":"wait","delay":3000}
  ]')

  VERIFY_SCRIPT="(() => {
    const modal = document.querySelector('.share-box--is-open, .share-creation-state');
    if (!modal || modal.offsetHeight === 0) {
      return JSON.stringify({success: true, message: 'Post published via browser session'});
    }
    return JSON.stringify({success: false, message: 'Post dialog still open — publish may have failed'});
  })()"

  local post_result
  post_result=$(persistent_interact "$persistent_id" "$POST_ACTIONS" "true" "$VERIFY_SCRIPT")
  local content
  content=$(echo "$post_result" | jq -r '.content // "{}"')
  # Post already published; degrade to unconfirmed if the verify body isn't JSON. (CRAFO-988)
  echo "$content" | jq -c '.' 2>/dev/null || echo '{"success":null,"message":"Post sent, but could not confirm the result — verify on LinkedIn."}'
}

cmd_draft_post() {
  local text="$1"
  local char_count=${#text}
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  local draft_file="${DRAFTS_DIR}/draft-${timestamp}.txt"

  echo "$text" > "$draft_file"

  jq -n --arg text "$text" --argjson charCount "$char_count" --arg savedTo "$draft_file" \
    '{draft: {text: $text, charCount: $charCount, savedTo: $savedTo}, note: "Draft saved locally. Use '\''post'\'' command to publish."}'
}

cmd_send_message() {
  local recipient_url="$1"
  local message_text="$2"

  if [[ ! "$recipient_url" =~ ^https://www\.linkedin\.com/in/ ]]; then
    error_json "INVALID_URL" "Recipient must be a LinkedIn profile URL (https://www.linkedin.com/in/...)"
  fi

  local text_json
  text_json=$(echo "$message_text" | jq -Rs '.')

  local session_result persistent_id
  session_result=$(persistent_create "$recipient_url")
  persistent_id=$(echo "$session_result" | jq -r '.persistentSessionId // ""')

  if [ -z "$persistent_id" ]; then
    error_json "SESSION_ERROR" "Failed to create persistent session for messaging"
  fi

  MSG_ACTIONS=$(jq -nc '[
    {"action":"waitForSelector","selector":"button[aria-label*=\"Message\"], a[href*=\"/messaging/\"]"},
    {"action":"click","selector":"button[aria-label*=\"Message\"], a[href*=\"/messaging/\"]"},
    {"action":"waitForSelector","selector":".msg-form__contenteditable [contenteditable=true], .msg-form__msg-content-container [contenteditable=true]","delay":5000}
  ]')

  persistent_interact "$persistent_id" "$MSG_ACTIONS" "false" "" >/dev/null 2>&1

  TYPE_ACTIONS=$(jq -nc --argjson text "$text_json" '[
    {"action":"click","selector":".msg-form__contenteditable [contenteditable=true], .msg-form__msg-content-container [contenteditable=true]"},
    {"action":"insertText","text":$text},
    {"action":"wait","delay":500}
  ]')

  persistent_interact "$persistent_id" "$TYPE_ACTIONS" "false" "" >/dev/null 2>&1

  SEND_ACTIONS=$(jq -nc '[
    {"action":"waitForSelector","selector":"button.msg-form__send-button, button[type=\"submit\"].msg-form__send-button"},
    {"action":"click","selector":"button.msg-form__send-button, button[type=\"submit\"].msg-form__send-button"},
    {"action":"wait","delay":2000}
  ]')

  VERIFY_SCRIPT="(() => {
    return JSON.stringify({success: true, message: 'Message sent via browser session'});
  })()"

  local send_result
  send_result=$(persistent_interact "$persistent_id" "$SEND_ACTIONS" "true" "$VERIFY_SCRIPT")
  local content
  content=$(echo "$send_result" | jq -r '.content // "{}"')
  # Message already sent; degrade to unconfirmed if the verify body isn't JSON. (CRAFO-988)
  echo "$content" | jq -c '.' 2>/dev/null || echo '{"success":null,"message":"Message sent, but could not confirm the result — verify on LinkedIn."}'
}

cmd_messages() {
  local content
  content=$(crawl_url "https://www.linkedin.com/messaging/")

  if [ -z "$content" ]; then
    error_json "NO_CONTENT" "Could not load messages. Session may have expired."
  fi

  content=$(echo "$content" | head -c 20480)
  jq -n --arg content "$content" '{source: "linkedin_messages", format: "raw_text", content: $content}'
}

cmd_search() {
  local query="$1" type="${2:-people}"

  case "$type" in
    people|posts|companies) ;;
    *) error_json "INVALID_TYPE" "Search type must be: people, posts, or companies" ;;
  esac

  local encoded_query
  encoded_query=$(jq -rn --arg q "$query" '$q | @uri')
  local url="https://www.linkedin.com/search/results/${type}/?keywords=${encoded_query}"

  local content
  content=$(crawl_url "$url")

  if [ -z "$content" ]; then
    error_json "NO_CONTENT" "Could not load search results. Session may have expired."
  fi

  content=$(echo "$content" | head -c 20480)
  jq -n --arg content "$content" --arg query "$query" --arg type "$type" \
    '{source: "linkedin_search", format: "raw_text", query: $query, type: $type, content: $content}'
}

cmd_comments() {
  local post_url="$1"

  if [[ ! "$post_url" =~ ^https://www\.linkedin\.com/ ]] || ! echo "$post_url" | grep -qiE 'activity|/posts/|/feed/update/'; then
    error_json "INVALID_URL" "Post URL must be a LinkedIn post/activity URL (contains /posts/, /feed/update/, or activity-<id>)"
  fi

  local session_result persistent_id
  session_result=$(persistent_create "$post_url")
  persistent_id=$(echo "$session_result" | jq -r '.persistentSessionId // ""')

  if [ -z "$persistent_id" ]; then
    error_json "SESSION_ERROR" "Failed to create persistent session for reading comments"
  fi

  # Let the post page settle; the extract script itself scrolls + clicks
  # "load more comments" (selector-free, so a 0-comment post won't hard-fail).
  local settle_actions
  settle_actions=$(jq -nc '[{"action":"wait","delay":3500}]')

  # Derive the post's numeric activity id for canonical URLs + constructed comment permalinks.
  local post_activity_id="" post_url_json
  if [[ "$post_url" =~ urn:li:activity:([0-9]+) ]]; then post_activity_id="${BASH_REMATCH[1]}";
  elif [[ "$post_url" =~ activity[:-]([0-9]+) ]]; then post_activity_id="${BASH_REMATCH[1]}"; fi
  post_url_json=$(printf '%s' "$post_url" | jq -Rs '.')

  # Async IIFE — Playwright awaits the returned Promise; the trailing evaluate's return value
  # becomes `content`. Paginates to exhaustion (ceiling 40), expands nested replies, and tags
  # per-comment permalink + hasOwnerReply/isByOwner. Bash-safe: no backticks; only the injected
  # $post_activity_id / $post_url_json are meant to expand.
  local extract_script
  extract_script="(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const loadMoreSel = 'button.comments-comments-list__load-more-button, button.show-prev-replies, button[aria-label*=\"more comment\" i], button[aria-label*=\"more repl\" i], button[aria-label*=\"previous repl\" i], button[aria-label*=\"Load more\" i], button.scaffold-finite-scroll__load-button';
    const MAX_ROUNDS = 40;
    const MAX_COMMENTS = 400;
    const countAll = () => document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item').length;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    let rounds = 0;
    for (; rounds < MAX_ROUNDS; rounds++) {
      const btns = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
      if (!btns.length) break;
      for (const b of btns) { try { b.click(); } catch (e) {} }
      await sleep(1100);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(400);
      if (countAll() > MAX_COMMENTS) break;
    }
    const remaining = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
    const truncated = (rounds >= MAX_ROUNDS || countAll() > MAX_COMMENTS) && remaining.length > 0;

    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const lc = (s) => norm(s).toLowerCase();
    const pick = (root, sels) => { for (const s of sels) { const n = root.querySelector(s); if (n && n.innerText && n.innerText.trim()) return n.innerText.trim(); } return ''; };
    const commentIdOf = (el) => {
      const cand = el.getAttribute('data-id') || el.getAttribute('data-urn') || '';
      if (/urn:li:comment/i.test(cand)) return cand;
      const inner = el.querySelector('[data-id*=\"urn:li:comment\" i], [data-urn*=\"urn:li:comment\" i]');
      if (inner) return inner.getAttribute('data-id') || inner.getAttribute('data-urn') || '';
      return '';
    };
    const nameOf = (el) => { const n = pick(el, ['.comments-comment-meta__description-title', '.comments-post-meta__name-text', '.comments-comment-item__post-meta .hoverable-link-text', '.comments-comment-meta__description a']); return n.split('\n')[0].trim(); };
    const textOf = (el) => pick(el, ['.comments-comment-item__main-content', '.update-components-text', '.comments-comment-item-content-body', '.feed-shared-main-content--comment']);
    const headlineOf = (el) => pick(el, ['.comments-comment-meta__description-subtitle', '.comments-post-meta__headline']);
    const timeOf = (el) => pick(el, ['.comments-comment-meta__data', 'time', '.comments-comment-item__timestamp']);
    const profileOf = (el) => { const link = el.querySelector('a.comments-comment-meta__image-link, .comments-comment-meta__actor a, a[href*=\"/in/\"]'); return link && link.href ? link.href.split('?')[0] : ''; };
    const idAct = (cid) => { const m = String(cid).match(/urn:li:activity:([0-9]+)/); return m ? m[1] : ''; };
    const postActId = \"$post_activity_id\";
    const permalinkOf = (el, cid) => {
      const anchors = Array.from(el.querySelectorAll('a[href*=\"commentUrn\" i], a.comments-comment-meta__data, a.comments-comment-meta__timestamp, a[href*=\"/feed/update/\"]'));
      for (const a of anchors) { if (a.href && /commentUrn/i.test(a.href)) return a.href.split('#')[0]; }
      for (const a of anchors) { if (a.href && /\/feed\/update\//.test(a.href)) return a.href.split('#')[0]; }
      const act = idAct(cid) || postActId;
      if (act && cid) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + act + '?commentUrn=' + encodeURIComponent(cid);
      if (act) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + act + '/';
      return '';
    };
    const postAuthorRaw = pick(document, ['.update-components-actor__title', '.feed-shared-actor__name', '.update-components-actor__name']);
    const ownerName = lc((postAuthorRaw || '').split('\n')[0]);
    const byOwner = (nm) => ownerName.length > 0 && lc(nm) === ownerName;
    const allNodes = Array.from(document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
    const isReplyNode = (el) => !!(el.parentElement && el.parentElement.closest('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
    const seen = new Set();
    const comments = [];
    let totalWithReplies = 0;
    let canonicalActId = postActId;
    for (const el of allNodes) {
      if (isReplyNode(el)) continue;
      const name = nameOf(el);
      const text = textOf(el);
      if (!name && !text) continue;
      const cid = commentIdOf(el);
      if (!canonicalActId) canonicalActId = idAct(cid);
      const key = cid || (name + '|' + text.slice(0, 80));
      if (seen.has(key)) continue;
      seen.add(key);
      const replyEls = Array.from(el.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
      const replies = [];
      for (const r of replyEls) {
        const rn = nameOf(r); const rt = textOf(r);
        if (!rn && !rt) continue;
        const rcid = commentIdOf(r);
        replies.push({ commentId: rcid, name: rn, profileUrl: profileOf(r), text: rt.slice(0, 2000), time: timeOf(r), permalink: permalinkOf(r, rcid), isByOwner: byOwner(rn) });
      }
      const hasOwnerReply = replies.some((r) => r.isByOwner);
      totalWithReplies += 1 + replies.length;
      comments.push({ commentId: cid, name: name, headline: headlineOf(el), profileUrl: profileOf(el), text: text.slice(0, 2000), time: timeOf(el), permalink: permalinkOf(el, cid), isByOwner: byOwner(name), hasOwnerReply: hasOwnerReply, replyCount: replies.length, replies: replies });
      if (comments.length >= MAX_COMMENTS) break;
    }
    const canonicalPostUrl = canonicalActId ? ('https://www.linkedin.com/feed/update/urn:li:activity:' + canonicalActId + '/') : $post_url_json;
    const postText = pick(document, ['.fie-impression-container .update-components-text', '.feed-shared-update-v2 .update-components-text', '.update-components-text']);
    return JSON.stringify({ postAuthor: postAuthorRaw, ownerName: (postAuthorRaw || '').split('\n')[0], postUrl: canonicalPostUrl, postActivityId: canonicalActId, postTextPreview: postText.slice(0, 500), commentCount: comments.length, totalWithReplies: totalWithReplies, truncated: truncated, rounds: rounds, comments: comments });
  })()"

  local result content
  result=$(persistent_interact "$persistent_id" "$settle_actions" "true" "$extract_script")
  content=$(echo "$result" | jq -r '.content // ""')

  if [ -z "$content" ] || printf '%s' "$content" | tr -d '[:space:]' | grep -q '^{"ok":'; then
    error_json "NO_CONTENT" "Could not extract comments — the page may have failed to load or the session is logged out. Reconnect the LinkedIn session via the Flock dashboard if this persists."
  fi

  echo "$content" | jq -c --arg url "$post_url" '{source: "linkedin_post_comments", url: $url} + .' 2>/dev/null \
    || jq -n --arg url "$post_url" --arg raw "$content" \
         '{source: "linkedin_post_comments", url: $url, error: true, code: "PARSE_ERROR", message: "Could not parse extracted comments", raw: $raw}'
}

cmd_reply_comment() {
  local post_url="$1" reply_text="$2" target_comment_id="${3:-}" target_name="${4:-}"

  if [[ ! "$post_url" =~ ^https://www\.linkedin\.com/ ]] || ! echo "$post_url" | grep -qiE 'activity|/posts/|/feed/update/'; then
    error_json "INVALID_URL" "Post URL must be a LinkedIn post/activity URL (contains /posts/, /feed/update/, or activity-<id>)"
  fi
  [ -z "$reply_text" ] && error_json "MISSING_ARG" "Reply text is empty"
  if [ "${#reply_text}" -gt 1250 ]; then error_json "TOO_LONG" "Reply exceeds 1250 characters (${#reply_text} chars)"; fi
  if [ -z "$target_comment_id" ] && [ -z "$target_name" ]; then
    error_json "MISSING_TARGET" "A target is required: pass the commentId (from the 'comments' command) or the commenter's name"
  fi

  local text_json want_id_json want_name_json
  text_json=$(printf '%s' "$reply_text" | jq -Rs '.')
  want_id_json=$(printf '%s' "$target_comment_id" | jq -Rs '.')
  want_name_json=$(printf '%s' "$target_name" | jq -Rs '.')

  local session_result persistent_id
  session_result=$(persistent_create "$post_url")
  persistent_id=$(echo "$session_result" | jq -r '.persistentSessionId // ""')
  [ -z "$persistent_id" ] && error_json "SESSION_ERROR" "Failed to create persistent session for replying"

  local settle_actions
  settle_actions=$(jq -nc '[{"action":"wait","delay":3500}]')

  # Step 1 — load comments, LOCATE the target comment (by URN, then commenter name), click its
  # Reply button, and mark the opened editor + submit button so Step 2 targets them precisely
  # (DOM state persists across calls in the same persistent session).
  local open_script
  open_script="(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const loadMoreSel = 'button.comments-comments-list__load-more-button, button.show-prev-replies, button[aria-label*=\"more comment\" i], button[aria-label*=\"more repl\" i], button[aria-label*=\"previous repl\" i], button[aria-label*=\"Load more\" i], button.scaffold-finite-scroll__load-button';
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const wantId = ${want_id_json};
    const wantName = norm(${want_name_json});
    const idOf = (el) => { const c = el.getAttribute('data-id') || el.getAttribute('data-urn') || ''; if (/urn:li:comment/i.test(c)) return c; const inner = el.querySelector('[data-id*=\"urn:li:comment\" i], [data-urn*=\"urn:li:comment\" i]'); return inner ? (inner.getAttribute('data-id') || inner.getAttribute('data-urn') || '') : ''; };
    const nameOf = (el) => { const n = el.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text, .comments-comment-item__post-meta .hoverable-link-text, .comments-comment-meta__description a'); return n ? norm(n.innerText.split('\n')[0]) : ''; };
    const findTarget = () => {
      const nodes = Array.from(document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
      if (wantId) { const t = nodes.find((el) => idOf(el) === wantId); if (t) return { target: t, matchedBy: 'id', count: nodes.length }; }
      if (wantName) { const t = nodes.find((el) => nameOf(el).indexOf(wantName) >= 0); if (t) return { target: t, matchedBy: 'name', count: nodes.length }; }
      return { target: null, matchedBy: '', count: nodes.length };
    };
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1000);
    let found = findTarget();
    for (let i = 0; i < 40 && !found.target; i++) {
      const btns = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
      if (!btns.length) break;
      for (const b of btns) { try { b.click(); } catch (e) {} }
      await sleep(1000);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(300);
      found = findTarget();
    }
    const target = found.target, matchedBy = found.matchedBy;
    if (!target) return JSON.stringify({ found: false, commentCount: found.count });
    target.setAttribute('data-flock-target', '1');
    target.scrollIntoView({ block: 'center' }); await sleep(500);
    const replyBtn = target.querySelector('button.comments-comment-social-bar__reply-action-button, button[aria-label*=\"Reply\" i], .comments-comment-social-bar__action-button--reply, button.comment-button');
    if (!replyBtn) return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'no_reply_button' });
    try { replyBtn.click(); } catch (e) { return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'reply_click_failed' }); }
    await sleep(1500);
    // CRITICAL GUARD: the inline reply composer MUST be inside THIS comment's subtree (querySelector
    // on target returns only descendants). We do NOT fall back to any page-level editor — the
    // top-level 'Add a comment' box is not a reply and typing there posts a stray top-level comment.
    const box = target.querySelector('.comments-comment-box .ql-editor[contenteditable=\"true\"], .comments-comment-texteditor .ql-editor[contenteditable=\"true\"], form[class*=\"comments-comment-box\"] .ql-editor[contenteditable=\"true\"], .ql-editor[contenteditable=\"true\"]');
    const placeholderOf = (b) => ((b && (b.getAttribute('data-placeholder') || b.getAttribute('aria-placeholder') || b.getAttribute('aria-label'))) || '').toLowerCase();
    if (!box || !target.contains(box) || /add a comment/.test(placeholderOf(box))) { return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'no_inline_reply_box', placeholder: placeholderOf(box) }); }
    box.setAttribute('data-flock-reply', '1'); try { box.focus(); } catch (e) {}
    const form = box.closest('form.comments-comment-box__form, form[class*=\"comments-comment-box\"], .comments-comment-box') || target;
    const submit = form.querySelector('button.comments-comment-box__submit-button, button[class*=\"comments-comment-box__submit\"], button.artdeco-button--primary[type=\"submit\"]');
    if (submit) submit.setAttribute('data-flock-reply-submit', '1');
    return JSON.stringify({ found: true, replyOpen: true, matchedBy, placeholder: placeholderOf(box), hasSubmit: !!submit });
  })()"

  local open_res open_content found reply_open matched_by reason
  open_res=$(persistent_interact "$persistent_id" "$settle_actions" "false" "$open_script")
  open_content=$(echo "$open_res" | jq -r '.content // ""')
  found=$(echo "$open_content" | jq -r '.found // false' 2>/dev/null || echo "false")
  reply_open=$(echo "$open_content" | jq -r '.replyOpen // false' 2>/dev/null || echo "false")
  matched_by=$(echo "$open_content" | jq -r '.matchedBy // ""' 2>/dev/null || echo "")
  reason=$(echo "$open_content" | jq -r '.reason // "unknown"' 2>/dev/null || echo "unknown")

  local has_submit
  has_submit=$(echo "$open_content" | jq -r '.hasSubmit // false' 2>/dev/null || echo "false")

  if [ "$found" != "true" ]; then
    persistent_close "$persistent_id"
    error_json "COMMENT_NOT_FOUND" "Could not find the target comment on the post. It may have been deleted, or the commentId/name didn't match — re-read with 'comments' and retry."
  fi
  if [ "$reply_open" != "true" ]; then
    persistent_close "$persistent_id"
    error_json "REPLY_BOX_ERROR" "Found the comment but could not open its INLINE reply box ($reason). Aborted WITHOUT posting — refusing to fall back to the top-level comment box (that would post a stray comment on the whole post). Retry later."
  fi
  if [ "$has_submit" != "true" ]; then
    persistent_close "$persistent_id"
    error_json "REPLY_BOX_ERROR" "Opened the inline reply box but could not locate its Reply/submit button. Aborted WITHOUT posting to avoid mis-posting a top-level comment."
  fi

  # Step 2 — type into the MARKED editor and click ONLY the MARKED reply-submit button (never a
  # page-wide selector), then close the session and verify the reply nested under the target.
  local needle needle_json
  needle=$(printf '%s' "$reply_text" | cut -c1-60)
  needle_json=$(printf '%s' "$needle" | jq -Rs '.')

  local type_actions
  type_actions=$(jq -nc --argjson text "$text_json" '[
    {"action":"click","selector":"[data-flock-reply=\"1\"]"},
    {"action":"insertText","text":$text},
    {"action":"wait","delay":800},
    {"action":"click","selector":"[data-flock-reply-submit=\"1\"]"},
    {"action":"wait","delay":2500}
  ]')

  local verify_script
  verify_script="(() => { const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); const target = document.querySelector('[data-flock-target=\"1\"]'); const ed = document.querySelector('[data-flock-reply=\"1\"]'); const needle = norm(${needle_json}); const stillTyped = !!ed && needle.length > 0 && norm(ed.innerText).indexOf(needle) >= 0; const nested = !!target && needle.length > 0 && norm(target.innerText).indexOf(needle) >= 0; if (nested && !stillTyped) return JSON.stringify({ success: true, nested: true, message: 'Reply posted and confirmed nested under the target comment' }); if (!stillTyped) return JSON.stringify({ success: null, nested: false, message: 'Reply submitted but could not confirm it nested under the target comment — verify on LinkedIn.' }); return JSON.stringify({ success: false, nested: false, message: 'Reply may not have posted (composer still holds the text) — verify on LinkedIn.' }); })()"

  local send_result content
  send_result=$(persistent_interact "$persistent_id" "$type_actions" "true" "$verify_script")
  content=$(echo "$send_result" | jq -r '.content // "{}"')
  echo "$content" | jq -c --arg mb "$matched_by" '{matchedBy: $mb} + .' 2>/dev/null || echo '{"success":null,"message":"Reply sent, but could not confirm the result — verify on LinkedIn."}'
}

# Main dispatch
# Resolve subcommand + args from positional args, or — when invoked through the
# platform's per-function dispatch (functionName="linkedin") — from params._args
# carried in $SKILL_PARAMS (no positional argv is passed in that mode).
if [ "$#" -eq 0 ] && [ -n "${SKILL_PARAMS:-}" ]; then
  _pa_count=$(echo "$SKILL_PARAMS" | jq -r '(._args // []) | length' 2>/dev/null || echo 0)
  _idx=0
  while [ "$_idx" -lt "$_pa_count" ]; do
    set -- "$@" "$(echo "$SKILL_PARAMS" | jq -r --argjson i "$_idx" '._args[$i]')"
    _idx=$((_idx + 1))
  done
fi

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  notifications)
    cmd_notifications
    ;;
  feed)
    cmd_feed "${1:-10}"
    ;;
  profile)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh profile <profileUrl>"
    cmd_profile "$1"
    ;;
  post)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh post <text>"
    cmd_post "$1"
    ;;
  draft-post)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh draft-post <text>"
    cmd_draft_post "$1"
    ;;
  send-message)
    [ -z "${1:-}" ] || [ -z "${2:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh send-message <recipientProfileUrl> <message>"
    cmd_send_message "$1" "$2"
    ;;
  messages)
    cmd_messages
    ;;
  search)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh search <query> [type]"
    cmd_search "$1" "${2:-people}"
    ;;
  comments)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linkedin.sh comments <postUrl>"
    cmd_comments "$1"
    ;;
  reply-comment)
    { [ -z "${1:-}" ] || [ -z "${2:-}" ]; } && error_json "MISSING_ARG" "Usage: linkedin.sh reply-comment <postUrl> <replyText> [commentId] [commenterName]"
    cmd_reply_comment "$1" "$2" "${3:-}" "${4:-}"
    ;;
  *)
    error_json "UNKNOWN_COMMAND" "Unknown command: $COMMAND. Available: notifications, feed, profile, post, draft-post, send-message, messages, search, comments, reply-comment"
    ;;
esac
