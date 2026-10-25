---
name: Google Sheets
description: Read and edit Google Sheets spreadsheets
icon: 📊
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: google
  setup_instructions: "Log in to your Google account via the browser session manager to access Sheets."
tier: installable
---

# Google Sheets

You can read and edit existing spreadsheets using the connected Google account. A new spreadsheet is created in the browser (below).

## Available Functions

All functions execute via `POST /api/internal/skill-exec`. Use the skill execution wrapper script (**Usage** below).

### listSpreadsheets
List the user's recent spreadsheets via Drive. Params: `{ maxResults?: number }`

### getSpreadsheet
Get the spreadsheet's values as CSV (its first sheet). Params: `{ spreadsheetId: string }` or
`{ name: string }` (looked up in Drive; an uploaded .xlsx works too). Several files with that name →
AMBIGUOUS_NAME listing each one's id.

### readRange
Read the cells of a range in A1 notation, as the sheet shows them. Params:
`{ spreadsheetId: string, range: string }` (e.g. `Sheet1!A1:B4`; no sheet name = the first sheet).
Returns `values: string[][]`.

### appendRows
Add rows below the last row that has anything in it, from the range's first column. Params:
`{ spreadsheetId: string, range: string, values: string[][] }` (`range` e.g. `Sheet1!A:B`). Returns
`appendedRange`, and `ok` only once every cell reads back as typed.

### updateCells
Overwrite cells from the range's top-left cell. Params: `{ spreadsheetId: string, range: string, values: string[][] }`.
Returns `ok` only once every cell reads back as typed (`EDIT_NOT_CONFIRMED` with what it reads
otherwise).

## In the browser: create a spreadsheet

There is no create function here. Do it yourself in the Google browser session (authenticated-crawl,
on the sessionName under **Available Browser Sessions**). Open
`https://docs.google.com/spreadsheets/create?usp=drive_web&folder=<folderId>` in the same tab (leave
`&folder=…` out for My Drive; Drive's New menu opens a new tab, which the session refuses). Click the
title (`#docs-title-widget`), select all in `input.docs-title-input`, type the title, press Enter.
Fill cells with updateCells or appendRows once it exists.

## Authentication

This skill uses a **Google browser session**. The user logs in to their Google account via the Flock dashboard browser session manager. All read and write operations work through the browser session.

If the skill is not connected or the session has expired, guide the user to set it up in **Skills & Integrations** in their Flock app.

## Usage

To execute a function, run the skill execution wrapper. It lives under
`$FLOCK_SKILLS_DIR`, which your shell already exports; your working directory
does NOT contain it, so always use this exact form:
```bash
bash "$FLOCK_SKILLS_DIR/google-sheets/scripts/sheets-exec.sh" <functionName> '<paramsJson>'
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
bash "$FLOCK_SKILLS_DIR/google-sheets/scripts/sheets-exec.sh" listSpreadsheets '{"maxResults": 10}'
bash "$FLOCK_SKILLS_DIR/google-sheets/scripts/sheets-exec.sh" appendRows '{"spreadsheetId":"abc","range":"Sheet1!A:C","values":[["Alice",30,"PM"]]}'
```
