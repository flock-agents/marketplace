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
  persistentClose,
} from "../../_shared/_google_helpers";
import { SAVE_AND_CLOSE_SCRIPT } from "./_composeSave";
import { invalidateCachedThreadForDraft } from "./_threadCache";

// --- Pure splice (unit-tested, no browser) ---

const QUOTE_MARKER_RE = /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain text -> minimal Gmail-compatible compose HTML (one <div> per line). */
function textToComposeHtml(text: string): string {
  const lines = (text || "").split("\n");
  return lines.map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`).join("");
}

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
  const composedHtml = textToComposeHtml(newBody);
  const quoteIdx = html.search(QUOTE_MARKER_RE);
  if (quoteIdx === -1) return composedHtml;
  return composedHtml + html.slice(quoteIdx);
}

// --- Script entrypoint (browser-driven compose) ---
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

const COMPOSE_SELECTOR_SCRIPT_PREFIX = `
  const compose = document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
                  document.querySelector('.Am.Al.editable') ||
                  document.querySelector('[role="textbox"][aria-label*="Message"]');
`;

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
    const sessionResult = await persistentCreate(`https://mail.google.com/mail/u/0/#drafts/${draftId}`, undefined, { holdLock: true });
    const persistentId: string = sessionResult?.persistentSessionId || "";

    if (!persistentId) {
      errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail draft");
    }

    try {
      // Read the current compose HTML first — spliceDraftBody needs it to
      // locate (and preserve) the quoted block, if any.
      const readScript = `(() => {
        ${COMPOSE_SELECTOR_SCRIPT_PREFIX}
        if (!compose) return JSON.stringify({ ok: false, message: "Draft compose area not found." });
        return JSON.stringify({ ok: true, bodyHtml: compose.innerHTML });
      })()`;
      const readResult = await persistentInteract(persistentId, [{ action: "wait", delay: 1000 }], false, readScript);
      const readContent = readResult?.content || "{}";
      let readParsed: any;
      try {
        readParsed = typeof readContent === "string" ? JSON.parse(readContent) : readContent;
      } catch {
        readParsed = { ok: false, message: "Could not parse the draft's current compose content." };
      }

      if (readParsed?.ok === false) {
        await persistentClose(persistentId).catch(() => {});
        errorJson("BROWSER_ERROR", readParsed?.message || "Failed to read the draft's current compose content.");
      }

      const newHtml = spliceDraftBody(readParsed?.bodyHtml || "", bodyText);

      // Write the spliced HTML back directly — no select-all, so the quoted
      // block (untouched, since it's carried through from readParsed.bodyHtml
      // verbatim) is never at risk from a selection that spans the whole
      // contenteditable region.
      const writeScript = `(() => {
        ${COMPOSE_SELECTOR_SCRIPT_PREFIX}
        if (!compose) return JSON.stringify({ ok: false, message: "Draft compose area not found." });
        compose.innerHTML = ${JSON.stringify(newHtml)};
        compose.dispatchEvent(new Event('input', { bubbles: true }));
        compose.dispatchEvent(new Event('keyup', { bubbles: true }));
        return JSON.stringify({ ok: true });
      })()`;
      const writeResult = await persistentInteract(persistentId, [{ action: "wait", delay: 300 }], false, writeScript);
      const writeContent = writeResult?.content || "{}";
      let writeParsed: any;
      try {
        writeParsed = typeof writeContent === "string" ? JSON.parse(writeContent) : writeContent;
      } catch {
        writeParsed = { ok: null };
      }
      if (writeParsed?.ok === false) {
        await persistentClose(persistentId).catch(() => {});
        errorJson("BROWSER_ERROR", writeParsed?.message || "Failed to write the updated draft body");
      }

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
      console.log(JSON.stringify({ ok: true, draftId }));
    } finally {
      await persistentClose(persistentId).catch(() => {});
    }
  })();
}
