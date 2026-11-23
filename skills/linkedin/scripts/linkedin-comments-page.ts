// LinkedIn post comments — the page scripts and page actions of `comments` and `reply-comment`.
//
// PURE: no network, no argv (linkedin.ts runs its dispatch on import, so what is worth a test lives
// here). Page scripts only FIND and MARK elements (see _shared/_realInput.ts); every click, scroll
// and keystroke is a page action Flock performs with real input.

import { MARK_JS, clickTarget, targetSelector } from "../../_shared/_realInput";

/** Top-level and nested "load more" buttons ("show previous replies" / "more replies"). */
const LOAD_MORE_SEL = 'button.comments-comments-list__load-more-button, button.show-prev-replies, button[aria-label*="more comment" i], button[aria-label*="more repl" i], button[aria-label*="previous repl" i], button[aria-label*="Load more" i], button.scaffold-finite-scroll__load-button';
const COMMENT_SEL = 'article.comments-comment-entity, .comments-comment-entity, .comments-comment-item';
/** Safety ceiling on load-more rounds; otherwise comments are paginated to EXHAUSTION (no more buttons). */
export const MAX_LOAD_ROUNDS = 40;
/** Hard cap on entities so a viral post can't run unbounded. */
export const MAX_COMMENTS = 400;
/** A scroll long enough to reach the bottom of a post page, where LinkedIn loads more comments. */
const SCROLL_TO_BOTTOM = { action: "scroll", deltaY: 10000 };
const LOAD_MORE_MARK = "load-more-";

export const REPLY_TARGET = "reply-target";
export const REPLY_BUTTON = "reply-button";
export const REPLY_BOX = "reply-box";
export const REPLY_SUBMIT = "reply-submit";

/** What a load-more probe reports: how many load-more buttons it marked, and how many comments are shown. */
export interface LoadMoreProbe { buttons: number; comments: number }

/** Page-side: marks every visible, enabled load-more button "load-more-<i>" (stale marks cleared);
 *  `markLoadMore()` returns how many. */
const LOAD_MORE_JS = `${MARK_JS}
  function markLoadMore() {
    flockClear('${LOAD_MORE_MARK}');
    var btns = Array.from(document.querySelectorAll(${JSON.stringify(LOAD_MORE_SEL)})).filter(function(b) { return b && b.offsetParent !== null && !b.disabled; });
    btns.forEach(function(b, i) { flockMark('${LOAD_MORE_MARK}' + i, b); });
    return btns.length;
  }
  function countComments() { return document.querySelectorAll(${JSON.stringify(COMMENT_SEL)}).length; }`;

/** Marks the load-more buttons; → JSON LoadMoreProbe. */
export const LOAD_MORE_PROBE_JS = `(function(){
  ${LOAD_MORE_JS}
  return JSON.stringify({ buttons: markLoadMore(), comments: countComments() });
})()`;

/** The first look at a post's comments: scroll to the bottom and let them load. */
export function firstLookActions(settleMs: number): any[] {
  return [SCROLL_TO_BOTTOM, { action: "wait", delay: settleMs }];
}

/** One load-more round: a real click on each of the `buttons` marked buttons (one gone by then is
 *  skipped), a wait, a scroll to the bottom and a settle. */
export function loadMoreRoundActions(buttons: number, waitMs: number, settleMs: number): any[] {
  const clicks = Array.from({ length: buttons }, (_, i) => clickTarget(`${LOAD_MORE_MARK}${i}`, true));
  return [...clicks, { action: "wait", delay: waitMs }, SCROLL_TO_BOTTOM, { action: "wait", delay: settleMs }];
}

export function parseProbe<T>(content: unknown): T | null {
  try { return JSON.parse(String(content ?? "")) as T; } catch { return null; }
}

// ── reply-comment ────────────────────────────────────────────────

/** What a target probe reports: the load-more buttons (when the target is not shown yet), or the target. */
export interface TargetProbe extends LoadMoreProbe { found: boolean; matchedBy: string; hasReplyButton?: boolean }

/** Looks for the target comment, by its stable commentId (URN), else a case-insensitive commenter-name
 *  match. Found: marks it and its Reply button. Not found: marks the load-more buttons. → JSON TargetProbe. */
