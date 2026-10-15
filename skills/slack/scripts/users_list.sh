#!/bin/bash
# users_list.sh — list workspace users in bulk, so many display names cost ONE call.
#
# Exists because users.info resolves exactly one user per call: an app naming a few hundred
# message authors would spend a few hundred account reads and take as many account-guard
# leases. users.list returns up to `limit` members per call, so the same job costs one call
# per page. users_search cannot stand in — it demands a `query` and truncates to limit/10.
#
# Slack's users.list has NO server-side id filter (its only params are cursor, limit,
# include_locale, team_id), so `users` filters each page client-side in jq; the pages are
# still fetched in full and cost the same. Because a wanted id may sit on any page, passing
# `users` makes the script keep paging until every requested id is found (or max_pages is
# reached), so one invocation answers the caller's whole set. With no `users` it fetches a
# single page and hands back nextCursor for the caller to drive.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"

# Clamped numerically rather than trusted: a non-numeric or absurd limit degrades to the
# default instead of reaching Slack, which answers an oversized limit with HTTP 500.
LIMIT=$(echo "$PARAMS" | jq -r '((.limit // 200) | tonumber? // 200) | if . < 1 then 1 elif . > 1000 then 1000 else floor end')
MAX_PAGES=$(echo "$PARAMS" | jq -r '((.max_pages // 10) | tonumber? // 10) | if . < 1 then 1 elif . > 20 then 20 else floor end')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')

if [ "$CURSOR" = "null" ]; then
  CURSOR=""
fi
# _slack_api_call splits its params on "&", so a cursor carrying one would smuggle in an
# extra API param. Slack cursors are base64, which this allows and "&" is not.
if [ -n "$CURSOR" ] && ! [[ "$CURSOR" =~ ^[A-Za-z0-9+/=_.:-]+$ ]]; then
  _error_json "INVALID_CURSOR" "cursor contains unexpected characters"
fi

# `users` accepts "U1,U2" or a JSON array — whichever shape the caller already holds.
REQUESTED=$(echo "$PARAMS" | jq -c '
  (.users // "") as $u
  | (if ($u | type) == "array" then $u else ($u | tostring | split(",")) end)
  | map(tostring | gsub("^\\s+|\\s+$"; ""))
  | map(select(length > 0))
  | unique')
WANTED=$(echo "$REQUESTED" | jq 'length')

if [ "$WANTED" -gt 0 ]; then
  while IFS= read -r USER_ID; do
    _validate_slack_id "$USER_ID" "users"
  done < <(echo "$REQUESTED" | jq -r '.[]')
fi

USERS="[]"
NEXT_CURSOR="$CURSOR"
PAGES=0

while : ; do
  API_PARAMS="limit=${LIMIT}"
  if [ -n "$NEXT_CURSOR" ]; then
    API_PARAMS="${API_PARAMS}&cursor=${NEXT_CURSOR}"
  fi

  RESULT=$(_slack_api "users.list" "$API_PARAMS")
  PAGES=$((PAGES + 1))

  # Every field degrades to a default: a member missing a profile, a name, or the flags
  # yields empty strings and false rather than aborting the whole page.
  PAGE_USERS=$(echo "$RESULT" | jq -c --argjson want "$REQUESTED" '
    ($want | map({key: ., value: true}) | from_entries) as $set
    | [ .members[]?
        | select(($want | length) == 0 or ($set[.id // ""] // false))
        | {
            id:           (.id // ""),
            name:         (.name // ""),
            real_name:    (.real_name // .profile.real_name // ""),
            display_name: (.profile.display_name // ""),
            is_bot:       (.is_bot // false),
            deleted:      (.deleted // false)
          } ]')

  USERS=$(jq -nc --argjson acc "$USERS" --argjson page "$PAGE_USERS" '$acc + $page')
  NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')

  if [ -z "$NEXT_CURSOR" ]; then
    break
  fi
  # Unfiltered: one page per call, the caller pages with nextCursor.
  if [ "$WANTED" -eq 0 ]; then
    break
  fi
  if [ "$(echo "$USERS" | jq 'length')" -ge "$WANTED" ]; then
    break
  fi
  if [ "$PAGES" -ge "$MAX_PAGES" ]; then
    break
  fi
done

jq -nc \
  --argjson users "$USERS" \
  --arg nextCursor "$NEXT_CURSOR" \
  --argjson pages "$PAGES" \
  '{users: $users, count: ($users | length), nextCursor: $nextCursor, hasMore: ($nextCursor != ""), pages: $pages}'
