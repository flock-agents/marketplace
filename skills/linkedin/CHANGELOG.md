# Changelog

## 1.2.4

- Page scripts never click, focus or type: `comments` and `reply-comment` (now in `linkedin-comments-page.ts`) only find and mark the load-more buttons, the target comment, its Reply button, its own inline reply editor and submit button (`data-flock-target`); every click, scroll and keystroke is Flock's real input. A reply still never falls back to the post's top-level comment box. Outputs and error codes are unchanged.

## 1.2.3

- Commands run with the run_skill tool (function `linkedin`, the command first in `params._args`), not `linkedin-exec.sh` or skill-exec; the sign-in is Flock's browser session named "linkedin" (the sign-in guide), not authenticated-crawl.
- The frontmatter's `auth` no longer names `provider: authenticated-crawl`.
