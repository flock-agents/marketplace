import { useEffect, useRef, type RefObject } from "react";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Open modals, oldest first. Only the last one answers Escape and Tab. */
const stack: symbol[] = [];
/**
 * Modal behaviour for a dialog element: focus moves in on open, Tab is trapped,
 * Escape closes, body scroll is locked, and focus returns to what opened it.
 */
export function useModal(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = Symbol("modal");
    stack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    const body = document.body, overflow = body.style.overflow;
    body.style.overflow = "hidden";
    const items = () => (ref.current ? [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab") return;
      const els = items();
      if (!els.length) return;
      const first = els[0]!, last = els[els.length - 1]!, at = document.activeElement;
      if (!ref.current?.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { stack.splice(stack.indexOf(me), 1); document.removeEventListener("keydown", onKey); body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, ref]);
}
