// updateDraft.ts — rewrite a draft's composed body in place (task-11 brief).
//
// Pairs with getDraft for owner-edit detection: the caller reads a draft
// back, and when it still matches what the agent wrote, updateDraft
// overwrites the composed body without creating a second draft. Navigates to
// #drafts/<id> — same id format createReplyDraft returns and sendDraft
// already expects there.
//
// This function must never send. It replaces the composed text and saves
// the draft only — no path in this file calls or falls through to
// sendDraft/sendEmail.
//
// Fix round 1 (Finding 2): the original implementation cleared the compose
// region with Control+A + Backspace before typing the new body. Gmail nests
// the quoted original thread as a non-editable descendant INSIDE that same
// contenteditable region, and a select-all scoped to the parent selects (and
// then deletes) that descendant too — every owner-edit round-trip silently
// deleted the conversation below the reply. This now reads the existing
// compose HTML, computes a replacement that splices in the new body while
// leaving everything from the quoted block onward byte-for-byte untouched
// (spliceDraftBody, unit-tested), and writes that back directly rather than
// depending on select-all at all.
//
// Task 28 (2026-10-03): that direct innerHTML write never reached Gmail's save
// (see "Writing THIS draft with real input" below). The quote is now protected
// by selecting ONLY the main-body Range (mainBodyRange) and typing over it with
// insertText; spliceDraftBody stays as a pure, tested helper but no longer
// drives the write.
//
// The pure splice (spliceDraftBody) is exported and unit-tested against an
// HTML fixture with no browser. The browser-driving script body only runs
// when this file executes as a skill script — gated on SKILL_PARAMS, same
// posture as checkEngagedDomains.ts — so importing this module for its pure
// export never touches the browser.

import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentInteract,
  persistentInteractRaw,
  persistentClose,
} from "../../_shared/_google_helpers";
import { SAVE_AND_CLOSE_SCRIPT, waitForDraftSavedScript } from "./_composeSave";
import { invalidateCachedThreadForDraft } from "./_threadCache";
import { bodyToComposeHtml } from "./_bodyHtml";
import { COMPOSE_BODY_SCRAPE, extractDraftBody } from "./_draftBody";
import { openDraftRequest, onDraftComposeExpr, parseOpenedDraft, draftNotOpenMessage, DRAFT_NOT_OPEN_WRITTEN } from "./_openDraft";

// --- Pure splice (unit-tested, no browser) ---

const QUOTE_MARKER_RE = /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"/i;


/**
 * Compute the new compose HTML for `newBody`, preserving Gmail's quoted
 * original content (`blockquote.gmail_quote`) from `existingHtml` byte-for-
 * byte. When no quote is present, the new body replaces the whole compose
 * HTML. Never depends on selecting the existing composed text — the caller
 * writes this result directly, so the quoted block (a non-editable
 * descendant of the same contenteditable region) is never at risk of being
 * selected and deleted alongside it.
 */
export function spliceDraftBody(existingHtml: string, newBody: string): string {
  const html = existingHtml || "";
  const composedHtml = bodyToComposeHtml(newBody);
  const quoteIdx = html.search(QUOTE_MARKER_RE);
  if (quoteIdx === -1) return composedHtml;
  return composedHtml + html.slice(quoteIdx);
}

// --- Opening and writing THIS draft (pure builders, unit-tested) ---
//
// Task 26a (live 2026-10-02): this used to open the draft by bare hash, sleep a
// second in a separate call and write in a third -- on a page another caller was
// using, it read "compose area not found" or, worse, could have written into
// someone else's compose. Now it opens the draft the getDraft way (gmailViewUrl +
// an in-page poll, ONE call) and verifies the open compose belongs to draftId
// (_openDraft.ts) before reading; the write re-verifies in the same in-page
// expression that writes, so no navigation can land between verify and write.

/** Open `draftId` and read its compose HTML once the compose is verified as ours. */
export function updateDraftOpenRequest(draftId: string, nonce?: string | number, timeoutMs?: number) {
  return openDraftRequest(draftId, `return { bodyHtml: ${COMPOSE_BODY_SCRAPE} };`, nonce, timeoutMs);
}

