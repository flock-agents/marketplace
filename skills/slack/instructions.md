---
name: Slack
description: Full Slack workspace integration — read channels, search, post messages, manage saved items, reactions, and user groups
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: slack
  setup_instructions: "Log into your Slack workspace (app.slack.com) via the dashboard browser session."
tier: installable
---

# Slack

Full workspace integration via browser session authentication. Equivalent feature set to [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server).

## Connection

Browser session only. The user logs into `app.slack.com` via the Flock dashboard. API calls are made from within the browser session (relative `/api/...` fetch with `credentials: include`) so the httpOnly `d=` auth cookie is attached automatically.

No bot tokens or OAuth app installs required — works on workspaces that restrict bot installs.

> **Performance note:** Each API call takes ~10s via the browser session. Functions that make many calls (e.g. `conversations_unreads`) can take several minutes on large workspaces.

## Environment Flags (opt-in write operations)

Set these env vars to enable write/mutation actions:

| Env var | Controls |
|---------|---------|
| `SLACK_MCP_ADD_MESSAGE_TOOL=true` | `conversations_add_message` — post messages |
| `SLACK_MCP_MARK_TOOL=true` | `conversations_mark` — mark channels as read |
| `SLACK_MCP_REACTION_TOOL=true` | `reactions_add`, `reactions_remove` — emoji reactions |

## Available Functions

### Auth & Health

#### `extractTokens`
Extract xoxc tokens from the browser session and validate. Params: `{}`

#### `checkTokenHealth`
Verify stored tokens via auth.test. Params: `{}`

#### `getUserInfo`
Get details for a single user. Params: `{ user: string }`

---

### Channels

#### `channels_list`
List visible channels (public, private, DMs, group DMs).

Params:
- `limit` — number of channels (default 100)
- `cursor` — pagination cursor
- `types` — comma-separated: `public_channel,private_channel,mpim,im` (default: all)
- `sort` — `"name"` | `"members"` | `""` (default: API order)

Returns: `{ channels[], nextCursor, hasMore }`

---

### Messages

#### `conversations_history`
Read message history for a channel. Smart `limit` accepts time ranges or counts.

Params:
- `channel` — **required** channel ID (e.g. `C01234ABCDE`)
- `limit` — message count (number) OR time range: `"1d"`, `"7d"`, `"30d"`, `"2w"`, `"4h"` (default `25`)
- `cursor` — pagination cursor
- `oldest` — explicit Slack timestamp lower bound
- `latest` — explicit Slack timestamp upper bound

Returns: `{ channel, messages[], nextCursor, hasMore }`

#### `conversations_replies`
Get replies in a thread.

Params:
- `channel` — **required**
- `ts` — **required** thread parent timestamp
- `limit` — (default 50)
- `cursor` — pagination cursor

Returns: `{ channel, threadTs, messages[], nextCursor, hasMore }`

#### `conversations_search_messages`
Full-text search with rich filters.

Params:
- `query` — **required** base search query
- `count` — results per page (default 20)
- `page` — page number (default 1)
- `sort` — `"score"` (default) | `"timestamp"`
- `filter_in_channel` — channel name or ID (`#general` or `C123`)
- `filter_users_from` — comma-separated user IDs or names (`from:`)
- `filter_users_with` — comma-separated user IDs for DM search (`with:`)
- `filter_date_before` — `YYYY-MM-DD`
- `filter_date_after` — `YYYY-MM-DD`
- `filter_date_on` — `YYYY-MM-DD`
- `filter_date_during` — month name or `YYYY-MM` (e.g. `"september"`)
- `filter_threads_only` — bool, only threaded messages (default false)

Returns: `{ query, total, page, pages, matches[] }`

#### `conversations_add_message`
Post a message to a channel or thread. **Requires `SLACK_MCP_ADD_MESSAGE_TOOL=true`.**

Params:
- `channel_id` — **required**
- `payload` — **required** message text
- `thread_ts` — optional, post as reply to this thread
- `content_type` — `"text/plain"` (default) | `"text/markdown"`

Returns: `{ ok, channel, ts, message_id }`

#### `conversations_unreads`
Get unread messages across all channels. **Slow** — many sequential API calls.

Params:
- `channel_types` — `"all"` (default) | `"im"` | `"mpim"` | `"public"` | `"private"`
- `max_channels` — max channels to check (default 50)
- `max_messages_per_channel` — messages per unread channel (default 10)
- `mentions_only` — bool, only channels with @mentions (default false)
- `include_messages` — bool, fetch message content (default true)

