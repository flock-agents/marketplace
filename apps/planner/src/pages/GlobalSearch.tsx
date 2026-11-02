import "./pantry.css";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search, kitFetch } from "../flock/ui";
import { KIND_LABELS, groupHits, readHits, routeFor, type SearchHit } from "./GlobalSearchResults";

/** Dishes, recipes, ingredients (with aliases), pantry and orders from one box in the header; ↑/↓ move, Enter opens, Esc closes. */
export function GlobalSearch({ onOpen }: { onOpen: (route: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => { setSlot(document.querySelector(".fl-shell-end")); }, []);

  useEffect(() => {
    const text = q.trim();
    if (!text) { setHits([]); return; }
    let live = true;
    kitFetch<unknown>(`search?q=${encodeURIComponent(text)}`)
      .then((body) => { if (live) { setHits(readHits(body)); setActive(0); setOpen(true); } })
      .catch(() => { if (live) setHits([]); });
    return () => { live = false; };
  }, [q]);

  const go = (hit: SearchHit) => { setOpen(false); setQ(""); onOpen(routeFor(hit)); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter" && open) { e.preventDefault(); const flat = groupHits(hits).flatMap((g) => g.hits); if (flat[active]) go(flat[active]); }
  };

  const box = (
    <div className={`pl-gsearch${slot ? "" : " pl-gsearch-inline"}`} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <Search value={q} onChange={setQ} placeholder="Search dishes, ingredients, orders" debounceMs={150} />
      {open && q.trim() ? (
        <ul className="pl-gsearch-list" role="listbox" aria-label="Search results">
          {hits.length ? groupHits(hits).map((g) => (
            <li key={g.kind} role="presentation">
              <div className="pl-gsearch-group">{KIND_LABELS[g.kind]}</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }} role="group">
                {g.hits.map((h, i) => (
                  <li key={`${h.kind}:${h.id}`} role="option" aria-selected={g.start + i === active}>
                    <button type="button" tabIndex={-1} className="pl-picker-opt" data-active={g.start + i === active || undefined}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
                      <span>{h.title}</span>{h.meta ? <small>{h.meta}</small> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )) : <li className="pl-gsearch-group" role="presentation">No matches</li>}
        </ul>
      ) : null}
    </div>
  );
  return slot ? createPortal(box, slot) : box;
}
