# Linear

Create, update, and search issues in Linear. Track assigned work, manage cycles, and query project status.

## Commands

| Command | Description |
|---------|-------------|
| `my-issues [status]` | List issues assigned to you (optional status filter) |
| `search <query>` | Search issues by text |
| `create <teamId> <title> [desc] [priority] [assigneeId]` | Create a new issue |
| `update <issueId> <field> <value>` | Update an issue field |
| `view <issueId>` | Get full issue details with comments |
| `teams` | List all teams in the workspace |
| `cycles <teamId>` | List current and upcoming cycles |

## Authentication

Requires a Linear API key (personal or workspace). The key is provided via the `LINEAR_API_KEY` environment variable, configured through Flock's Accounts & Sessions settings.

## Limitations

- Rate limited to 1500 requests/hour (Linear API) and 1 request/second locally
- Results limited to 50 items per query
- Attachments and comments on create/update not yet supported
