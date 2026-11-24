import { FLOCK_API } from "../../_shared/_helpers";
import { targetSelector } from "../../_shared/_realInput";
import {
  LOAD_MORE_PROBE_JS, MAX_LOAD_ROUNDS, MAX_COMMENTS, REPLY_TARGET, REPLY_BOX,
  firstLookActions, loadMoreRoundActions, parseProbe, targetProbeScript, openReplyActions, replyBoxScript, sendReplyActions,
  type LoadMoreProbe, type TargetProbe,
} from "./linkedin-comments-page";
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

/**
 * A 4xx/5xx from `/api/internal/browser-fetch` is FLOCK refusing us, not LinkedIn.
 *
 * WRONG FIELD (fixed 2026-09-28): server.ts answers
 * `{ error: "session_not_ready", state, message }` -- the discriminator is **error**,
 * not `code`. Reading `body?.code` made the SESSION_NOT_READY branch DEAD, so every
 * not-ready 403 fell through to "Access denied (HTTP 403)" -- and the ingest guard read
 * `\b403\b` out of THAT and quarantined the account, for a status produced by Flock's
 * own access list (`access_denied`: "Agent X does not have the 'Y' skill required for
 * this session"), with the provider never contacted. A connector may only be demoted
 * when a request REACHED the provider and the PROVIDER answered auth-shaped.
 *
 * Flock's own status stays readable for humans, under a code guard-anomaly.ts treats as
 * non-quarantining (NON_QUARANTINING_CODES).
 * PRECEDENCE, CAREFULLY (2026-09-28): do not pick one field over the other. `error`
 * carries the discriminator on the paths server.ts names ("session_not_ready",
 * "access_denied", "session_not_found") but a bare human MESSAGE on others (its 500
 * path answers `{ error: e.message }`), and a mock/older caller can put the code in
 * `code` while `error` holds prose. So TEST BOTH FIELDS for the code, as
 * _shared/checkout.ts has always done -- reading `error ?? code` silently loses a code
 * that is sitting in the other field.
 */
function checkError(httpCode: number, body: any, context: string): void {
  if (httpCode < 400) return;
  const serverCodes = [String(body?.error ?? ""), String(body?.code ?? "")];
  const detail = String(body?.message ?? body?.error ?? "(unknown)");
  if (serverCodes.includes("session_not_ready")) {
    errorJson("SESSION_NOT_READY", "LinkedIn browser session is not ready — Flock has either not finished connecting it or already marked it outdated. Log in via the dashboard.");
  }
  if (serverCodes.includes("access_denied")) {
    errorJson("ACCESS_DENIED", `Flock refused this request and never contacted LinkedIn: ${detail}`);
  }
  if (serverCodes.includes("session_not_found")) {
    errorJson("SESSION_NOT_FOUND", `Flock has no such browser session: ${detail}`);
  }
  errorJson(`${context}_ERROR`, `${context} failed inside Flock's browser-fetch endpoint (Flock status ${httpCode}): ${detail}`);
}

/**
 * Does the PAGE TEXT prove LinkedIn served us its auth wall?
 *
 * This used to be `/sign in|log in|login|session_redirect|"authwall"/i` -- and `login`
 * alone appears in the markup, script bundles and link targets of perfectly
 * authenticated LinkedIn pages, so the session was condemned by its own chrome. Content
 * is weak evidence; only LinkedIn's own auth-wall markers and its login ENDPOINTS are
 * strong enough to mark a session outdated. Same class of bug as the Google
 * substring match documented on isSignInUrl in skills/_shared/_google_helpers.ts.
 */
const LINKEDIN_AUTHWALL_MARKER =
  /"authwall"|session_redirect|linkedin\.com\/(?:checkpoint\/lg\/login|uas\/login|login)\b|(?:sign|log)\s?-?\s?in to (?:continue|view|see|access)|join now to see/i;

