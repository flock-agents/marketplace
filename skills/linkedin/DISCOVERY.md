# LinkedIn skill — `discover` + `get-post` (social-listening discovery)

Design notes for the discovery commands added to `scripts/linkedin.ts`. Keep this in sync when the
LinkedIn DOM shifts. Sibling of the reply-desk docs; the drafting/save half lives there.

## Why not keyword content-search
LinkedIn migrated `/search/results/content/` to a **server-driven UI (SDUI)**. The rendered page
(`data-sdui-screen`, `data-testid`, `data-token-id`) contains post text but **no activity URN and no
permalink anywhere in the DOM or the 350 KB of HTML** — verified empirically 2026-08-21: zero
`urn:li:activity`, `fsd_update`, `entityUrn`, `navigationUrl`, or `/feed/update` strings; only
`/in/` profile links. Post permalinks are resolved by server-side SDUI click actions, never
rendered. The page also fires no interceptable GraphQL search call. So the content-search page is
**not scrapable for post URLs**, and the old `search <q> content` (raw-text via `extractText`) could
never yield a URL to comment on or dedup against. That is the root cause of the earlier run
comment-sweeping instead of commenting on posts.

## What `discover` actually does — the HOME FEED
The classic home feed (`https://www.linkedin.com/feed/`) is **not** SDUI and still renders
`<article data-activity-urn="urn:li:activity:…" data-id="main-feed-card">` cards with the real URN on
the container. It is also personalized to the owner's interests (AI / automation / building), so it
is a good discovery surface. `discover`:

1. Loads the feed ONCE in a persistent browser session and scrolls a few times (all inside one
   `evaluate`, staying within the 30 s script timeout) to load ~40 cards.
2. Walks `article[data-activity-urn]`, deriving `postUrl` from the URN, and parses author /
   headline / follower text / age / snippet from `innerText`, reactions from the
   `[aria-label*="reaction"]` control, and comment count from the `N comments` text. Excludes
   `Promoted` and `reposted this` cards. Age uses a STANDALONE-timestamp line regex (excludes years)
   so "15 years experience" in a headline can't be mistaken for the post age.
3. Optional args are keyword FILTER terms (OR-matched, case-insensitive, over author+headline+
   snippet). No args → all original posts.
4. Returns COMPACT structured JSON, sorted by engagement:
   `{ source:"linkedin_discover", surface:"home_feed", terms, feedCards, originalPosts, count,
      posts:[ { postUrl, authorName, authorHeadline, authorFollowersText, reactionCount,
      commentCount, ageText, isRepost, isPromoted, snippet(≤300), matchedTerms? } ] }`.

Tradeoff: this is keyword-FILTERED feed, not keyword-SEARCH. The feed is already topic-relevant, and
running 3×/day with rotated category terms surfaces enough. It is also far lighter on rate limits
than N searches — the earlier 429s came from many rapid content searches; `discover` is ONE page
load per run.

## `get-post <postUrl>` — optional escape hatch
Returns ONE post's fuller text compactly:
`{ source:"linkedin_post", postUrl, authorName, authorHeadline, text(≤2000), reactionCount,
   commentCount }`. Use ONLY when a `discover` snippet is too thin to draft from — the default flow
drafts straight from the 300-char snippet to avoid N extra reads.

## Token efficiency (the point)
- `discover` returns compact structured JSON, NEVER the ~20 KB `extractText` raw_text blob the old
  `feed`/`search` commands return. One `discover` call yields every candidate ready to filter AND
  draft, so the model needs no second browser call per post.
- Snippets are capped at 300 chars — enough to write a relevant comment. `get-post` is the rare
  exception, not the default.
- Pairs with reply-desk's batch `POST /api/drafts/by-url` (dedup all urls in one call) and
  `POST /api/drafts/batch` (save all drafts in one call) so a whole run is a handful of round-trips.

## Rate-limit resilience
- ONE persistent browser session per run (`createPersistentSession` reuses the page by session
  name); closed in a `finally`.
