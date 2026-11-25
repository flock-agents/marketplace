# Changelog

## 1.0.0

Needs Flock 0.24.0: the scripts click and type with Flock's real input (`_shared/_realInput`).

- `list-chats`, `read-chat`, `search` and `send-message` on WhatsApp Web, through the WhatsApp sign-in in Flock's browser.
- Limits kept in the skill's data folder across runs, per Flock: WhatsApp Web opened at most 10 times an hour and 60 a day (every function, sends too), open at most 30 minutes a day in the Flock's timezone (UTC when it has none; each result says `minutesLeftToday`), and at most 5 sends an hour and 20 a day. A send goes to one chat already in the chat list, and only after the open chat's own name matches.
- Sign-in with the browser tool: `sign_in` sends the person's number, the agent reads WhatsApp's 8-character code and gives it to them (never asks them for one), then records the link with `signed_in` (kind `handoff`) on a freshly opened window; a QR code through `hand_to_owner` when they ask.
