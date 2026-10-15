// discardDraft.ts — delete one draft.
//
// THIS IS THE ONLY DESTRUCTIVE FUNCTION IN THIS SKILL. Read the guards below
// before changing anything in it.
//
// WHY IT EXISTS (owner decision, 2026-09-09): Gmail allows two drafts in one
// thread when they answer different messages, but the draft ADDRESSING this
// skill uses does not — for a reply draft the draft's own legacy id IS the
// thread's legacy id (see _draftRows.ts), so `#drafts/<id>` cannot distinguish
// two drafts on one thread. getDraft, updateDraft and findDraftForThread all
// address drafts that way. Discarding our previous unsent draft before writing
// a new one for a later message keeps one draft per thread, which is what those
// three already assume.
//
// THE CALLER MUST HAVE PROVEN THE DRAFT IS UNTOUCHED. This function does not
// and cannot check: it takes a draft id and deletes it. skill-executor.ts is the
// only caller, and it refuses to call this unless the owner-edit compare
// (draft-records.ts draftStatus) returned "untouched" against a baseline read
// back from Gmail itself. Deleting a draft the owner has edited destroys
// writing that cannot be recovered — the exact asymmetry this branch's "fail
// closed at action" rule exists for.
//
// IT MUST NEVER SEND. The discard control sits in the same compose toolbar as
// Send, so the selectors below are pinned to Gmail's discard affordances only,
// and the click is verified to have hit an element whose own aria-label/tooltip
// says discard. If none matches, this reports a failure and changes nothing —
// it never falls back to "click something in the toolbar", and it never clicks
// by position.
//
// Input  (SKILL_PARAMS): { draftId: string }
// Output (stdout JSON):  { draftId, discarded: boolean }

import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentInteract,
  persistentClose,
} from "../../_shared/_google_helpers";
import { invalidateCachedThreadForDraft } from "./_threadCache";
import { gmailViewUrl, pollInPageScript, parsePollResult, COMPOSE_OPEN_EXPR, DRAFTS_VIEW_READY_EXPR, NAV_TO_DRAFTS_SCRIPT } from "./_gmailNav";
import { draftIdFromRows, DRAFT_ROWS_EXPR, type DraftListRow } from "./_draftRows";

// Click Gmail's discard control, and ONLY that. Every selector names a discard
// affordance explicitly; there is no positional fallback and no generic
// toolbar-button search. The element's own label is re-checked after selection,
// so a Gmail markup change that made one of these selectors match a different
// button (Send being the one that matters) fails the check instead of firing.
const DISCARD_SCRIPT = `(() => {
  const SELECTORS = [
    '[aria-label="Discard draft"]',
    '[data-tooltip="Discard draft"]',
    '[aria-label^="Discard"]',
    '[data-tooltip^="Discard"]',
  ];
  let btn = null;
  for (const sel of SELECTORS) {
    const found = document.querySelector(sel);
    if (found) { btn = found; break; }
  }
  if (!btn) return JSON.stringify({ ok: false, reason: 'no-discard-control' });

  // Belt and braces: whatever we matched must SAY discard. If Gmail ever reuses
  // one of these attributes for another control, refuse rather than click it.
  const label = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('data-tooltip') || '')).toLowerCase();
  if (label.indexOf('discard') === -1) {
    return JSON.stringify({ ok: false, reason: 'control-label-mismatch:' + label.trim() });
  }
  if (label.indexOf('send') !== -1) {
    return JSON.stringify({ ok: false, reason: 'refusing-send-adjacent-control' });
  }

  btn.click();
  return JSON.stringify({ ok: true });
})()`;


