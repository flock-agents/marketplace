# Changelog

## 1.0.2

- Page scripts never click, focus or type: `replaceText` finds and marks the Replace all button (`data-flock-target`) and Flock's own click presses it, so Google Docs only ever sees real input. Outputs and error codes are unchanged.
- The unused shell twins (`appendText.sh`, `getDocument.sh`, `insertText.sh`, `listDocuments.sh`, `replaceText.sh`, `_google_helpers.sh`) are removed; the `.ts` scripts were always the ones that ran.

## 1.0.1

- Functions run with the run_skill tool, not `docs-exec.sh`.
- Work done in the browser uses the browser tool on the Google sign-in (`open` with its `session` and the url, then `act` on its `persistentSessionId`), not the `authenticated-crawl` skill.
