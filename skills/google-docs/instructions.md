---
name: Google Docs
description: Read and edit Google Docs documents
icon: 📄
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: google
  setup_instructions: "Log in to your Google account via the browser session manager to access Docs."
tier: installable
---

# Google Docs

You can read and edit existing documents using the connected Google account. A new document is created in the browser (below).

## Available Functions

### listDocuments
List the user's recent docs via Drive. Params: `{ maxResults?: number }`

### getDocument
Get the document's text. Params: `{ documentId: string }` or `{ name: string }` (looked up in
Drive; several files with that name → AMBIGUOUS_NAME listing each one's id).

### appendText
Append text to the end of the document body. Params: `{ documentId: string, text: string }`. Start
`text` with a newline for a new line. Returns `ok` only once the document shows it; `autocorrected: true`
when Docs changed it as it was typed (e.g. capitalised the first letter): read it back and fix it with
replaceText if it matters.

### insertText
Insert text at the very beginning of the document. Params: `{ documentId: string, text: string }`.
Not at an arbitrary position: for a change in the middle, use replaceText. Confirmed and
`autocorrected` as appendText.

### replaceText
Replace every occurrence of a text, ignoring case (Docs' Replace all). Params:
`{ documentId: string, find: string, replace: string }`. Returns `ok` only once `find` is gone from
the document.

## In the browser: create a document

There is no create function here. Do it yourself in the Google browser session (authenticated-crawl,
on the sessionName under **Available Browser Sessions**). Tested 2026-10-25:

1. Open `https://docs.google.com/document/create?usp=drive_web&folder=<folderId>` in the same
   tab (the folder's id is in its Drive address; leave `&folder=…` out for My Drive). Do not use
   Drive's New menu: it opens the doc in a new tab, which the session refuses.
2. Click the title (`#docs-title-widget`), then select all in `input.docs-title-input`, type the
   title, press Enter.
3. Click `.kix-appview-editor` and type the text. Docs auto-corrects as you type (it capitalised
   "test" to "Test"): read the text back (getDocument) and fix any change.
4. Wait for "Saved to Drive". Report the doc's URL (`https://docs.google.com/document/d/<id>/edit`).

## Authentication

This skill uses a **Google browser session**. The user logs in to their Google account via the Flock dashboard browser session manager. All read and write operations work through the browser session.

If the skill is not connected or the session has expired, guide the user to set it up in **Skills & Integrations** in their Flock app.

## Usage

To execute a function, run the skill execution wrapper. It lives under
`$FLOCK_SKILLS_DIR`, which your shell already exports; your working directory
does NOT contain it, so always use this exact form:
```bash
bash "$FLOCK_SKILLS_DIR/google-docs/scripts/docs-exec.sh" <functionName> '<paramsJson>'
```

The wrapper is the only way to call a function: it picks the account (pass
`"accountHint"` in the params for a non-default one) and hands the function its
Google sign-in. Never run the per-function scripts in `scripts/` yourself —
outside the wrapper they have no sign-in and always answer `NO_AUTH` ("No
browser session available"), whatever is connected. If `$FLOCK_SKILLS_DIR` is
unset or the wrapper is missing, tell the owner (the install is broken); do not
search the filesystem for another copy.

Example:
```bash
bash "$FLOCK_SKILLS_DIR/google-docs/scripts/docs-exec.sh" appendText '{"documentId":"abc","text":"\n## 2026-05-13\nKickoff."}'
bash "$FLOCK_SKILLS_DIR/google-docs/scripts/docs-exec.sh" replaceText '{"documentId":"abc","find":"TBD","replace":"Confirmed"}'
```
