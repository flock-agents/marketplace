import "./button.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../tone";
import { Icon } from "../Icon/Icon";
export interface ButtonProps {
  variant?: "ink" | "app" | "soft" | "ghost" | "danger"; size?: "sm" | "md"; icon?: string;
  loading?: boolean; disabled?: boolean; onClick?: () => void; type?: "button" | "submit";
  children: ReactNode; menu?: { label: string; onSelect: () => void }[];
}
export function Button({ variant = "ink", size = "md", icon, loading, disabled, onClick, type = "button", children, menu }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", esc, true); document.addEventListener("mousedown", away);
    return () => { window.removeEventListener("keydown", esc, true); document.removeEventListener("mousedown", away); };
  }, [open]);
  const cls = cx("fl-btn", `fl-btn-${variant}`, size === "sm" && "fl-btn-sm");
  const main = (
    <button type={type} className={cls} aria-busy={loading ? true : undefined} disabled={disabled || loading} onClick={onClick}>
      {loading ? <span className="fl-spin" aria-hidden /> : icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  );
  if (!menu) return main;
  return (
    <span className={cx("fl-split", `fl-split-${variant}`)} ref={ref}>
      {main}
      <button type="button" className={cls} aria-label="More" aria-haspopup="menu" aria-expanded={open} disabled={disabled || loading} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-down" size={15} />
      </button>
      {open ? (
        <div role="menu" className="fl-menu">
          {menu.map((m) => (
            <button key={m.label} type="button" role="menuitem" onClick={() => { setOpen(false); m.onSelect(); }}>{m.label}</button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
