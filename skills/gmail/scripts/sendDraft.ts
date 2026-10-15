// sendDraft.ts — send an existing Gmail draft as-is.
//
// Task 26a (live 2026-10-02): this used to open `#drafts/<id>` by bare hash on a
// reused persistent page, sleep 3s, and click Send on WHATEVER compose was open.
// A fragment-only goto does not reload (_gmailNav.ts), so on a page another
// caller was using it could fail -- or SEND A DIFFERENT DRAFT. Now it opens the
// draft the getDraft way (gmailViewUrl + an in-page poll, ONE call), and clicks
// Send only inside the expression that has just verified the open compose
// belongs to draftId (_openDraft.ts). Anything else sends nothing.
//
// Task 28: the press is a real mouse sequence on the compose's own Send, and the
// result says sent ONLY once Gmail confirmed it (see below).
//
// The pure request builder is exported and unit-tested (gmail-open-draft.test.ts);
// the browser body runs only when SKILL_PARAMS is set.

import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentClose,
} from "../../_shared/_google_helpers";
import { invalidateCachedThreadForDraft } from "./_threadCache";
import { openDraftRequest, parseOpenedDraft, draftNotOpenMessage, findDraftCompose, hashNamesOtherId, DRAFT_NOT_OPEN_SENT } from "./_openDraft";
import { findComposeSend, pressGmailButton, findGmailNotice } from "./_gmailPress";

// Task 28 (live 2026-10-02 23:39, 35626): `sendBtn.click()` reported "Draft sent
// successfully" and Gmail sent nothing -- its div[role=button] controls ignore an
// in-page .click(). Now: press Send with real mouse events (_gmailPress.ts), then
// WAIT for Gmail to confirm, and report sent only on that confirmation. The press
// is never retried: a second press could send twice.

/** window keys the open step leaves for the confirmation step (same request, same page). */
const STEP_KEY = "__flockSendStep";
const EDITOR_KEY = "__flockSendEditor";

/** How long the confirmation step waits for Gmail after the press. */
export const SEND_CONFIRM_TIMEOUT_MS = 10000;
/** With the editor gone, how much longer to wait for Gmail's "Message sent" before accepting the editor-gone signal. */
export const SEND_GONE_GRACE_MS = 3000;
/**
 * Undo Send (fix round 1): Gmail's undo window is 5-30s, and "Message sent · Undo"
 * shows while the send is still cancellable. Closing the page inside that window
 * can cancel or lose the send. So after confirmation the page stays open until
 * the notice no longer offers Undo, capped here.
 */
export const SEND_UNDO_CAP_MS = 35000;
/** No Undo and no "Sending…" must hold this long before the undo window counts as closed. */
export const SEND_UNDO_SETTLE_MS = 1500;

/**
 * `composes` is how many compose editors the page holds AT ALL (fix round 1):
 * a re-render that briefly drops the heading, or a hash the draft check
 * rejects, must not read as "no compose for this draft".
 */
export type SendObservation = { notice: string; editorPresent: boolean; composes: number };

/**
 * Did Gmail confirm the send? Its "Message sent" notice -> sent ("notice").
 * Otherwise the pressed editor detached AND the page holds no compose editor at
 * all -> sent ("editor-gone"; the caller also requires it to last). Anything
 * else -> not sent ("none"). A "Sending…" notice alone is not a confirmation.
 * Self-contained: it runs in the page too.
 */
export function judgeSendOutcome(o: SendObservation): { sent: boolean; how: "notice" | "editor-gone" | "none" } {
  if (o && /message sent/i.test(o.notice || "")) return { sent: true, how: "notice" };
  if (o && o.editorPresent === false && o.composes === 0) return { sent: true, how: "editor-gone" };
  return { sent: false, how: "none" };
}

/**
 * Is Gmail's undo window still open? A notice offering Undo (its text, or the
 * `#link_undo` control) or one still saying "Sending…" -> open. Self-contained.
 */
export function undoWindowOpen(doc: Document): boolean {
  if (doc.querySelector('#link_undo, [id^="link_undo"]')) return true;
  const nodes = doc.querySelectorAll('[role="alert"], .bAq');
  for (let i = 0; i < nodes.length; i++) {
    const n: any = nodes[i];
    const text = String((typeof n.innerText === "string" && n.innerText) || n.textContent || "");
    if (/\bundo\b|sending/i.test(text)) return true;
  }
  return false;
}

