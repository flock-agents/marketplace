// _draftList.ts — the WHOLE #drafts list, page by page, on one held session (2026-09-24).
//
// WHY. "Does this thread have a draft?" used to read only the first page of #drafts (~50 rows).
// Flock lands drafts automatically, so a mailbox can pass that; every older draft then read as
// "no draft". The reply-card check also needs this answer WITHOUT opening the conversation (a
// conversation-view read marks the thread read — thread 1a0d3d741892bc52, 2026-09-24).
//
// COMPLETE OR NOT. `complete: true` only when the walk reached a page whose Older control is
// disabled (or the folder is empty). Anything else is `complete: false`, but "found" (walked to
// the thread asked for) is a real answer — absence of OTHER threads is not. A caller must read
// "page_cap"/"no_pager"/"page_not_ready"/"deadline" as "could not look", never as "no draft".
//
// VISIBLE EVIDENCE ONLY (final review C1, 2026-09-24). A single scrape of this list is the ONLY
// evidence reply-card-reconcile has for dismissing a card, so "the page is ready" must mean real,
// on-screen proof — not the old LIST_SETTLED_EXPR, which counts document-wide `tr.zA` rows
// (Gmail keeps earlier list views in the DOM, HIDDEN — #drafts held 61 tr.zA for 11 real drafts)
// and treats Gmail's "No conversations" text as emptiness, even though that text was seen live on
// a page that still had rows. Readiness here requires a VISIBLE draft row or Gmail's own visible
// "you don't have any saved drafts" copy — "No conversations" is never accepted.
//
// Pure helper module: no SKILL_PARAMS entrypoint, safe to import from any script. The browser is
// behind DraftListIo so the walk is unit-tested without one.

import { type DraftListRow, draftRowForThread } from "./_draftRows";
import { gmailViewUrl, pollInPageScript, parsePollResult } from "./_gmailNav";
import { persistentCreate, persistentInteract, persistentClose } from "../../_shared/_google_helpers";

export const MAX_DRAFT_PAGES = 10;
// In practice the deadline below, not this cap, is what ends a long walk — each page is a full
// Gmail reload (persistentInteract navigates the URL fresh every time), so 10 pages of that cost
// far more wall-clock time than the deadline allows.
export const DRAFT_LIST_DEADLINE_MS = 55_000;
// Page 1 is a cold Gmail load (auth + first paint); later pages reuse the same session and only
// need to re-render the list, so they settle faster. Verified live 2026-09-24 (see _gmailNav.ts).
const PAGE_POLL_MS_FIRST = 25_000;
const PAGE_POLL_MS_LATER = 15_000;
function pagePollMs(page: number): number {
  return page === 1 ? PAGE_POLL_MS_FIRST : PAGE_POLL_MS_LATER;
}

export function draftsPageHash(page: number): string {
  return page <= 1 ? "#drafts" : `#drafts/p${page}`;
}

// The visible Older control: true = enabled (more pages), false = disabled (last page),
// null = not found. Verified live 2026-09-24: several Older controls exist, only one visible;
// the visible one carries aria-disabled="true" on the last page and nothing otherwise.
const OLDER_BUTTON_EXPR = `(function(){
  var els = document.querySelectorAll('[role="button"][aria-label="Older"], [role="button"][data-tooltip="Older"]');
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return els[i].getAttribute('aria-disabled') !== 'true';
  }
  return null;
})()`;

