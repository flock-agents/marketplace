#!/bin/bash
# saved_update.sh — update a saved/Later item (mark complete, set due date).
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
ITEM_ID=$(echo "$PARAMS" | jq -r '.item_id // ""')
MARK=$(echo "$PARAMS" | jq -r '.mark // ""')
DATE_DUE=$(echo "$PARAMS" | jq -r '.date_due // ""')

_validate_param "$ITEM_ID" "item_id"

API_PARAMS="item_id=${ITEM_ID}"

if [ -n "$MARK" ] && [ "$MARK" != "null" ]; then
  case "$MARK" in
    completed|uncompleted) ;;
    *) _error_json "INVALID_PARAM" "mark must be 'completed' or 'uncompleted'" ;;
  esac
  API_PARAMS="${API_PARAMS}&mark=${MARK}"
fi

if [ -n "$DATE_DUE" ] && [ "$DATE_DUE" != "null" ]; then
  API_PARAMS="${API_PARAMS}&date_due=${DATE_DUE}"
fi

RESULT=$(_slack_api "saved.update" "$API_PARAMS")

echo "$RESULT" | jq -c '{
  ok:      .ok,
  item_id: .item_id,
  state:   (.todo_state // null)
}'
