# User Memory

A shared use-case skill. It builds a model of **how you write and what you prefer** — your greeting,
sign-off, sentence length, level of formality, recurring do's and don'ts — and makes that available to
your other skills so their output sounds like you.

## What this skill owns

- Your **voice profile** and preferences (stored with your agent; no marketplace app of its own).

## What it depends on

- **Connector:** `gmail` (optional) — one source it can learn your voice from. It also learns from any
  documents you share and, most importantly, from the **edits you make** to drafts other skills produce.

## How it behaves

1. Extracts a voice profile from samples of your real writing.
2. When you correct a draft (e.g. "no exclamation marks"), that correction flows back here and refines
   the profile.
3. Serves the current voice to dependent skills (e.g. Draft Replies) so the next draft is better.

This skill is a dependency of other skills; installing Draft Replies installs this automatically.