/** The caller-facing failure when Gmail never confirmed, naming what the page showed. */
export function sendNotConfirmedMessage(result: { notice?: unknown; editorPresent?: unknown; composes?: unknown; confirm?: unknown } | null | undefined): string {
  const r: any = result || {};
  const notice = typeof r.notice === "string" && r.notice ? r.notice : "none";
  const editor = typeof r.editorPresent === "boolean" ? String(r.editorPresent) : "?";
  const composes = typeof r.composes === "number" ? String(r.composes) : "?";
  if (r.confirm === "undo-open") {
    return `Send was pressed and Gmail showed Message sent, but its undo window did not close within ${Math.round(SEND_UNDO_CAP_MS / 1000)}s; check Gmail (notice=${notice}, editorPresent=${editor}, composes=${composes}).`;
  }
  return `Send was pressed but Gmail did not confirm it was sent. Check the thread in Gmail before trying again (notice=${notice}, editorPresent=${editor}, composes=${composes}).`;
}

/**
 * In-page step 1 body (runs inside onDraftComposeExpr, so `compose` is the
 * VERIFIED editor): find THIS compose's Send by a bounded walk, press it with
 * mouse events, and keep the editor for the confirmation step. `ok` stays false
 * here: only the confirmation step may say sent.
 */
function pressSendBody(): string {
  return `
    var f = (${findComposeSend.toString()})(compose);
    if (!f.button) return { ok: false, pressed: false, message: "Send button not found in this draft's compose (container=" + f.container + ", candidates=" + f.seen + ")" };
    var pressed = (${pressGmailButton.toString()})(f.button);
    if (!pressed) return { ok: false, pressed: false, message: "Send button was not on screen (container=" + f.container + ")" };
    window[${JSON.stringify(EDITOR_KEY)}] = compose;
    return { ok: false, pressed: true, container: f.container };
  `;
}

/**
 * In-page step 2: read step 1's result and, only when it pressed Send, poll for
 * Gmail's confirmation (judgeSendOutcome; editor-gone must last goneGraceMs),
 * then keep the page open until the undo window closes (undoWindowOpen false
 * for SEND_UNDO_SETTLE_MS), capped at undoCapMs. Hitting the cap is NOT sent
 * (`confirm: "undo-open"`). Returns the pollInPageScript shape
 * `{ ready, waitedMs, result }` so parseOpenedDraft reads it; `result` is step
 * 1's result plus `ok`, `confirm`, `notice`, `editorPresent`, `composes`.
 * Never presses anything.
 */
export function sendConfirmScript(
  draftId: string,
  timeoutMs = SEND_CONFIRM_TIMEOUT_MS,
  goneGraceMs = SEND_GONE_GRACE_MS,
  undoCapMs = SEND_UNDO_CAP_MS,
  undoSettleMs = SEND_UNDO_SETTLE_MS,
): string {
  return `(async () => {
  var step = window[${JSON.stringify(STEP_KEY)}] || null;
  var editor = window[${JSON.stringify(EDITOR_KEY)}] || null;
  try { delete window[${JSON.stringify(STEP_KEY)}]; delete window[${JSON.stringify(EDITOR_KEY)}]; } catch (e) {}
  // No step result at all means the page changed under us after the open step: Send may have
  // been pressed, so report "not confirmed" (check Gmail), never "nothing was sent".
  if (!step) return JSON.stringify({ ready: false, waitedMs: 0, result: { opened: true, pressed: true, ok: false, confirm: 'none', notice: 'page changed before confirmation', editorPresent: !!editor && document.contains(editor) } });
  if (step.opened !== true || step.pressed !== true) return JSON.stringify({ ready: false, waitedMs: 0, result: step });
  var judge = ${judgeSendOutcome.toString()};
  var undoOpen = ${undoWindowOpen.toString()};
  var find = ${findDraftCompose.toString()};
  var hashRule = ${hashNamesOtherId.toString()};
  var notice = ${findGmailNotice.toString()};
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var observe = function () {
    return {
      notice: notice(document, /message sent/i) || notice(document, /./),
      editorPresent: !!editor && document.contains(editor),
      composes: find(document, ${JSON.stringify(draftId)}, hashRule).composes,
    };
  };
  var started = Date.now(), deadline = started + ${Math.max(0, Math.floor(timeoutMs))}, goneAt = 0;
  var obs = observe(), verdict = judge(obs);
  while (Date.now() < deadline) {
    if (verdict.how === 'notice') break;
    if (verdict.how === 'editor-gone') {
      if (!goneAt) goneAt = Date.now();
      if (Date.now() - goneAt >= ${Math.max(0, Math.floor(goneGraceMs))}) break;
    } else { goneAt = 0; }
    await sleep(250);
    obs = observe(); verdict = judge(obs);
  }
  // editor-gone counts only when it lasted the whole grace window.
  if (verdict.how === 'editor-gone' && (!goneAt || Date.now() - goneAt < ${Math.max(0, Math.floor(goneGraceMs))})) verdict = { sent: false, how: 'none' };
  var how = verdict.how, ok = verdict.sent;
  if (ok) {
    // Undo window: stay until no Undo / "Sending…" for undoSettleMs, capped.
    var undoDeadline = Date.now() + ${Math.max(0, Math.floor(undoCapMs))}, clearSince = 0, closed = false;
    for (;;) {
      if (undoOpen(document)) clearSince = 0;
      else if (!clearSince) clearSince = Date.now();
      if (clearSince && Date.now() - clearSince >= ${Math.max(0, Math.floor(undoSettleMs))}) { closed = true; break; }
      if (Date.now() >= undoDeadline) break;
      await sleep(250);
    }
    if (!closed) { ok = false; how = 'undo-open'; }
    obs = observe();
  }
  var out = {};
  for (var k in step) out[k] = step[k];
  out.ok = ok; out.confirm = how; out.notice = obs.notice; out.editorPresent = obs.editorPresent; out.composes = obs.composes;
  return JSON.stringify({ ready: ok, waitedMs: Date.now() - started, result: out });
})()`;
}

