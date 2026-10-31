# Changelog

## 1.0.1

- The MCP server is installed straight from this repo's release tag (`uv tool run --from git+https://github.com/flock-agents/marketplace@zepp-v1.0.1#subdirectory=skills/zepp/server zepp-mcp`): no `${SKILL_DIR}` support needed in Flock. `ZEPP_EMAIL` is now marked sensitive.

## 1.0.0

- First release: Zepp / Amazfit daily activity, workouts, sleep, heart rate, body composition and PAI, via the vendored `zepp-mcp` server.
