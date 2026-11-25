# Changelog

## 1.0.0

Needs Flock 0.24.0: the scripts click and type with Flock's real input (`_shared/_realInput`).

- `list-chats`, `read-chat`, `search` and `send-message` on WhatsApp Web, through the WhatsApp sign-in in Flock's browser.
- Limits kept in the skill's data folder across runs, per Flock: WhatsApp Web opened at most 10 times an hour and 60 a day (every function, sends too), open at most 30 minutes a day in the Flock's timezone (UTC when it has none; each result says `minutesLeftToday`), and at most 5 sends an hour and 20 a day. A send goes to one chat already in the chat list, and only after the open chat's own name matches.
- Sign-in with the browser tool: `sign_in` sends the person's number, the agent reads WhatsApp's 8-character link code off the page and gives it to them in their own chat (never asks them for one), then records the link with `signed_in` (kind `handoff`) on a freshly opened window. A fresh link code comes from a new window with `sign_in` and the page's `url`; a QR code, when they ask, through `hand_to_owner` after going back to the QR screen.
