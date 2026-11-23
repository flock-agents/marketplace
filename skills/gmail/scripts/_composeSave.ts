// Shared, PURE compose-save helpers. No browser, no side effects and no script
// entrypoint — safe to import from another skill script, for the same reason
// _draftRows.ts and _draftBody.ts are (importing a real script would run its
// runScript() as an import side effect).
//
// WHY THIS EXISTS — the 2026-09-09 "the draft never saves" bug
// -----------------------------------------------------------
// Every Gmail writer used to end with this "save & close" lookup:
//
//   document.querySelector('.Ha img.Ha-Jj')
//     || document.querySelector('[aria-label="Save & close"]')
//     || document.querySelector('.og.T-I-J3')      // <-- NOT a save control
//
// The third selector is Gmail's DISCARD DRAFT (trash) control. On the popup
// composer createDraft.ts drives, the first selector matches, so the lookup
// short-circuits and the trash is never reached — which is the only reason
// createDraft appeared to work. On an INLINE reply neither of the first two
// exists, so the lookup fell through to the trash and clicked it.
//
// Verified live against a real mailbox, one variable at a time:
//   - compose + type, no close step        -> "Draft saved", Drafts (1). Saved.
//   - same, then the close lookup's click  -> Drafts 0, and Gmail's own
//                                             snackbar reads "Draft discarded.
//                                             Undo".
//
// So the draft was never failing to save. It saved, and then we deleted it.
// That is also why the symptom was so confusing: the body read back verbatim
// from the compose DOM (it really had been typed) while Drafts stayed empty.
//
// The same lookup sat in updateDraft.ts, where it is worse than a lost draft:
// a reply draft opens INLINE, so editing an owner's draft would have written
// the new body and then thrown the whole draft away.
//
// RULE: never reach for a "close" control by guessing. A save affordance is
// named as one; anything unnamed may be the trash.

import { markThenClick } from "./_gmailPress";

/**
 * Gmail's Discard draft control. Exported ONLY so callers and tests can name
 * the thing they must never click. Clicking this destroys the draft.
 */
export const DISCARD_DRAFT_SELECTOR = ".og.T-I-J3";

/**
 * The two controls that genuinely save-and-close a compose. Both belong to the
 * POPUP composer; an inline reply has neither, and does not need them (Gmail
 * autosaves it — see WAIT_FOR_DRAFT_SAVED_SCRIPT).
 */
export const SAVE_AND_CLOSE_SELECTORS = ['.Ha img.Ha-Jj', '[aria-label="Save & close"]'];

/** The mark SAVE_AND_CLOSE_SCRIPT puts on the element the finishing click hits. */
const SAVE_CLOSE_TARGET = "save-close";

/**
 * Finish a compose WITHOUT ever risking the draft.
 *
 * Marks a real save-and-close control when one is on screen (popup composer);
 * otherwise marks the thread's subject heading, so the click lands away from
 * the editor and leaves the compose alone, because Gmail has already autosaved
 * it. Clicking away is what the owner does by hand -- "typing something and
 * then clicking outside saves the draft" -- and, unlike the old fallback, it
 * cannot delete anything. Neither on screen: nothing is marked or clicked.
 *
 * Returns JSON: { ok: true, how: "save-and-close" | "autosaved-inline" }.
 *
 * The click is a real click page action (SAVE_AND_CLOSE_ACTIONS, _gmailPress.ts),
 * never an in-page `.click()` or dispatched mouse events: Gmail's div[role=button]
 * controls ignore the first (task 28) and Google can tell the second from real input.
 */
export const SAVE_AND_CLOSE_SCRIPT = `(() => {
  const saveClose = document.querySelector('.Ha img.Ha-Jj') ||
                    document.querySelector('[aria-label="Save & close"]');
  if (saveClose && mark(saveClose, "${SAVE_CLOSE_TARGET}")) return JSON.stringify({ok:true, how:"save-and-close"});
  mark(document.querySelector('h2.hP'), "${SAVE_CLOSE_TARGET}");
  return JSON.stringify({ok:true, how:"autosaved-inline"});
})()`;

/** SAVE_AND_CLOSE_SCRIPT, the real click on what it marked, and its result as the step's last. */
export const SAVE_AND_CLOSE_ACTIONS = markThenClick(SAVE_CLOSE_TARGET, SAVE_AND_CLOSE_SCRIPT);

/**
 * Wait for Gmail's OWN "Draft saved" confirmation rather than sleeping a fixed
 * number of seconds and hoping. Gmail's autosave is debounced a few seconds
 * after the last input, and the indicator is transient — it appears for a
 * second or two and then clears — so this polls in the page (250ms) instead of
 * sampling it once and missing it.
 *
 * Best-effort by design: `saved:false` is NOT an error, because the authority
 * on whether a draft exists is the #drafts list the caller polls afterwards.
 * This only buys the autosave its debounce before the session is torn down.
 *
 * `fresh` (updateDraft, 2026-10-05): count only an indicator that appears AFTER one was absent.
 * An already-open draft can show a "Draft saved" left from before the edit, which proves nothing
 * about the edit; Gmail swaps it for "Saving…" while the edit's own save runs.
 */
export function waitForDraftSavedScript(timeoutMs = 12000, fresh = false): string {
  return `(async () => {
  const started = Date.now();
  const deadline = started + ${Math.max(0, Math.floor(timeoutMs))};
  let absentSeen = ${fresh ? "false" : "true"};
  const seen = () => {
    const nodes = document.querySelectorAll('span,div');
    for (const el of nodes) {
      if (el.children.length !== 0) continue;
      if (/^Draft saved/i.test((el.textContent || '').trim())) return true;
    }
    return false;
  };
  while (Date.now() < deadline) {
    if (!seen()) absentSeen = true;
    else if (absentSeen) return JSON.stringify({saved:true, waitedMs: Date.now() - started});
    await new Promise((r) => setTimeout(r, 250));
  }
  return JSON.stringify({saved:false, waitedMs: Date.now() - started});
})()`;
}

/**
 * Pure guard used by the regression test: does this in-page script reach for
 * Gmail's discard control? A writer that "saves" by clicking the trash is the
 * exact bug this module exists to prevent, and it is invisible to tsc — so it
 * is asserted against the script text instead.
 */
export function clicksDiscardControl(script: string): boolean {
  return (script || "").includes(DISCARD_DRAFT_SELECTOR);
}
