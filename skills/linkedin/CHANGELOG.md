# Changelog

## 1.2.6-beta.1

- Asking the owner to sign in again names the LinkedIn browser session from the error (its `BROWSER_SESSION`, such as `linkedin-connect-…`), not a fixed "linkedin" session.

## 1.2.5

Needs Flock 0.25.0-beta.2: the script uses `signInAgainAsk` from Flock's shared helpers.

- When the LinkedIn sign-in is not ready, has expired or returns no content, the owner is asked to sign in again with a connector hand-off in the agent's chat (target `{"sessionName": "linkedin"}`), never sent to the dashboard or the Connectors page.

## 1.2.4

- Page scripts never click, focus or type: `comments` and `reply-comment` (now in `linkedin-comments-page.ts`) only find and mark the load-more buttons, the target comment, its Reply button, its own inline reply editor and submit button (`data-flock-target`); every click, scroll and keystroke is Flock's real input. A reply still never falls back to the post's top-level comment box. Outputs and error codes are unchanged.

## 1.2.3

- Commands run with the run_skill tool (function `linkedin`, the command first in `params._args`), not `linkedin-exec.sh` or skill-exec; the sign-in is Flock's browser session named "linkedin" (the sign-in guide), not authenticated-crawl.
- The frontmatter's `auth` no longer names `provider: authenticated-crawl`.
