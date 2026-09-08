#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
COUNT=$(echo "$PARAMS" | jq -r '.count // 20')
PAGE=$(echo "$PARAMS" | jq -r '.page // 1')
SORT=$(echo "$PARAMS" | jq -r '.sort // "score"')

_validate_param "$QUERY" "query"

ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)

API_PARAMS="query=${ENCODED_QUERY}&count=${COUNT}&page=${PAGE}&sort=${SORT}"

RESULT=$(_slack_api "search.messages" "$API_PARAMS")

MATCHES=$(echo "$RESULT" | jq -c '{total: (.messages.total // 0), page: (.messages.pagination.page // 1), pages: (.messages.pagination.page_count // 1), matches: [.messages.matches[]? | {ts: .ts, channel: {id: .channel.id, name: .channel.name}, user: (.user // ""), username: (.username // ""), text: (.text // ""), permalink: (.permalink // ""), thread_ts: (.thread_ts // null)}]}')

echo "$MATCHES"
