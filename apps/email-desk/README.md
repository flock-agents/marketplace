# Email Desk

Your own copy of Email Desk. It reads your Gmail into your assistant's memory, drafts replies in your voice, and follows up on mail you sent that got no answer.

It never sends mail. You send a draft with Send on its card, or by replying "send" to its line.

## Shape

A companion app: its own process, its own store (`APP_DATA_DIR/email-desk.db`), talking to Flock only through `@flock/app-sdk`.

- Agent operations: `reply_context`, `create_draft`, `update_draft`, `discard_draft`.
- Routines: `memory-extraction` (builds memory from new mail) and `follow-up` (daily).
- Skills: `judge-mail`, `write-reply`.

Tests: `bun test server/__tests__/<file>`, one file at a time.
