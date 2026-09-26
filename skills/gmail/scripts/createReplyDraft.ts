// createReplyDraft.ts — a threaded draft that returns its id (task-10 brief).
//
// Incident (2026-09-08): createDraft (a new compose) and replyToMessage (an
// in-thread reply) both return no id. A live run called createDraft, then
// replyToMessage, was killed by a timeout mid-write, then retried with
// createDraft again — three write calls, two drafts, no way to tell which
// draft was which. This script composes the reply IN the thread (so it
// threads correctly) and then polls Gmail's #drafts list for the row it just
// created, returning that row's id so the caller can address the exact draft
// it made.
//
// Reply-all is the CALLER's responsibility, not this script's: `to` and `cc`
// are taken verbatim (Ghostwriter §2b computes the full reply-all set from
// getThread's per-message to/cc) and are never trimmed, deduped, or "tidied"
// here — dropping a recipient silently removes someone from a thread they
// were on. Signature widened 2026-09-08 to match Stych's draft_email.
//
// This function must never send. It composes and saves a draft only — no
// path in this file calls or falls through to sendDraft/sendEmail.

import { draftRowForThread, DRAFT_ROWS_EXPR, type DraftListRow } from "./_draftRows";
import { gmailViewUrl, pollInPageScript, parsePollResult, DRAFTS_VIEW_READY_EXPR, NAV_TO_DRAFTS_SCRIPT } from "./_gmailNav";
import { extractDraftBody, COMPOSE_BODY_SCRAPE } from "./_draftBody";
import { hasTable, bodyToComposeHtml, writeComposeHtmlScript } from "./_bodyHtml";
import { findReplyAll, findReplyAllMenuItem } from "./_replyAll";
import { SAVE_AND_CLOSE_SCRIPT, waitForDraftSavedScript } from "./_composeSave";
import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentInteract,
  persistentClose,
} from "../../_shared/_google_helpers";
import { invalidateCachedThread, rememberDraftThread } from "./_threadCache";

// --- Pure extraction (unit-tested, no browser) ---

// The row matcher and the #drafts scrape live in _draftRows.ts so
// findDraftForThread.ts (the C3 recovery lookup) matches rows by exactly the
// same rule as the write it recovers. Re-exported here because this module was
// their original home and gmail-draft-id.test.ts imports them from it.
export { draftIdFromRows, type DraftListRow } from "./_draftRows";

// --- Script entrypoint (browser-driven compose) ---
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}



