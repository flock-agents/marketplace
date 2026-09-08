#!/bin/bash
# Lightweight significance predicate — runs BEFORE waking the agent.
# Exits 0 (significant) or 1 (skip). No network calls.
set -euo pipefail

EVENT="${INGEST_EVENT:-"{}"}"
CONFIG="${ROUTINE_CONFIG:-"{}"}"

CHANNEL=$(echo "$EVENT" | jq -r '.channel // ""')
BOT_ID=$(echo "$EVENT" | jq -r '.bot_id // ""')
SUBTYPE=$(echo "$EVENT" | jq -r '.subtype // ""')
TEXT=$(echo "$EVENT" | jq -r '.text // ""')

WATCHED_CHANNELS=$(echo "$CONFIG" | jq -r '.channels // [] | .[]' 2>/dev/null)
IGNORE_BOTS=$(echo "$CONFIG" | jq -r '.ignoreBots // true')
KEYWORDS=$(echo "$CONFIG" | jq -r '.keywords // ""')

if [ -n "$WATCHED_CHANNELS" ]; then
  MATCH=false
  while IFS= read -r ch; do
    if [ "$ch" = "$CHANNEL" ]; then
      MATCH=true
      break
    fi
  done <<< "$WATCHED_CHANNELS"
  if [ "$MATCH" = "false" ]; then
    echo '{"significant":false,"reason":"channel_not_watched"}'
    exit 1
  fi
fi

if [ "$IGNORE_BOTS" = "true" ]; then
  if [ -n "$BOT_ID" ] && [ "$BOT_ID" != "null" ]; then
    echo '{"significant":false,"reason":"bot_message"}'
    exit 1
  fi
  if [ "$SUBTYPE" = "bot_message" ]; then
    echo '{"significant":false,"reason":"bot_subtype"}'
    exit 1
  fi
fi

if [ -n "$KEYWORDS" ]; then
  TEXT_LOWER=$(echo "$TEXT" | tr '[:upper:]' '[:lower:]')
  IFS=',' read -ra KW_ARRAY <<< "$KEYWORDS"
  KW_MATCH=false
  for kw in "${KW_ARRAY[@]}"; do
    kw_trimmed=$(echo "$kw" | tr '[:upper:]' '[:lower:]' | xargs)
    if [ -n "$kw_trimmed" ] && echo "$TEXT_LOWER" | grep -qF "$kw_trimmed"; then
      KW_MATCH=true
      break
    fi
  done
  if [ "$KW_MATCH" = "false" ]; then
    echo '{"significant":false,"reason":"keyword_no_match"}'
    exit 1
  fi
fi

echo '{"significant":true}'
exit 0
