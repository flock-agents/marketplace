#!/bin/bash
# Slack skill execution wrapper — routes through Flock server for security enforcement
set -euo pipefail

# Self-contained: marketplace-installed skills have no ../../_shared/_helpers.sh
# (that only exists in the platform's bundled skills tree). We only need FLOCK_API.
FLOCK_API="${FLOCK_API_URL:-http://localhost:35625}"
if [[ ! "$FLOCK_API" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
  echo '{"error": "FLOCK_API_URL must be localhost"}' >&2
  exit 1
fi

FUNCTION_NAME="${1:-}"
# NOTE: do NOT write this as "${2:-{}}" — bash closes the ${...} at the first '}',
# so with $2='{}' it expands to '{}}' (invalid JSON) and breaks `jq --argjson`.
PARAMS="${2:-}"
[ -z "$PARAMS" ] && PARAMS='{}'

if [ -z "$FUNCTION_NAME" ]; then
  echo '{"error": "Function name required. Usage: slack-exec.sh <function> <params_json>"}' >&2
  exit 1
fi

BODY=$(jq -nc \
  --arg fn "$FUNCTION_NAME" \
  --arg iid "${SKILL_ACCOUNT_ID:-}" \
  --arg aid "${FLOCK_AGENT_ID:-}" \
  --argjson params "$PARAMS" \
  '{skillId: "slack", functionName: $fn, instanceId: $iid, agentId: $aid, params: $params}')

curl -s -X POST "${FLOCK_API}/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
  -d "$BODY"