// Confirm the draft IN THE SESSION THAT WROTE IT, before that session is torn
// down. This used to open a SECOND persistent session against #drafts after
// closing the first, which was wrong twice over:
//
//   1. It destroyed the compose's browser context the moment the blur fired.
//      An inline reply that UPDATES an existing draft survives that; a
//      brand-new one does not -- verified live, a first draft on a clean thread
//      reported "Draft saved" and was then absent from #drafts, while the
//      identical compose left open persisted every time.
//   2. It then raced its own write across two contexts for no benefit.
//
// Switching this page to #drafts is also exactly what a person does to commit
// an inline reply -- click away from the compose -- so the commit and the
// confirmation are one action, and the draft is proven to exist before
// anything is destroyed.
//
// Bounded (3 attempts, 2s apart) so a missing row can never hang the 90s
// slow-function timeout, and "no row" stays a legitimate, reportable answer.
async function confirmDraftRow(persistentId: string, threadId: string, attempts = 3, delayMs = 2000): Promise<DraftListRow | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await persistentInteract(
        persistentId,
        [{ action: "evaluate", script: NAV_TO_DRAFTS_SCRIPT }],
        false,
        pollInPageScript(DRAFTS_VIEW_READY_EXPR, DRAFT_ROWS_EXPR, 25000),
      );
      const { result: rows } = parsePollResult<DraftListRow[]>(result?.content);
      const found = draftRowForThread(Array.isArray(rows) ? rows : [], threadId);
      if (found) return found;
    } catch {
      // A failed read means "not visible yet", never a throw out of the writer:
      // the draft may well exist, and the caller must be able to say so.
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const threadId: string = params.threadId || "";
  const to: string = params.to || "";
  const cc: string = params.cc || "";
  const subject: string = params.subject || "";
  const bodyText: string = params.body || "";

  requireBrowserSession();

  if (!threadId || !to) {
    errorJson("MISSING_PARAM", "threadId and to are required");
  }
  validateId(threadId, "threadId");

  (async () => {
    // Set inside the compose block below, read after it closes. Declared out here
    // deliberately: skills/ is NOT covered by server/tsconfig.json, so a
    // block-scoped variable used after its block would not be caught by tsc --
    // only by gmail-scripts-load.test.ts actually running the script.
    let savedBody = "";
    let openMode = "";
    let autosaveSeen: boolean | null = null;
    let draftRow: DraftListRow | null = null;
    // gmailViewUrl, not a bare fragment: a reused persistent page would treat
    // "#inbox/<id>" as a same-document navigation and leave the PREVIOUS view
    // up (see _gmailNav.ts). Here that is not merely a stale read -- the reply
    // controls we are about to click would belong to whatever thread was
    // already open, so the draft could be composed on the wrong thread.
    const sessionResult = await persistentCreate(gmailViewUrl(`#inbox/${threadId}`), undefined, { holdLock: true });
    const persistentId: string = sessionResult?.persistentSessionId || "";

    if (!persistentId) {
      errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail reply draft");
    }

    try {
      // Open the in-thread reply editor — same selectors replyToMessage.ts uses.
      // 20s/15s, not the original 5s: a thread took 19.6s to render on a measured
      // authenticated load. Ceilings, not delays -- they resolve as soon as the
      // selector appears, and this function has a 90s budget. See getThread.ts for
      // the diagnostic trap: a lapsed session also surfaces as a selector timeout.
      // RECIPIENTS COME FROM GMAIL'S OWN "REPLY ALL" (owner decision, 2026-09-09).
      //
      // We used to open a plain Reply and then overwrite To/Cc with the caller's
      // computed list, on the principle of never trusting Gmail's inference. That
      // principle cost more than it bought: verified live, an inline reply's To
      // field is present but 0x0 with its whole ancestor row collapsed, so the
      // fill reliably failed ("click: Timeout ... locator resolved to
      // <input size=0>") AFTER the compose was already open -- which both blocked
      // every draft and risked leaving a stray autosaved compose behind.
      //
      // Gmail's Reply all computes exactly what section 2b specifies: the sender plus
      // everyone on the triggering message's To and Cc, minus the owner. Letting
      // it do that removes the entire recipient-editing surface, and with it the
      // abort paths that could strand a half-written compose.
      //
      // Falls back to plain Reply when no Reply-all control is present, which is
      // Gmail's own behaviour for a single-recipient thread -- there, the two are
      // identical by construction.
      // FINDING "REPLY ALL" (owner, 2026-09-23). Live, a thread with two people
      // in Cc was drafted to the sender alone: Gmail's reply-all control at the
      // foot of a thread is a text link with neither of the attributes this used
      // to look for, so it fell back to plain Reply. The control is found by
      // attribute or by its text, "Reply to all" or "Reply all" (_replyAll.ts,
      // matched against the live element), then through the newest message's
      // "More" menu. When the executor says the thread needs
      // reply-all (requireReplyAll), plain Reply is never the fallback: the script
      // stops before typing anything, so no draft is written without the Cc.
      const requireReplyAll = params.requireReplyAll === true || params.requireReplyAll === "true";
      const findReplyAllScript = `(() => {
          const visible = (el) => !!el && el.offsetParent !== null;
          const lastOf = (sel) => { const all = [...document.querySelectorAll(sel)].filter(visible); return all[all.length - 1] || null; };
          const direct = (${findReplyAll.toString()})(document);
          if (direct) { direct.click(); window.__flockReplyMode = "reply-all"; return JSON.stringify({ step: "direct" }); }
          const more = lastOf('[aria-label="More message options"]') || lastOf('[aria-label="More"]') || lastOf('[data-tooltip="More"]');
          if (more) { more.click(); window.__flockReplyMode = "menu"; return JSON.stringify({ step: "menu-opened" }); }
          window.__flockReplyMode = "none";
          return JSON.stringify({ step: "none" });
        })()`;
      const settleReplyModeScript = `(() => {
          const visible = (el) => !!el && el.offsetParent !== null;
          let mode = window.__flockReplyMode || "none";
          if (mode === "menu") {
            const item = (${findReplyAllMenuItem.toString()})(document);
            if (item) { item.click(); mode = "reply-all"; }
            else { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); mode = "none"; }
          }
          if (mode === "reply-all") return JSON.stringify({ ok: true, mode });
          if (${requireReplyAll ? "true" : "false"}) return JSON.stringify({ ok: false, mode: "none" });
          const all = [...document.querySelectorAll('[aria-label="Reply"]')].filter(visible);
          const one = all[all.length - 1] || document.querySelector('.T-I-JW[data-tooltip="Reply"]');
          if (one) { one.click(); return JSON.stringify({ ok: true, mode: "reply" }); }
          return JSON.stringify({ ok: false, message: "no reply control found" });
        })()`;
      const openResult = await persistentInteract(persistentId, [
        { action: "waitForSelector", selector: `[aria-label="Reply"],[aria-label="Reply all"],.T-I-JW[data-tooltip="Reply"]`, delay: 20000 },
        { action: "evaluate", script: findReplyAllScript },
        { action: "wait", delay: 800 },
        { action: "evaluate", script: settleReplyModeScript },
      ]);
      const opened = (() => {
        try {
          return JSON.parse(typeof openResult?.content === "string" ? openResult.content : "{}") || {};
        } catch { return {}; }
      })();
      if (opened.ok !== true) {
        await persistentClose(persistentId).catch(() => {});
        if (requireReplyAll && opened.mode === "none") {
          errorJson("NOT_REPLY_ALL", "Could not open Reply all on this thread, and a plain Reply would leave out people on it. Nothing was typed and no draft was written.");
        }
        errorJson("BROWSER_ERROR", opened.message || "Could not open a reply on this thread.");
      }
      openMode = typeof opened.mode === "string" ? opened.mode : "";
      await persistentInteract(persistentId, [
        { action: "waitForSelector", selector: `div[aria-label*="Message"][contenteditable=true]`, delay: 15000 },
      ]);

      // No recipient editing: Gmail's Reply all already set them (see above).
      // NO SUBJECT STEP. Gmail's Reply all already sets the thread's own
      // "Re: ..." subject, which is exactly what the spec asks for (the subject
      // is carried through unchanged, never reworded), so there is nothing to
      // override and `subject` is advisory only.
      //
      // It also could not be done safely. An inline reply renders
      // input[name=subjectbox] but leaves it INVISIBLE, so the click failed with
      // "element is not visible" -- and the `.catch(() => {})` that was supposed
      // to make this step best-effort never ran, because persistentInteract
      // reports failure through errorJson, which calls process.exit(1) rather
      // than throwing. A promise catch cannot swallow an exit: any "best-effort"
      // step built on these helpers actually kills the whole draft.

      // Body
      // A body with a Markdown table is written as HTML so the table is real
      // (_bodyHtml.ts); every other body is typed, exactly as before.
      const bodyActions = [
        { action: "click", selector: `div[aria-label*="Message"][contenteditable=true]` },
        hasTable(bodyText)
          ? { action: "evaluate", script: writeComposeHtmlScript(bodyToComposeHtml(bodyText)) }
          : { action: "insertText", text: bodyText },
        // Belt-and-braces, NOT the fix. insertText delivers the text and fires
        // `input` but not keydown/keyup, and this pair was once believed to be
        // why Drafts stayed empty -- Gmail supposedly never being told the
        // compose was dirty. That was wrong: the body always saved, and the
        // close step then clicked Gmail's trash (see _composeSave.ts). Proven
        // live to be harmless and it costs nothing, so the real keystrokes
        // stay; a space followed by a backspace leaves the text identical.
        { action: "press", key: "Space" },
        { action: "press", key: "Backspace" },
      ];
      await persistentInteract(persistentId, bodyActions);

      // Wait for GMAIL to say it saved, rather than sleeping a fixed number of
      // seconds and hoping. Its autosave is debounced a couple of seconds after
      // the last input, so something must give it that time before teardown --
      // but a sleep long enough to be safe is also a sleep wasted on every
      // healthy call. Best-effort: a miss is not an error, because the #drafts
      // poll below is what actually decides whether a draft exists.
      try {
        const savedResult = await persistentInteract(persistentId, [], false, waitForDraftSavedScript(12000));
        const savedContent = typeof savedResult?.content === "string" ? savedResult.content : "";
        autosaveSeen = JSON.parse(savedContent || "{}")?.saved === true;
      } catch {
        autosaveSeen = null;
      }

      // I2: read back what Gmail ACTUALLY holds, while the compose is still
      // open and costs no extra navigation. The caller records this — not the
      // text we sent — as the owner-edit compare baseline, so every later
      // compare is read-vs-read through one transformation and is exact.
      // Storing the sent text instead is what made the compare report
      // "owner-edited" for every multi-paragraph body on an untouched draft.
      // Best-effort: a failed read-back leaves bodyAsSaved empty and the caller
      // falls back to the text it sent, which is no worse than before.
      let bodyAsSaved = "";
      try {
        const readBack = await persistentInteract(persistentId, [], false, COMPOSE_BODY_SCRAPE);
        const html = typeof readBack?.content === "string" ? readBack.content : "";
        bodyAsSaved = extractDraftBody(html);
      } catch {
        bodyAsSaved = "";
      }

      // Finish the compose — NEVER Send, and never Discard either.
      //
      // The old lookup here ended in `.og.T-I-J3`, which is not a save control
      // at all: it is Gmail's Discard draft trash. An inline reply has neither
      // of the two real save-and-close affordances, so every reply fell through
      // to it, and the script deleted the draft it had just saved. Gmail's own
      // snackbar said so -- "Draft discarded. Undo". That single click is the
      // whole bug; see _composeSave.ts for the live evidence.
      //
      // An inline reply needs no close click. Gmail has already autosaved it
      // (we waited for it to say so above), exactly as it does for a person who
      // types and then clicks away.
      await persistentInteract(persistentId, [
        { action: "evaluate", script: SAVE_AND_CLOSE_SCRIPT },
        // Room for Gmail to act on the blur it was just given. NOT a substitute
        // for the confirmation below -- the previous version tore the context
        // down in this very call, which is what lost brand-new drafts.
        { action: "wait", delay: 2000 },
      ]);
      savedBody = bodyAsSaved;

      // Prove the draft exists BEFORE this session dies (see confirmDraftRow).
      draftRow = await confirmDraftRow(persistentId, threadId);
    } finally {
      await persistentClose(persistentId).catch(() => {});
    }

    // A draft was composed on this thread, so its cached copy (whose hasDraft is now stale) must go —
    // even when the row could not be confirmed below, the compose did happen. When the draft id is
    // known, record draft->thread so a later updateDraft/sendDraft/discardDraft can drop this thread.
    const draftId = draftRow ? draftRow.draftId : null;
    invalidateCachedThread(threadId, "createReplyDraft");
    if (draftId) rememberDraftThread(draftId, threadId);

    if (!draftId) {
      // A usable failure, never a lie: the draft may have been composed but
      // its row hasn't shown up in #drafts yet — the caller must be able to
      // tell that apart from an actual failure, so this returns normally
      // (never throws / errorJson) with draftId: null and a reason.
      console.log(JSON.stringify({
        draftId: null,
        threadId,
        bodyAsSaved: savedBody,
        replyMode: openMode,
        autosaveConfirmed: autosaveSeen,
        reason: autosaveSeen === false
          ? "Gmail never showed its 'Draft saved' confirmation, and no row appeared in #drafts within 5 attempts (1s apart) — the reply was probably not saved."
          : "Draft was composed but its row did not appear in #drafts within 3 attempts (2s apart) — it may still be indexing.",
      }));
      return;
    }
    // draftMessageId is the draft's OWN id (see _draftRows.ts). The platform
    // records it so a later call can ask "is the draft on this thread still the
    // one we wrote?" -- a question `draftId` cannot answer, because it is the
    // thread's id and a thread can hold more than one draft.
    console.log(JSON.stringify({
      draftId,
      draftMessageId: draftRow?.draftMessageId || "",
      threadId,
      bodyAsSaved: savedBody,
      replyMode: openMode,
    }));
  })();
}