- `discover` detects HTTP 429 (page `statusCode`) and block/checkpoint pages (authwall / "reached
  the limit" / "verify you're a human") and returns a clear `RATE_LIMITED` error INSTEAD of
  retrying. On `RATE_LIMITED`/`NO_CONTENT` the caller must stop and let the session cool down; a
  hung browser-fetch can require a Flock server restart to clear a leaked context.
- Content is validated: empty / `{"ok":true}` / a bare base64 blob → `NO_CONTENT` (never treated as
  data); `JSON.parse` is wrapped in try/catch.

## `comment <postUrl> <text>` — post a TOP-LEVEL comment (approval-gated send)
Posts an engagement comment on someone else's ORIGINAL post — the INVERSE of `reply-comment`
(which targets a specific comment's inline reply box). Used by Reply Desk's approve→send for the
`linkedin_post_comment` source: nothing posts until the owner approves the draft, then Milo runs
this. Two-step marked-element flow (same pattern as reply-comment): Step 1 finds + marks the post's
OWN composer and its Post button; Step 2 clicks the marked box, types (newlines via **Shift+Enter**,
never a bare Enter — and `insertText` emits no keydown so it can't submit early), clicks the marked
submit button (never Enter), and confirms the comment appears in the list (`success:true` only when
confirmed; clean error otherwise, no retry-hammer).

**Renders in TWO variants — the command handles both** (verified 2026-08-21):
- DESKTOP: composer `.comments-comment-box .ql-editor[contenteditable="true"]` (top-level, NOT inside
  a `.comments-comment-entity`/`.comments-comment-item`), submit `.comments-comment-box__submit-button`.
- MWLITE (mobile-lite — this is what the session actually served for `/feed/update/<urn>/` post
  pages): composer `.comment-box__text-area[contenteditable="true"][role="textbox"]` (placeholder
  "Add your comment") in `.comment-box`, submit `button.comment-box__post-btn` ("Post your comment",
  starts `disabled` until text is entered). ⚠️ Because post permalink pages came back as MWLITE,
  `cmdComments`/`cmdReplyComment` (desktop-only selectors) may also need mwlite fallbacks — not done
  here (out of scope), flagged as a risk.
The composer is chosen by: a top-level contenteditable NOT nested in a rendered comment AND whose
placeholder is not "reply to …" (rejects reply boxes — the inverse of reply-comment's own guard).

Validated WITHOUT live-posting: drove Step 1 + type on a live post and confirmed the composer was
found (`variant:mwlite`, placeholder "add your comment"), the text landed in the box, and the Post
button enabled — then STOPPED before the submit click (no comment posted). The first real owner
Approve exercises the final click + confirm.

## Hashtag feeds do NOT work (checked 2026-08-21) — home feed stays the surface
Prototyped hashtag discovery to reach beyond the home feed. Result: NOT viable.
- `/feed/hashtag/?keywords=<tag>`, `/feed/hashtag/<tag>/`, `/mwlite/hashtag/<tag>`,
  `/mwlite/feed/hashtag/<tag>` → all HTTP **500** (blocked/error, `bodyLen ~130`).
- `/feed/hashtag/?keyword=<tag>` (singular) → HTTP 200 but **redirects to `/mwlite/feed`** (the
  generic personalized feed) and DROPS the tag: `?keyword=aiagents` and `?keyword=homelab` return
  the SAME generic, non-tag content (page-instance `p_mwlite_feed_topic_updates`, but posts were
  sales/aviation/CEO items, unrelated to the tag). So it gives NO reach beyond the home feed.
Conclusion: hashtag feeds expose no usable tag-filtered post URLs. Keep home-feed `discover` as the
surface; do not wire brittle hashtag scraping. See [[linkedin-content-search-sdui-dead]].

## Where this runs (system-skill gotcha)
`linkedin` is a `system` skill: the executor runs the BUNDLE copy
(`SHARED_SKILLS_DIR/linkedin/scripts/linkedin.ts`, `resolveSkillSourceDir` → shared for non-
marketplace), NOT the `~/.flock/data/skills/linkedin` copy. Edit the bundle + this dev mirror, then
`PUT /api/skills/linkedin` with byte-identical scripts to rehash the registry. See the memory notes
`editing-bundled-system-skills` and `linkedin-skill-dispatch-contract`.
