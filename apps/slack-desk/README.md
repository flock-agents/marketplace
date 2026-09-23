# Slack Desk

Reads the Slack conversations you chose, remembers what matters, and surfaces anything that
reads like a task you have not done. It never posts, replies, reacts, or marks anything read.

## What it is

A **companion app**: it runs in its own process, on its own port, with its own store. Flock
spawns it, and the two talk over two narrow seams:

| direction | how | what crosses |
|---|---|---|
| platform → app | HTTP `POST /lifecycle/initialize`, `/lifecycle/tick`, `GET /lifecycle/progress` | "start", "do a pass", "how far along are you" |
| app → platform | `@flock/app-sdk`'s `PlatformContext` | `progress.report`, `tasks.publish/withdraw`, `connectors.exec`, `memory.extract` |

Nothing else is shared. No Slack message ever lands in a platform table — the app keeps its own
SQLite file under `APP_DATA_DIR` and hands the platform only the extracted memory items.

## How it reads Slack

The app calls the Slack connector **itself**, through `platform.connectors.exec` (which the
platform serves at `POST /apps/:id/skill-exec`). The platform resolves the credential and
applies the per-account guard server-side, so the app never sees a token and cannot outrun the
rate limit. There is no platform-side poll feeding this app — one read, made by the thing that
needs it.

Two things worth knowing about the Slack API here:

- `conversations.history` returns **thread parents only**. A channel whose day happened inside
  one thread looks like a single message until `conversations.replies` is fetched for each
  parent with `reply_count > 0`. The harvest does this; skipping it loses almost everything.
- With no channels configured the app does not read everything — it reads what is already
  addressed to you: DMs, mentions and saved items.

## The routine

One routine, declared in `flock.app.json`: **Build memory from Slack**, a daily cron
(`0 5 * * *`) in `app-relay` mode. App-relay means the platform calls the app's `/lifecycle/tick`
and no agent is woken, so the routine costs nothing beyond the memory extraction itself. The
routine is the app's, not the agent's: it is always visible on the agent's routines page,
configurable and pausable there, but not deletable — deleting it would leave the app with no way
to run.

Its config: `channels` (multi-select, options fetched live from the connector), `ignoreBots`,
`lookbackHours`.

## Initialization

`POST /lifecycle/initialize` is fire-and-acknowledge: the app answers 202 immediately and does
the first backfill in the background, reporting rows through `progress.report`. It is idempotent
and decides from **its own records** whether it has already run — the platform keeps no cache of
the app's initialization state, so a platform restart never re-runs a finished backfill and
never shows stale progress.

## Layout

```
server/
  index.ts       createFlockApp — wires lifecycle + journal, listens on loopback only
  lifecycle.ts   initialize / tick / progress
  harvest.ts     the daily read: what counts, how threads group, what an extraction item is
  store.ts       slack-desk.db — messages, cursors, init_state, harvest_days
```

Everything that *decides* in `harvest.ts` takes its inputs as arguments, so it is testable
without a Slack or a platform.

## Building it

`bun install`. The `@flock/app-sdk` import is **supplied by the platform** at build time — its
correct version is whatever this Flock build speaks, so it is not fetched from a registry. That
is why it is declared as an *optional* peer dependency: `bun install` must not try to resolve it.
Working on this app outside Flock, you will not get a resolvable import until you copy an SDK
build into `node_modules/@flock/app-sdk` yourself.
