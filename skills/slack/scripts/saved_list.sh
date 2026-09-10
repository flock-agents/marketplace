#!/bin/bash
# saved_list.sh — list saved/Later items and time-based reminders.
# filter: "saved" (default, pending), "completed", "archived"
# include_messages: bool — fetch linked message text for each item
# max_messages_per_item: int — message fetch limit per item (default 1)
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
LIMIT=$(echo "$PARAMS" | jq -r '.limit // 20')
FILTER=$(echo "$PARAMS" | jq -r '.filter // "saved"')
INCLUDE_MESSAGES=$(echo "$PARAMS" | jq -r '.include_messages // false')
MAX_MSG=$(echo "$PARAMS" | jq -r '.max_messages_per_item // 1')
INCLUDE_COMPLETED=$(echo "$PARAMS" | jq -r '.include_completed // false')

# Validate filter
case "$FILTER" in
  saved|completed|archived) ;;
  *) _error_json "INVALID_PARAM" "filter must be one of: saved, completed, archived" ;;
esac

# ── Saved / Later items ───────────────────────────────────────────────────────
SAVED_API_PARAMS="limit=${LIMIT}"
[ "$FILTER" = "archived" ] && SAVED_API_PARAMS="${SAVED_API_PARAMS}&include_archived=true"

SAVED_RESULT=$(_slack_api "saved.list" "$SAVED_API_PARAMS")

# Apply filter logic to saved items
SAVED_ITEMS=$(echo "$SAVED_RESULT" | jq -c \
  --arg filter "$FILTER" \
  '[.saved_items[]? | {
    id:           .item_id,
    kind:         "later",
    item_type:    .item_type,
    state:        .todo_state,
    is_overdue:   (.date_due > 0 and .date_due < now),
    date_due:     (if .date_due   > 0 then (.date_due   | todate) else null end),
    date_created: (if .date_created > 0 then (.date_created | todate) else null end),
    completed:    (.date_completed > 0),
    archived:     (.is_archived // false),
    channel_id:   (.channel_id // null),
    message_ts:   (.message_ts // null),
    text: (
      [.description[]?.elements[]?.elements[]?
       | select(.type == "text") | .text]
      | join(" ")
    ),
    message_text: null
  } | select(
    if $filter == "saved"     then .completed == false and .archived == false
    elif $filter == "completed" then .completed == true
    elif $filter == "archived"  then .archived == true
    else true end
  )]')

SAVED_COUNTS=$(echo "$SAVED_RESULT" | jq -c '.counts // {}')

# ── Optionally fetch linked message text ─────────────────────────────────────
if [ "$INCLUDE_MESSAGES" = "true" ]; then
  ENRICHED="[]"
  while IFS= read -r ITEM; do
    CH=$(echo "$ITEM" | jq -r '.channel_id // ""')
    MSG_TS=$(echo "$ITEM" | jq -r '.message_ts // ""')
    MSG_TEXT="null"

    if [ -n "$CH" ] && [ "$CH" != "null" ] && [ -n "$MSG_TS" ] && [ "$MSG_TS" != "null" ]; then
      # Fetch messages around this timestamp
      HIST=$(_slack_api "conversations.history" \
        "channel=${CH}&latest=${MSG_TS}&limit=${MAX_MSG}&inclusive=true") || true
      MSG_TEXT=$(echo "$HIST" | jq -r '
        (.messages[]? | select(.ts == $ts) | .text) // (.messages[0]?.text) // null
      ' --arg ts "$MSG_TS" 2>/dev/null || echo "null")
      [ "$MSG_TEXT" = "null" ] && MSG_TEXT_JSON="null" || MSG_TEXT_JSON=$(echo "$MSG_TEXT" | jq -Rs '.')
    else
      MSG_TEXT_JSON="null"
    fi

    ITEM_UPDATED=$(echo "$ITEM" | jq -c --argjson t "${MSG_TEXT_JSON:-null}" '.message_text = $t')
    ENRICHED=$(echo "$ENRICHED" | jq -c --argjson i "$ITEM_UPDATED" '. + [$i]')
  done < <(echo "$SAVED_ITEMS" | jq -c '.[]')
  SAVED_ITEMS="$ENRICHED"
fi

# ── Time-based reminders (/remind) ───────────────────────────────────────────
REMINDERS_RESULT=$(_slack_api "reminders.list")

INCLUDE_COMPLETED_BOOL="false"
[ "$FILTER" = "completed" ] && INCLUDE_COMPLETED_BOOL="true"
[ "$INCLUDE_COMPLETED" = "true" ] && INCLUDE_COMPLETED_BOOL="true"

REMINDERS=$(echo "$REMINDERS_RESULT" | jq -c \
  --argjson inc "$INCLUDE_COMPLETED_BOOL" \
  '[.reminders[]? | {
    id:           .id,
    kind:         "reminder",
    item_type:    "reminder",
    state:        (if .complete then "done" else "to_do" end),
    is_overdue:   (.time > 0 and .time < now),
    date_due:     (if .time > 0 then (.time | todate) else null end),
    date_created: null,
    completed:    .complete,
    archived:     false,
    channel_id:   null,
    message_ts:   null,
    text:         .text,
    message_text: null
  } | select(if $inc then true else .completed == false end)]')

NOTE=""
if [ "$FILTER" = "completed" ]; then
  COMPLETED_COUNT=$(echo "$SAVED_COUNTS" | jq -r '.completed_count // 0')
  if [ "$COMPLETED_COUNT" -gt 0 ] && [ "$(echo "$SAVED_ITEMS" | jq 'length')" -eq 0 ]; then
    NOTE="Slack's API does not expose individual completed items — only the count is available."
  fi
fi

jq -nc \
  --argjson saved     "$SAVED_ITEMS" \
  --argjson reminders "$REMINDERS" \
  --argjson counts    "$SAVED_COUNTS" \
  --arg filter        "$FILTER" \
  --arg note          "$NOTE" \
  '{
    filter:    $filter,
    counts:    $counts,
    items:     ($saved + $reminders),
    total:     (($saved | length) + ($reminders | length))
  } + (if $note != "" then {note: $note} else {} end)'
