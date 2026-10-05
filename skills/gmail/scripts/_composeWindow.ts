// Shared, PURE helpers for a NEW popup compose (createDraft, sendEmail). No
// browser, no side effects, no script entrypoint — same rule as _composeSave.ts.
//
// WHY THIS EXISTS — the 2026-10-04 "every createDraft fails" bug
// --------------------------------------------------------------
// Both writers waited for the recipient field with
//
//   [aria-label*="To"] input, textarea[aria-label*="To"], [name=to]
//
// and then typed into whatever had focus. Playwright resolves a selector list
// to the FIRST match in document order and waits for THAT element to become
// visible. Gmail's compose now carries a `div[name="to"][aria-label="To"]`
// wrapper that is not itself visible, and it comes first — so the wait timed
// out on a compose that was open and ready (live: "locator resolved to 4
// elements. Proceeding with the first one: <div name="to" aria-label="To">").
//
// The failure then fed itself. Nothing closed the compose or the session on an
// error, and the next call reused the same page through a fragment-only goto
// (`#inbox`), which does not reload Gmail — so every failed attempt left one
// more compose open (4 -> 6 -> 8 matches), and the stale windows' fields came
// first in document order for every later attempt.
//
// THE RULES this module encodes:
//   1. Every field selector is VISIBLE-ONLY (Playwright's `:visible`) — a
//      hidden template can never be "the first match" again.
//   2. Every field selector is SCOPED to the compose this call opened, tagged
//      with a per-call nonce — a stale compose can never be typed into, and
//      sendEmail can never click another compose's Send.
//   3. A failed compose is discarded (never sent) and the session closed, and
//      the next call opens Gmail with a REAL page load (see gmailViewUrl), so
//      leftovers cannot pile up even if a cleanup step itself fails.

/** The attribute a call stamps on the compose window it opened. */
export const COMPOSE_TAG_ATTR = "data-flock-compose";
/** The attribute stamped on every compose that was already open before ours. */
export const PREEXISTING_ATTR = "data-flock-preexisting";

/** Gmail's recipient field across the markups seen so far, newest first. */
export const TO_FIELD_CANDIDATES = [
  'input[aria-label="To recipients"]',
  'div[name="to"] input',
  'textarea[name="to"]',
  'input[aria-label^="To"]',
  'textarea[aria-label^="To"]',
];

/** A fresh, collision-free nonce for one compose. */
export function newComposeNonce(now: number = Date.now(), rand: number = Math.random()): string {
  return `${now.toString(36)}${Math.floor(rand * 1e9).toString(36)}`;
}

/** The CSS scope of the compose tagged with `nonce`. */
export function composeScope(nonce: string): string {
  if (!/^[a-z0-9]+$/i.test(nonce)) throw new Error(`invalid compose nonce: ${nonce}`);
  return `[${COMPOSE_TAG_ATTR}="${nonce}"]`;
}

/**
 * Scope every alternative of a selector list to our compose, optionally
 * visible-only. `a, b` -> `[scope] a:visible, [scope] b:visible`.
 */
export function scopedSelector(nonce: string, candidates: string[], visibleOnly = true): string {
  const scope = composeScope(nonce);
  return candidates.map((c) => `${scope} ${c}${visibleOnly ? ":visible" : ""}`).join(", ");
}

/** The visible recipient field of our compose — never a hidden template, never another compose's. */
export function toFieldSelector(nonce: string): string {
  return scopedSelector(nonce, TO_FIELD_CANDIDATES);
}

export function ccFieldSelector(nonce: string): string {
  return scopedSelector(nonce, ['textarea[name="cc"]', 'input[name="cc"]', '[aria-label="Cc"] input', 'input[aria-label^="Cc" i]']);
}

export function bccFieldSelector(nonce: string): string {
  return scopedSelector(nonce, ['textarea[name="bcc"]', 'input[name="bcc"]', '[aria-label="Bcc"] input', 'input[aria-label^="Bcc" i]']);
}

export function subjectFieldSelector(nonce: string): string {
  return scopedSelector(nonce, ['input[name="subjectbox"]']);
}

export function bodyFieldSelector(nonce: string): string {
  return scopedSelector(nonce, ['div[aria-label*="Message"][contenteditable="true"]', 'div[aria-label*="Message"]']);
}

/** The attachment input is hidden by design, so this one is scoped but NOT visible-only. */
export function fileInputSelector(nonce: string): string {
  return scopedSelector(nonce, ['input[type="file"]'], false);
}

/** The Send button of OUR compose only. */
export function sendButtonSelector(nonce: string): string {
  return scopedSelector(nonce, ['[aria-label*="Send"]:not([aria-label*="Schedule"])']);
}

// In-page: the compose window that owns a subject box. Gmail's popup is a
// role=dialog (older markup: .AD); failing both, the nearest ancestor that also
// holds the compose's own toolbar (its discard control).
const COMPOSE_ROOT_FN = `function composeRoot(box) {
    const named = box.closest('[role="dialog"]') || box.closest('.AD');
    if (named) return named;
    for (let n = box.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n.querySelector('[aria-label^="Discard draft"], [data-tooltip^="Discard draft"]')) return n;
    }
    return null;
  }`;

const IS_VISIBLE_FN = `function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }`;

