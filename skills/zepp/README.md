# Zepp

Zepp / Amazfit watch data for Flock through a stdio MCP server in `server/`: a dependency-free JavaScript port of [zepp-mcp](https://github.com/DhavalBhimani44/zepp-mcp) (MIT, commit 9ba4f58). One skill, one account per person; each agent picks its account.

## Setup

Nothing to install: Flock runs the server with its bundled Node (`npx`), from the `zepp-server-v<version>` tag, a tag whose tree is just `server/`. Add an account per person with:
`ZEPP_EMAIL`, `ZEPP_PASSWORD` and optional `ZEPP_COUNTRY`. Tokens are cached per account under `~/.zepp-mcp/<email hash>/`.

## Tools

`zepp_daily_summary`, `zepp_heart_rate`, `zepp_sleep`, `zepp_list_workouts`, `zepp_workout_detail`, `zepp_body_composition`, `zepp_training_thresholds`, `zepp_describe_schema`, `zepp_raw_request`, `zepp_auth_status`.

## Releasing the server

The connector runs the tarball of the `zepp-server-v<version>` tag, not the skill's own tag, so npm needs no git. Cut it from the server folder and bump the URL in `flock.skill.json`:

```bash
git tag zepp-server-v1.0.0 "$(git commit-tree "$(git rev-parse HEAD:skills/zepp/server)" -m "zepp-mcp 1.0.0")"
```
