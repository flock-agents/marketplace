#!/bin/bash
set -euo pipefail

LINEAR_API="https://api.linear.app/graphql"
RATE_FILE="/tmp/skill-linear-rate"

rate_limit() {
  local now last diff
  now=$(date +%s)
  last=$(cat "$RATE_FILE" 2>/dev/null || echo 0)
  diff=$((now - last))
  if [ "$diff" -lt 1 ]; then
    sleep 1
  fi
  echo "$now" > "$RATE_FILE"
}

error_json() {
  local code="$1" msg="$2"
  printf '{"error":true,"code":"%s","message":"%s"}\n' "$code" "$msg"
  exit 1
}

graphql() {
  local query="$1" variables="${2:-{}}"
  local token="${LINEAR_API_KEY:-${ACCESS_TOKEN:-}}"
  if [ -z "$token" ]; then
    error_json "NO_TOKEN" "LINEAR_API_KEY env var is required."
  fi

  rate_limit
  local data
  data=$(jq -n --arg query "$query" --argjson variables "$variables" '{query: $query, variables: $variables}')

  local response http_code
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: ${token}" \
    -H "Content-Type: application/json" \
    -d "$data" "$LINEAR_API")
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -ge 400 ]; then
    local err_msg
    err_msg=$(echo "$body" | jq -r '.errors[0].message // "API error"' 2>/dev/null || echo "HTTP $http_code")
    error_json "API_ERROR_${http_code}" "$err_msg"
  fi

  local errors
  errors=$(echo "$body" | jq -r '.errors[0].message // empty' 2>/dev/null)
  if [ -n "$errors" ]; then
    error_json "GRAPHQL_ERROR" "$errors"
  fi

  echo "$body" | jq '.data'
}

cmd_my_issues() {
  local status_filter="${1:-}"

  local query='query($filter: IssueFilter) { viewer { assignedIssues(first: 50, filter: $filter, orderBy: updatedAt) { nodes { id identifier title state { name type } priority priorityLabel project { name } dueDate url } } } }'
  local variables='{}'
  if [ -n "$status_filter" ]; then
    variables=$(jq -n --arg s "$status_filter" '{filter: {state: {type: {eq: $s}}}}')
  fi
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '{
    issues: [.viewer.assignedIssues.nodes[] | {
      id: .id,
      identifier: .identifier,
      title: .title,
      status: .state.name,
      statusType: .state.type,
      priority: .priorityLabel,
      project: .project.name,
      dueDate: .dueDate,
      url: .url
    }],
    count: (.viewer.assignedIssues.nodes | length)
  }'
}

cmd_search() {
  local query_text="$1"
  local query='query($q: String!) { issueSearch(query: $q, first: 30) { nodes { id identifier title state { name } priority priorityLabel assignee { name } url } } }'
  local variables
  variables=$(jq -n --arg q "$query_text" '{q: $q}')
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '{
    issues: [.issueSearch.nodes[] | {
      id: .id,
      identifier: .identifier,
      title: .title,
      status: .state.name,
      priority: .priorityLabel,
      assignee: .assignee.name,
      url: .url
    }],
    count: (.issueSearch.nodes | length)
  }'
}

cmd_create() {
  local team_id="$1" title="$2"
  local description="${3:-}"
  local priority="${4:-0}"
  local assignee_id="${5:-}"

  local variables
  variables=$(jq -n \
    --arg teamId "$team_id" \
    --arg title "$title" \
    --arg description "$description" \
    --argjson priority "$priority" \
    '{teamId: $teamId, title: $title, description: $description, priority: $priority}')

  if [ -n "$assignee_id" ]; then
    variables=$(echo "$variables" | jq --arg aid "$assignee_id" '. + {assigneeId: $aid}')
  fi

  local query='mutation($teamId: String!, $title: String!, $description: String, $priority: Int, $assigneeId: String) { issueCreate(input: {teamId: $teamId, title: $title, description: $description, priority: $priority, assigneeId: $assigneeId}) { success issue { id identifier title url } } }'
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '.issueCreate.issue | {id, identifier, title, url}'
}

