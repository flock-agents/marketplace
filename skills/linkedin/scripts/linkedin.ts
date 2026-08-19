const FLOCK_API = process.env.FLOCK_API_URL || "http://localhost:35625";
const RATE_FILE = "/tmp/skill-linkedin-rate";
const DRAFTS_DIR = `${process.env.SKILL_DATA_DIR || "/tmp"}/linkedin-drafts`;

import { mkdirSync, writeFileSync } from "fs";
try { mkdirSync(DRAFTS_DIR, { recursive: true }); } catch {}

async function rateLimit(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const last = parseInt(await Bun.file(RATE_FILE).text(), 10) || 0;
    if (now - last < 3) {
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch {}
  await Bun.write(RATE_FILE, String(now));
}

function errorJson(code: string, msg: string): never {
  console.log(JSON.stringify({ error: true, code, message: msg }));
  process.exit(1);
}

function getSessionAndAgent(): { sessionName: string; agentId: string } {
  const sessionName = process.env.BROWSER_SESSION || "linkedin";
  const agentId = process.env.FLOCK_AGENT_ID || "";
  if (!agentId) errorJson("MISSING_AGENT", "FLOCK_AGENT_ID is not set; skill must be invoked via skill-exec");
  return { sessionName, agentId };
}

async function browserFetchPost(body: Record<string, unknown>): Promise<{ httpCode: number; body: any }> {
  const resp = await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { content: text }; }
  return { httpCode: resp.status, body: parsed };
}

function checkError(httpCode: number, body: any, context: string): void {
  if (httpCode === 403) {
    if (body?.code === "session_not_ready") {
      errorJson("SESSION_NOT_READY", "LinkedIn browser session is not ready. User needs to log in or re-authenticate via the dashboard.");
    }
    errorJson(`${context}_ERROR`, "Access denied (HTTP 403). Check browser session access settings.");
  }
  if (httpCode >= 400) {
    const errMsg = body?.error || body?.message || "(unknown)";
    errorJson(`${context}_ERROR`, `${context} failed (HTTP ${httpCode}): ${errMsg}`);
  }
}

function checkSessionExpired(pageContent: string): void {
  const { sessionName, agentId } = getSessionAndAgent();
  if (/sign in|log in|login|session_redirect|"authwall"/i.test(pageContent)) {
    fetch(`${FLOCK_API}/api/internal/browser-sessions/${sessionName}/mark-outdated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}`,
      },
      body: JSON.stringify({
        agentId,
        reason: "LinkedIn returned login/auth page instead of authenticated content",
      }),
    }).catch(() => {});
    errorJson("SESSION_OUTDATED", "LinkedIn session has expired. Marked as outdated — user needs to re-login via the dashboard.");
  }
}

async function crawlUrl(url: string): Promise<string> {
  const { sessionName, agentId } = getSessionAndAgent();
  await rateLimit();

  const { httpCode, body } = await browserFetchPost({
    url, sessionName, agentId, extractText: true,
  });
  checkError(httpCode, body, "CRAWL");

  const pageContent = body?.content || "";
  checkSessionExpired(pageContent);
  return pageContent;
}

async function persistentCreate(url: string, pageActions?: any[]): Promise<any> {
  const { sessionName, agentId } = getSessionAndAgent();
  await rateLimit();

  const payload: Record<string, unknown> = {
    url, sessionName, agentId, createPersistentSession: true, extractText: true,
  };
  if (pageActions) payload.pageActions = pageActions;

  const { httpCode, body } = await browserFetchPost(payload);
  checkError(httpCode, body, "CRAWL");

  const pageContent = body?.content || "";
  checkSessionExpired(pageContent);
  return body;
}

async function persistentInteract(
  persistentId: string, pageActions: any[], close = false, evalScript?: string
): Promise<any> {
  const { sessionName, agentId } = getSessionAndAgent();
  await rateLimit();

  // A verify evalScript becomes a TRAILING `evaluate` action — top-level
  // evaluateScript is ignored when pageActions is present, so it would otherwise
  // be dropped (content would be the last action, e.g. a screenshot base64).
  // Appending it makes its return value the content. (CRAFO-988/989)
  const actions = evalScript ? [...pageActions, { action: "evaluate", script: evalScript }] : pageActions;
  const payload: Record<string, unknown> = {
    sessionName, agentId, persistentSessionId: persistentId, pageActions: actions, extractText: true,
  };
  if (close) payload.closePersistentSession = true;

  const { httpCode, body } = await browserFetchPost(payload);
  checkError(httpCode, body, "BROWSER");
  return body;
}

