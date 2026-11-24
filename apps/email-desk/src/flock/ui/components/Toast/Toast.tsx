import "./toast.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
export interface ToastInput { message: string; tone?: ToneT; action?: { label: string; onClick: () => void; focus?: boolean } }
/** `action.focus` moves keyboard focus to the action button when the toast shows: use it when the control the user
 *  pressed goes away (Clear samples), so focus lands on Undo, not <body>. Focus also holds the toast open. */
interface ToastCtx { show(t: ToastInput): void }
const NOOP: ToastCtx = { show() {} };
const Ctx = createContext<ToastCtx>(NOOP);
/** Without a ToastProvider this returns a no-op `show`, so data hooks never crash outside the shell. */
export function useToast(): ToastCtx { return useContext(Ctx); }
const LIFETIME_MS = 5000;
/** A toast offering Undo gets the time to reach it, on a phone too (live run T22c: 5s was gone before the tap). */
const ACTION_LIFETIME_MS = 10_000;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<(ToastInput & { id: number })[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id); held.current.delete(id); withAction.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);
  const withAction = useRef(new Set<number>());
  const arm = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => dismiss(id), withAction.current.has(id) ? ACTION_LIFETIME_MS : LIFETIME_MS));
  }, [dismiss]);
  const held = useRef(new Map<number, { hover: boolean; focus: boolean }>());
  const setHeld = useCallback((id: number, k: "hover" | "focus", on: boolean) => {
    const h = held.current.get(id) ?? { hover: false, focus: false };
    h[k] = on; held.current.set(id, h);
    if (h.hover || h.focus) clearTimeout(timers.current.get(id)); else arm(id);
  }, [arm]);
  const show = useCallback((t: ToastInput) => {
    const id = ++next.current;
    if (t.action) withAction.current.add(id);
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    arm(id);
  }, [arm]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const focusOnce = useCallback((el: HTMLButtonElement | null) => { if (el && !el.dataset.focused) { el.dataset.focused = "1"; el.focus(); } }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fl-toasts" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={cx("fl-toast", `fl-toast-${t.tone ?? "neutral"}`)}
            {...(t.action ? { onMouseEnter: () => setHeld(t.id, "hover", true), onMouseLeave: () => setHeld(t.id, "hover", false), onFocus: () => setHeld(t.id, "focus", true), onBlur: () => setHeld(t.id, "focus", false) } : {})}>
            <i aria-hidden />{t.message}
            {t.action ? <button type="button" ref={t.action.focus ? focusOnce : undefined} onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button> : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
