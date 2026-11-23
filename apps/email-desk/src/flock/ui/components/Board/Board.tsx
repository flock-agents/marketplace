import "./board.css";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
import { SampleChip, isSample } from "../Sample/Sample";
import { inlineFor, type InlineSlot } from "../InlinePanel/InlinePanel";
export interface BoardColumn { id: string; label: string; tone?: ToneT }
export interface BoardProps<R> {
  columns: BoardColumn[]; rows: R[]; columnOf: (r: R) => string; card: (r: R) => ReactNode;
  onMove?: (row: R, toColumn: string) => void; onCardClick?: (r: R) => void;
  rowKey?: (r: R) => string;
  /** A form or detail shown in place in the card's column, right under the card whose key is `expanded.at`. */
  expanded?: InlineSlot | null;
}
export function Board<R>({ columns, rows, columnOf, card, onMove, onCardClick, rowKey, expanded }: BoardProps<R>) {
  const [drag, setDrag] = useState<R | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<R | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (menuFor) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(); }, [menuFor]);
  return (
    <div className="fl-board">
      {columns.map((c) => {
        const items = rows.filter((r) => columnOf(r) === c.id);
        return (
          <div key={c.id} className={cx("fl-col", over === c.id && "fl-over")}
            onDragOver={(e) => { if (drag && onMove) { e.preventDefault(); setOver(c.id); } }}
            onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); if (drag && onMove && columnOf(drag) !== c.id) onMove(drag, c.id); setDrag(null); }}>
            <h5><i className={cx("fl-sd", c.tone && `fl-tone-${c.tone}`)} />{c.label}<span className="fl-n">{items.length}</span></h5>
            <ul role="list" aria-label={c.label} className="fl-col-list">
              {items.map((r, i) => { const k = rowKey?.(r) ?? String((r as { id?: unknown }).id ?? i); return (
                <Fragment key={k}>
                <li role="listitem" tabIndex={0} draggable={!!onMove} aria-keyshortcuts={onMove ? "." : undefined}
                  className={cx("fl-bcard", drag === r && "fl-dragging")}
                  onDragStart={(e) => { setDrag(r); e.dataTransfer?.setData("text/plain", String(i)); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={() => onCardClick?.(r)}
                  onKeyDown={(e) => {
                    if (e.key === "." && onMove && e.target === e.currentTarget) { e.preventDefault(); setMenuFor(r); }
                    else if (e.key === "Enter" && onCardClick && e.target === e.currentTarget) onCardClick(r);
                  }}>
                  {isSample(r) ? <><SampleChip /><div className="fl-sample-soft-kids">{card(r)}</div></> : card(r)}
                  {onMove && <button type="button" className="fl-move" aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setMenuFor(r); }}>Move</button>}
                  {menuFor === r && onMove && (
                    <div ref={menuRef} className="fl-bmenu" role="menu" aria-label="Move to"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") { setMenuFor(null); (e.currentTarget.closest("[role=listitem]") as HTMLElement | null)?.focus(); }
                        const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
                        const at = items.indexOf(document.activeElement as HTMLElement);
                        if (e.key === "ArrowDown") { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
                        if (e.key === "ArrowUp") { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
                      }}>
                      <span className="fl-bmenu-h" role="presentation">Move to</span>
                      {columns.filter((x) => x.id !== c.id).map((x) => (
                        <button key={x.id} type="button" role="menuitem" onClick={() => { onMove(r, x.id); setMenuFor(null); }}>
                          <i className={cx("fl-sd", x.tone && `fl-tone-${x.tone}`)} />{x.label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
                {inlineFor(expanded, k, (panel) => <li role="listitem" className="fl-bcard-inline" data-fl-inline="">{panel}</li>)}
                </Fragment>
              ); })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
