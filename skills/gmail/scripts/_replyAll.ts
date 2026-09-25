// Shared, PURE lookup of Gmail's reply-all controls. No browser, no side
// effects, and no script entrypoint -- safe to import from another skill script.
//
// FINDING "REPLY ALL" (owner, 2026-09-23). Live, every lookup missed: the link
// at the foot of a thread reads "Reply to all" (not "Reply all") and carries
// neither aria-label nor data-tooltip:
//
//   <span role="link" tabindex="0" class="ams bkI">Reply to all</span>
//
// These functions run IN THE PAGE: createReplyDraft inlines them with
// Function.prototype.toString, so each must be self-contained (no imports, no
// outer variables). They take `visible` as a parameter so a test can run them
// against a layout-less DOM, where offsetParent is always null.

type Visible = (el: Element) => boolean;

/** The newest visible reply-all control on the thread, or null. */
export function findReplyAll(doc: Document, visible: Visible = (el) => (el as HTMLElement).offsetParent !== null): Element | null {
  const labels = ["reply all", "reply to all"];
  const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isReplyAll = (el: Element) =>
    labels.includes(norm(el.getAttribute("aria-label"))) ||
    labels.includes(norm(el.getAttribute("data-tooltip"))) ||
    labels.includes(norm(el.textContent));
  const candidates = Array.from(doc.querySelectorAll('.ams.bkI,[role="link"],[role="button"],[aria-label],[data-tooltip]'))
    .filter((el) => visible(el) && isReplyAll(el));
  return candidates[candidates.length - 1] || null;
}

/** The "Reply to all" item of an open message menu, or null. */
export function findReplyAllMenuItem(doc: Document, visible: Visible = (el) => (el as HTMLElement).offsetParent !== null): Element | null {
  const labels = ["reply all", "reply to all"];
  const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const items = Array.from(doc.querySelectorAll('[role="menuitem"]'))
    .filter((el) => visible(el) && labels.includes(norm(el.textContent)));
  return items[items.length - 1] || null;
}
