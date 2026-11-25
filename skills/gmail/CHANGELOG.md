# Changelog

## 1.6.9

Needs Flock 0.25.0-beta.2: the scripts use `persistentStep` from Flock's shared Google helpers.

- `getEmail` reads through Gmail's print view first (body, date and snippet from the newest message, as before), falling back to the conversation view when the print view is missing, empty or slow (15s).
- Views switch inside the already loaded Gmail app instead of full page reloads. A switch counts only once the old view has left the screen, else it does a full load; one slow page no longer turns in-app switching off for the session.
- `checkEngagedDomains` counts only on-screen rows and the empty-state copy.
- Draft save, the first draft list page, `getDraft` and send keep their full page loads and checks.

## 1.6.8

- `createReplyDraft` takes five browser calls, not eleven: the unread probe's page load is the only one (the thread opens in the same call), the mode settle and editor wait are one call, and typing, "Draft saved" and the body read-back are one. No fixed sleep after the click-away: the first #drafts check polls for the draft's own row.
- While the compose is open it reads the reply's own To/Cc/Bcc and the newest message's id, sender and time, returned as `reply` and `newestMessage` (each only when read whole), so a caller can skip a thread read after the write.

## 1.6.7

- `getVoice`, `getReplyContext`, `shouldTrigger` and `storeThreadBody` are removed: reply context and voice live in the Email Desk app, which reads the thread itself.
## 1.6.6

- Gmail connects only through the Google sign-in: the IMAP (app password) connection, the `imap+browser` auth type and the imap/smtp hosts leave the manifest, `gmail-imap.py` is removed, and the instructions no longer mention IMAP.
- Page scripts never click, focus or type: compose, reply, draft update and send, labels, archive, star, unread and thread reads only find and mark their element (`data-flock-target`), and Flock's own click, type and press actions do the input. Which element is found, the waits, error codes and JSON outputs are unchanged.
- A body with a table is pasted into the compose as rich text (a real paste, Flock 0.24.0) instead of written by a page script.
- The unused shell scripts (`applyLabel.sh`, `archiveMessage.sh`, `createDraft.sh`, `createLabel.sh`, `getEmail.sh`, `listInbox.sh`, `listLabels.sh`, `markRead.sh`, `markUnread.sh`, `replyToMessage.sh`, `searchEmails.sh`, `sendEmail.sh`, `starMessage.sh`, `_gmail_helpers.sh`) are removed; the `.ts` scripts were always the ones that ran.

## 1.6.5

- Functions run with the run_skill tool, not `gmail-exec.sh` or `POST /api/internal/skill-exec`; the browser fallback is the browser tool, and a reconnect is a connector hand-off (the connector-handoff guide). Carries Flock's bundled 1.6.4 send wording: a reply whose words the owner gave is sent; one without them is shown first.
- The browser fallback picks the Gmail sign-in from the browser tool's `list` and works in it with `open` (`session`), `act`, `read` and `close` on its `persistentSessionId`; a by-hand attachment download does the same, not the `authenticated-crawl` skill. A reconnect is a connector hand-off (the connector-handoff guide).
- `getVoice` and `getReplyContext` run outside Flock say to call them with the run_skill tool, not `gmail-exec.sh`.