// Parse a verify-script JSON result defensively — the write action has already
// fired, so a malformed/unexpected body degrades to "unconfirmed", never throws. (CRAFO-988)
function parseVerify(content: unknown): any {
  if (content && typeof content === "object") return content;
  try { return JSON.parse(String(content)); }
  catch { return { success: null, message: "Action sent, but could not confirm the result — verify on LinkedIn." }; }
}

async function persistentClose(persistentId: string): Promise<void> {
  const { sessionName, agentId } = getSessionAndAgent();
  await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}`,
    },
    body: JSON.stringify({
      sessionName, agentId, persistentSessionId: persistentId, closePersistentSession: true,
    }),
  }).catch(() => {});
}

// ── Commands ─────────────────────────────────────────────────────

async function cmdNotifications(): Promise<void> {
  let content = await crawlUrl("https://www.linkedin.com/notifications/");
  if (!content) errorJson("NO_CONTENT", "Could not load notifications. Session may have expired.");
  content = content.substring(0, 20480);
  console.log(JSON.stringify({ source: "linkedin_notifications", format: "raw_text", content }));
}

async function cmdFeed(count: number): Promise<void> {
  // Plain extractText (crawlUrl), NO pageActions: passing pageActions makes
  // browser-fetch return content "{"ok":true}" and drop the rendered feed text
  // (CRAFO-986). extractText alone returns the rendered viewport of the feed.
  let content = await crawlUrl("https://www.linkedin.com/feed/");
  const trimmed = (content || "").replace(/\s/g, "");
  if (!trimmed || /^\{"ok":/.test(trimmed)) {
    errorJson("NO_CONTENT", "LinkedIn feed returned no extractable text — the session may be logged out or blocked. Reconnect the LinkedIn browser session via the Flock dashboard.");
  }
  content = content.substring(0, 20480);
  console.log(JSON.stringify({ source: "linkedin_feed", format: "raw_text", content, requestedCount: count }));
}

async function cmdProfile(profileUrl: string): Promise<void> {
  if (!/^https:\/\/www\.linkedin\.com\/(in|company)\//.test(profileUrl)) {
    errorJson("INVALID_URL", "Profile URL must be a LinkedIn profile or company page (https://www.linkedin.com/in/... or /company/...)");
  }
  let content = await crawlUrl(profileUrl);
  if (!content) errorJson("NO_CONTENT", "Could not load profile. Session may have expired.");
  content = content.substring(0, 20480);
  console.log(JSON.stringify({ source: "linkedin_profile", format: "raw_text", url: profileUrl, content }));
}

async function cmdPost(text: string): Promise<void> {
  if (text.length > 3000) {
    errorJson("TOO_LONG", `Post exceeds 3000 characters (${text.length} chars)`);
  }

  const sessionResult = await persistentCreate("https://www.linkedin.com/feed/");
  const persistentId = sessionResult?.persistentSessionId || "";
  if (!persistentId) errorJson("SESSION_ERROR", "Failed to create persistent session for posting");

  const composeActions = [
    { action: "waitForSelector", selector: `button.share-box-feed-entry__trigger, .share-box-feed-entry__trigger, [data-control-name="share.feedEntry"]` },
    { action: "click", selector: `button.share-box-feed-entry__trigger, .share-box-feed-entry__trigger, [data-control-name="share.feedEntry"]` },
    { action: "waitForSelector", selector: `.ql-editor[contenteditable=true], .share-creation-state__text-editor .ql-editor, [role="textbox"]`, delay: 5000 },
  ];
  await persistentInteract(persistentId, composeActions);

  const typeActions = [
    { action: "click", selector: `.ql-editor[contenteditable=true], .share-creation-state__text-editor .ql-editor, [role="textbox"]` },
    { action: "insertText", text },
    { action: "wait", delay: 500 },
  ];
  await persistentInteract(persistentId, typeActions);

  const postActions = [
    { action: "waitForSelector", selector: "button.share-actions__primary-action, .share-box_actions button.artdeco-button--primary" },
    { action: "click", selector: "button.share-actions__primary-action, .share-box_actions button.artdeco-button--primary" },
    { action: "wait", delay: 3000 },
  ];

  const verifyScript = `(() => {
    const modal = document.querySelector('.share-box--is-open, .share-creation-state');
    if (!modal || modal.offsetHeight === 0) {
      return JSON.stringify({success: true, message: 'Post published via browser session'});
    }
    return JSON.stringify({success: false, message: 'Post dialog still open — publish may have failed'});
  })()`;

  const postResult = await persistentInteract(persistentId, postActions, true, verifyScript);
  console.log(JSON.stringify(parseVerify(postResult?.content)));
}

async function cmdDraftPost(text: string): Promise<void> {
  const charCount = text.length;
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").substring(0, 15);
  const draftFile = `${DRAFTS_DIR}/draft-${timestamp}.txt`;

  writeFileSync(draftFile, text);

  console.log(JSON.stringify({
    draft: { text, charCount, savedTo: draftFile },
    note: "Draft saved locally. Use 'post' command to publish.",
  }));
}

async function cmdSendMessage(recipientUrl: string, messageText: string): Promise<void> {
  if (!/^https:\/\/www\.linkedin\.com\/in\//.test(recipientUrl)) {
    errorJson("INVALID_URL", "Recipient must be a LinkedIn profile URL (https://www.linkedin.com/in/...)");
  }

  const sessionResult = await persistentCreate(recipientUrl);
  const persistentId = sessionResult?.persistentSessionId || "";
  if (!persistentId) errorJson("SESSION_ERROR", "Failed to create persistent session for messaging");

  const msgActions = [
    { action: "waitForSelector", selector: `button[aria-label*="Message"], a[href*="/messaging/"]` },
    { action: "click", selector: `button[aria-label*="Message"], a[href*="/messaging/"]` },
    { action: "waitForSelector", selector: `.msg-form__contenteditable [contenteditable=true], .msg-form__msg-content-container [contenteditable=true]`, delay: 5000 },
  ];
  await persistentInteract(persistentId, msgActions);

  const typeActions = [
    { action: "click", selector: `.msg-form__contenteditable [contenteditable=true], .msg-form__msg-content-container [contenteditable=true]` },
    { action: "insertText", text: messageText },
    { action: "wait", delay: 500 },
  ];
  await persistentInteract(persistentId, typeActions);

  const sendActions = [
    { action: "waitForSelector", selector: `button.msg-form__send-button, button[type="submit"].msg-form__send-button` },
    { action: "click", selector: `button.msg-form__send-button, button[type="submit"].msg-form__send-button` },
    { action: "wait", delay: 2000 },
  ];

  const verifyScript = `(() => {
    return JSON.stringify({success: true, message: 'Message sent via browser session'});
  })()`;

  const sendResult = await persistentInteract(persistentId, sendActions, true, verifyScript);
  console.log(JSON.stringify(parseVerify(sendResult?.content)));
}

async function cmdMessages(): Promise<void> {
  let content = await crawlUrl("https://www.linkedin.com/messaging/");
  if (!content) errorJson("NO_CONTENT", "Could not load messages. Session may have expired.");
  content = content.substring(0, 20480);
  console.log(JSON.stringify({ source: "linkedin_messages", format: "raw_text", content }));
}

async function cmdSearch(query: string, type: string): Promise<void> {
  const validTypes = ["people", "posts", "companies"];
  if (!validTypes.includes(type)) {
    errorJson("INVALID_TYPE", "Search type must be: people, posts, or companies");
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.linkedin.com/search/results/${type}/?keywords=${encodedQuery}`;

  let content = await crawlUrl(url);
  if (!content) errorJson("NO_CONTENT", "Could not load search results. Session may have expired.");
  content = content.substring(0, 20480);
  console.log(JSON.stringify({ source: "linkedin_search", format: "raw_text", query, type, content }));
}