// Declared above the invocation guard on purpose: `runScript()` hoists, a
// `const` does not. With the guard first, the script dies with "Cannot access
// 'DISCARD_SCRIPT' before initialization" on its first real call -- and unit
// tests never see it, because they import without SKILL_PARAMS so the body
// never runs.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const draftId: string = params.draftId || "";

  requireBrowserSession();

  if (!draftId) {
    errorJson("MISSING_PARAM", "draftId is required");
  }
  validateId(draftId, "draftId");

  (async () => {
    let psId = "";
    try {
      // gmailViewUrl + a wait for the draft to actually OPEN before looking
      // for its discard control. With a fragment-only navigation on a reused
      // page (see _gmailNav.ts) this ran against the previous view, where
      // DISCARD_SCRIPT found nothing to click -- and a discard that never
      // happened was reported as {discarded: true}.
      const created = await persistentCreate(gmailViewUrl(`#drafts/${draftId}`), undefined, { holdLock: true });
      psId = created?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for the draft");
      }

      const opened = await persistentInteract(
        psId,
        [],
        false,
        pollInPageScript(COMPOSE_OPEN_EXPR, "true", 25000),
      );
      if (!parsePollResult<boolean>(opened?.content).ready) {
        // The draft never opened: it is already gone, or Gmail never got
        // there. Either way there is nothing to click, and claiming a discard
        // would let a caller write a replacement beside a draft that may still
        // exist.
        await persistentClose(psId).catch(() => {});
        psId = "";
        errorJson("DRAFT_NOT_FOUND", `Draft ${draftId} did not open — not reporting a discard that did not happen.`);
      }

      const result = await persistentInteract(
        psId,
        [],
        false,
        DISCARD_SCRIPT,
      );
      const content = typeof result?.content === "string" ? result.content : "";
      let outcome: { ok?: boolean; reason?: string } = {};
      try {
        outcome = JSON.parse(content);
      } catch {
        outcome = {};
      }

      if (!outcome.ok) {
        // Report the failure rather than claiming a discard that did not
        // happen: the caller is about to write a replacement draft and must be
        // able to decide not to, rather than leave two drafts behind.
        // Close first — errorJson exits the process, so the finally below would
        // never run and the session would leak (the same reason
        // createReplyDraft.ts closes before its own abort paths).
        await persistentClose(psId).catch(() => {});
        psId = "";
        errorJson("BROWSER_ERROR", `Could not discard draft ${draftId} (${outcome.reason || "unknown"})`);
      }

      // PROVE the row is gone before reporting a discard. A 1000ms sleep used
      // to stand here, and it was not enough: verified live, a caller that
      // discarded a superseded draft and immediately composed a replacement got
      // Gmail's Reply reopening the DISCARDED draft, so the new text was
      // appended to the old body instead of replacing it. The same compose run
      // after a settled discard came back clean.
      //
      // Fails CLOSED. "I clicked discard" is not the same claim as "the draft
      // is gone", and the caller of this function is usually about to write a
      // replacement beside whatever is left.
      let gone = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const check = await persistentInteract(
            psId,
            [{ action: "evaluate", script: NAV_TO_DRAFTS_SCRIPT }],
            false,
            pollInPageScript(DRAFTS_VIEW_READY_EXPR, DRAFT_ROWS_EXPR, 20000),
          );
          const { result: rows } = parsePollResult<DraftListRow[]>(check?.content);
          if (!draftIdFromRows(Array.isArray(rows) ? rows : [], draftId)) { gone = true; break; }
        } catch {
          // A failed read is not proof of removal — keep trying, then fail closed.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (!gone) {
        await persistentClose(psId).catch(() => {});
        psId = "";
        errorJson(
          "DISCARD_UNCONFIRMED",
          `Clicked discard for draft ${draftId}, but its row is still in #drafts — not reporting a discard that cannot be confirmed.`,
        );
      }

      // Discarding removed the draft from its thread; drop the thread's cached copy (its hasDraft is stale).
      invalidateCachedThreadForDraft(draftId, "discardDraft");
      console.log(JSON.stringify({ draftId, discarded: true }));
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }
  })().catch((err: any) => {
    errorJson("BROWSER_ERROR", `Discard failed for draft ${draftId}: ${err?.message || err}`);
  });
}
