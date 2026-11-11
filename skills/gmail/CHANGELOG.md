# Changelog

## 1.6.5

- Functions run with the run_skill tool, not `gmail-exec.sh` or `POST /api/internal/skill-exec`; the browser fallback is the browser tool, and a reconnect is a connector hand-off (the connector-handoff guide). Carries Flock's bundled 1.6.4 send wording: a reply whose words the owner gave is sent; one without them is shown first.
- The browser fallback picks the Gmail sign-in from the browser tool's `list` and works in it with `open` (`session`), `act`, `read` and `close` on its `persistentSessionId`; a by-hand attachment download does the same, not the `authenticated-crawl` skill. A reconnect is a connector hand-off (the connector-handoff guide).
- `getVoice` and `getReplyContext` run outside Flock say to call them with the run_skill tool, not `gmail-exec.sh`.