// VISIBLE rows only. Gmail keeps earlier list views in the DOM, hidden (probed 2026-09-24:
// #drafts held 61 tr.zA for 11 drafts — 50 were the hidden inbox). Same row rule as
// DRAFT_ROWS_EXPR (_draftRows.ts), restricted to rows that take up space on screen.
// DRAFT_ROWS_EXPR itself is left as is: createReplyDraft relies on it and is live-verified.
const VISIBLE_DRAFT_ROWS_EXPR = `(function(){
  var out = [];
  var rows = document.querySelectorAll('tr.zA');
  for (var i = 0; i < rows.length; i++) {
    var b = rows[i].getBoundingClientRect();
    if (!(b.width > 0 && b.height > 0)) continue;
    var idEl = rows[i].querySelector('[data-legacy-thread-id]') || rows[i].querySelector('[data-thread-id]');
    var id = (idEl && (idEl.getAttribute('data-legacy-thread-id') || idEl.getAttribute('data-thread-id'))) || '';
    // Same rule as DRAFT_ROWS_EXPR (_draftRows.ts): data-legacy-last-message-id names the draft
    // only while it is the thread's newest item. Equal ids (a reply landed after the draft) or a
    // missing attribute mean the row cannot say which message is the draft -- "" (unknown) is the
    // only honest answer.
    var lastEl = rows[i].querySelector('[data-legacy-last-message-id]');
    var last = (lastEl && lastEl.getAttribute('data-legacy-last-message-id')) || '';
    var nonDraftEl = rows[i].querySelector('[data-legacy-last-non-draft-message-id]');
    var lastNonDraft = (nonDraftEl && nonDraftEl.getAttribute('data-legacy-last-non-draft-message-id')) || '';
    var msgId = (last && lastNonDraft && last !== lastNonDraft) ? last : '';
    if (id) out.push({ draftId: id, threadId: id, draftMessageId: msgId });
  }
  return out;
})()`;

// VISIBLE Gmail's-own-empty-drafts copy only. Deliberately narrower than _gmailNav.ts's
// LIST_SETTLED_EXPR: that also accepts "No conversations", which was seen live on a page that
// still held rows (final review C1) — never good enough evidence to end this walk as complete.
// Same "several candidates, only one visible" pattern as OLDER_BUTTON_EXPR above: Gmail can keep
// a previous, hidden view's own "No conversations" text in the DOM alongside the real one.
const VISIBLE_EMPTY_DRAFTS_MSG_EXPR = `(function(){
  var mains = document.querySelectorAll('div[role="main"]');
  for (var i = 0; i < mains.length; i++) {
    var r = mains[i].getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    var text = mains[i].innerText || mains[i].textContent || '';
    if (/don't have any saved drafts|no saved drafts/i.test(text)) return true;
  }
  return false;
})()`;

// Ready = this page's hash is on screen, there is VISIBLE evidence it rendered (a visible draft
// row, or Gmail's own visible empty-drafts message — never "No conversations", see above), and
// (after page 1) its first VISIBLE row is not the previous page's first row — Gmail swaps the
// hash before the rows.
export function pageReadyExpr(page: number, prevFirstId: string): string {
  // document.location, not the bare global -- identical in a real browser, and it lets a fake-DOM
  // test drive this expression with `new Function("document", ...)` and no separate location arg.
  return `(function(){
  if (document.location.hash !== ${JSON.stringify(draftsPageHash(page))}) return false;
  var rows = ${VISIBLE_DRAFT_ROWS_EXPR};
  if (rows.length === 0 && !(${VISIBLE_EMPTY_DRAFTS_MSG_EXPR})) return false;
  var prev = ${JSON.stringify(prevFirstId)};
  if (!prev) return true;
  return rows.length === 0 || rows[0].threadId !== prev;
})()`;
}

export const PAGE_EXPR = `({ rows: ${VISIBLE_DRAFT_ROWS_EXPR}, hasOlder: ${OLDER_BUTTON_EXPR}, emptyMsg: ${VISIBLE_EMPTY_DRAFTS_MSG_EXPR} })`;

export interface DraftListIo {
  open(url: string, actions: unknown[]): Promise<{ psId: string; content: unknown }>;
  go(psId: string, url: string, actions: unknown[]): Promise<{ content: unknown }>;
  close(psId: string): Promise<void>;
}

export interface DraftListRead {
  rows: DraftListRow[];
  complete: boolean;
  pages: number;
  /**
   * Reason for walk termination:
   * - "end": reached a page with Older disabled or empty folder (complete=true)
   * - "found": thread asked for was found on a page read (complete=false, but this is a real answer)
   * - "page_cap": hit the max page limit (complete=false, could not look)
   * - "no_pager": page had rows but no Older control found (complete=false, could not look)
   * - "page_not_ready": page never rendered or settled (complete=false, could not look)
   * - "deadline": hit the wall-clock deadline (complete=false, could not look)
   */
  reason: "end" | "found" | "page_cap" | "no_pager" | "page_not_ready" | "deadline";
}

type PageResult = { rows: DraftListRow[]; hasOlder: boolean | null; emptyMsg: boolean };