// --- Writing THIS draft with real input (task 28) ---
//
// Live 2026-10-02 23:39 (35626): Save draft reported success and Gmail kept the
// ORIGINAL body. `compose.innerHTML = …` plus synthetic input/keyup events is
// not an edit Gmail registers, so its save kept the old text. createReplyDraft's
// body, typed with the page action `insertText` (real input through CDP), is
// what Gmail saves. So: select the main body inside the VERIFIED editor (never
// the quoted history), insertText over the selection, READ IT BACK, wait for
// Gmail's save, and only then report written.

/** Quoted history inside a reply editor: everything from the first of these on is never touched. */
export const QUOTE_SELECTOR = ".gmail_quote_container, .gmail_quote";

/**
 * The editor's MAIN BODY as a DOM Range, or null when it cannot be separated
 * from the quoted history.
 *
 * Live (controller, real Chrome, 2026-10-03): an inline reply draft's editor
 * holds NO quote -- Gmail keeps the quoted history collapsed ("trimmed
 * content") outside the editable region. Then the main body is the whole
 * editor content.
 *
 * When the quote IS inside the editor (an expanded quote), the range must not
 * END at the quote boundary: Blink canonicalises `setEndBefore(quote)` into the
 * quote container, and insertText's delete can then merge the "On … wrote:"
 * line into the body or type inside the quote (fix round 1). So the range runs
 * from the editor start to the DEEPEST LAST position inside the last node
 * before the quote: the end of a text node, or just before an empty element
 * (a trailing `<br>` stays as the separator). The first quote match in document
 * order is the outermost wrapper, so the attribution stays with the quote. A
 * quote with nothing before it -> null (fail closed; nothing is typed).
 * Self-contained: it runs in the page too (inlined via toString).
 */
export function mainBodyRange(doc: Document, editor: Element): Range | null {
  const range = doc.createRange();
  const q = editor.querySelector(".gmail_quote_container, .gmail_quote");
  if (!q) { range.selectNodeContents(editor); return range; }
  let n: Node | null = q;
  while (n && n !== editor && !n.previousSibling) n = n.parentNode;
  if (!n || n === editor || !n.previousSibling) return null;
  let p: Node = n.previousSibling;
  for (;;) {
    if (p.nodeType === 3) { range.setStart(editor, 0); range.setEnd(p, (p as Text).length); return range; }
    if (p.lastChild) { p = p.lastChild; continue; }
    const parent = p.parentNode as Node;
    const idx = Array.prototype.indexOf.call(parent.childNodes, p);
    range.setStart(editor, 0);
    range.setEnd(parent, idx);
    return range;
  }
}

/** Marker for a refusal thrown from an in-page step, so the action list aborts before typing. */
export const REFUSED_MARKER = "FLOCK_REFUSED:";
const QUOTE_BEFORE_KEY = "__flockQuoteBefore";

/**
 * In-page: re-verify `draftId`'s compose (onDraftComposeExpr), focus it,
 * select its main body, and remember the in-editor quote's HTML (if any) for
 * the read-back. Focus first: focusing after would collapse the selection.
 *
 * It THROWS on any refusal (not opened, not ok): it runs as the first action
 * of the same list as insertText (updateDraftWriteActions), and a throwing
 * evaluate aborts the list (executePageActions rethrows), so nothing is ever
 * typed into a compose that was not verified and selected. The refusal is
 * carried as `FLOCK_REFUSED:<uri-encoded JSON>` (parseRefusal).
 */
export function selectMainBodyScript(draftId: string): string {
  const inner = onDraftComposeExpr(draftId, `
    if (compose.focus) compose.focus();
    var range = (${mainBodyRange.toString()})(document, compose);
    if (!range) return { ok: false, message: "The draft's text could not be told apart from its quoted history; nothing was written." };
    var sel = window.getSelection();
    if (!sel) return { ok: false, message: "The page gave no selection to write into; nothing was written." };
    sel.removeAllRanges();
    sel.addRange(range);
    var q = compose.querySelector(${JSON.stringify(QUOTE_SELECTOR)});
    window[${JSON.stringify(QUOTE_BEFORE_KEY)}] = q ? q.outerHTML : null;
    return { ok: true, quote: !!q };
  `);
  return `(function(){
    var r = ${inner};
    if (!r || r.opened !== true || r.ok !== true) throw new Error(${JSON.stringify(REFUSED_MARKER)} + encodeURIComponent(JSON.stringify(r || {})));
    return r;
  })()`;
}

