// createReplyDraft's browser steps, batched into as few round trips as the write allows (owner, 2026-11-24).
//
// Measured live (2026-11-24, one createReplyDraft = 63 s): every round trip to the browser costs ~2.5 s
// before it does anything, and the write made eleven of them, two of them full Gmail page loads (~12 s
// each). This module holds the batched steps; createReplyDraft.ts drives them. What each step proves is
// unchanged:
//
//  1. OPEN: the unread probe still runs BEFORE the thread opens (opening marks it read), in the same
//     held session, and the thread is then opened IN-SPA (a hash change, exactly what NAV_TO_DRAFTS_SCRIPT
//     does for #drafts) instead of a second full page load. The page was freshly loaded on the search
//     list, which has no `h2.hP`, so the first visible subject heading after the hop IS the thread we
//     routed to; its data-legacy-thread-id, when Gmail renders one, must also be ours. Nothing is looked
//     for or clicked until that holds (THREAD_OPEN_FLAG).
//  2. COMMIT + CONFIRM: no fixed 2 s sleep after the click-away. Switching to #drafts is itself the
//     click-away that commits an inline reply (confirmDraftRow's history), and the #drafts poll waits for
//     the draft's OWN row, not merely a settled list, so it waits exactly as long as the save takes.
//  3. FACTS: while the compose is open, the reply's own To/Cc (what Gmail's Reply all actually put on it)
//     and the newest message's sender and time are read, so the caller need not read the thread again.
//
// A LEAF MODULE, no entrypoint (same rule as _draftRows.ts): importing createReplyDraft.ts would run it.

import { composeFrom } from "../../_shared/_gmail-sender";
import { pollInPageScript, DRAFTS_VIEW_READY_EXPR, NAV_TO_DRAFTS_SCRIPT } from "./_gmailNav";
import { DRAFT_ROWS_EXPR } from "./_draftRows";
import { COMPOSE_BODY_SCRAPE } from "./_draftBody";
import { markThenClick } from "./_gmailPress";
import { SAVE_AND_CLOSE_ACTIONS } from "./_composeSave";

/** The thread's reply controls: present only once the thread view has rendered. */
export const REPLY_CONTROL_SELECTOR = `[aria-label="Reply"],[aria-label="Reply all"],.T-I-JW[data-tooltip="Reply"]`;
/** The inline reply's editor. */
export const REPLY_EDITOR_SELECTOR = `div[aria-label*="Message"][contenteditable=true]`;

const PROBE_KEY = "__flockUnreadProbe";
/** Set in the page once the thread view is proven to be ours; every later step checks it. */
export const THREAD_OPEN_FLAG = "__flockThreadOpen";
const SAVED_KEY = "__flockDraftSaved";
const STEP_RESULT_KEY = "__flockStepResult";

/** Gmail's legacy thread ids are hex; anything else is refused before it reaches a page script. */
function assertThreadId(threadId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) throw new Error(`invalid threadId: ${threadId}`);
}

/** In-page: route the current Gmail page to the thread, in-SPA. */
export function hopToThreadScript(threadId: string): string {
  assertThreadId(threadId);
  return `(() => { location.hash = ${JSON.stringify(`#all/${threadId}`)}; return 'nav'; })()`;
}

/**
 * In-page: the thread view for `threadId` is on screen and its reply controls have rendered. Gmail may
 * rewrite the id in the hash to its newer form once routed, so the hash is only required to be a thread
 * route under #all; the heading's own legacy id, when present, must be ours.
 */
export function threadOpenExpr(threadId: string): string {
  assertThreadId(threadId);
  return `(function(){
  if (location.hash.indexOf('#all/') !== 0) return false;
  var h = Array.prototype.slice.call(document.querySelectorAll('h2.hP')).filter(function (el) {
    var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  })[0];
  if (!h) return false;
  var legacy = h.getAttribute('data-legacy-thread-id');
  if (legacy && legacy !== ${JSON.stringify(threadId)}) return false;
  return !!document.querySelector(${JSON.stringify(REPLY_CONTROL_SELECTOR)});
})()`;
}

/** Wrap a find-and-mark script so it marks nothing unless the thread is proven open. */
function onlyInOpenThread(script: string, refused: string): string {
  return `(window.${THREAD_OPEN_FLAG} === true ? ${script} : ${JSON.stringify(refused)})`;
}

/**
 * Step 1, the session-opening call's page actions: the unread probe (its result kept in the page), the
 * in-SPA hop to the thread, the wait for the thread to render (a poll: a timeout is an answer, never a
 * throw, so the probe can never fail the call it rides on), then Reply all found and pressed exactly as
 * before (direct control, else the newest message's menu). The last action answers
 * `{ probe, open, mode }`: `probe` is the poll result unreadIdsFrom/wasUnread parse.
 */