Returns: `{ channel_types, unread_channels, channels[] }` — each channel has `messages[]`.

⚠️ Expect 1–5+ minutes on large workspaces.

#### `conversations_mark`
Mark a channel as read. **Requires `SLACK_MCP_MARK_TOOL=true`.**

Params:
- `channel_id` — **required**
- `ts` — timestamp to mark read up to (default: now)

Returns: `{ ok, channel, ts }`

---

### Reactions

#### `reactions_add`
Add an emoji reaction to a message. **Requires `SLACK_MCP_REACTION_TOOL=true`.**

Params:
- `channel_id` — **required**
- `timestamp` — **required** message timestamp
- `emoji` — **required** emoji name without colons (e.g. `"thumbsup"`)

Returns: `{ ok, channel, timestamp, emoji }`

#### `reactions_remove`
Remove an emoji reaction. **Requires `SLACK_MCP_REACTION_TOOL=true`.**

Same params as `reactions_add`. Returns: `{ ok, channel, timestamp, emoji }`

---

### Users

#### `users_search`
Search workspace users by name, display name, or email.

Params:
- `query` — **required** search string (case-insensitive substring match)
- `limit` — max results (default 10)
- `include_dm_channel` — bool, resolve DM channel ID for each user (default true; adds ~10s per user)

Returns: `{ query, count, users[] }` — each user has `dm_channel_id`.

---

### Saved / Later

#### `saved_list`
List saved/Later items and time-based reminders.

Params:
- `limit` — max saved items (default 20)
- `filter` — `"saved"` (pending, default) | `"completed"` | `"archived"`
- `include_messages` — bool, fetch linked message text (default false; adds API calls)
- `max_messages_per_item` — messages to fetch per item when `include_messages=true` (default 1)
- `include_completed` — bool, include completed reminders (default false)

Returns: `{ filter, counts, items[], total }`

#### `saved_update`
Update a saved/Later item (mark complete, set due date).

Params:
- `item_id` — **required**
- `mark` — `"completed"` | `"uncompleted"` (optional)
- `date_due` — unix timestamp or `0` to clear (optional)

Returns: `{ ok, item_id, state }`

#### `saved_clear_completed`
Bulk clear all completed saved/Later items. No params.

Returns: `{ ok, cleared }`

---

### User Groups

#### `usergroups_list`
List all user groups.

Params:
- `include_users` — bool, include member user IDs (default false)
- `include_count` — bool, include user count (default true)
- `include_disabled` — bool, include disabled groups (default false)

Returns: `{ usergroups[] }`

#### `usergroups_create`
Create a new user group.

Params:
- `name` — **required** display name
- `handle` — optional handle (slug)
- `description` — optional
- `channels` — optional comma-separated default channel IDs

Returns: `{ ok, usergroup }`

#### `usergroups_update`
Update an existing user group.

Params:
- `usergroup_id` — **required** (format: `S...`)
- `name`, `handle`, `description`, `channels` — optional fields to update

Returns: `{ ok, usergroup }`

#### `usergroups_users_update`
Set the full member list of a user group (replaces existing members).

Params:
- `usergroup_id` — **required**
- `users` — **required** comma-separated user IDs

Returns: `{ ok, usergroup, users[] }`

#### `usergroups_me`
Manage own group membership.

Params:
- `action` — **required**: `"list"` | `"join"` | `"leave"`
- `usergroup_id` — **required** for `join`/`leave`

Returns:
- `list`: `{ user_id, usergroups[] }`
- `join`/`leave`: `{ ok, action, usergroup_id, user_id, members[] }`

---

## Token Lifecycle

- Tokens are extracted once via `extractTokens` and cached (4h TTL)
- On `invalid_auth`: automatic re-extraction via browser session
- Session expiry: user is notified to re-login via the Flock dashboard

## Rate Limits

Slack rate limits by tier:
- Tier 2 (~20/min): `conversations.list`, `users.list`, `search.messages`
- Tier 3 (~50/min): `conversations.history`, `conversations.replies`
- Tier 4 (~100/min): `users.info`, `auth.test`

The connector applies a minimum delay between calls to stay within limits.

## Reconnection

If the Slack connector reports expired tokens:
- Direct the user to **Skills & Integrations** in their Flock app
- They need to log in again to `app.slack.com` via the Flock dashboard browser session
