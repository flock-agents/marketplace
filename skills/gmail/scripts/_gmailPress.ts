// Shared, PURE "act on Gmail with REAL input" helpers for every Gmail script.
// No browser, no side effects, no script entrypoint -- safe to import from
// another skill script (same rule as _gmailNav.ts / _openDraft.ts).
//
// WHY THIS EXISTS
// ---------------
// Task 28 (live 2026-10-02): Gmail's `div[role=button]` controls ignore an
// in-page `.click()`, so Send and Save reported success and did nothing. The
// first fix dispatched mousedown/mouseup/click MouseEvents from page script.
// Those are still script-made: every such event carries `isTrusted: false`,
// which Google can see, and an account driven that way risks being flagged.
//
// THE RULE NOW: page script only FINDS an element and MARKS it (_shared/_realInput.ts TARGET_ATTR);
// the click itself is a `click` page action, which Flock performs with real
// input through the browser. A mark is cleared before it is set again, so a
// click never lands on an element a previous step marked. The element a
// script finds is exactly the one it found before; only the delivery changed.
//
// Every function inlined into the page (via Function.prototype.toString) is
// SELF-CONTAINED: it may reference nothing outside its own body.

import { clickTarget } from "../../_shared/_realInput";

/** A real click on the element marked `name`; skipped when nothing carries the mark. */
export function clickMarked(name: string) {
  return clickTarget(name, true);
}

/** Real clicks on the elements marked `${prefix}0` .. `${prefix}${count - 1}` (see markGmailTargets). */
export function clickEachMarked(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => clickMarked(`${prefix}${i}`));
}

/** Is `el` on screen: a non-empty box and not `visibility:hidden`? (A display:none ancestor gives a zero box.) */
export function isOnScreen(el: Element | null): boolean {
  if (!el || typeof (el as any).getBoundingClientRect !== "function") return false;
  const r = (el as any).getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return false;
  const win: any = el.ownerDocument && el.ownerDocument.defaultView;
  const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
  return !cs || cs.visibility !== "hidden";
}

/**
 * Mark `el` as the target `name` for the next click action, after clearing
 * that mark from every element in `doc`. Returns whether `el` was marked.
 * An element `onScreen` rejects is never marked (pass null to skip the check):
 * Gmail keeps hidden copies of controls (a "Send feedback to Google" menuitem
 * sat beside the live Send), a real click cannot reach one, and aiming at one
 * is at best nothing and at worst the wrong action.
 */
export function markGmailTarget(doc: Document, el: Element | null, name: string, onScreen: ((el: Element) => boolean) | null = isOnScreen): boolean {
  const attr = "data-flock-target";
  const stale = doc.querySelectorAll("[" + attr + '="' + name + '"]');
  for (let i = 0; i < stale.length; i++) stale[i].removeAttribute(attr);
  if (!el || (onScreen && !onScreen(el))) return false;
  el.setAttribute(attr, name);
  return true;
}

/**
 * Mark each on-screen element of `els` as `${prefix}0`, `${prefix}1`, ... (at
 * most `max`), after clearing every `${prefix}*` mark in `doc`. Returns how
 * many were marked; clickEachMarked(prefix, max) then clicks them in order.
 */
export function markGmailTargets(doc: Document, els: ArrayLike<Element>, prefix: string, max: number, onScreen: (el: Element) => boolean = isOnScreen): number {
  const attr = "data-flock-target";
  const stale = doc.querySelectorAll("[" + attr + '^="' + prefix + '"]');
  for (let i = 0; i < stale.length; i++) stale[i].removeAttribute(attr);
  let n = 0;
  for (let i = 0; i < els.length && n < max; i++) {
    if (!onScreen(els[i])) continue;
    els[i].setAttribute(attr, prefix + n);
    n++;
  }
  return n;
}

/**
 * In-page prelude: `mark(el, name)` (on-screen only), `markAny(el, name)` (no
 * screen check, for callers that already filtered) and `markAll(els, prefix,
 * max)`, all bound to `document`.
 */
export const MARK_FNS = `var onScreen = ${isOnScreen.toString()};
  var mark = function (el, name) { return (${markGmailTarget.toString()})(document, el, name, onScreen); };
  var markAny = function (el, name) { return (${markGmailTarget.toString()})(document, el, name, null); };
  var markAll = function (els, prefix, max) { return (${markGmailTargets.toString()})(document, els, prefix, max, onScreen); };`;

const STEP_RESULT_KEY = "__flockStepResult";

/**
 * A find-and-mark script, then a real click on its mark, then the script's own
 * result again as the step's last result. The mark `name` is cleared before the
 * script runs, so a script that finds nothing leaves nothing to click. `markScript` is an in-page
 * expression (MARK_FNS is in scope) that marks `name` -- or nothing -- and
 * returns what the old click script returned. Read back last so a caller that
 * reads the step's result sees exactly what it saw when the script clicked.
 */