export function openThreadActions(
  threadId: string, probeScript: string, findReplyAllScript: string, pickMenuItemScript: string, openWaitMs = 20_000,
) {
  return [
    { action: "evaluate", script: `(async () => { window.${PROBE_KEY} = await ${probeScript}; return window.${PROBE_KEY}; })()` },
    { action: "evaluate", script: hopToThreadScript(threadId) },
    {
      action: "evaluate",
      script: `(async () => { const r = JSON.parse(await ${pollInPageScript(threadOpenExpr(threadId), "true", openWaitMs)}); window.${THREAD_OPEN_FLAG} = r.ready === true; window.__flockReplyMode = "none"; return JSON.stringify(r); })()`,
    },
    ...markThenClick("reply-open", onlyInOpenThread(findReplyAllScript, JSON.stringify({ step: "not-open" }))),
    { action: "wait", delay: 800 },
    ...markThenClick("reply-menu-item", onlyInOpenThread(pickMenuItemScript, JSON.stringify({ mode: "none" }))),
    {
      action: "evaluate",
      script: `JSON.stringify({ probe: window.${PROBE_KEY} || null, open: window.${THREAD_OPEN_FLAG} === true, mode: window.__flockReplyMode || "none" })`,
    },
  ];
}

/** Step 1's answer, never throwing: an unparseable one is "not open", with no probe. */
export function parseOpenThread(content: unknown): { probe: string | null; open: boolean; mode: string } {
  try {
    const v = JSON.parse(typeof content === "string" ? content : "{}") || {};
    return { probe: typeof v.probe === "string" ? v.probe : null, open: v.open === true, mode: typeof v.mode === "string" ? v.mode : "none" };
  } catch {
    return { probe: null, open: false, mode: "none" };
  }
}

/**
 * Step 2: settle the reply mode (Escape first when the menu held no reply-all item), press plain Reply
 * when that is allowed, and wait for the editor, in one call. Answers `{ settle, editor }`: `settle` is
 * the settle script's own JSON, `editor` whether the reply editor is on screen.
 */
export function settleReplyActions(settleReplyModeScript: string, menuMissed: boolean, editorWaitMs = 15_000) {
  const editorUp = `!!document.querySelector(${JSON.stringify(REPLY_EDITOR_SELECTOR)})`;
  // Stop waiting at once when the settle step refused: there is no editor coming.
  const doneExpr = `(function(){ var s = {}; try { s = JSON.parse(window.${STEP_RESULT_KEY} || "{}"); } catch (e) {} return s.ok !== true || ${editorUp}; })()`;
  return [
    ...(menuMissed ? [{ action: "press", key: "Escape" }] : []),
    ...markThenClick("reply-plain", onlyInOpenThread(settleReplyModeScript, JSON.stringify({ ok: false, message: "the thread did not open" }))),
    { action: "evaluate", script: pollInPageScript(doneExpr, "true", editorWaitMs) },
    { action: "evaluate", script: `JSON.stringify({ settle: (function(){ try { return JSON.parse(window.${STEP_RESULT_KEY} || "{}"); } catch (e) { return {}; } })(), editor: ${editorUp} })` },
  ];
}

export function parseSettleReply(content: unknown): { settle: Record<string, any>; editor: boolean } {
  try {
    const v = JSON.parse(typeof content === "string" ? content : "{}") || {};
    return { settle: v.settle && typeof v.settle === "object" ? v.settle : {}, editor: v.editor === true };
  } catch {
    return { settle: {}, editor: false };
  }
}

/**
 * In-page, with the reply compose open: who Gmail's reply reaches (the recipient chips of the compose
 * that holds the editor, by field) and the thread's newest message (the last rendered message with a
 * sender and a date: a compose has neither). Read only; nothing is clicked or expanded.
 */
export const REPLY_FACTS_EXPR = `(function(){
  var editor = document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
               document.querySelector('.Am.Al.editable') ||
               document.querySelector('[role="textbox"][aria-label*="Message"]');
  var root = null;
  for (var n = editor ? editor.parentElement : null; n && n !== document.body; n = n.parentElement) {
    if (n.querySelector('[name="to"]')) { root = n; break; }
  }
  var addrRe = /[^\\s<>,;"']+@[^\\s<>,;"']+/;
  var collect = function (kind) {
    var out = [];
    var add = function (s) { var m = String(s || '').match(addrRe); var a = m ? m[0].toLowerCase() : ''; if (a && out.indexOf(a) < 0) out.push(a); };
    if (!root) return out;
    root.querySelectorAll('[name="' + kind + '"]').forEach(function (box) {
      if (box.tagName === 'INPUT' || box.tagName === 'TEXTAREA') { String(box.value || '').split(',').forEach(add); return; }
      box.querySelectorAll('[data-hovercard-id]').forEach(function (c) { add(c.getAttribute('data-hovercard-id')); });
      box.querySelectorAll('[email]').forEach(function (c) { add(c.getAttribute('email')); });
    });
    return out;
  };
  var raw = Array.prototype.slice.call(document.querySelectorAll('.adn.ads, div[role="listitem"]'));
  var msgs = raw.filter(function (el) { return !raw.some(function (o) { return o !== el && o.contains(el); }); })
    .filter(function (el) { return el.querySelector('.gD[email]') && el.querySelector('.g3'); });
  var last = msgs[msgs.length - 1] || null;
  var newest = null;
  if (last) {
    var sender = last.querySelector('.gD[email]');
    var dateEl = last.querySelector('.g3');
    var idEl = last.hasAttribute('data-legacy-message-id') ? last : last.querySelector('[data-legacy-message-id]');
    newest = {
      id: idEl ? (idEl.getAttribute('data-legacy-message-id') || '') : '',
      fromEmail: sender.getAttribute('email') || '',
      fromName: (sender.textContent || '').trim(),
      date: (dateEl.getAttribute('title') || dateEl.textContent || '').trim()
    };
  }
  return { composeFound: !!root, to: collect('to'), cc: collect('cc'), bcc: collect('bcc'), newest: newest };
})()`;

