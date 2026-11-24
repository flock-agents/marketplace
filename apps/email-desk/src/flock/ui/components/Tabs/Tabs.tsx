import "./tabs.css";
import { useRef, type KeyboardEvent } from "react";
import { Icon } from "../Icon/Icon";
export interface TabItem { id: string; label: string; count?: number | string; icon?: string; /** TypeScript-only: a finished step (an answered question), drawn in the accent. */ done?: boolean }
export interface TabsProps { tabs: TabItem[]; value: string; onChange: (id: string) => void }
export function Tabs({ tabs, value, onChange }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    if (!t) return;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };
  const active = tabs.some((t) => t.id === value) ? value : tabs[0]?.id;
  return (
    <div className="fl-tabs" role="tablist">
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" className="fl-tab"
          aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1}
          data-done={t.done ? "true" : undefined}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.icon ? <Icon name={t.icon} size={14} /> : null}{t.label}{t.count != null ? <span className="fl-tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
