# Slack memory

The use case that owns [Slack Desk](../../apps/slack-desk). Installing this skill installs the
whole thing: the Slack connector it depends on, the app, and the app's daily routine.

```
slack-memory (skill)
├── connectorDeps: slack     ← the credential and the API surface
└── apps: slack-desk         ← the process that does the reading and remembering
```

The skill itself carries no routines and no prompt — it is `deterministic`. The daily routine is
declared by the app (`schedule` + `app-relay`) and wakes no agent; the app reads Slack, extracts
memory, and publishes tasks through the platform SDK. That is the whole use case.

Install it from the marketplace, or get it with the **Slack Assistant** template, which pairs it
with an agent and walks you through connecting Slack.
