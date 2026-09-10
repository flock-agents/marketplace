#!/bin/bash
# saved_clear_completed.sh — bulk clear all completed saved/Later items.
set -euo pipefail
source "$(dirname "$0")/_slack_helpers.sh"

RESULT=$(_slack_api "saved.clearCompleted" "")

echo "$RESULT" | jq -c '{
  ok:      .ok,
  cleared: (.cleared_count // null)
}'