export function targetProbeScript(targetCommentId: string, targetName: string): string {
  return `(function(){
  ${LOAD_MORE_JS}
  var norm = function(s) { return (s || '').toLowerCase().replace(/\\s+/g, ' ').trim(); };
  var wantId = ${JSON.stringify(targetCommentId || "")};
  var wantName = norm(${JSON.stringify(targetName || "")});
  var idOf = function(el) {
    var c = el.getAttribute('data-id') || el.getAttribute('data-urn') || '';
    if (/urn:li:comment/i.test(c)) return c;
    var inner = el.querySelector('[data-id*="urn:li:comment" i], [data-urn*="urn:li:comment" i]');
    return inner ? (inner.getAttribute('data-id') || inner.getAttribute('data-urn') || '') : '';
  };
  var nameOf = function(el) {
    var n = el.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text, .comments-comment-item__post-meta .hoverable-link-text, .comments-comment-meta__description a');
    return n ? norm(n.innerText.split('\\n')[0]) : '';
  };
  var nodes = Array.from(document.querySelectorAll(${JSON.stringify(COMMENT_SEL)}));
  var target = null, matchedBy = '';
  if (wantId) { target = nodes.find(function(el) { return idOf(el) === wantId; }) || null; if (target) matchedBy = 'id'; }
  if (!target && wantName) { target = nodes.find(function(el) { return nameOf(el).indexOf(wantName) >= 0; }) || null; if (target) matchedBy = 'name'; }
  if (!target) return JSON.stringify({ found: false, matchedBy: '', buttons: markLoadMore(), comments: nodes.length });
  flockClear('${LOAD_MORE_MARK}');
  flockMark('${REPLY_TARGET}', target);
  var replyBtn = target.querySelector('button.comments-comment-social-bar__reply-action-button, button[aria-label*="Reply" i], .comments-comment-social-bar__action-button--reply, button.comment-button');
  flockMark('${REPLY_BUTTON}', replyBtn);
  return JSON.stringify({ found: true, matchedBy: matchedBy, buttons: 0, comments: nodes.length, hasReplyButton: !!replyBtn });
})()`;
}

/** The target's Reply button, clicked with real input, and a moment for its composer to open. */
export function openReplyActions(): any[] {
  return [{ action: "wait", delay: 500 }, clickTarget(REPLY_BUTTON), { action: "wait", delay: 1500 }];
}

/** After the Reply click: marks the target's OWN inline reply editor and its submit button.
 *  → JSON { found, replyOpen, matchedBy, placeholder?, hasSubmit?, reason? }
 *
 *  CRITICAL GUARD: the inline reply composer MUST live inside THIS comment's subtree. The query is
 *  scoped to the target (querySelector only returns descendants) and DELIBERATELY never falls back
 *  to a page-level editor. LinkedIn's top-level "Add a comment" box is NOT a reply — typing there
 *  posts a stray top-level comment on the whole post. If no inline composer appears (LinkedIn
 *  "reused the main box"), the reply is ABORTED rather than mis-posted. */
export function replyBoxScript(matchedBy: string): string {
  return `(function(){
  ${MARK_JS}
  var matchedBy = ${JSON.stringify(matchedBy)};
  var target = document.querySelector(${JSON.stringify(targetSelector(REPLY_TARGET))});
  var box = target ? target.querySelector('.comments-comment-box .ql-editor[contenteditable="true"], .comments-comment-texteditor .ql-editor[contenteditable="true"], form[class*="comments-comment-box"] .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"]') : null;
  var placeholderOf = function(b) { return ((b && (b.getAttribute('data-placeholder') || b.getAttribute('aria-placeholder') || b.getAttribute('aria-label'))) || '').toLowerCase(); };
  // Reject if it is (or resolves to) the top-level composer: not inside the comment, or shows the
  // "Add a comment" placeholder rather than a reply placeholder.
  if (!box || !target.contains(box) || /add a comment/.test(placeholderOf(box))) {
    return JSON.stringify({ found: true, replyOpen: false, matchedBy: matchedBy, reason: 'no_inline_reply_box', placeholder: placeholderOf(box) });
  }
  flockMark('${REPLY_BOX}', box);
  // Scope the submit button to the reply composer's own form so the top-level Post is never clicked.
  var form = box.closest('form.comments-comment-box__form, form[class*="comments-comment-box"], .comments-comment-box') || target;
  var submit = form.querySelector('button.comments-comment-box__submit-button, button[class*="comments-comment-box__submit"], button.artdeco-button--primary[type="submit"]');
  flockMark('${REPLY_SUBMIT}', submit);
  return JSON.stringify({ found: true, replyOpen: true, matchedBy: matchedBy, placeholder: placeholderOf(box), hasSubmit: !!submit });
})()`;
}

/** Types the reply into the MARKED editor and clicks the MARKED submit button only. */
export function sendReplyActions(replyText: string): any[] {
  return [
    clickTarget(REPLY_BOX),
    { action: "insertText", text: replyText },
    { action: "wait", delay: 800 },
    clickTarget(REPLY_SUBMIT),
    { action: "wait", delay: 2500 },
  ];
}
