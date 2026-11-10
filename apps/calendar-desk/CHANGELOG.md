# Changelog

## 2.0.4

- The plan_events and meeting_prep instructions make their calls with the api tool, the body a JSON object, not `flock-api` with a heredoc or a single-quoted string.
- The planning and prep instructions say what Flock knows (the `facts`, the guests) instead of describing memory.
