---
name: Gmail
description: Read, draft, search, and organize emails via Gmail (drafts only — this skill cannot send)
icon: 📧
category: integration
requiresInstance: true
auth:
  type: imap+browser
  session_name: google
  setup_instructions: "Connect via App Password (IMAP) or browser session login. IMAP: go to myaccount.google.com/apppasswords. Browser: log in to Gmail via the dashboard browser session."
tier: installable
---

# Gmail

You can read, search, draft, and organize emails using the connected Gmail account.

## This skill cannot send

There is no send function. `sendEmail`, `sendDraft` and `replyToMessage` are NOT
available — calling any of them fails with `invalid_function`. Every write this
skill can make is a DRAFT that the owner reviews and sends themselves. Do not go
looking for a way to send; there isn't one, and that is deliberate.

## Replying to a thread — read this before you draft

**The only correct call for a reply is `createReplyDraft`.** Not `createDraft`,
not `replyToMessage`.

The exact sequence, every time:

1. `getThread({ threadId })` — the whole thread with per-message recipients.
   Use this, NOT `getEmail`: `getEmail` returns one joined blob with no `to`/`cc`
   fields, so a reply built from it cannot address anyone correctly. Each message
   also carries `unsubscribeLink: true` when its body has an unsubscribe / opt-out
   / manage-preferences link — bulk mail, which the platform refuses to draft for.
   The thread carries `hasDraft: true` when an unsent draft is already open on it;
   the platform refuses to draft a second one.
2. Read the LAST message in `messages` — that is the one you are answering. Take
   its `from`, `to`, `cc` and `date`.
3. `createReplyDraft({ threadId, to, cc, subject, body, replyToMessageRef })`,
   exactly once for that thread.

Why it must be this function and not `createDraft`:

- `createDraft` starts a NEW standalone message. It does not thread, it does not
  carry the conversation's recipients, and the reply lands nowhere near the
  conversation it answers.
- Every protection the platform applies to replies is keyed on the
  `createReplyDraft` name: the To-only rule (never reply to mail the owner was
  merely cc'd on), one-draft-per-thread, the owner-edit guard (never overwrite
  what the owner typed into a draft), and replace-on-new-message. A reply
  written through `createDraft` silently bypasses all four.

If `getThread` returns `incomplete: true`, stop — its recipient list may already
be missing people, so there is no safe reply to compose from it.

## Connection Types

Two connection methods are supported. **Use browser session by default. Use IMAP only as fallback when no browser session is connected.**

1. **Browser Session** *(default)* — Full Gmail experience: rich compose, CC/BCC, attachments via upload, formatting. Log in to Gmail via the dashboard browser session.
2. **IMAP (App Password)** *(fallback)* — Direct protocol access, plain text only. Used automatically when no browser session is available. Requires a Google App Password (myaccount.google.com/apppasswords).

The skill checks for a browser session first. If no browser session is connected, it falls back to IMAP credentials.

## Available Functions

All functions execute via `POST /api/internal/skill-exec`. Use the skill execution wrapper script.

### listInbox
List recent emails from the inbox. Params: `{ maxResults?: number, query?: string }`

### getEmail
Get a single email's body by ID. Params: `{ messageId: string }`
Returns no recipient fields. **Do not use this to read a thread you intend to
reply to — use `getThread`**, which returns per-message `to`/`cc`.

### searchEmails
Search emails with Gmail query syntax. Params: `{ query: string, maxResults?: number }`

### listLabels
List all Gmail labels. Params: `{}`

### createLabel
Create a Gmail label. Params: `{ name: string }`

### applyLabel
Apply a label to a message. Params: `{ messageId: string, labelName: string }`

### archiveMessage
Archive a message (remove from INBOX). Params: `{ messageId: string }`

### starMessage
Star a message. Params: `{ messageId: string }`

## Drafting: which function to use

**Replying to an existing thread → `createReplyDraft`. Always.**
`createDraft` writes a NEW standalone message; it does not thread, it does not
carry the conversation's recipients, and it is not covered by any of the
protections below. Reaching for it to answer a thread produces a draft that
looks right in the Drafts list and is wrong in every way that matters.