/**
 * The refusal a throwing selectMainBodyScript carried, out of the browser-fetch
 * error text, or null when the text holds none. Never throws.
 */
export function parseRefusal(text: unknown): Record<string, unknown> | null {
  const m = /FLOCK_REFUSED:([A-Za-z0-9%\-_.!~*'()]+)/.exec(String(text ?? ""));
  if (!m) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1]));
    return v && typeof v === "object" ? v : null;
  } catch { return null; }
}

/**
 * The write as ONE action list: select (throws on refusal), then type with the
 * real-input page actions exactly as createReplyDraft types a body. One round
 * trip, so nothing (another caller, a Gmail focus handler between calls) can
 * collapse or move the selection between select and type.
 */
export function updateDraftWriteActions(draftId: string, body: string): Array<{ action: string; script?: string; text?: string; key?: string }> {
  return [{ action: "evaluate", script: selectMainBodyScript(draftId) }, ...updateDraftTypeActions(body)];
}

/**
 * In-page: re-verify, then return the main body's HTML (the same range the
 * write replaced) and whether the in-editor quote is byte-identical to what
 * the select step saw (`quoteIntact`; true when there was and is no quote).
 */
export function readMainBodyScript(draftId: string): string {
  return onDraftComposeExpr(draftId, `
    var range = (${mainBodyRange.toString()})(document, compose);
    var box = document.createElement('div');
    if (range) box.appendChild(range.cloneContents());
    var q = compose.querySelector(${JSON.stringify(QUOTE_SELECTOR)});
    var before = window[${JSON.stringify(QUOTE_BEFORE_KEY)}];
    var now = q ? q.outerHTML : null;
    return { ok: !!range, mainHtml: box.innerHTML, quoteIntact: (before === undefined ? now === null : before === now) };
  `);
}

/**
 * In-page: re-verify, then the WHOLE compose through getDraft's own scrape
 * (COMPOSE_BODY_SCRAPE). Its extractDraftBody is what the owner-edit guard
 * compares against later (draft-records.ts draftStatus), so the caller records
 * exactly this, never the text it asked for.
 */
export function scrapeComposeScript(draftId: string): string {
  return onDraftComposeExpr(draftId, `return { ok: true, bodyHtml: ${COMPOSE_BODY_SCRAPE} };`);
}

/**
 * The write itself: the real-input page actions, exactly as createReplyDraft
 * types a body -- `insertText` (newlines passed through as-is), then a
 * Space+Backspace pair that leaves the text identical. Never an innerHTML
 * assignment. Runs ONLY behind the select step, in updateDraftWriteActions.
 */
export function updateDraftTypeActions(body: string): Array<{ action: string; text?: string; key?: string }> {
  return [
    { action: "insertText", text: body },
    { action: "press", key: "Space" },
    { action: "press", key: "Backspace" },
  ];
}

