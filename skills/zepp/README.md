# Zepp

Zepp / Amazfit watch data for Flock via [zepp-mcp](https://github.com/flock-agents/zepp-mcp) (stdio MCP, pinned commit). One skill, one account per person; each agent picks its account.

## Setup

Requires `python3` with `uv` installed (`python3 -m pip install uv`). Add an account per person with:
`ZEPP_EMAIL`, `ZEPP_PASSWORD`, optional `ZEPP_COUNTRY`, and a `ZEPP_TOKEN_CACHE` path unique to that account.

## Tools

`zepp_daily_summary`, `zepp_heart_rate`, `zepp_sleep`, `zepp_list_workouts`, `zepp_workout_detail`, `zepp_body_composition`, `zepp_training_thresholds`, `zepp_describe_schema`, `zepp_raw_request`, `zepp_auth_status`.
