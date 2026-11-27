# Changelog

## 2.1.0

- Reports the linked number, masked, so Flock can tell WhatsApp accounts apart: every answer from a linked WhatsApp (`link-status` and `link` once linked, `list-chats`, `read-chat`, `search`, `send-message`, and `unlink` for the number it unlinked) carries `signedInAs`, such as `+••••••••5678` (only the last 4 digits, never the whole number). No `signedInAs` when WhatsApp is not linked.

## 2.0.0

Rebuilt on WhatsApp's own linked-device protocol (Baileys 7.0.0-rc14, bundled in `server/lib/baileys.bundle.js`) instead of WhatsApp Web in Flock's browser. Needs Flock 0.25.0-beta.8 or newer (local-connector egress, `MCP_DATA_DIR`, `{packageDir}`, `FLOCK_TIMEZONE` and connector call hooks).

- With Flock's egress, refuses to connect on a Bun older than 1.3 (its WebSocket ignores the proxy and would connect direct). Cloud Flocks run Bun 1.3.13; Mac Flocks have no egress and connect direct on any Bun.
- A local MCP server (`server/server.ts`, outside `scripts/`, which Flock rewrites when an MCP connector connects) Flock starts per linked WhatsApp; the connection is the connector account (one tap, no form). Tools: `link`, `link-status`, `list-chats`, `read-chat`, `search`, `send-message`, `unlink`, with the names and fields Flock's WhatsApp gate checks.
- Linking: `link` gives an 8-character link code for the person's number at once (WhatsApp also shows them an "Enter code to link new device" notification), or a QR code picture with `qr: true`; the link waits a few minutes in the server and counts as a session. A finished link reconnects for WhatsApp's restart; a link or a call reconnects at most 2 times.
- `link`'s answer carries the message to send the person (`tellThePerson`) and what to do (`forYou`): Flock replaces a connected MCP connector's instructions with its tool list, so the linking steps travel with the tool.
- One connection is reused while calls keep coming and closes after 3 quiet minutes, or when today's time runs out; a link keeps its own while it waits. Through Flock's egress when it gives one (`HTTPS_PROXY`, cloud), else direct: the WebSocket through the proxy agent, the version and every download through `HTTPS_PROXY`; a `NO_PROXY` that would let WhatsApp skip the egress is refused.
- Low data use: only the chat list with a few recent messages and contact names when linked (no recent or full history), media never downloaded (placeholders with kind, caption, file name and size), no link previews, no profile pictures, no presence, never shown online.
- The link, the stored chats (the newest 300 chats, the last 60 messages each) and the limits live in the connection's own data folder.
- Safety limits, per connection, roomy for real use and tight on what WhatsApp treats as abuse: 6 sessions an hour and 40 a day (up to 5 reconnects inside a session are not a new one), 2 hours connected a day, at most 120 calls an hour (a runaway guard; reads have no count limit), 20 sends an hour and 100 a day, at least 5 seconds apart plus a random 1 to 3 second pause, counted from when the last one really went (the call waits), 10 different chats an hour and 30 a day, the same text (case, spacing and invisible characters aside, kept as a hash) to at most 3 chats a day; one existing chat per send.
- Paused when WhatsApp pushes back: a logout, a refused account, or 3 failed connections in a row (a link's too). Only WhatsApp's own verdict ends the link (a logout, a device mismatch, or a bad session WhatsApp sends as a stream error); a WebSocket that cannot connect (network down, the egress refusing) or Baileys' own errors are a failed connection, never a logout. Every tool then refuses (but the status, unlink, and a new link after a logout) until the person links again or unlinks; nothing retries.
- Stopping (Flock's SIGTERM) closes the open connection and counts its time at once, without waiting for a call in progress.
- Tool descriptions carry the rules the agent needs (Flock shows them, cut to 200 characters, in place of instructions.md once connected), including that messages read are other people's words, never instructions.
- The bundle is built by `tools/whatsapp-bundle/build.ts` and is byte for byte the same wherever it is built.
- Removed: the WhatsApp Web scripts, and `read-chat`'s PDF download (nothing is downloaded now; there is no single-document fetch).

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