/**
 * Step 3: type the body, wait for Gmail's own "Draft saved", then read back what Gmail holds and the
 * reply's facts, in one call. Answers `{ saved, html, facts }` (`saved`: the wait script's JSON or null;
 * `html`: the compose body as COMPOSE_BODY_SCRAPE reads it; `facts`: REPLY_FACTS_EXPR's object or null).
 */
export function writeBodyActions(bodyActions: any[], waitForSavedScript: string) {
  return [
    ...bodyActions,
    { action: "evaluate", script: `(async () => { window.${SAVED_KEY} = await ${waitForSavedScript}; return window.${SAVED_KEY}; })()` },
    {
      action: "evaluate",
      script: `JSON.stringify({ saved: window.${SAVED_KEY} || null, html: (function(){ try { return ${COMPOSE_BODY_SCRAPE}; } catch (e) { return ''; } })(), facts: (function(){ try { return ${REPLY_FACTS_EXPR}; } catch (e) { return null; } })() })`,
    },
  ];
}

export function parseWriteBody(content: unknown): { autosaveSeen: boolean | null; html: string; facts: unknown } {
  try {
    const v = JSON.parse(typeof content === "string" ? content : "{}") || {};
    let autosaveSeen: boolean | null = null;
    try { autosaveSeen = typeof v.saved === "string" ? JSON.parse(v.saved)?.saved === true : null; } catch { autosaveSeen = null; }
    return { autosaveSeen, html: typeof v.html === "string" ? v.html : "", facts: v.facts ?? null };
  } catch {
    return { autosaveSeen: null, html: "", facts: null };
  }
}

export interface ReplyFacts {
  /** Who the reply reaches, as Gmail's compose holds it: bare, lower-cased addresses. Absent when unread. */
  reply?: { to: string[]; cc: string[]; bcc: string[] };
  /** The thread's newest message when the reply was composed (the one Reply all answers). */
  newestMessage?: { id: string; from: string; date: string };
}

const isAddress = (s: unknown): s is string => typeof s === "string" && /^[^\s@<>]+@[^\s@<>]+$/.test(s);
const addresses = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isAddress) ? (v as string[]) : null);

/**
 * REPLY_FACTS_EXPR's object -> what createReplyDraft returns. Each half only when it was read whole:
 * `reply` needs the compose found and at least one To; `newestMessage` a sender address and a date. A
 * caller treats a missing half as "read the thread yourself", never as "nobody".
 */
export function replyFactsFrom(raw: unknown): ReplyFacts {
  const out: ReplyFacts = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, any>;
  const to = addresses(r.to), cc = addresses(r.cc), bcc = addresses(r.bcc ?? []);
  if (r.composeFound === true && to && to.length > 0 && cc && bcc) out.reply = { to, cc, bcc };
  const n = r.newest;
  if (n && typeof n === "object" && isAddress(n.fromEmail) && typeof n.date === "string" && n.date.trim()) {
    out.newestMessage = {
      id: typeof n.id === "string" ? n.id : "",
      from: composeFrom(n.fromEmail, typeof n.fromName === "string" ? n.fromName : ""),
      date: n.date.trim(),
    };
  }
  return out;
}

/** In-page: #drafts is on screen, settled, and holds this thread's row. */
export function draftRowReadyExpr(threadId: string): string {
  assertThreadId(threadId);
  return `(function(){
  if (!(${DRAFTS_VIEW_READY_EXPR})) return false;
  return (${DRAFT_ROWS_EXPR}).some(function (r) { return r.threadId === ${JSON.stringify(threadId)}; });
})()`;
}

/**
 * Step 4, first attempt: click away from the compose (SAVE_AND_CLOSE_ACTIONS: a real save control, else
 * the subject heading, never the trash), switch to #drafts, and poll until the thread's draft row shows,
 * returning the rows either way. Later attempts are confirmDraftRowActions with `commit` false.
 */
export function confirmDraftRowActions(threadId: string, waitMs: number, commit: boolean) {
  return [
    ...(commit ? SAVE_AND_CLOSE_ACTIONS : []),
    { action: "evaluate", script: NAV_TO_DRAFTS_SCRIPT },
    { action: "evaluate", script: pollInPageScript(draftRowReadyExpr(threadId), DRAFT_ROWS_EXPR, waitMs) },
  ];
}