/** Stamp every compose already open, so the one Compose opens next is unambiguous. */
export const MARK_PREEXISTING_COMPOSES_SCRIPT = `(() => {
  ${COMPOSE_ROOT_FN}
  let n = 0;
  for (const box of document.querySelectorAll('input[name="subjectbox"]')) {
    const root = composeRoot(box);
    if (root && !root.hasAttribute('${COMPOSE_TAG_ATTR}')) { root.setAttribute('${PREEXISTING_ATTR}', '1'); n++; }
  }
  return JSON.stringify({ preexisting: n });
})()`;

/**
 * Wait for the compose that Compose just opened, tag it with `nonce`, and make
 * sure its recipient row is expanded (Gmail collapses it to a "Recipients"
 * placeholder whenever focus leaves it; clicking the placeholder only expands
 * the row). Returns JSON { ok, waitedMs, expanded }.
 */
export function tagNewComposeScript(nonce: string, timeoutMs = 15000): string {
  composeScope(nonce);
  const toCandidates = JSON.stringify(TO_FIELD_CANDIDATES.join(", "));
  return `(async () => {
  ${COMPOSE_ROOT_FN}
  ${IS_VISIBLE_FN}
  const started = Date.now();
  const deadline = started + ${Math.max(0, Math.floor(timeoutMs))};
  const find = () => {
    const boxes = Array.from(document.querySelectorAll('input[name="subjectbox"]')).reverse();
    for (const box of boxes) {
      const root = composeRoot(box);
      if (root && !root.hasAttribute('${PREEXISTING_ATTR}') && !root.hasAttribute('${COMPOSE_TAG_ATTR}')) return root;
    }
    return null;
  };
  let root = null;
  while (Date.now() < deadline && !(root = find())) await new Promise((r) => setTimeout(r, 250));
  if (!root) return JSON.stringify({ ok: false, waitedMs: Date.now() - started, reason: "no new compose window appeared" });
  root.setAttribute('${COMPOSE_TAG_ATTR}', ${JSON.stringify(nonce)});
  let expanded = false;
  const hasVisibleTo = () => Array.from(root.querySelectorAll(${toCandidates})).some(isVisible);
  if (!hasVisibleTo()) {
    const placeholder = Array.from(root.querySelectorAll('div,span'))
      .find((el) => el.children.length === 0 && (el.textContent || '').trim() === 'Recipients' && isVisible(el));
    if (placeholder) { placeholder.click(); expanded = true; }
  }
  return JSON.stringify({ ok: true, waitedMs: Date.now() - started, expanded });
})()`;
}

/**
 * Reveal the Cc or Bcc row of OUR compose (Gmail hides both by default).
 * Returns "visible" | "expanded" | "not-found" | "no-compose".
 */
export function expandRecipientRowScript(nonce: string, field: "cc" | "bcc"): string {
  const scope = composeScope(nonce);
  const toggles = field === "cc" ? '["Cc", "Cc Bcc"]' : '["Bcc"]';
  return `(() => {
  const c = document.querySelector(${JSON.stringify(scope)});
  if (!c) return "no-compose";
  if (c.querySelector("textarea[name=${field}],input[name=${field}]")) return "visible";
  const labels = ${toggles};
  for (const el of c.querySelectorAll("span,a,[role=link],[role=button]")) {
    if (labels.includes((el.textContent || "").trim())) { el.click(); return "expanded"; }
  }
  return "not-found";
})()`;
}

/**
 * Save-and-close OUR compose. Same rule as SAVE_AND_CLOSE_SCRIPT (_composeSave.ts):
 * only a control NAMED as save-and-close is ever clicked. If ours cannot be
 * found it blurs instead — Gmail has already autosaved — and never guesses.
 */
export function saveAndCloseComposeScript(nonce: string): string {
  const scope = composeScope(nonce);
  return `(() => {
  const c = document.querySelector(${JSON.stringify(scope)});
  const saveClose = c && (c.querySelector('.Ha img.Ha-Jj') || c.querySelector('[aria-label="Save & close"]'));
  if (saveClose) { saveClose.click(); return JSON.stringify({ok:true, how:"save-and-close"}); }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  return JSON.stringify({ok:true, how:"autosaved", composeFound: !!c});
})()`;
}

/**
 * Discard OUR compose after a failure, so a retry does not inherit it. Only an
 * element whose own label/tooltip starts with "Discard" and never mentions
 * "Send" is clicked; anything else is reported, not clicked. It never falls
 * back to a positional or generic toolbar click (see discardDraft.ts).
 * Returns JSON { ok, reason? }.
 */
export function discardComposeScript(nonce: string): string {
  const scope = composeScope(nonce);
  return `(() => {
  const c = document.querySelector(${JSON.stringify(scope)});
  if (!c) return JSON.stringify({ ok: false, reason: "compose-not-found" });
  const btn = c.querySelector('[aria-label^="Discard draft"]') || c.querySelector('[data-tooltip^="Discard draft"]');
  if (!btn) return JSON.stringify({ ok: false, reason: "discard-control-not-found" });
  const label = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('data-tooltip') || '')).trim();
  if (!/^discard/i.test(label) || /send/i.test(label)) return JSON.stringify({ ok: false, reason: "label-mismatch", label });
  btn.click();
  return JSON.stringify({ ok: true });
})()`;
}

/** Parse a compose script's JSON reply without ever throwing. */
export function parseComposeReply(content: unknown): Record<string, any> {
  if (typeof content !== "string") return {};
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