function checkSessionExpired(pageContent: string): void {
  const { sessionName, agentId } = getSessionAndAgent();
  if (LINKEDIN_AUTHWALL_MARKER.test(pageContent)) {
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

// A verify evalScript becomes a TRAILING `evaluate` action — top-level evaluateScript is ignored
// when pageActions is present, so it would otherwise be dropped (content would be the last action,
// e.g. a screenshot base64). Appending it makes its return value the content. (CRAFO-988/989)
async function interactRaw(
  persistentId: string, pageActions: any[], close = false, evalScript?: string
): Promise<{ httpCode: number; body: any }> {
  const { sessionName, agentId } = getSessionAndAgent();
  const actions = evalScript ? [...pageActions, { action: "evaluate", script: evalScript }] : pageActions;
  const payload: Record<string, unknown> = {
    sessionName, agentId, persistentSessionId: persistentId, pageActions: actions, extractText: true,
  };
  if (close) payload.closePersistentSession = true;
  return browserFetchPost(payload);
}

async function persistentInteract(
  persistentId: string, pageActions: any[], close = false, evalScript?: string
): Promise<any> {
  await rateLimit();
  const { httpCode, body } = await interactRaw(persistentId, pageActions, close, evalScript);
  checkError(httpCode, body, "BROWSER");
  return body;
}

/** A step on the page already open (a load-more round, a probe): it loads no new page, so no rate-limit pause. */
async function pageStep(persistentId: string, pageActions: any[], evalScript: string): Promise<any> {
  const { httpCode, body } = await interactRaw(persistentId, pageActions, false, evalScript);
  checkError(httpCode, body, "BROWSER");
  return body;
}

/** One load-more round, then `probeScript`'s answer. A click that did not land (a button LinkedIn
 *  re-rendered mid-round) does not end the read: the page is probed again as it is. */
async function loadMoreRound(persistentId: string, buttons: number, waitMs: number, settleMs: number, probeScript: string): Promise<string> {
  const { httpCode, body } = await interactRaw(persistentId, loadMoreRoundActions(buttons, waitMs, settleMs), false, probeScript);
  const answered = httpCode < 400 ? body : await pageStep(persistentId, [], probeScript);
  return String(answered?.content ?? "");
}

/** Expands every comment thread with real clicks on the load-more buttons, to exhaustion
 *  (ceiling MAX_LOAD_ROUNDS) or until more than MAX_COMMENTS are shown. */
async function expandComments(persistentId: string, settleMs: number): Promise<{ truncated: boolean; rounds: number }> {
  const first = await persistentInteract(persistentId, [{ action: "wait", delay: settleMs }, ...firstLookActions(1200)], false, LOAD_MORE_PROBE_JS);
  const none: LoadMoreProbe = { buttons: 0, comments: 0 };
  let probe = parseProbe<LoadMoreProbe>(first?.content) ?? none;
  let rounds = 0;
  for (; rounds < MAX_LOAD_ROUNDS && probe.buttons > 0; rounds++) {
    probe = parseProbe<LoadMoreProbe>(await loadMoreRound(persistentId, probe.buttons, 1100, 400, LOAD_MORE_PROBE_JS)) ?? none;
    if (probe.comments > MAX_COMMENTS) break;
  }
  return { truncated: (rounds >= MAX_LOAD_ROUNDS || probe.comments > MAX_COMMENTS) && probe.buttons > 0, rounds };
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

  // Let the post page settle, then expand every thread with real clicks on its load-more buttons
  // (selector-free, so a 0-comment post won't hard-fail).
  const { truncated, rounds } = await expandComments(persistentId, 3500);

  // Derive the post's numeric activity id up front — used to emit a canonical activity URL and to
  // CONSTRUCT a per-comment deep-link permalink when LinkedIn doesn't expose a real anchor.
  const actMatch = postUrl.match(/urn:li:activity:(\d+)/) || postUrl.match(/activity[:\-](\d+)/i);
  const postActivityId = actMatch ? actMatch[1] : "";

  // The trailing evaluate's return value becomes `content`. A read only: it moves nothing on the page.
  const extractScript = `(() => {
    const truncated = ${truncated};
    const rounds = ${rounds};
    const MAX_COMMENTS = ${MAX_COMMENTS};
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

  const result = await persistentInteract(persistentId, [], true, extractScript);
  const content = result?.content || "";
  const trimmed = String(content).replace(/\s/g, "");
  if (!trimmed || /^\{"ok":/.test(trimmed)) {
    errorJson("NO_CONTENT", "Could not extract comments — the page may have failed to load or the session is logged out. Reconnect the LinkedIn session via the Flock dashboard if this persists.");
  }

  let parsed: any;
  try { parsed = JSON.parse(String(content)); } catch { parsed = null; }
  if (parsed && typeof parsed === "object") {
    console.log(JSON.stringify({ source: "linkedin_post_comments", url: postUrl, ...parsed }));
    return;
  }
  // Unparseable content: if the page fell back to an auth/login wall (session died mid-session,
  // or the post redirected to authwall while the feed didn't), report SESSION_OUTDATED + mark the
  // session — never dump the raw login page into `raw`. checkSessionExpired exits on a match.
  checkSessionExpired(String(content));
  console.log(JSON.stringify({ source: "linkedin_post_comments", url: postUrl, error: true, code: "PARSE_ERROR", message: "Could not parse extracted comments", raw: content }));
}

/** Step 1 of reply-comment: finds the target comment (expanding threads with real load-more clicks,
 *  ceiling MAX_LOAD_ROUNDS, stopping the moment it is shown), clicks its Reply button with real input,
 *  and marks its inline reply editor and submit button. `open` is null when the page gave no readable
 *  answer; `content` is that answer, for the auth-wall check. */
async function openTargetReply(
  persistentId: string, targetCommentId: string, targetName: string
): Promise<{ open: any; content: string }> {
  const probeScript = targetProbeScript(targetCommentId, targetName);
  const first = await persistentInteract(persistentId, [{ action: "wait", delay: 3500 }, ...firstLookActions(1000)], false, probeScript);
  let content = String(first?.content ?? "");
  let probe = parseProbe<TargetProbe>(content);
  for (let i = 0; i < MAX_LOAD_ROUNDS && probe && !probe.found && probe.buttons > 0; i++) {
    content = await loadMoreRound(persistentId, probe.buttons, 1000, 300, probeScript);
    probe = parseProbe<TargetProbe>(content);
  }
  if (!probe) return { open: null, content };
  const { matchedBy } = probe;
  if (!probe.found) return { open: { found: false, commentCount: probe.comments }, content };
  if (!probe.hasReplyButton) return { open: { found: true, replyOpen: false, matchedBy, reason: "no_reply_button" }, content };
  const { httpCode, body } = await interactRaw(persistentId, openReplyActions(), false, replyBoxScript(matchedBy));
  if (httpCode >= 400) return { open: { found: true, replyOpen: false, matchedBy, reason: "reply_click_failed" }, content };
  content = String(body?.content ?? "");
  return { open: parseProbe(content), content };
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
  // opened reply editor + its submit button so Step 2 can target them precisely (DOM state persists
  // across calls within the SAME persistent session). Prefer the stable commentId (URN); fall back
  // to a case-insensitive commenter-name match.
  const { open, content: openContent } = await openTargetReply(persistentId, targetCommentId, targetName);
  // Unparseable Step-1 result usually means the post fell back to an auth wall — surface
  // SESSION_OUTDATED (and mark the session) instead of a misleading COMMENT_NOT_FOUND.
  // checkSessionExpired exits the process on a match; if it returns, fall through to the
  // COMMENT_NOT_FOUND branch below (which performs the single session close).
  if (!open) {
    await persistentClose(persistentId);
    checkSessionExpired(openContent);
    errorJson("COMMENT_NOT_FOUND", "Could not read the post's comments (unexpected response). Re-read with 'comments' and retry.");
  }
  if (!open.found) {
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
  const needle = replyText.slice(0, 60);
  const verifyScript = `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const target = document.querySelector(${JSON.stringify(targetSelector(REPLY_TARGET))});
    const ed = document.querySelector(${JSON.stringify(targetSelector(REPLY_BOX))});
    const needle = norm(${JSON.stringify(needle)});
    const stillTyped = !!ed && needle.length > 0 && norm(ed.innerText).indexOf(needle) >= 0;
    // The posted reply should now appear WITHIN the target comment's subtree (nested), proving it
    // is a threaded reply and not a stray top-level comment.
    const nested = !!target && needle.length > 0 && norm(target.innerText).indexOf(needle) >= 0;
    if (nested && !stillTyped) return JSON.stringify({ success: true, nested: true, message: 'Reply posted and confirmed nested under the target comment' });
    if (!stillTyped) return JSON.stringify({ success: null, nested: false, message: 'Reply submitted but could not confirm it nested under the target comment — verify on LinkedIn.' });
    return JSON.stringify({ success: false, nested: false, message: 'Reply may not have posted (composer still holds the text) — verify on LinkedIn.' });
  })()`;

  const sendRes = await persistentInteract(persistentId, sendReplyActions(replyText), true, verifyScript);
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
