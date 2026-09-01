# Draft Assistant

A one-click assistant that drafts your outbound email, LinkedIn, and X messages into **Draft Desk** — you review and approve, nothing sends without you.

Installing this template sets everything up in one step: it creates the assistant agent, installs the Draft Desk companion app, and pairs them so drafts flow to your dashboard for approval. No manual wiring.

## What It Does

- **Draft sweeps:** Scans email, LinkedIn, and X for messages that need a reply and drafts each one in your voice
- **Approval-first:** Every draft lands in Draft Desk as an approval card on your dashboard — you approve, edit, or discard
- **Send on approval:** Once you approve, the platform sends the draft via the right skill (email→gmail, LinkedIn→linkedin, X→twitter); the assistant escalates only if a send fails
- **Revisions:** Comment on a draft and the assistant rewrites it in your voice
- **Never sends on its own:** The assistant drafts; you decide. Approval is always a human gate.

## Companion App

| App | Purpose |
|-----|---------|
| Draft Desk | The approval desk — review, edit, and approve drafts before they send; deep workbench with thread context and revision history |

## Skills

| Skill | Purpose |
|-------|---------|
| gmail | Read and send email |
| linkedin | Read and send LinkedIn messages and comments |
| twitter | Read and send messages on X |

## Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| Morning Draft Sweep | 8:00 AM daily | Scan sources and draft replies that need one (nothing sends) |

Times in Asia/Kolkata (IST) by default — adjust in the wizard.

## Setup

1. Choose a name and tone in the personality wizard
2. Connect Gmail, LinkedIn, and X so the assistant can draft (and, once approved, send) replies
3. Draft Desk is installed and paired automatically
4. Optionally connect Telegram to reach the assistant on the go
5. Review the morning draft sweep schedule

## Safety

- The assistant **drafts**; you **decide**. Approval is always a human gate.
- Side-effecting sends ride a user-approved task action — a draft never sends on the assistant's own initiative.
- Account credentials stay in the Vault; the app and agent call by reference, never holding your logins.
