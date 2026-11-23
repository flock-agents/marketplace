# Changelog

## 1.0.1

- Functions run with the run_skill tool, not `sheets-exec.sh` or `POST /api/internal/skill-exec`.
- Work done in the browser uses the browser tool on the Google sign-in (`open` with its `session` and the url, then `act` on its `persistentSessionId`), not the `authenticated-crawl` skill.