export function markThenClick(name: string, markScript: string): Array<{ action: string; script?: string; selector?: string; optional?: true }> {
  return [
    { action: "evaluate", script: `(function(){ ${MARK_FNS} mark(null, ${JSON.stringify(name)}); return (window[${JSON.stringify(STEP_RESULT_KEY)}] = ${markScript}); })()` },
    clickMarked(name),
    { action: "evaluate", script: `window[${JSON.stringify(STEP_RESULT_KEY)}]` },
  ];
}

/**
 * markThenClick on a text field, then `text` typed into it with real input
 * (`insertText`, the way every Gmail body is typed). For a field Gmail has just
 * opened empty (a menu's or a dialog's own box): when the script marks nothing
 * the click is skipped and the text goes to the focus, which is then that
 * menu or dialog, where it inserts nothing.
 */
export function markThenType(name: string, markScript: string, text: string): Array<{ action: string; script?: string; selector?: string; optional?: true; text?: string }> {
  return [...markThenClick(name, markScript), { action: "insertText", text }];
}

/**
 * The text of a Gmail notice (snackbar / toast) matching `re`, or "". Gmail
 * shows "Message sent", "Draft saved", "Marked as unread" in `[role="alert"]`
 * or the `.bAq` snackbar span (the same nodes MARK_UNREAD_CONFIRM_SCRIPT watches). Reads
 * innerText where the browser has it, textContent otherwise (jsdom). The text is
 * capped at 80 chars: it is diagnostics, never page content to relay.
 */
export function findGmailNotice(doc: Document, re: RegExp): string {
  const nodes = doc.querySelectorAll('[role="alert"], .bAq');
  for (let i = 0; i < nodes.length; i++) {
    const n: any = nodes[i];
    const text = String((typeof n.innerText === "string" && n.innerText) || n.textContent || "").replace(/\s+/g, " ").trim();
    if (text && re.test(text)) return text.slice(0, 80);
  }
  return "";
}

/**
 * The Send button of the compose that holds `editor`, found by a BOUNDED walk:
 * up through the editor's compose containers (`.M9`, `.ip`, `[role="dialog"]`,
 * nearest first) and never past the outermost one. No container -> null. A
 * page-wide Send is never returned: another compose's Send could send another
 * draft. Inside a container, a candidate is a `[role=button]` / `.T-I` whose
 * aria-label, data-tooltip or title STARTS with "Send" (Gmail: `Send (⌘Enter)`,
 * optionally behind bidi marks) and is not a feedback / schedule control, or
 * Gmail's Send class `.T-I.J-J5-Ji.aoO.v7`; it must be on screen.
 * `seen` counts the candidates in the last container looked at, for the error.
 */
export function findComposeSend(editor: Element | null): { button: Element | null; container: string; seen: number } {
  const CONTAINERS = '.M9, .ip, [role="dialog"]';
  const SEND_RE = /^[\s‎‏‪-‮]*send\b/i;
  const NOT_RE = /feedback|schedule/i;
  const onScreen = (el: Element) => {
    const r = (el as any).getBoundingClientRect ? (el as any).getBoundingClientRect() : null;
    if (!r || r.width <= 0 || r.height <= 0) return false;
    const win: any = el.ownerDocument && el.ownerDocument.defaultView;
    const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
    return !cs || cs.visibility !== "hidden";
  };
  const isSend = (el: Element) => {
    const labels = [el.getAttribute("aria-label") || "", el.getAttribute("data-tooltip") || "", el.getAttribute("title") || ""];
    for (let i = 0; i < labels.length; i++) if (NOT_RE.test(labels[i])) return false;
    if (String(el.tagName || "").toUpperCase() === "A") return false;
    for (let i = 0; i < labels.length; i++) if (SEND_RE.test(labels[i])) return true;
    const cls = " " + (el.getAttribute("class") || "") + " ";
    return cls.indexOf(" T-I ") >= 0 && cls.indexOf(" aoO ") >= 0 && cls.indexOf(" v7 ") >= 0 && cls.indexOf(" J-J5-Ji ") >= 0;
  };
  if (!editor) return { button: null, container: "none", seen: 0 };
  let container: Element | null = editor.parentElement ? editor.parentElement.closest(CONTAINERS) : null;
  if (!container) return { button: null, container: "none", seen: 0 };
  let seen = 0;
  let name = "";
  while (container) {
    name = (container.getAttribute("role") === "dialog" ? "dialog" : "") ||
      ((" " + (container.getAttribute("class") || "") + " ").indexOf(" M9 ") >= 0 ? "M9" : "ip");
    const cands = Array.from(container.querySelectorAll('[role="button"], .T-I')).filter(isSend);
    seen = cands.length;
    const visible = cands.filter(onScreen);
    if (visible.length > 0) return { button: visible[0], container: name, seen: seen };
    container = container.parentElement ? container.parentElement.closest(CONTAINERS) : null;
  }
  return { button: null, container: name, seen: seen };
}
