---
name: LinkedIn
description: Read notifications, browse feed, publish posts, send messages, check messages, monitor post comments, and reply to comments on LinkedIn
category: integration
requiresInstance: true
auth:
  type: browser_session
  provider: authenticated-crawl
  session_name: linkedin
  setup_instructions: "I'll need a LinkedIn browser session to read your notifications, feed, and messages. Log in via the Flock dashboard."
tier: installable
---

# LinkedIn

Read LinkedIn notifications, browse your feed, publish posts, send messages, and check messages using an authenticated browser session.

## When to use

- User asks about LinkedIn notifications
- User wants to check their LinkedIn feed
- User asks to draft, review, or publish a LinkedIn post
- User wants to send a LinkedIn message
- User wants to check LinkedIn messages
- User wants to see who commented on a LinkedIn post / monitor post engagement
- User wants commenter names and comment text from a specific post URL (e.g. to draft replies)
- User references LinkedIn activity

## Authentication

This skill uses an authenticated browser session (no public API for individuals). The user must log in via the Flock dashboard's authenticated-crawl session named "linkedin". The session must be in **ready** state — if it is `setting_up` or `outdated`, commands will fail with a session error.

Invoke via skill-exec. The gated function is `linkedin`, so `args[0]` **must be the literal string `linkedin`** and the subcommand + its arguments follow it:

```bash
curl -s -X POST http://localhost:35625/api/internal/skill-exec \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOCK_AUTH_TOKEN" \
  -d '{
    "skillId": "linkedin",
    "scriptName": "linkedin.sh",
    "args": ["linkedin", "<command>", ...commandArgs],
    "agentId": "'"$FLOCK_AGENT_ID"'"
  }'
```

For example, to read a post's comments: `"args": ["linkedin", "comments", "https://www.linkedin.com/feed/update/urn:li:activity:123/"]`.

## Commands

### notifications
Get recent LinkedIn notifications.

    linkedin.sh notifications

### feed
Get recent posts from your feed.

    linkedin.sh feed [count]

### profile
Get a user's profile info.

    linkedin.sh profile <profileUrl>

### post
Publish a LinkedIn post using a persistent browser session.

    linkedin.sh post "<text>"

Returns: `{success: true/false, message: "..."}`

### draft-post
Draft a LinkedIn post (saves locally, does NOT publish).

    linkedin.sh draft-post "<text>"

Returns: `{draft: {text, charCount, savedTo}}`

### send-message
Send a direct message to a LinkedIn user via their profile URL.

    linkedin.sh send-message "<profileUrl>" "<message>"

Returns: `{success: true/false, message: "..."}`

### messages
Check recent LinkedIn messages.

    linkedin.sh messages

### search
Search LinkedIn for people or content.

    linkedin.sh search "<query>" [type]

Types: people, posts, companies.

### comments
Read the comments on a specific LinkedIn post and return structured engagement data (commenter names, headlines, profile URLs, and comment text). Read-only — use it to surface who's engaging with a post and to draft replies.

    linkedin.sh comments "<postUrl>"

`<postUrl>` is a LinkedIn post/activity URL — it must contain `/posts/`, `/feed/update/`, or an `activity-<id>` segment (e.g. `https://www.linkedin.com/posts/...-activity-1234567890-abcd` or `https://www.linkedin.com/feed/update/urn:li:activity:1234567890/`).

Returns:
```json
{
  "source": "linkedin_post_comments",
  "url": "<postUrl>",
  "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890/",
  "postActivityId": "1234567890",
  "postAuthor": "...",
  "ownerName": "...",
  "postTextPreview": "...",
  "commentCount": 12,
  "totalWithReplies": 27,
  "truncated": false,
  "comments": [
    {
      "commentId": "urn:li:comment:(urn:li:activity:1234567890,9876543210)",
      "name": "Jane Doe",
      "headline": "VP Eng at Acme",
      "profileUrl": "https://www.linkedin.com/in/janedoe",
      "text": "Great post!",
      "time": "2d",
      "permalink": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890?commentUrn=urn%3Ali%3Acomment%3A(urn%3Ali%3Aactivity%3A1234567890%2C9876543210)",
      "isByOwner": false,
      "hasOwnerReply": false,
      "replyCount": 1,
      "replies": [
        { "commentId": "urn:li:comment:(...)", "name": "Post Owner", "profileUrl": "...", "text": "Thanks Jane!", "time": "1d", "permalink": "...", "isByOwner": true }
      ]
    }
  ]
}
```

