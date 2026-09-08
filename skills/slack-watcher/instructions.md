# Slack Watcher

A use-case skill. It monitors configured Slack channels for messages that contain actionable items
and creates Flock tasks for each one. It runs on a schedule (every 30 minutes) and on new-message
events from the Slack connector.

## What this skill owns

- **Routine:** `watch-channels` — fires on slack_message events from the Slack connector. Scans
  messages from watched channels, identifies actionable items, and creates Flock tasks.
  - `channels` (multi-select): which Slack channels to monitor (populated dynamically from the connector)
  - `ignoreBots` (default on): skip messages from bots and integrations
  - `keywords` (text, optional): comma-separated keyword filter — only surface messages containing at least one keyword

## What it depends on

- **Connector:** `slack` (required) — the data source it reads messages from.

## How it behaves

1. Reads new messages from watched channels since the last poll.
2. Filters out bot messages if `ignoreBots` is enabled.
3. Applies keyword filter if configured — skips messages that don't contain any of the keywords.
4. For each message that passes filters, analyzes the content for actionable items:
   - Tasks or action items ("can you do X", "please handle", "TODO")
   - Follow-ups ("let's circle back", "following up on")
   - Reminders ("don't forget", "reminder:")
   - Decisions that need tracking ("we decided to", "going with")
   - Learnings worth capturing ("TIL", "lesson learned", "good to know")
5. Creates a Flock task for each actionable item via POST /api/tasks with:
   - `title`: concise description of the action
   - `body`: context from the Slack message — who said what, which channel, thread link if available
   - `sourceKind`: "app"
   - `sourceApp`: "slack-watcher"
   - `sourceRef`: unique dedup ref in format `{channel_id}:{message_ts}`
   - `priority`: based on urgency signals (deadlines, escalation language, mentions)
6. Skips noise — status updates, casual chat, emoji reactions, already-resolved items, simple acknowledgments.
7. Never creates duplicate tasks — uses `sourceRef` for deduplication.
8. Collapses thread activity into one task per thread; doesn't create separate tasks for each reply.
