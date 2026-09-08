---
name: Slack
description: Connect to your Slack workspace via browser session — search, read channels, and list users
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: slack
  setup_instructions: "Log into your Slack workspace (app.slack.com) via the dashboard browser session."
tier: installable
---

# Slack

Read messages, search conversations, and list users in a connected Slack workspace.

## Connection

Browser session only. The user logs into `app.slack.com` via the Flock dashboard. The connector extracts `xoxc` + `xoxd` tokens from the authenticated session and uses Slack's web API directly.

No bot tokens or OAuth app installs required — works on workspaces that restrict bot installs.

## Available Functions

All functions execute via the skill execution wrapper.

### extractTokens
Extract xoxc + xoxd tokens from the browser session and validate them. Params: `{}`

### checkTokenHealth
Verify stored tokens are still valid via auth.test. Params: `{}`

### listChannels
List visible channels (public, private, DMs, group DMs). Params: `{ limit?: number, cursor?: string, types?: string }`
- `types` defaults to `public_channel,private_channel,mpim,im`

### listMessages
Read message history for a channel. Params: `{ channel: string, limit?: number, cursor?: string, oldest?: string, latest?: string }`

### listThreadReplies
Get replies in a thread. Params: `{ channel: string, ts: string, limit?: number, cursor?: string }`

### searchMessages
Full-text search across the workspace. Params: `{ query: string, count?: number, page?: number, sort?: string }`
- `sort`: `score` (default) or `timestamp`

### getUserInfo
Get details for a single user. Params: `{ user: string }`

### listUsers
List workspace users. Params: `{ limit?: number, cursor?: string }`

## Usage

```bash
bash scripts/slack-exec.sh <functionName> '<paramsJson>'
```

Examples:
```bash
bash scripts/slack-exec.sh extractTokens '{}'
bash scripts/slack-exec.sh listChannels '{"limit": 20}'
bash scripts/slack-exec.sh listMessages '{"channel": "C01234ABCDE", "limit": 25}'
bash scripts/slack-exec.sh searchMessages '{"query": "deploy production"}'
bash scripts/slack-exec.sh listThreadReplies '{"channel": "C01234ABCDE", "ts": "1234567890.123456"}'
```

## Token Lifecycle

- Tokens are extracted once via `extractTokens` and reused for subsequent API calls
- Before each batch of operations, `checkTokenHealth` verifies validity
- On `invalid_auth`: automatic re-extraction via browser session is attempted
- If the browser session itself has expired: the user is notified to re-login via the Flock dashboard
- Enterprise Grid workspaces rotate tokens within hours — documented as limited support

## Rate Limits

Slack rate limits by API method tier:
- Tier 2 (~20/min): conversations.list, users.list, search.messages
- Tier 3 (~50/min): conversations.history, conversations.replies
- Tier 4 (~100/min): users.info, auth.test

The connector respects `Retry-After` headers on 429 responses and paginates naturally.

## Reconnection

If the Slack connector reports expired tokens:
- Guide the user to reconnect via **Skills & Integrations** in their Flock app
- The user needs to log in again to `app.slack.com` via the Flock dashboard browser session
