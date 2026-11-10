# Changelog

## 1.1.14

- `read-products` and `read-variants` run with the run_skill tool, not `skill-exec.sh`; photos for groceries are read with the browser tool's `readText` and `readImages` steps (the browsing guide), not `authenticated-crawl`.
- When the skill fails, the pages are read by hand with the browser tool (`open` with the Amazon.in `session`, then one `read` with `pages`), and checkout from product cards adds each ASIN in that session; payment follows the payments guide. No text describes memory.
