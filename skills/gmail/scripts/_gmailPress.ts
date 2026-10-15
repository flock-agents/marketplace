// Shared, PURE "act on Gmail the way Gmail accepts it" helpers for the draft
// writers (sendDraft, updateDraft) and the compose save step. No browser, no
// side effects, no script entrypoint -- safe to import from another skill
// script (same rule as _gmailNav.ts / _openDraft.ts).
//
// WHY THIS EXISTS (task 28, live 2026-10-02 23:39-23:42 on 35626)
// ---------------------------------------------------------------
// Save draft and Approve & send both reported success, and Gmail's own API
// showed nothing had happened: the draft kept its original body and the thread
// held no sent message. sendDraft called `sendBtn.click()`, and Gmail's
// `div[role=button]` controls ignore an in-page `.click()` (memory "Gmail
// toolbar needs mouse events", live-verified 2026-09-24 for Mark as unread).
// What Gmail's listeners answer is a mousedown, mouseup, click sequence on the
// on-screen element -- the pattern MARK_UNREAD_SCRIPT (_unreadState.ts) already
// uses inline. It lives here once, as a function, so both draft writers and the
// save-and-close step press buttons the same way.
//
// Every function here is SELF-CONTAINED: it runs in the page too, inlined via
// Function.prototype.toString (like findDraftCompose), so it may reference
// nothing outside its own body.

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
 * Press a Gmail control: dispatch mousedown, mouseup, click (bubbles, cancelable,
 * view: window) on `el` -- only when it is on screen. Returns whether it pressed.
 * A hidden element is never pressed: Gmail keeps hidden copies of controls (a
 * "Send feedback to Google" menuitem sat beside the live Send), and pressing one
 * of those is at best nothing and at worst the wrong action.
 */
export function pressGmailButton(el: Element | null): boolean {
  if (!el || typeof (el as any).getBoundingClientRect !== "function") return false;
  const r = (el as any).getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return false;
  const win: any = el.ownerDocument && el.ownerDocument.defaultView;
  const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
  if (cs && cs.visibility === "hidden") return false;
  const Ctor: any = (win && win.MouseEvent) || MouseEvent;
  const types = ["mousedown", "mouseup", "click"];
  for (let i = 0; i < types.length; i++) {
    el.dispatchEvent(new Ctor(types[i], { bubbles: true, cancelable: true, view: win }));
  }
  return true;
}

/**
 * The text of a Gmail notice (snackbar / toast) matching `re`, or "". Gmail
 * shows "Message sent", "Draft saved", "Marked as unread" in `[role="alert"]`
 * or the `.bAq` snackbar span (the same nodes MARK_UNREAD_SCRIPT watches). Reads
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
