import "./inline-panel.css";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../tone";

/**
 * What a list shows in place, directly under one of its rows: an add or edit form, or the picked row's detail.
 * `at` names the row: its id (or the list's `rowKey`), or `scheduleAddKey(date, slot?)` for an add spot in Schedule.
 */
export interface InlineSlot {
  at: string;
  content: ReactNode;
  /** Escape inside the panel calls it. Focus then goes back to the control that opened the panel. */
  onClose: () => void;
  /** The panel's accessible name, e.g. "Edit Rice" or "Add lunch on Fri, Oct 16". */
  label?: string;
}

export interface InlinePanelProps {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  className?: string;
}

const FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (el: HTMLElement) => !el.closest("[hidden]") && (el as HTMLInputElement).type !== "hidden";
const firstField = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`[data-autofocus], ${FIELD}`)].find(visible) ?? null;
const lost = (panel: HTMLElement) => { const a = document.activeElement; return !a || a === document.body || a === panel || !a.isConnected; };

/** The row the panel opened under: the element just before the panel's own slot in the list (an li, a tr, a card). */
function anchorOf(panel: HTMLElement): HTMLElement | null {
  const slot = panel.closest<HTMLElement>("[data-fl-inline]") ?? panel;
  return slot.previousElementSibling as HTMLElement | null;
}
function focusIn(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

/** Bring the panel on screen, the least scroll that shows it, and only when some of it is off screen. A panel taller than the screen shows its top. */
function reveal(el: HTMLElement) {
  if (typeof el.scrollIntoView !== "function") return;
  const r = el.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight;
  if (!h || (r.top >= 0 && r.bottom <= h)) return;
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: r.height > h ? "start" : "nearest", behavior: still ? "auto" : "smooth" });
}

/**
 * A form or detail opened in place, under the row or item that was clicked; what is below moves down. On open it focuses its first
 * field (or itself, when it holds no field yet) and scrolls only as far as needed. Escape closes it; on close, focus returns to the
 * control that opened it, or to the row it opened under. Lists render it through their `expanded` prop; use it directly in a list
 * you lay out yourself.
 */
export function InlinePanel({ children, onClose, label, className }: InlinePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  // Read while rendering, before the content's own effects can move focus into the panel: this is what was clicked.
  const [clicked] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const opener = clicked && clicked !== document.body && !panel.contains(clicked) ? clicked : null;
    const anchor = anchorOf(panel);
    // A field the content focused itself (a child's own effect) wins; otherwise the first field, else the panel.
    if (!panel.contains(document.activeElement)) { const f = firstField(panel); (f ?? panel).focus({ preventScroll: true }); }
    reveal(panel);
    // Content that arrives later (a record still loading, Edit swapping the detail for a form) gets the focus when nothing else holds it.
    const watch = typeof MutationObserver === "function" ? new MutationObserver(() => {
      if (!lost(panel)) return;
      const f = firstField(panel);
      if (f) f.focus({ preventScroll: true }); else if (document.activeElement !== panel) panel.focus({ preventScroll: true });
    }) : null;
    watch?.observe(panel, { childList: true, subtree: true });
    return () => {
      watch?.disconnect();
      const now = document.activeElement;
      if (!now || now === document.body || !now.isConnected || panel.contains(now)) {
        if (!(opener && focusIn(opener))) focusIn(anchor);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    // A dialog opened from inside the panel (Delete's confirm) answers its own Escape.
    if ((e.target as Element).closest?.('[role="dialog"], [aria-modal="true"]')) return;
    e.preventDefault(); e.stopPropagation();
    close.current();
  };
  return (
    <div ref={ref} className={cx("fl-inline", className)} role="region" aria-label={label} tabIndex={-1} onKeyDown={onKey}>
      {children}
    </div>
  );
}

/** The key of an add spot in Schedule: a day, or a day and a slot ("Lunch"). Pass it as `expanded.at` to open a form at that "+ Add". */
export const scheduleAddKey = (date: string, slot?: string): string => `+${date}${slot ? `|${slot}` : ""}`;
/** The date and slot of an add key, or null for a row key. */
export function parseAddKey(key: string | undefined | null): { date: string; slot?: string } | null {
  if (!key || key[0] !== "+") return null;
  const [date, slot] = key.slice(1).split("|");
  return slot ? { date: date!, slot } : { date: date! };
}

/** The slot a list renders under row `key`: nothing unless `expanded` points at it. */
export function inlineFor(expanded: InlineSlot | null | undefined, key: string, wrap: (panel: ReactNode) => ReactNode): ReactNode {
  if (!expanded || expanded.at !== key) return null;
  return wrap(<InlinePanel key={`inline:${key}`} onClose={expanded.onClose} label={expanded.label}>{expanded.content}</InlinePanel>);
}