/** Whitespace-insensitive text compare for the read-back. */
function normaliseText(s: string): string {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Does the main body read back as `requested`? `mainHtml` goes through
 * extractDraftBody (the draft extractor), and both sides are whitespace-
 * normalised: Gmail may hold a newline as `<div>`/`<br>` and spaces as nbsp.
 * Returns what was read, for the error on a mismatch.
 */
export function readBackMatches(mainHtml: string, requested: string): { match: boolean; read: string } {
  const read = extractDraftBody(mainHtml || "");
  return { match: normaliseText(read) === normaliseText(requested), read };
}

/** Parse a persistentInteract evaluate result (a JSON string or an object). Never throws. */
function parseEval(content: unknown): any {
  if (content && typeof content === "object") return content;
  if (typeof content !== "string" || !content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

// --- Script entrypoint (browser-driven compose) ---

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const draftId: string = params.draftId || "";
  const bodyText: string = params.body || "";

  requireBrowserSession();

  if (!draftId || !bodyText) {
    errorJson("MISSING_PARAM", "draftId and body are required");
  }
  validateId(draftId, "draftId");

  (async () => {
    // holdLock: the sequence lease (338003737). Open+read, write and
    // save-and-close are separate round trips, and the hold keeps every other
    // caller off this page until persistentClose.
    const open = updateDraftOpenRequest(draftId);
    const sessionResult = await persistentCreate(open.url, open.actions, { holdLock: true });
    const persistentId: string = sessionResult?.persistentSessionId || "";

    if (!persistentId) {
      errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail draft");
    }

    try {
      const opened = parseOpenedDraft<{ bodyHtml?: string }>(sessionResult?.content);
      if (!opened.opened) {
        await persistentClose(persistentId).catch(() => {});
        errorJson("BROWSER_ERROR", draftNotOpenMessage(DRAFT_NOT_OPEN_WRITTEN, opened.result));
      }

      const fail = async (message: string): Promise<never> => {
        await persistentClose(persistentId).catch(() => {});
        errorJson("BROWSER_ERROR", message);
        throw new Error(message); // unreachable: errorJson exits
      };
      const step = async (script: string): Promise<any> => {
        const res = await persistentInteract(persistentId, [{ action: "evaluate", script }]);
        const parsed = parseEval(res?.content);
        if (parsed?.opened === false) await fail(draftNotOpenMessage(DRAFT_NOT_OPEN_WRITTEN, parsed));
        return parsed;
      };

      // 1+2. Select the main body of the RE-VERIFIED compose and type over it, in ONE action list.
      //      The select evaluate throws on any refusal, which aborts the list before insertText.
      const write = await persistentInteractRaw(persistentId, updateDraftWriteActions(draftId, bodyText));
      if (write.httpCode >= 400) {
        const refusal = parseRefusal(write.body?.message ?? write.body?.error);
        if (refusal && refusal.opened === false) await fail(draftNotOpenMessage(DRAFT_NOT_OPEN_WRITTEN, refusal));
        if (refusal) await fail(typeof refusal.message === "string" && refusal.message ? refusal.message : "Could not select the draft's text; nothing was written.");
        await fail(`Writing the draft failed in the browser: ${String(write.body?.message ?? write.body?.error ?? "unknown error").slice(0, 300)}`);
      }

      // 3. Read the main body back. A mismatch means Gmail does not hold what was asked; a quote
      //    that changed at all fails closed.
      const readBack = await step(readMainBodyScript(draftId));
      const compared = readBackMatches(typeof readBack?.mainHtml === "string" ? readBack.mainHtml : "", bodyText);
      if (readBack?.quoteIntact === false) {
        await fail("Writing the draft changed its quoted history, so it was not saved as written (it may be partly changed; check it in Gmail).");
      }
      if (readBack?.ok !== true || !compared.match) {
        await fail(`The draft did not take the new text as asked (it may be partly changed; check it in Gmail). Its compose reads: ${JSON.stringify(compared.read.slice(0, 200))}`);
      }

      // 4. Wait for Gmail's own save indicator. When none shows within 8s the read-back still
      //    matched and 8s (>= the 2s settle) passed; the result says which.
      let saveConfirm: "indicator" | "settle" = "settle";
      try {
        const saved = await persistentInteract(persistentId, [], false, waitForDraftSavedScript(8000));
        if (parseEval(saved?.content)?.saved === true) saveConfirm = "indicator";
      } catch {
        saveConfirm = "settle";
      }

      // 5. What Gmail now holds, through getDraft's scrape + extractor: the owner-edit baseline.
      const scraped = await step(scrapeComposeScript(draftId));
      const bodyAsSaved = extractDraftBody(typeof scraped?.bodyHtml === "string" ? scraped.bodyHtml : "");

      // Close (save) — NEVER Send, and never Discard. This used to fall
      // through to `.og.T-I-J3`, Gmail's trash: a reply draft opens INLINE, so
      // editing one wrote the new body and then deleted the draft outright.
      // See _composeSave.ts.
      const closeActions = [
        { action: "evaluate", script: SAVE_AND_CLOSE_SCRIPT },
        { action: "wait", delay: 1500 },
      ];
      await persistentInteract(persistentId, closeActions, true);

      // The draft's thread now holds a different body; drop its cached copy (via the draft->thread map).
      invalidateCachedThreadForDraft(draftId, "updateDraft");
      console.log(JSON.stringify({ ok: true, draftId, bodyAsSaved, saveConfirm }));
    } finally {
      await persistentClose(persistentId).catch(() => {});
    }
  })();
}

// Last, so every const above is initialised before the script body runs.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}
