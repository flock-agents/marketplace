# Draft Desk

An outbound-draft approval desk. Your paired agent drafts replies across email, LinkedIn, LinkedIn comments, and X; you review and approve them — **nothing sends without you**.

Draft Desk is task-native: every draft that needs your review surfaces as an approval card on your Flock dashboard, with the incoming message, the draft, the recipient, and the agent's rationale. Approve from the dashboard and the platform sends it via the right skill; open it to edit first when you want to.

## How it works

1. **Ask for drafts** (or let your agent run) → the agent scans your connected sources and creates a draft per thread.
2. **A `reply-approval` task appears on your dashboard** with the draft, the message it replies to, the recipient, and why. It also shows in the app's approvals widget.
3. **Approve & send** — the platform sends the draft deterministically through the matching skill (email→gmail, LinkedIn→linkedin, X→twitter), escalating to your agent only if the send fails. Or **Review & edit** to open the workbench.
4. **Sent or discarded** → the task is withdrawn from the dashboard automatically.

The deep workbench (thread context, revision history, inline editing, per-source filters) remains available at the app surface for anything the card doesn't cover.

## Configuration (App Configuration, §6)

On install, Draft Desk requires:

- **An agent** to draft and send for you (defaults to your chief-of-staff agent; editable). For a fresh, purpose-built assistant, install the **Draft Assistant** template — the canonical `draft-assistant` persona — which creates the agent and installs + pairs Draft Desk in one step.
- **Skills:** `gmail`, `linkedin`, `twitter` — scoped, consented at setup, borrowed through the paired agent (the app never holds your account credentials).

The platform provisions the agent-webhook binding invisibly. No webhook, token, or secret is ever shown to you.

## Safety

- The agent **drafts**; the human **decides**. Approval is always a human gate — the agent never approves its own drafts.
- Side-effecting sends ride a user-approved task action (approval-context token); a draft never sends on the agent's own initiative.
- The app calls platform APIs with its own scoped, loopback-only token; account credentials stay in the Vault.

## Tech

- **Frontend:** React + Vite (hash-routed SPA)
- **Backend:** Hono on Bun
- **Database:** SQLite (`bun:sqlite`) under `$APP_DATA_DIR`

## API (workbench + agent-facing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/drafts?status=&source=` | List drafts |
| POST | `/api/drafts` | Create a draft |
| GET | `/api/drafts/:id` | Draft + revision history |
| PATCH | `/api/drafts/:id` | Edit body / status (approve routes to send) |
| POST | `/api/drafts/:id/comment` | Request a revision |
| POST | `/api/drafts/:id/sent` | Mark sent |
| POST | `/api/drafts/:id/send-failed` | Report a failed send |
| POST | `/api/drafts/request-more` | Ask the agent for more drafts |
| GET | `/api/widgets/approvals` | Declarative approvals-widget data (platform-fetched) |
| GET | `/api/health` | Health check |
