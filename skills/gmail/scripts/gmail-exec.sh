#!/bin/bash
# Gmail skill execution wrapper — routes through Flock server for security enforcement
set -euo pipefail

_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"

FUNCTION_NAME="${1:-}"
# Not "${2:-{}}": macOS's /bin/bash 3.2 expands that with a stray trailing brace,
# so every call WITH parameters produced `{"threadId":"…"}}` and jq refused it
# ("invalid JSON text passed to --argjson"). Seen live 2026-09-10: the agent's
# getThread calls all died here, and it went on to hand-roll a curl at the
# wrong port. Bash 5 parses the old form fine, which is why it hid so long.
PARAMS="${2:-}"
if [ -z "$PARAMS" ]; then PARAMS='{}'; fi

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

# X-Flock-Session-Id lets the platform derive WHICH MAILBOX this call is for.
# An agent's own calls carry no account, so with two inboxes bound to one agent
# they resolved primary-first -- a routine watching inbox B would wake the agent
# and the agent's reads and writes would land in inbox A, silently. The routine
# knows its account and owns this session, so the server can look it up rather
# than asking the model to pass one. Empty outside an agent session, which simply
# means no routine to derive from (the old behaviour).
curl -s -X POST "${FLOCK_API}/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FLOCK_AUTH_TOKEN:-}" \
  -H "X-Flock-Session-Id: ${FLOCK_SESSION_ID:-}" \
  -d "$BODY"