export async function readDraftList(
  io: DraftListIo,
  opts: { stopAtThreadId?: string; maxPages?: number; deadlineMs?: number; now?: () => number } = {},
): Promise<DraftListRead> {
  const maxPages = opts.maxPages ?? MAX_DRAFT_PAGES;
  const deadlineMs = opts.deadlineMs ?? DRAFT_LIST_DEADLINE_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const rows: DraftListRow[] = [];
  let psId = "";
  let prevFirstId = "";
  try {
    for (let page = 1; ; page++) {
      if (page > 1 && now() - startedAt >= deadlineMs) {
        return { rows, complete: false, pages: page - 1, reason: "deadline" };
      }
      const actions = [{ action: "evaluate", script: pollInPageScript(pageReadyExpr(page, prevFirstId), PAGE_EXPR, pagePollMs(page)) }];
      const url = gmailViewUrl(draftsPageHash(page));
      const res = page === 1 ? await io.open(url, actions) : await io.go(psId, url, actions);
      if (page === 1) psId = (res as { psId: string }).psId;
      const poll = parsePollResult<PageResult>(res.content);
      if (!poll.ready || !poll.result) return { rows, complete: false, pages: page - 1, reason: "page_not_ready" };
      const pageRows = Array.isArray(poll.result.rows) ? poll.result.rows : [];
      rows.push(...pageRows);
      if (opts.stopAtThreadId && pageRows.some((r) => r.threadId === opts.stopAtThreadId)) {
        return { rows, complete: false, pages: page, reason: "found" };
      }
      if (pageRows.length === 0) {
        // "end" only on page 1 with Gmail's own visible empty-drafts message as proof — a later
        // page exists ONLY because a previous page's Older control was enabled, so zero visible
        // rows there is a rendering race, never a legitimate empty folder (final review C1).
        if (page === 1 && poll.result.emptyMsg) return { rows, complete: true, pages: page, reason: "end" };
        return { rows, complete: false, pages: page, reason: "page_not_ready" };
      }
      if (poll.result.hasOlder === null) return { rows, complete: false, pages: page, reason: "no_pager" };
      if (poll.result.hasOlder === false) return { rows, complete: true, pages: page, reason: "end" };
      if (page >= maxPages) return { rows, complete: false, pages: page, reason: "page_cap" };
      prevFirstId = pageRows[0].threadId;
    }
  } finally {
    if (psId) await io.close(psId).catch(() => {});
  }
}

/** findDraftForThread's answer. "incomplete" = could not look; the script exits non-zero on it. */
export function lookupFromRead(read: DraftListRead, threadId: string):
  { threadId: string; draftId: string | null; draftMessageId: string } | "incomplete" {
  const hit = draftRowForThread(read.rows, threadId);
  if (hit) return { threadId, draftId: hit.draftId, draftMessageId: hit.draftMessageId || "" };
  return read.complete ? { threadId, draftId: null, draftMessageId: "" } : "incomplete";
}

// The walk can't START a page after DRAFT_LIST_DEADLINE_MS, and one page in flight can still take
// up to its own poll ceiling (25s on page 1, 15s later) to resolve -- the hold must outlive both,
// plus headroom for the platform's own overhead. 85_000 = DRAFT_LIST_DEADLINE_MS (55_000) + the
// longest single-page poll (25_000) + 5_000 of margin (final review I2/I3, 2026-09-24: the
// previous hold, 95_000, sat above the 90s skill limit).
export const DRAFT_LIST_HOLD_MAX_MS = 85_000;

/** The real browser behind readDraftList: one session, lock held across every page so no other
 *  caller navigates it between pages (the 2026-09-09 split-sequence race, findDraftForThread.ts). */
export function browserDraftListIo(): DraftListIo {
  return {
    open: async (url, actions) => {
      const res = await persistentCreate(url, actions, { holdLock: true, holdMaxMs: DRAFT_LIST_HOLD_MAX_MS });
      const psId = res?.persistentSessionId || "";
      if (!psId) throw new Error("Failed to create persistent session for the Gmail drafts list");
      return { psId, content: res?.content };
    },
    go: async (psId, url, actions) => {
      const res = await persistentInteract(psId, actions, false, undefined, url);
      return { content: res?.content };
    },
    close: (psId) => persistentClose(psId),
  };
}