cmd_update() {
  local issue_id="$1" field="$2" value="$3"

  local input_field
  case "$field" in
    title) input_field="title" ;;
    description) input_field="description" ;;
    priority) input_field="priority" ;;
    assignee) input_field="assigneeId" ;;
    dueDate) input_field="dueDate" ;;
    status) input_field="stateId" ;;
    *) error_json "INVALID_FIELD" "Supported fields: title, description, status, priority, assignee, dueDate" ;;
  esac

  local input_json
  if [ "$field" = "priority" ]; then
    input_json=$(jq -n --arg f "$input_field" --argjson v "$value" '{($f): $v}')
  else
    input_json=$(jq -n --arg f "$input_field" --arg v "$value" '{($f): $v}')
  fi

  local query='mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title state { name } url } } }'
  local variables
  variables=$(jq -n --arg id "$issue_id" --argjson input "$input_json" '{id: $id, input: $input}')
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '.issueUpdate.issue | {id, identifier, title, status: .state.name, url}'
}

cmd_view() {
  local issue_id="$1"
  local query='query($id: String!) { issue(id: $id) { id identifier title description state { name type } priority priorityLabel assignee { name email } project { name } team { name } dueDate createdAt updatedAt url comments { nodes { body user { name } createdAt } } } }'
  local variables
  variables=$(jq -n --arg id "$issue_id" '{id: $id}')
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '.issue | {
    id, identifier, title, description,
    status: .state.name, statusType: .state.type,
    priority: .priorityLabel,
    assignee: .assignee,
    project: .project.name,
    team: .team.name,
    dueDate, createdAt, updatedAt, url,
    comments: [.comments.nodes[] | {body, author: .user.name, createdAt}]
  }'
}

cmd_teams() {
  local query='query { teams { nodes { id name key description } } }'
  local result
  result=$(graphql "$query")
  echo "$result" | jq '{teams: .teams.nodes, count: (.teams.nodes | length)}'
}

cmd_cycles() {
  local team_id="$1"
  local query='query($teamId: String!) { team(id: $teamId) { cycles(first: 5, orderBy: createdAt) { nodes { id number name startsAt endsAt completedAt progress { completed total } } } } }'
  local variables
  variables=$(jq -n --arg teamId "$team_id" '{teamId: $teamId}')
  local result
  result=$(graphql "$query" "$variables")

  echo "$result" | jq '{cycles: [.team.cycles.nodes[] | {id, number, name, startsAt, endsAt, completedAt, progress}], count: (.team.cycles.nodes | length)}'
}

# Main dispatch
COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  my-issues)
    cmd_my_issues "${1:-}"
    ;;
  search)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linear.sh search <query>"
    cmd_search "$1"
    ;;
  create)
    [ -z "${1:-}" ] || [ -z "${2:-}" ] && error_json "MISSING_ARG" "Usage: linear.sh create <teamId> <title> [description] [priority] [assigneeId]"
    cmd_create "$1" "$2" "${3:-}" "${4:-0}" "${5:-}"
    ;;
  update)
    [ -z "${1:-}" ] || [ -z "${2:-}" ] || [ -z "${3:-}" ] && error_json "MISSING_ARG" "Usage: linear.sh update <issueId> <field> <value>"
    cmd_update "$1" "$2" "$3"
    ;;
  view)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linear.sh view <issueId>"
    cmd_view "$1"
    ;;
  teams)
    cmd_teams
    ;;
  cycles)
    [ -z "${1:-}" ] && error_json "MISSING_ARG" "Usage: linear.sh cycles <teamId>"
    cmd_cycles "$1"
    ;;
  *)
    error_json "UNKNOWN_COMMAND" "Unknown command: $COMMAND. Available: my-issues, search, create, update, view, teams, cycles"
    ;;
esac
