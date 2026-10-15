#!/bin/bash
# channels_list.sh — the conversations this person can see, named the way Slack names them.
#
# Each row keeps Slack's raw `name` (callers match on it) and adds `label` ("#general",
# "🔒 finance", "Yogesh Kumar", "Yogesh, Anil, Priya") and `group` ("Channels",
# "Direct messages", "Group DMs") — see _channels_label.jq. A DM row carries no name of its own,
# only the other person's user id, which is what a routine's channel picker used to show.
#
# ALL PAGES BY DEFAULT. This read one page of 100 and stopped, so a larger workspace silently
# lost channels from the picker. Without `cursor` it now pages conversations.list up to
# max_pages; with `cursor` it returns that one page, as before, for a caller that pages itself.
#
# NAMES COST ONE users.list PASS, not a users.info per DM: every call is paced ~3s. The pass
# runs only when there is a DM or group DM to name, and stops as soon as every wanted id and
# handle has been seen.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"

LIMIT=$(echo "$PARAMS" | jq -r '((.limit // 200) | tonumber? // 200) | if . < 1 then 1 elif . > 1000 then 1000 else floor end')
MAX_PAGES=$(echo "$PARAMS" | jq -r '((.max_pages // 10) | tonumber? // 10) | if . < 1 then 1 elif . > 20 then 20 else floor end')
CURSOR=$(echo "$PARAMS" | jq -r '.cursor // ""')
TYPES=$(echo "$PARAMS" | jq -r '(.types // "public_channel,private_channel,mpim,im") | tostring | gsub("\\s"; "")')
SORT=$(echo "$PARAMS" | jq -r '.sort // ""')

if [ "$CURSOR" = "null" ]; then
  CURSOR=""
fi
# _slack_api_call splits its params on "&"; a cursor carrying one would smuggle in a param.
if [ -n "$CURSOR" ] && ! [[ "$CURSOR" =~ ^[A-Za-z0-9+/=_.:-]+$ ]]; then
  _error_json "INVALID_CURSOR" "cursor contains unexpected characters"
fi
if ! [[ "$TYPES" =~ ^[a-z_,]+$ ]]; then
  _error_json "INVALID_TYPES" "types must be a comma-separated list of conversation types"
fi

SINGLE_PAGE=false
[ -n "$CURSOR" ] && SINGLE_PAGE=true

# Pages accumulate in FILES, not shell variables handed to jq as arguments: a few thousand rows
# of channels and users passes macOS's argument-size limit.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/slack-channels.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

NEXT_CURSOR="$CURSOR"
PAGES=0
while : ; do
  API_PARAMS="types=${TYPES}&limit=${LIMIT}&exclude_archived=true"
  if [ -n "$NEXT_CURSOR" ]; then
    API_PARAMS="${API_PARAMS}&cursor=${NEXT_CURSOR}"
  fi
  RESULT=$(_slack_api "conversations.list" "$API_PARAMS")
  PAGES=$((PAGES + 1))
  echo "$RESULT" | jq -c '.channels // []' > "$WORK/conv-$PAGES.json"
  NEXT_CURSOR=$(echo "$RESULT" | jq -r '.response_metadata.next_cursor // ""')
  if [ -z "$NEXT_CURSOR" ] || [ "$SINGLE_PAGE" = true ] || [ "$PAGES" -ge "$MAX_PAGES" ]; then
    break
  fi
done
jq -s 'add // []' "$WORK"/conv-*.json > "$WORK/channels.json"

# --- names for DMs and group DMs ------------------------------------------------------------
echo "[]" > "$WORK/users.json"
SELF=""
NEEDS_NAMES=$(jq '[.[] | select(.is_im or .is_mpim)] | length' "$WORK/channels.json")
if [ "$NEEDS_NAMES" -gt 0 ]; then
  # Who "you" is: the self-DM gets "(you)" and a group DM leaves the owner out of its name.
  # Best effort — without it the labels are still names, just with the owner included.
  AUTH=$(_slack_api "auth.test" 2>/dev/null) || AUTH="{}"
  SELF=$(echo "$AUTH" | jq -r '.user_id // ""')
  SELF_HANDLE=$(echo "$AUTH" | jq -r '.user // ""')

  jq -c --arg me "$SELF_HANDLE" '{
    ids: ([.[] | select(.is_im) | .user // empty] | unique),
    handles: ([.[] | select(.is_mpim) | (.name // "") | sub("^mpdm-"; "") | sub("-[0-9]+$"; "")
               | split("--")[] | select(. != "" and . != $me)] | unique)
  }' "$WORK/channels.json" > "$WORK/wanted.json"

  U_CURSOR=""
  U_PAGES=0
  while : ; do
    U_PARAMS="limit=200"
    [ -n "$U_CURSOR" ] && U_PARAMS="${U_PARAMS}&cursor=${U_CURSOR}"
    # A names pass that fails leaves ids in the labels; it must not cost the whole list.
    U_RESULT=$(_slack_api "users.list" "$U_PARAMS" 2>/dev/null) || break
    U_PAGES=$((U_PAGES + 1))
    echo "$U_RESULT" | jq -c '[.members[]? | {
        id: (.id // ""), name: (.name // ""),
        real_name: (.real_name // .profile.real_name // ""),
        display_name: (.profile.display_name // "")
      }]' > "$WORK/users-$U_PAGES.json"
    jq -s 'add // []' "$WORK"/users-*.json > "$WORK/users.json"
    U_CURSOR=$(echo "$U_RESULT" | jq -r '.response_metadata.next_cursor // ""')
    [ -z "$U_CURSOR" ] && break
    [ "$U_PAGES" -ge "$MAX_PAGES" ] && break
    MISSING=$(jq -s '.[0] as $u | .[1] as $w
      | ($u | map({key: .id, value: true}) | from_entries) as $ids
      | ($u | map({key: .name, value: true}) | from_entries) as $hs
      | ([$w.ids[] | select($ids[.] | not)] + [$w.handles[] | select($hs[.] | not)]) | length' \
      "$WORK/users.json" "$WORK/wanted.json")
    [ "$MISSING" -eq 0 ] && break
  done
fi

CHANNELS_FILE="$WORK/labelled.json"
jq -s '{channels: .[0], users: .[1]}' "$WORK/channels.json" "$WORK/users.json" \
  | jq -c --arg self "$SELF" --arg sort "$SORT" -f "$(dirname "$0")/_channels_label.jq" > "$CHANNELS_FILE"

jq -c --arg nextCursor "$NEXT_CURSOR" --argjson pages "$PAGES" \
  '{channels: ., nextCursor: $nextCursor, hasMore: ($nextCursor != ""), pages: $pages}' "$CHANNELS_FILE"
