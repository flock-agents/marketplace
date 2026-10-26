# zepp-mcp (vendored)

Vendored from https://github.com/flock-agents/zepp-mcp at commit 9ba4f58 (MIT, see LICENSE).
Only `zepp_mcp/`, `pyproject.toml` and `uv.lock` are kept; tests, spike, tools, docs and examples are omitted.

Local change: without `ZEPP_TOKEN_CACHE`, the token cache defaults to
`~/.zepp-mcp/<sha256(lowercased ZEPP_EMAIL)[:16]>/token.json` (device_id beside it), so accounts never share a cache.
