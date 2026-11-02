# zepp-mcp (JavaScript port)

An MCP stdio server exposing Zepp/Amazfit health and workout data.

Ported to dependency-free JavaScript (Node >= 20, ESM) from
https://github.com/DhavalBhimani44/zepp-mcp at commit 9ba4f58 (MIT, see LICENSE).
Tool names, input schemas and output JSON match the Python server so either
can back the same connector. The Python sources (`zepp_mcp/`,
`pyproject.toml`, `uv.lock`) are kept as the reference.

## Run

```sh
npx -y github:flock-agents/marketplace#<tag>   # the tag's tree is this folder
node bin/zepp-mcp.js                           # from a checkout
```

No `npm install` step: the package has no dependencies.

## Configuration

| Variable | Meaning |
| --- | --- |
| `ZEPP_EMAIL`, `ZEPP_PASSWORD` | Zepp account login (required) |
| `ZEPP_COUNTRY` | Account country code, default `US` |
| `ZEPP_TOKEN_CACHE` | Token cache file path |

Variables can also live in a `.env` beside `package.json`; real environment
variables win. Without `ZEPP_TOKEN_CACHE`, the token cache defaults to
`~/.zepp-mcp/<sha256(lowercased ZEPP_EMAIL)[:16]>/token.json` (device_id
beside it), so accounts never share a cache. Only the API token is cached;
no health data is written to disk.

## Tools

`zepp_daily_summary`, `zepp_heart_rate`, `zepp_sleep`, `zepp_list_workouts`,
`zepp_workout_detail`, `zepp_body_composition`, `zepp_training_thresholds`,
`zepp_describe_schema`, `zepp_raw_request`, `zepp_auth_status`.

## Layout

- `bin/zepp-mcp.js` -- entry point
- `src/mcp-stdio.js` -- minimal MCP JSON-RPC stdio transport
- `src/server.js` -- tool definitions
- `src/client.js`, `src/auth.js` -- Zepp API client and login
- `src/decode.js`, `src/workouts.js`, `src/body.js`, `src/codes.js` -- payload decoding

## Test

```sh
npm test
```