/**
 * Open `draftId`, verify it, press ITS Send, then wait for Gmail's confirmation
 * -- one request, two evaluates on the same page. The Send lookup walks out from
 * the verified editor and stops at its compose container (_gmailPress.ts), so
 * another compose's Send, or a page-level "Send feedback", is never pressed.
 * Nothing waits before the verify.
 */
export function sendDraftRequest(
  draftId: string,
  nonce?: string | number,
  timeoutMs?: number,
  confirmTimeoutMs?: number,
  goneGraceMs?: number,
  undoCapMs?: number,
  undoSettleMs?: number,
) {
  const req = openDraftRequest(draftId, pressSendBody(), nonce, timeoutMs, STEP_KEY);
  return {
    url: req.url,
    actions: [
      ...req.actions,
      // The evaluate bound covers confirm (10s) + grace (3s) + undo cap (35s) with room; it is one
      // step of one request, so no hold idle clock runs while it waits (the per-operation lock
      // holds the page for the whole request). The manifest gives sendDraft 120s overall.
      { action: "evaluate", script: sendConfirmScript(draftId, confirmTimeoutMs, goneGraceMs, undoCapMs, undoSettleMs), delay: 60000 },
    ],
  };
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const draftId: string = params.draftId || "";

  requireBrowserSession();

  if (!draftId) {
    errorJson("MISSING_PARAM", "draftId is required (use the draft's thread/message ID from Gmail)");
  }
  validateId(draftId, "draftId");

  (async () => {
    const req = sendDraftRequest(draftId);
    let psId = "";
    let sessionResult: any;
    try {
      sessionResult = await persistentCreate(req.url, req.actions);
      psId = sessionResult?.persistentSessionId || "";
      if (!psId) {
        errorJson("SESSION_ERROR", "Failed to create persistent session for draft");
      }
    } finally {
      if (psId) await persistentClose(psId).catch(() => {});
    }

    const { opened, result } = parseOpenedDraft(sessionResult?.content);
    if (!opened) {
      errorJson("BROWSER_ERROR", draftNotOpenMessage(DRAFT_NOT_OPEN_SENT, result));
    }
    if (result?.ok === true && (result as any)?.pressed === true) {
      // Gmail confirmed: the draft is now a real message in the thread; drop the thread's cached copy.
      invalidateCachedThreadForDraft(draftId, "sendDraft");
      console.log(JSON.stringify({ ok: true, draftId, message: "Draft sent successfully", confirm: (result as any)?.confirm }));
    } else if ((result as any)?.pressed === true) {
      // Pressed, not confirmed. It may or may not have gone out, so never press again from here.
      invalidateCachedThreadForDraft(draftId, "sendDraft");
      errorJson("BROWSER_ERROR", sendNotConfirmedMessage(result as any));
    } else {
      errorJson("BROWSER_ERROR", `Failed to send draft, nothing was sent: ${result?.message || "unknown error"}`);
    }
  })();
}

// Last, so every const above is initialised before the script body runs.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}
