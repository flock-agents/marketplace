---
name: linear
description: Create/update issues, list assigned work, track cycles, and search in Linear
tags: [productivity, linear, project-management]
category: integration
requiresInstance: true
auth:
  type: api_key
  keys: [LINEAR_API_KEY]
  setup_instructions: "I'll need a Linear API key to manage your issues, track cycles, and search your workspace."
---

# Linear

Create, update, and search issues in Linear. Track assigned work, manage cycles, and query project status.

## When to use

- User asks about their Linear issues or assigned work
- User wants to create a new issue
- User needs to update issue status
- User references a Linear project or cycle
- User asks "what's on my plate" (work tracking context)

## Authentication

This skill requires a Linear API key (personal or workspace). Invoke via skill-exec:

```bash
curl -s -X POST http://localhost:35625/api/internal/skill-exec \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "linear",
    "scriptName": "linear.sh",
    "args": ["<command>", ...args],
    "agentId": "'"$FLOCK_AGENT_ID"'"
  }'
```

## Commands

### my-issues
List issues assigned to the authenticated user.

    linear.sh my-issues [status]

Status filter: backlog, todo, in_progress, done, canceled (optional).
Returns: `{issues: [{id, identifier, title, status, priority, project, dueDate}], count: N}`

### search
Search issues by text.

    linear.sh search "<query>"

### create
Create a new issue.

    linear.sh create <teamId> <title> [description] [priority] [assigneeId]

Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.
Returns: `{id, identifier, title, url}`

### update
Update an issue field.

    linear.sh update <issueId> <field> <value>

Fields: title, description, status, priority, assignee, dueDate.

### view
Get full details of an issue.

    linear.sh view <issueId>

### teams
List all teams in the workspace.

    linear.sh teams

### cycles
List current and upcoming cycles for a team.

    linear.sh cycles <teamId>

## Safety Rules

- Creating issues is safe when user requests it
- Never delete or archive issues without confirmation
- Status changes should be confirmed for issues assigned to others
- Search and read operations are always safe

## Response Format

All responses are JSON. Errors follow:
```json
{"error": true, "code": "ERROR_CODE", "message": "Human-readable description"}
```

## Limitations

- Linear API uses GraphQL — rate limited to 1500 requests/hour
- Results limited to 50 items per query
- Attachments and comments not yet supported
- Rate limited to 1 request per second locally
