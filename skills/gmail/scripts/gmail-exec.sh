#!/bin/bash
# Gmail skill execution wrapper — routes through Flock server for security enforcement
set -euo pipefail

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

FUNCTION_NAME="${1:-}"
PARAMS="${2:-{}}"

if [ -z "$FUNCTION_NAME" ]; then
  echo '{"error": "Function name required. Usage: gmail-exec.sh <function> <params_json>"}' >&2
  exit 1
fi

BODY=$(jq -nc \
  --arg fn "$FUNCTION_NAME" \
  --arg iid "${SKILL_ACCOUNT_ID:-}" \
  --arg aid "${FLOCK_AGENT_ID:-}" \
  --argjson params "$PARAMS" \
  '{skillId: "gmail", functionName: $fn, instanceId: $iid, agentId: $aid, params: $params}')

curl -s -X POST "${FLOCK_API}/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
  -d "$BODY"
