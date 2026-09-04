# Draft Replies

A use-case skill. It watches the sources you connect for messages that genuinely need a reply and
drafts responses **in your voice** into Draft Desk. It never sends — every draft waits for your
approval.

## What this skill owns

- **App:** Draft Desk (`draft-desk`) — the approval desk where drafts land. Installed with this skill.
- **Routine:** `on-new-mail` — fires on a new-mail event from the Gmail connector and drafts a reply
  for anything that needs one.
  - `ignoreAutomated` (default on): skip automated / no-reply senders (receipts, newsletters, alerts).

## What it depends on

- **Connector:** `gmail` (required) — the data source it reads from and drafts into.
- **Skill:** `user-memory` — supplies your writing voice so drafts sound like you, and learns from the
  edits you make to drafts.

## How it behaves

1. Reads the real thread before drafting — never invents context.
2. Collapses to one draft per thread; never double-drafts the same thread.
3. Skips what doesn't need a reply.
4. Leaves a visible gap rather than fabricating a name, number, date, or link.
5. Never sends. Drafts go to Draft Desk and stop there.
