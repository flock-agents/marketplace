// Shared, PURE helpers for reading Gmail's #drafts list. No browser, no
// side effects, and — critically — no script entrypoint: this file is safe to
// import from another skill script.
//
// It exists because createReplyDraft.ts and findDraftForThread.ts must agree
// exactly on how a #drafts row maps to a thread. They run in separate spawned
// processes, so they cannot share the scrape call itself, but the RULE must not
// diverge — if one of them ever matched rows differently from the other, the
// recovery lookup would disagree with the write it is recovering, which is the
// one thing that would make the duplicate guard worse than useless.
//
// Importing this from a skill script is safe. Importing createReplyDraft.ts
// would NOT be: its module body runs runScript() whenever SKILL_PARAMS is set,
// which is exactly the case inside any spawned skill process, so a helper
// import there would compose a real draft as a side effect.
//
// The `_` filename prefix marks it as a helper rather than a callable skill
// function, matching _shared/_google_helpers.ts.

export interface DraftListRow {
  /** Thread-scoped id Gmail navigates by (`#drafts/<id>`). NOT unique per draft. */
  draftId: string;
  threadId: string;
  /**
   * The draft's OWN message id (`data-legacy-last-message-id`), which is what
   * makes one draft distinguishable from another on the same thread.
   *
   * WHY (2026-09-09): `draftId` above is the thread's legacy id, so two drafts on
   * one thread are the same value -- and a thread really can hold two. Replying
   * to the LAST message opens a new draft even when one exists against an older
   * message; replying when a draft exists against the last message EDITS it. So
   * without this, a draft the owner wrote is indistinguishable from ours, and we
   * would type into it and then record it as ours.
   *
   * Empty when the attribute is absent (an older Gmail render, or a row scraped
   * before this existed). Callers treat empty as "cannot tell" and fall back to
   * the previous behaviour rather than refusing to work.
   */
  draftMessageId?: string;
}

/**
 * Find the draft id for `threadId` among scraped `#drafts` rows. Rows arrive
 * in Gmail's own list order (newest first), so the first match IS the most
 * recent — the tie-break falls out of that order rather than needing a
 * separate timestamp comparison. Returns null (never throws) when no row
 * matches: "no draft for this thread" is a legitimate answer a caller must be
 * able to tell apart from a hard failure.
 */
export function draftIdFromRows(rows: DraftListRow[], threadId: string): string | null {
  const match = draftRowForThread(rows, threadId);
  return match ? match.draftId : null;
}

/**
 * The whole row for a thread, not just its navigation id -- the caller usually
 * wants the draft's own message id too, to ask whether this is still the draft
 * it wrote. Same first-match-wins ordering as draftIdFromRows.
 */
export function draftRowForThread(rows: DraftListRow[], threadId: string): DraftListRow | null {
  const match = (rows || []).find((r) => r.threadId === threadId);
  return match ?? null;
}

/**
 * The in-page scrape both callers run against `#drafts`.
 *
 * DRAFT_ROWS_EXPR is the rule itself, as a bare in-page expression returning
 * the array; DRAFTS_SCRAPE_SCRIPT is that expression wrapped for callers that
 * want it as JSON on its own. Both callers build on the SAME expression so the
 * settled-wait lookup (which reads rows only once the list has rendered — see
 * _gmailNav.ts) cannot drift from the plain scrape.
 *
 * `#drafts` rows carry data-legacy-thread-id exactly as inbox rows do —
 * verified against three existing drafts, one of them a reply draft inside a
 * thread — and that id is what sendDraft already expects at `#drafts/<id>`.
 * For a reply draft the draft's own legacy id IS the thread's legacy id, which
 * is why one attribute serves as both draftId and threadId here, and why
 * finding "the draft for this thread" is a lookup rather than a search.
 */
export const DRAFT_ROWS_EXPR = `(function(){
  const rows = document.querySelectorAll('tr.zA');
  const out = [];
  rows.forEach(function(row){
    const idEl = row.querySelector('[data-legacy-thread-id]') || row.querySelector('[data-thread-id]');
    const id = (idEl && (idEl.getAttribute('data-legacy-thread-id') || idEl.getAttribute('data-thread-id'))) || '';
    // In the DRAFTS list the thread's last message IS the draft, so
    // data-legacy-last-message-id names the draft itself. Verified live against a
    // real drafts row: thread 1a0825bed76acd3f carried
    // data-legacy-last-message-id=1a0864d6c38b4ef4 alongside
    // data-legacy-last-non-draft-message-id=1a0825c99ba14014 (the newest real
    // message). Absent on an older render -> empty string, never a throw.
    const msgEl = row.querySelector('[data-legacy-last-message-id]');
    const msgId = (msgEl && msgEl.getAttribute('data-legacy-last-message-id')) || '';
    if (id) out.push({ draftId: id, threadId: id, draftMessageId: msgId });
  });
  return out;
})()`;

export const DRAFTS_SCRAPE_SCRIPT = `(() => JSON.stringify(${DRAFT_ROWS_EXPR}))()`;
