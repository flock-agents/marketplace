# Changelog

## 1.0.0

Needs Flock 0.24.0: the scripts click and type with Flock's real input (`_shared/_realInput`).

- `list-chats`, `read-chat`, `search` and `send-message` on WhatsApp Web, through the WhatsApp sign-in in Flock's browser.
- Limits kept in the skill's data folder across runs: WhatsApp Web is loaded at most 20 times an hour and 100 a day, the same chat once every 10 minutes (a kept read comes back instead); at most 5 sends an hour and 20 a day, a minute apart, one chat per send, never the same text to a second chat within 24 hours, and only to chats already in the chat list.
- Sign-in: the agent links WhatsApp with a code the person types on their phone, or hands them the QR code when they ask.