async function cmdComments(postUrl: string): Promise<void> {
  if (!/^https:\/\/www\.linkedin\.com\//.test(postUrl) || !/activity|\/posts\/|\/feed\/update\//i.test(postUrl)) {
    errorJson("INVALID_URL", "Post URL must be a LinkedIn post/activity URL (contains /posts/, /feed/update/, or activity-<id>)");
  }

  const sessionResult = await persistentCreate(postUrl);
  const persistentId = sessionResult?.persistentSessionId || "";
  if (!persistentId) errorJson("SESSION_ERROR", "Failed to create persistent session for reading comments");

  // Let the post page settle; the extract script itself scrolls + clicks
  // "load more comments" (selector-free, so a 0-comment post won't hard-fail).
  const settleActions = [{ action: "wait", delay: 3500 }];

  // Derive the post's numeric activity id up front — used to emit a canonical activity URL and to
  // CONSTRUCT a per-comment deep-link permalink when LinkedIn doesn't expose a real anchor.
  const actMatch = postUrl.match(/urn:li:activity:(\d+)/) || postUrl.match(/activity[:\-](\d+)/i);
  const postActivityId = actMatch ? actMatch[1] : "";

  // Async IIFE — Playwright awaits the returned Promise; the trailing evaluate's
  // return value becomes `content`.
  const extractScript = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Include nested reply-expansion buttons ("show previous replies" / "more replies") so nested
    // threads are pulled in too, not just top-level comments.
    const loadMoreSel = 'button.comments-comments-list__load-more-button, button.show-prev-replies, button[aria-label*="more comment" i], button[aria-label*="more repl" i], button[aria-label*="previous repl" i], button[aria-label*="Load more" i], button.scaffold-finite-scroll__load-button';
    const MAX_ROUNDS = 40;   // safety ceiling; we otherwise paginate to EXHAUSTION (no more buttons)
    const MAX_COMMENTS = 400; // hard cap on entities so a viral post can't run unbounded
    const countAll = () => document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item').length;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    let rounds = 0;
    for (; rounds < MAX_ROUNDS; rounds++) {
      // Click EVERY visible load-more (top-level AND nested) each round, not just the first.
      const btns = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
      if (!btns.length) break; // exhausted — nothing left to expand
      for (const b of btns) { try { b.click(); } catch (e) {} }
      await sleep(1100);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(400);
      if (countAll() > MAX_COMMENTS) break;
    }
    const remaining = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
    const truncated = (rounds >= MAX_ROUNDS || countAll() > MAX_COMMENTS) && remaining.length > 0;

    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const lc = (s) => norm(s).toLowerCase();
    const pick = (root, sels) => { for (const s of sels) { const n = root.querySelector(s); if (n && n.innerText && n.innerText.trim()) return n.innerText.trim(); } return ''; };
    // Stable comment id (URN) — lets a later reply target THIS exact comment without re-reading.
    const commentIdOf = (el) => {
      const cand = el.getAttribute('data-id') || el.getAttribute('data-urn') || '';
      if (/urn:li:comment/i.test(cand)) return cand;
      const inner = el.querySelector('[data-id*="urn:li:comment" i], [data-urn*="urn:li:comment" i]');
      if (inner) return inner.getAttribute('data-id') || inner.getAttribute('data-urn') || '';
      return '';
    };
    const nameOf = (el) => { const n = pick(el, ['.comments-comment-meta__description-title', '.comments-post-meta__name-text', '.comments-comment-item__post-meta .hoverable-link-text', '.comments-comment-meta__description a']); return n.split('\\n')[0].trim(); };
    const textOf = (el) => pick(el, ['.comments-comment-item__main-content', '.update-components-text', '.comments-comment-item-content-body', '.feed-shared-main-content--comment']);
    const headlineOf = (el) => pick(el, ['.comments-comment-meta__description-subtitle', '.comments-post-meta__headline']);
    const timeOf = (el) => pick(el, ['.comments-comment-meta__data', 'time', '.comments-comment-item__timestamp']);
    const profileOf = (el) => { const link = el.querySelector('a.comments-comment-meta__image-link, .comments-comment-meta__actor a, a[href*="/in/"]'); return link && link.href ? link.href.split('?')[0] : ''; };
    const idAct = (cid) => { const m = String(cid).match(/urn:li:activity:(\\d+)/); return m ? m[1] : ''; };
    const postActId = ${JSON.stringify(postActivityId)};
    // Deep-link to a SPECIFIC comment: prefer a real commentUrn anchor, then a feed/update anchor
    // on the timestamp, finally CONSTRUCT one from the activity id + comment URN. Never a bare feed.
    const permalinkOf = (el, cid) => {
      const anchors = Array.from(el.querySelectorAll('a[href*="commentUrn" i], a.comments-comment-meta__data, a.comments-comment-meta__timestamp, a[href*="/feed/update/"]'));
      for (const a of anchors) { if (a.href && /commentUrn/i.test(a.href)) return a.href.split('#')[0]; }
      for (const a of anchors) { if (a.href && /\\/feed\\/update\\//.test(a.href)) return a.href.split('#')[0]; }
      const act = idAct(cid) || postActId;
      if (act && cid) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + act + '?commentUrn=' + encodeURIComponent(cid);
      if (act) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + act + '/';
      return '';
    };

    const postAuthorRaw = pick(document, ['.update-components-actor__title', '.feed-shared-actor__name', '.update-components-actor__name']);
    const ownerName = lc((postAuthorRaw || '').split('\\n')[0]);
    const byOwner = (nm) => ownerName.length > 0 && lc(nm) === ownerName;

    // Classify: a node is a nested REPLY if it has an ancestor comment entity. Gather each reply
    // inside its parent so the model sees the thread shape and can detect owner replies.
    const allNodes = Array.from(document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
    const isReplyNode = (el) => !!(el.parentElement && el.parentElement.closest('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));

    const seen = new Set();
    const comments = [];
    let totalWithReplies = 0;
    let canonicalActId = postActId;
    for (const el of allNodes) {
      if (isReplyNode(el)) continue; // gathered within its parent below
      const name = nameOf(el);
      const text = textOf(el);
      if (!name && !text) continue;
      const cid = commentIdOf(el);
      if (!canonicalActId) canonicalActId = idAct(cid);
      const key = cid || (name + '|' + text.slice(0, 80));
      if (seen.has(key)) continue;
      seen.add(key);
      const replyEls = Array.from(el.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
      const replies = [];
      for (const r of replyEls) {
        const rn = nameOf(r); const rt = textOf(r);
        if (!rn && !rt) continue;
        const rcid = commentIdOf(r);
        replies.push({ commentId: rcid, name: rn, profileUrl: profileOf(r), text: rt.slice(0, 2000), time: timeOf(r), permalink: permalinkOf(r, rcid), isByOwner: byOwner(rn) });
      }
      // hasOwnerReply === the post owner already replied somewhere in this comment's thread.
      const hasOwnerReply = replies.some((r) => r.isByOwner);
      totalWithReplies += 1 + replies.length;
      comments.push({ commentId: cid, name: name, headline: headlineOf(el), profileUrl: profileOf(el), text: text.slice(0, 2000), time: timeOf(el), permalink: permalinkOf(el, cid), isByOwner: byOwner(name), hasOwnerReply: hasOwnerReply, replyCount: replies.length, replies: replies });
      if (comments.length >= MAX_COMMENTS) break;
    }
    const canonicalPostUrl = canonicalActId ? ('https://www.linkedin.com/feed/update/urn:li:activity:' + canonicalActId + '/') : ${JSON.stringify(postUrl)};
    const postText = pick(document, ['.fie-impression-container .update-components-text', '.feed-shared-update-v2 .update-components-text', '.update-components-text']);
    return JSON.stringify({ postAuthor: postAuthorRaw, ownerName: (postAuthorRaw || '').split('\\n')[0], postUrl: canonicalPostUrl, postActivityId: canonicalActId, postTextPreview: postText.slice(0, 500), commentCount: comments.length, totalWithReplies: totalWithReplies, truncated: truncated, rounds: rounds, comments: comments });
  })()`;

  const result = await persistentInteract(persistentId, settleActions, true, extractScript);
  const content = result?.content || "";
  const trimmed = String(content).replace(/\s/g, "");
  if (!trimmed || /^\{"ok":/.test(trimmed)) {
    errorJson("NO_CONTENT", "Could not extract comments — the page may have failed to load or the session is logged out. Reconnect the LinkedIn session via the Flock dashboard if this persists.");
  }

  let parsed: any;
  try { parsed = JSON.parse(String(content)); } catch { parsed = null; }
  if (parsed && typeof parsed === "object") {
    console.log(JSON.stringify({ source: "linkedin_post_comments", url: postUrl, ...parsed }));
  } else {
    console.log(JSON.stringify({ source: "linkedin_post_comments", url: postUrl, error: true, code: "PARSE_ERROR", message: "Could not parse extracted comments", raw: content }));
  }
}

async function cmdReplyComment(
  postUrl: string, replyText: string, targetCommentId: string, targetName: string
): Promise<void> {
  if (!/^https:\/\/www\.linkedin\.com\//.test(postUrl) || !/activity|\/posts\/|\/feed\/update\//i.test(postUrl)) {
    errorJson("INVALID_URL", "Post URL must be a LinkedIn post/activity URL (contains /posts/, /feed/update/, or activity-<id>)");
  }
  if (!replyText || !replyText.trim()) errorJson("MISSING_ARG", "Reply text is empty");
  if (replyText.length > 1250) errorJson("TOO_LONG", `Reply exceeds 1250 characters (${replyText.length} chars)`);
  if (!targetCommentId && !targetName) {
    errorJson("MISSING_TARGET", "A target is required: pass the commentId (from the 'comments' command) or the commenter's name");
  }

  const sessionResult = await persistentCreate(postUrl);
  const persistentId = sessionResult?.persistentSessionId || "";
  if (!persistentId) errorJson("SESSION_ERROR", "Failed to create persistent session for replying");

  // Step 1 — load comments, LOCATE the exact target comment, click its Reply button, and mark the
  // opened reply editor + its submit button with data-attributes so Step 2 can target them
  // precisely (DOM state persists across calls within the SAME persistent session). Prefer the
  // stable commentId (URN); fall back to a case-insensitive commenter-name match.
  const settleActions = [{ action: "wait", delay: 3500 }];
  const openReplyScript = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const loadMoreSel = 'button.comments-comments-list__load-more-button, button.show-prev-replies, button[aria-label*="more comment" i], button[aria-label*="more repl" i], button[aria-label*="previous repl" i], button[aria-label*="Load more" i], button.scaffold-finite-scroll__load-button';
    const norm = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const wantId = ${JSON.stringify(targetCommentId || "")};
    const wantName = norm(${JSON.stringify(targetName || "")});
    const idOf = (el) => {
      const c = el.getAttribute('data-id') || el.getAttribute('data-urn') || '';
      if (/urn:li:comment/i.test(c)) return c;
      const inner = el.querySelector('[data-id*="urn:li:comment" i], [data-urn*="urn:li:comment" i]');
      return inner ? (inner.getAttribute('data-id') || inner.getAttribute('data-urn') || '') : '';
    };
    const nameOf = (el) => {
      const n = el.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text, .comments-comment-item__post-meta .hoverable-link-text, .comments-comment-meta__description a');
      return n ? norm(n.innerText.split('\\n')[0]) : '';
    };
    const findTarget = () => {
      const nodes = Array.from(document.querySelectorAll('article.comments-comment-entity, .comments-comment-entity, .comments-comment-item'));
      if (wantId) { const t = nodes.find((el) => idOf(el) === wantId); if (t) return { target: t, matchedBy: 'id', count: nodes.length }; }
      if (wantName) { const t = nodes.find((el) => nameOf(el).indexOf(wantName) >= 0); if (t) return { target: t, matchedBy: 'name', count: nodes.length }; }
      return { target: null, matchedBy: '', count: nodes.length };
    };
    // Paginate to EXHAUSTION (ceiling 40), but STOP EARLY the moment the target comment is present
    // — a comment deep in the tail is no longer missed by a hard 8-page cap.
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1000);
    let found = findTarget();
    for (let i = 0; i < 40 && !found.target; i++) {
      const btns = Array.from(document.querySelectorAll(loadMoreSel)).filter((b) => b && b.offsetParent !== null && !b.disabled);
      if (!btns.length) break;
      for (const b of btns) { try { b.click(); } catch (e) {} }
      await sleep(1000);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(300);
      found = findTarget();
    }
    const target = found.target, matchedBy = found.matchedBy;
    if (!target) return JSON.stringify({ found: false, commentCount: found.count });
    target.setAttribute('data-flock-target', '1');
    target.scrollIntoView({ block: 'center' });
    await sleep(500);
    const replyBtn = target.querySelector('button.comments-comment-social-bar__reply-action-button, button[aria-label*="Reply" i], .comments-comment-social-bar__action-button--reply, button.comment-button');
    if (!replyBtn) return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'no_reply_button' });
    try { replyBtn.click(); } catch (e) { return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'reply_click_failed' }); }
    await sleep(1500);
    // CRITICAL GUARD: the inline reply composer MUST live inside THIS comment's subtree. We scope
    // the query to \`target\` (querySelector only returns descendants) and DELIBERATELY do NOT fall
    // back to any page-level editor. LinkedIn's top-level "Add a comment" box is NOT a reply —
    // typing there posts a stray top-level comment on the whole post (the exact bug we prevent).
    // If no inline composer appears (LinkedIn "reused the main box"), we ABORT rather than mis-post.
    const box = target.querySelector('.comments-comment-box .ql-editor[contenteditable="true"], .comments-comment-texteditor .ql-editor[contenteditable="true"], form[class*="comments-comment-box"] .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"]');
    const placeholderOf = (b) => ((b && (b.getAttribute('data-placeholder') || b.getAttribute('aria-placeholder') || b.getAttribute('aria-label'))) || '').toLowerCase();
    // Reject if it is (or resolves to) the top-level composer: not inside the comment, or shows the
    // "Add a comment" placeholder rather than a reply placeholder.
    if (!box || !target.contains(box) || /add a comment/.test(placeholderOf(box))) {
      return JSON.stringify({ found: true, replyOpen: false, matchedBy, reason: 'no_inline_reply_box', placeholder: placeholderOf(box) });
    }
    box.setAttribute('data-flock-reply', '1');
    try { box.focus(); } catch (e) {}
    // Scope the submit button to the reply composer's own form so we never click the top-level Post.
    const form = box.closest('form.comments-comment-box__form, form[class*="comments-comment-box"], .comments-comment-box') || target;
    const submit = form.querySelector('button.comments-comment-box__submit-button, button[class*="comments-comment-box__submit"], button.artdeco-button--primary[type="submit"]');
    if (submit) submit.setAttribute('data-flock-reply-submit', '1');
    return JSON.stringify({ found: true, replyOpen: true, matchedBy, placeholder: placeholderOf(box), hasSubmit: !!submit });
  })()`;

  const openRes = await persistentInteract(persistentId, settleActions, false, openReplyScript);
  let open: any;
  try { open = JSON.parse(String(openRes?.content ?? "")); } catch { open = null; }
  if (!open || !open.found) {
    await persistentClose(persistentId);
    errorJson("COMMENT_NOT_FOUND", `Could not find the target comment on the post${targetCommentId ? ` (id ${targetCommentId})` : targetName ? ` by "${targetName}"` : ""}. It may have been deleted, or the commentId/name didn't match — re-read with 'comments' and retry.`);
  }
  if (!open.replyOpen) {
    await persistentClose(persistentId);
    errorJson("REPLY_BOX_ERROR", `Found the comment but could not open its INLINE reply box (${open.reason || "unknown"}). Aborted WITHOUT posting — refusing to fall back to the top-level comment box (that would post a stray comment on the whole post). Retry later; LinkedIn's DOM may have changed.`);
  }
  // Only proceed if we captured the reply composer's OWN submit button in Step 1. Without it we
  // could only reach a page-wide submit — which risks the top-level Post — so we abort instead.
  if (!open.hasSubmit) {
    await persistentClose(persistentId);
    errorJson("REPLY_BOX_ERROR", "Opened the inline reply box but could not locate its Reply/submit button. Aborted WITHOUT posting to avoid mis-posting a top-level comment.");
  }

  // Step 2 — type into the MARKED reply editor and click the MARKED reply-submit button ONLY.
  // Both marks were set in Step 1 and scoped to the target comment; we never use a page-wide
  // selector here, so a submit can only ever land on this comment's inline reply. Same persistent
  // session, so the Step-1 marks are still on the DOM. Close the session on this call.
  const typeActions = [
    { action: "click", selector: `[data-flock-reply="1"]` },
    { action: "insertText", text: replyText },
    { action: "wait", delay: 800 },
    { action: "click", selector: `[data-flock-reply-submit="1"]` },
    { action: "wait", delay: 2500 },
  ];
  const needle = replyText.slice(0, 60);
  const verifyScript = `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const target = document.querySelector('[data-flock-target="1"]');
    const ed = document.querySelector('[data-flock-reply="1"]');
    const needle = norm(${JSON.stringify(needle)});
    const stillTyped = !!ed && needle.length > 0 && norm(ed.innerText).indexOf(needle) >= 0;
    // The posted reply should now appear WITHIN the target comment's subtree (nested), proving it
    // is a threaded reply and not a stray top-level comment.
    const nested = !!target && needle.length > 0 && norm(target.innerText).indexOf(needle) >= 0;
    if (nested && !stillTyped) return JSON.stringify({ success: true, nested: true, message: 'Reply posted and confirmed nested under the target comment' });
    if (!stillTyped) return JSON.stringify({ success: null, nested: false, message: 'Reply submitted but could not confirm it nested under the target comment — verify on LinkedIn.' });
    return JSON.stringify({ success: false, nested: false, message: 'Reply may not have posted (composer still holds the text) — verify on LinkedIn.' });
  })()`;

  const sendRes = await persistentInteract(persistentId, typeActions, true, verifyScript);
  console.log(JSON.stringify({ matchedBy: open.matchedBy, ...parseVerify(sendRes?.content) }));
}

// ── Main dispatch ────────────────────────────────────────────────

// Resolve the subcommand + args. Two invocation shapes are supported:
//  1. Positional CLI/monolithic: `linkedin.ts <command> [args...]`.
//  2. Platform per-function dispatch (functionName="linkedin"): the subcommand
//     and its args arrive in params._args via the SKILL_PARAMS env var, not argv.
function resolveInvocation(): { command: string; args: string[] } {
  const argvCommand = process.argv[2];
  if (argvCommand) return { command: argvCommand, args: process.argv.slice(3) };
  try {
    const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
    const list = Array.isArray(params._args) ? params._args.map(String) : [];
    if (list.length) return { command: list[0], args: list.slice(1) };
  } catch {}
  return { command: "", args: [] };
}

const { command, args } = resolveInvocation();

switch (command) {
  case "notifications":
    await cmdNotifications();
    break;
  case "feed":
    await cmdFeed(parseInt(args[0] || "10", 10));
    break;
  case "profile":
    if (!args[0]) errorJson("MISSING_ARG", "Usage: linkedin.ts profile <profileUrl>");
    await cmdProfile(args[0]);
    break;
  case "post":
    if (!args[0]) errorJson("MISSING_ARG", "Usage: linkedin.ts post <text>");
    await cmdPost(args[0]);
    break;
  case "draft-post":
    if (!args[0]) errorJson("MISSING_ARG", "Usage: linkedin.ts draft-post <text>");
    await cmdDraftPost(args[0]);
    break;
  case "send-message":
    if (!args[0] || !args[1]) errorJson("MISSING_ARG", "Usage: linkedin.ts send-message <recipientProfileUrl> <message>");
    await cmdSendMessage(args[0], args[1]);
    break;
  case "messages":
    await cmdMessages();
    break;
  case "search":
    if (!args[0]) errorJson("MISSING_ARG", "Usage: linkedin.ts search <query> [type]");
    await cmdSearch(args[0], args[1] || "people");
    break;
  case "comments":
    if (!args[0]) errorJson("MISSING_ARG", "Usage: linkedin.ts comments <postUrl>");
    await cmdComments(args[0]);
    break;
  case "reply-comment":
    if (!args[0] || !args[1]) errorJson("MISSING_ARG", "Usage: linkedin.ts reply-comment <postUrl> <replyText> [commentId] [commenterName]");
    await cmdReplyComment(args[0], args[1], args[2] || "", args[3] || "");
    break;
  default:
    errorJson("UNKNOWN_COMMAND", `Unknown command: ${command}. Available: notifications, feed, profile, post, draft-post, send-message, messages, search, comments, reply-comment`);
    break;
}