Notes:
- **`postUrl`** is the post's canonical activity URL (`urn:li:activity:<id>`), never a bare `/feed/`. Use it as `send_target.linkedin_comment.postUrl`.
- Each comment carries a stable **`commentId`** (its `urn:li:comment:(…)` URN) — pass it to `reply-comment` to deep-link straight to that exact comment — and a **`permalink`** that deep-links to THAT comment (prefer it for a draft's `source_url` / `send_target.linkedin_comment.commentUrl` so "Open original" lands on the comment). Either may be empty if LinkedIn didn't expose it.
- **`isByOwner`** = the comment was written by the post owner. **`hasOwnerReply`** = the owner has already replied under this comment. Together these are the deterministic "needs a reply" filter: skip a comment when `isByOwner` OR `hasOwnerReply` is true. Nested replies are returned under each comment's **`replies`** array (each also has `isByOwner`).
- Pagination runs to **exhaustion** (clicks every "load more comments" / "show previous replies" until none remain), capped at 40 rounds / 400 entities. **`truncated: true`** means the cap was hit and some tail may be missing. `commentCount` is the top-level count; `totalWithReplies` includes nested replies.
- A post with no comments returns `commentCount: 0` and an empty `comments` array — not an error.
- LinkedIn's DOM changes often; if names/text come back empty, the selectors may need updating.

### reply-comment
Post a **threaded reply under a specific comment** on a LinkedIn post. Locates the target comment (by its `commentId` from `comments`, else the commenter's name), opens THAT comment's inline reply box, types, and submits.

    linkedin.sh reply-comment "<postUrl>" "<replyText>" "[commentId]" "[commenterName]"

- `<postUrl>` — the post/activity URL (same format as `comments`).
- `<replyText>` — the reply body (≤1250 chars).
- `[commentId]` — the target comment's URN from the `comments` command (STRONGLY preferred — exact + fast).
- `[commenterName]` — fallback locator when no commentId is available; matches the commenter's display name.
- At least one of `commentId` / `commenterName` is required.

Returns: `{ "matchedBy": "id"|"name", "success": true|false|null, "nested": true|false, "message": "..." }` — `success:true` with `nested:true` means the reply was posted and confirmed nested under the target comment.

**Guarantee — never a stray top-level comment.** `reply-comment` only ever types into an inline reply composer scoped INSIDE the target comment. If that inline box can't be acquired (e.g. LinkedIn reuses the main box) it **aborts without posting** (`REPLY_BOX_ERROR`) rather than falling back to the main "Add a comment" editor — which would post a standalone comment on the whole post. On `COMMENT_NOT_FOUND` / `REPLY_BOX_ERROR`, do not retry via any other posting path.

## Safety Rules

- **NEVER publish a post without explicit user confirmation**
- **NEVER send a message without explicit user confirmation**
- Draft posts are saved locally only
- Never send connection requests without user confirmation
- Read operations (notifications, feed, profile, comments) are safe
- **Replying to commenters is NOT automatic** — `comments` only reads. A reply is a separate `reply-comment` action that still requires explicit user confirmation
- **A comment reply must be a THREADED reply, never a new top-level comment.** Use `reply-comment` (which guarantees this and aborts rather than mis-posting); never approximate a comment reply with the `post` command or by typing into the main comment box

## Response Format

All responses are JSON. Errors follow:
```json
{"error": true, "code": "ERROR_CODE", "message": "Human-readable description"}
```

## Session State Errors

The script handles browser session lifecycle states automatically:

- **SESSION_NOT_READY** — the "linkedin" session is not in `ready` state (either `setting_up` or `outdated`). Tell the user to check the Flock dashboard and log in or re-authenticate. Do **not** retry.
- **SESSION_OUTDATED** — the script detected that LinkedIn returned a login page instead of authenticated content. The session has been automatically marked as outdated. Tell the user to re-login via the Flock dashboard.
- **CRAWL_ERROR (HTTP 403)** — either the session isn't ready or your agent lacks access. Tell the user to check browser session settings.

## Limitations

- Depends on authenticated browser session — session expires require user re-login via Flock dashboard
- No official API — uses page scraping which can be fragile
- Rate limiting is aggressive (wait 3+ seconds between requests)
- Post publishing and messaging use persistent browser sessions for multi-step flows
- Connection requests are not automated for safety