`createReplyDraft` is the only drafting call that goes through the platform's
guards: the To-only rule (no replying to mail the owner was merely cc'd on),
one-draft-per-thread, the owner-edit guard (never overwrite what the owner
typed), and replace-on-new-message. Those guards are keyed on THIS function
name, so a draft written any other way silently bypasses all of them.

### createReplyDraft
Draft a threaded reply to an existing thread. **Use this for every reply.**
Params: `{ threadId: string, to: string, cc?: string, subject: string, body: string, replyToMessageRef?: string }`
- `threadId` — from a permalink's trailing `#inbox/<id>`, or `getThread`.
- `to` / `cc` — comma-separated. Computed from the triggering message's own
  To/Cc (see `getThread`), never guessed.
- `replyToMessageRef` — the triggering message's `date`, copied verbatim. This
  is how a retry of the same draft is told apart from a new message arriving on
  the thread. Omit it and a later message on the thread produces no reply.
Returns `{ draftId, threadId, bodyAsSaved, replyMode }`.

### createDraft
Create a NEW standalone draft — a message that starts its own thread. Not a
reply. Params: `{ to: string, subject: string, body: string, cc?: string, bcc?: string, attachments?: string | string[] }`
Attachments accepts a file path or array of file paths on the local filesystem.

### getThread
Read a whole thread with per-message recipients. **Use this, not `getEmail`,
whenever you need to reply**: `getEmail` returns one joined blob with no
recipient fields, so reply-all cannot be computed from it.
Params: `{ threadId: string, forceRefresh?: boolean, freshAfter?: number }`
- `forceRefresh` — bypass the connector's 20-minute thread cache (default false:
  a cached copy is served when one is fresh, and a live read then replaces it).
  `bypassCache` is an accepted alias.
- `freshAfter` — epoch ms; serve a cached copy only if it was read at or after
  this instant (for a caller that knows a message arrived at time T).
Returns `{ threadId, subject, messages: [{ from, to, cc, date, body, recipientsVerified }], incomplete, reason }`,
oldest message first. The LAST message is the triggering one. `incomplete: true`
means the scrape was partial — do not compute recipients from it. A copy served
from cache carries `fromCache: true` and `cachedAt` (epoch ms).

### getDraft
Read a draft's current body. Params: `{ draftId: string }` → `{ draftId, body, threadId }`.
`body: null` means the draft no longer exists.

### updateDraft
Replace a draft's body. Params: `{ draftId: string, body: string }`. Refuses if
the owner has edited the draft since it was written.

### discardDraft
Delete a draft. Params: `{ draftId: string }`. Confirms the draft is actually
gone before reporting success.

### findDraftForThread
Find the draft for a thread when its id was not captured. Params: `{ threadId: string }` → `{ threadId, draftId }`.

### storeThreadBody
Keep a thread the platform has already read, so nothing reads it twice.
Params: `{ threadId: string, messages: [{ from, body }] }` — pass `getThread`'s
own `messages` array through unchanged. Returns `{ threadId, stored }`.

This is a STORE, not an extraction: the text is written down exactly as it came
back, and nothing summarises, judges or filters it. It touches no browser and
costs nothing. Call it only when you already have the thread in hand from a
`getThread` you made anyway — never fetch a thread in order to store it.

### markRead
Mark a message as read. Params: `{ messageId: string }`

### markUnread
Mark a message as unread. Params: `{ messageId: string }`

## Usage

To execute a function, run the skill execution wrapper. It lives under
`$FLOCK_SKILLS_DIR`, which your shell already exports; your working directory
does NOT contain it, so always use this exact form:
```bash
bash "$FLOCK_SKILLS_DIR/gmail/scripts/gmail-exec.sh" <functionName> '<paramsJson>'
```

Example:
```bash
bash "$FLOCK_SKILLS_DIR/gmail/scripts/gmail-exec.sh" listInbox '{"maxResults": 10}'
bash "$FLOCK_SKILLS_DIR/gmail/scripts/gmail-exec.sh" getThread '{"threadId": "1a0825bed76acd3f"}'
bash "$FLOCK_SKILLS_DIR/gmail/scripts/gmail-exec.sh" searchEmails '{"query": "from:boss@company.com is:unread"}'
```

If `$FLOCK_SKILLS_DIR` is unset or the script is missing, STOP and report it.
Do not search the filesystem for another copy, and do not use any other Gmail
tool or connector you may find: this wrapper is the only path that carries the
account binding, the audit trail and the never-send guarantee.

## Account Selection

When multiple accounts are connected, select the appropriate account based on context.
The SKILL_ACCOUNT_ID environment variable is set by the execution layer based on your selection.

## Reconnection

If the Gmail skill is not connected or credentials have expired:
- Guide the user to reconnect via **Skills & Integrations** in their Flock app
- For browser session: the user needs to log in again via the Flock dashboard
- For IMAP: the user needs to update their App Password in the Flock dashboard
- Never tell users to "grant access to" or "approve access for" anything other than Flock

## Browser Session Notes

When using browser session mode:
- Email IDs are Gmail's internal thread IDs extracted from the DOM, not RFC message IDs
- Operations are slower than IMAP (each action launches a headless browser navigation)
- Gmail's DOM selectors can change with updates — if extraction returns empty results, the skill may need selector updates
- The skill auto-detects expired sessions and marks them as outdated for the user to re-login
