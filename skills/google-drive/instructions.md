---
name: Google Drive
description: List, search, read, and download Google Drive files; upload and organise them in the browser
icon: 📁
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: google
  setup_instructions: "Log in to your Google account via the browser session manager to access Drive."
tier: installable
---

# Google Drive

You can list, search, read, and download files in the connected Drive account. Uploading, new folders, renaming, moving and deleting are done in the browser (below).

## Available Functions

### listFiles
List recent Drive files (page text), or a folder's with `folderId`. Params:
`{ folderId?: string, query?: string }`. A `query` searches like searchFiles and returns its `files`.

### getFile
Read a file's text: a Doc as text, a sheet (Google Sheets or .xlsx) as CSV, slides as text, else
Drive's viewer page. Params: `{ fileId: string }` or `{ name: string }` (looked up in Drive; several
files with that name → AMBIGUOUS_NAME listing each one's id).

### downloadFile
Download the file into your own `downloads/` folder, where your shell and Read tool can open it
(Docs as .docx, Sheets as .xlsx, Slides as .pptx). Params: `{ fileId: string }` or `{ name: string }`.
Returns `{ fileId, fileName, path, size }`.

### searchFiles
Search Drive like its search box. Params: `{ query: string, maxResults?: number }`. `query` is plain
words, as typed into Drive's search box (e.g. `"Grant Spend Monitor"`); `A OR B` runs a search for
each. Drive API syntax (`name contains 'x'`) is read as its words. Returns
`files: [{ id, name, kind, mimeType, url }]`: pass an `id` to getFile / downloadFile (`fileId`),
google-sheets getSpreadsheet (`spreadsheetId`) or google-docs getDocument (`documentId`).

## In the browser: upload, new folder, rename, move, bin

These have no function here. Do them yourself in the Google browser session (authenticated-crawl,
on the sessionName under **Available Browser Sessions**), on drive.google.com. Tested 2026-10-25:

- **Open the folder**: `https://drive.google.com/drive/folders/<id>` (My Drive: `/drive/my-drive`).
- **New folder**: click `New` → `New folder`, select all in `input[aria-label='New folder']`, type
  the name, click `Create`. Drive shows "<name> created successfully".
- **Upload**: write the file on disk first (e.g. your `downloads/` folder). In the folder click
  `New` → `File upload`: that adds a hidden `input[type=file]`; run `upload` on it with the
  file's absolute path (no file picker opens). Drive shows "1 upload complete".
- **Rename**: hover the file's row, click its `More actions` button → `Rename`, select all, type
  the new name, `OK`.
- **Move**: the row's `More actions` → `Organize` → `Move`. Click the menu item whose text is
  exactly `Move` (`[role=menuitem]` with that text): `Move to trash` sits beside it, and a loose
  match bins the file (seen 2026-10-25). The folder picker is inside an iframe
  (`iframe[src*='picker/minpick']`; `frames` may not list it): click the target folder in it, then
  `Move to <folder>`. Dragging a row does nothing.
- **Delete**: the row's `More actions` → `Move to trash` (recoverable from the bin). Never empty
  the bin.
- **New Google Doc / Sheet in a folder**: open
  `https://docs.google.com/document/create?usp=drive_web&folder=<folderId>` (a Sheet:
  `/spreadsheets/create?…`) in the same tab, not Drive's `New` menu (that opens a new tab). Click
  the title (`#docs-title-widget`), select all in `input.docs-title-input`, type, press Enter.
  It is created in that folder; nothing needs moving.
- Buttons on a row show only on hover, and Drive has hidden inputs: use `:visible` selectors.
- Read the folder back (listFiles) to confirm the result before you report it done.

## Authentication

This skill uses a **Google browser session**. The user logs in to their Google account via the Flock dashboard browser session manager. All operations work through the browser session.

If the skill is not connected or the session has expired, guide the user to set it up in **Skills & Integrations** in their Flock app.

## Usage

To execute a function, run the skill execution wrapper. It lives under
`$FLOCK_SKILLS_DIR`, which your shell already exports; your working directory
does NOT contain it, so always use this exact form:
```bash
bash "$FLOCK_SKILLS_DIR/google-drive/scripts/drive-exec.sh" <functionName> '<paramsJson>'
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
bash "$FLOCK_SKILLS_DIR/google-drive/scripts/drive-exec.sh" listFiles '{"maxResults": 20}'
bash "$FLOCK_SKILLS_DIR/google-drive/scripts/drive-exec.sh" searchFiles '{"query": "name contains \\"invoice\\""}'
```
