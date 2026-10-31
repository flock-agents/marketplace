# Zepp

Zepp / Amazfit watch data for Flock via [zepp-mcp](https://github.com/flock-agents/zepp-mcp) (stdio MCP, vendored in `server/` at commit 9ba4f58). One skill, one account per person; each agent picks its account.

## Setup

Requires `python3` with `uv` installed (`python3 -m pip install uv`). Add an account per person with:
`ZEPP_EMAIL`, `ZEPP_PASSWORD` and optional `ZEPP_COUNTRY`. Tokens are cached per account under `~/.zepp-mcp/<email hash>/`.

## Tools

`zepp_daily_summary`, `zepp_heart_rate`, `zepp_sleep`, `zepp_list_workouts`, `zepp_workout_detail`, `zepp_body_composition`, `zepp_training_thresholds`, `zepp_describe_schema`, `zepp_raw_request`, `zepp_auth_status`.
