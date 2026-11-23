import "./search.css";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon/Icon";
export interface SearchProps { value: string; onChange: (v: string) => void; placeholder?: string; debounceMs?: number }
export function Search({ value, onChange, placeholder = "Search", debounceMs = 250 }: SearchProps) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(value);
  const latest = useRef(onChange); latest.current = onChange;
  // Follow the value when the parent changes it (a reset), but not our own echo.
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value); } }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const type = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    const emit = () => { sent.current = v; latest.current(v); };
    if (debounceMs <= 0) emit(); else timer.current = setTimeout(emit, debounceMs);
  };
  return (
    <div className="fl-search">
      <Icon name="search" size={16} />
      <input type="search" className="fl-inp" value={text} placeholder={placeholder} aria-label={placeholder} autoComplete="off" onChange={(e) => type(e.target.value)} />
    </div>
  );
}
