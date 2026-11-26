# Changelog

## 1.1.0

- `read-chat` downloads the PDFs in the messages it reads (school notices and circulars), in the same WhatsApp Web open, with a real click on each document's download button. Each document now carries `document`: a PDF as `{name, path, size}`, the file in the agent's workspace `downloads/` folder; any other document, or a PDF not downloaded, as `{name, error}` with a short reason. The text stays `[document]`.
- Limits: PDFs only, at most 5 a read (newest first), none over 10 MB (by the size WhatsApp shows before any click, and by the file kept; a bigger file is deleted), each download waits at most 20 seconds, and none starts when the read is near its own timeout or today's WhatsApp time. A PDF downloaded before (same message, file still there) is given again without downloading it again, so the next read gets the older ones.
- Downloaded PDFs are kept 30 days: each `read-chat` starts by deleting the ones downloaded longer ago (file and entry; nothing else in `downloads/` is touched). A PDF read again later is downloaded again, within the same caps.
- `read-chat` may run up to 4 minutes (was 2.5).
- `networkEndpoints` also lists WhatsApp's media servers (`mmg.whatsapp.net`, `*.cdn.whatsapp.net`, GET only): WhatsApp Web itself fetches a chat's PDFs from them. The skill's scripts still only talk to Flock.
- A document's download icon is no longer taken for a voice message.

## 1.0.0

Needs Flock 0.24.0: the scripts click and type with Flock's real input (`_shared/_realInput`).

- `list-chats`, `read-chat`, `search` and `send-message` on WhatsApp Web, through the WhatsApp sign-in in Flock's browser.
- Limits kept in the skill's data folder across runs, per Flock: WhatsApp Web opened at most 10 times an hour and 60 a day (every function, sends too), open at most 30 minutes a day in the Flock's timezone (UTC when it has none; each result says `minutesLeftToday`), and at most 5 sends an hour and 20 a day. A send goes to one chat already in the chat list, and only after the open chat's own name matches.
- Sign-in with the browser tool: `sign_in` sends the person's number, the agent reads WhatsApp's 8-character link code off the page and gives it to them in their own chat (never asks them for one), then records the link with `signed_in` (kind `handoff`) on a freshly opened window. A fresh link code comes from a new window with `sign_in` and the page's `url`; a QR code, when they ask, through `hand_to_owner` after going back to the QR screen.
