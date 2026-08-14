---
name: Gmail
description: Read, send, search, and organize emails via Gmail
category: integration
requiresInstance: true
auth:
  type: imap+browser
  session_name: google
  setup_instructions: "Connect via browser session (recommended) or App Password (IMAP). Browser: log in to Gmail via the dashboard. IMAP: go to myaccount.google.com/apppasswords."
tier: installable
---

# Gmail

Read, send, search, and organize emails using the connected Gmail account.

## Connection Types

Two connection methods are supported. **Use browser session by default. Use IMAP only as fallback when no browser session is connected.**

1. **Browser Session** *(default)* — Full Gmail experience: rich compose, CC/BCC, attachments via upload, formatting. Log in to Gmail via the dashboard browser session.
2. **IMAP (App Password)** *(fallback)* — Direct protocol access, plain text only. Used automatically when no browser session is available. Requires a Google App Password (myaccount.google.com/apppasswords).

The skill checks for a browser session first. If no browser session is connected, it falls back to IMAP credentials.

## Available Functions

All functions execute via the skill execution layer.

### listInbox
List recent emails from the inbox. Params: `{ maxResults?: number, query?: string }`

### getEmail
Get a specific email by ID. Params: `{ messageId: string }`

### sendEmail
Send an email. Params: `{ to: string, subject: string, body: string, cc?: string, bcc?: string, attachments?: string | string[] }`
Attachments accepts a file path or array of file paths on the local filesystem.

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

### createDraft
Create a draft email. Params: `{ to: string, subject: string, body: string, cc?: string, bcc?: string, attachments?: string | string[] }`
Attachments accepts a file path or array of file paths on the local filesystem.

### replyToMessage
Reply to an existing message. Params: `{ messageId: string, body: string }`

### sendDraft
Send a previously created draft. Params: `{ draftId: string }`

### markRead
Mark a message as read. Params: `{ messageId: string }`

### markUnread
Mark a message as unread. Params: `{ messageId: string }`

## Usage

To execute a function, run the skill execution wrapper:
```bash
bash scripts/gmail-exec.sh <functionName> '<paramsJson>'
```

Example:
```bash
bash scripts/gmail-exec.sh listInbox '{"maxResults": 10}'
bash scripts/gmail-exec.sh sendEmail '{"to": "user@example.com", "subject": "Hello", "body": "Hi there!"}'
bash scripts/gmail-exec.sh searchEmails '{"query": "from:boss@company.com is:unread"}'
```

## Account Selection

When multiple accounts are connected, select the appropriate account based on context.
The SKILL_ACCOUNT_ID environment variable is set by the execution layer based on your selection.

## Reconnection

If the Gmail skill is not connected or credentials have expired:
- Guide the user to reconnect via **Skills & Integrations** in their Flock app
- For browser session: the user needs to log in again via the Flock dashboard
- For IMAP: the user needs to update their App Password in the Flock dashboard

## Browser Session Notes

When using browser session mode:
- Email IDs are Gmail's internal thread IDs extracted from the DOM, not RFC message IDs
- Operations are slower than IMAP (each action launches a headless browser navigation)
- Gmail's DOM selectors can change with updates — if extraction returns empty results, the skill may need selector updates
- The skill auto-detects expired sessions and marks them as outdated for the user to re-login
