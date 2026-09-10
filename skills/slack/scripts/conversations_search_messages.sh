#!/bin/bash
# conversations_search_messages.sh — full-text search with rich filters.
# Filters map to Slack search query modifiers.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
COUNT=$(echo "$PARAMS" | jq -r '.count // 20')
PAGE=$(echo "$PARAMS" | jq -r '.page // 1')
SORT=$(echo "$PARAMS" | jq -r '.sort // "score"')

# Rich filters
FILTER_IN_CHANNEL=$(echo "$PARAMS" | jq -r '.filter_in_channel // ""')
FILTER_USERS_FROM=$(echo "$PARAMS" | jq -r '.filter_users_from // ""')
FILTER_USERS_WITH=$(echo "$PARAMS" | jq -r '.filter_users_with // ""')
FILTER_DATE_BEFORE=$(echo "$PARAMS" | jq -r '.filter_date_before // ""')
FILTER_DATE_AFTER=$(echo "$PARAMS" | jq -r '.filter_date_after // ""')
FILTER_DATE_ON=$(echo "$PARAMS" | jq -r '.filter_date_on // ""')
FILTER_DATE_DURING=$(echo "$PARAMS" | jq -r '.filter_date_during // ""')
FILTER_THREADS_ONLY=$(echo "$PARAMS" | jq -r '.filter_threads_only // false')

_validate_param "$QUERY" "query"

# Build compound query by appending filter modifiers
FULL_QUERY="$QUERY"

if [ -n "$FILTER_IN_CHANNEL" ] && [ "$FILTER_IN_CHANNEL" != "null" ]; then
  # Accept either a channel name or ID; prepend # if not already
  if [[ "$FILTER_IN_CHANNEL" =~ ^C[A-Z0-9]+ ]]; then
    FULL_QUERY="$FULL_QUERY in:<#${FILTER_IN_CHANNEL}>"
  else
    CLEAN="${FILTER_IN_CHANNEL#\#}"
    FULL_QUERY="$FULL_QUERY in:#${CLEAN}"
  fi
fi

if [ -n "$FILTER_USERS_FROM" ] && [ "$FILTER_USERS_FROM" != "null" ]; then
  # Comma-separated list of user IDs or names
  while IFS=',' read -r U; do
    U="${U#"${U%%[![:space:]]*}"}"  # trim leading whitespace
    U="${U%"${U##*[![:space:]]}"}"  # trim trailing whitespace
    [ -z "$U" ] && continue
    if [[ "$U" =~ ^U[A-Z0-9]+ ]]; then
      FULL_QUERY="$FULL_QUERY from:<@${U}>"
    else
      FULL_QUERY="$FULL_QUERY from:@${U#@}"
    fi
  done <<< "$FILTER_USERS_FROM"
fi

if [ -n "$FILTER_USERS_WITH" ] && [ "$FILTER_USERS_WITH" != "null" ]; then
  while IFS=',' read -r U; do
    U="${U#"${U%%[![:space:]]*}"}"
    U="${U%"${U##*[![:space:]]}"}"
    [ -z "$U" ] && continue
    if [[ "$U" =~ ^U[A-Z0-9]+ ]]; then
      FULL_QUERY="$FULL_QUERY with:<@${U}>"
    else
      FULL_QUERY="$FULL_QUERY with:@${U#@}"
    fi
  done <<< "$FILTER_USERS_WITH"
fi

if [ -n "$FILTER_DATE_BEFORE" ] && [ "$FILTER_DATE_BEFORE" != "null" ]; then
  FULL_QUERY="$FULL_QUERY before:${FILTER_DATE_BEFORE}"
fi

if [ -n "$FILTER_DATE_AFTER" ] && [ "$FILTER_DATE_AFTER" != "null" ]; then
  FULL_QUERY="$FULL_QUERY after:${FILTER_DATE_AFTER}"
fi

if [ -n "$FILTER_DATE_ON" ] && [ "$FILTER_DATE_ON" != "null" ]; then
  FULL_QUERY="$FULL_QUERY on:${FILTER_DATE_ON}"
fi

if [ -n "$FILTER_DATE_DURING" ] && [ "$FILTER_DATE_DURING" != "null" ]; then
  FULL_QUERY="$FULL_QUERY during:${FILTER_DATE_DURING}"
fi

if [ "$FILTER_THREADS_ONLY" = "true" ]; then
  FULL_QUERY="$FULL_QUERY has:thread"
fi

ENCODED_QUERY=$(printf '%s' "$FULL_QUERY" | jq -sRr @uri)
API_PARAMS="query=${ENCODED_QUERY}&count=${COUNT}&page=${PAGE}&sort=${SORT}"

RESULT=$(_slack_api "search.messages" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  query:   .query,
  total:   (.messages.total // 0),
  page:    (.messages.pagination.page // 1),
  pages:   (.messages.pagination.page_count // 1),
  matches: [.messages.matches[]? | {
    ts:        .ts,
    channel:   {id: .channel.id, name: .channel.name},
    user:      (.user // ""),
    username:  (.username // ""),
    text:      (.text // ""),
    permalink: (.permalink // ""),
    thread_ts: (.thread_ts // null)
  }]
}'
