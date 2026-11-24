import "./checklist.css";
import { useState } from "react";
import { cx } from "../../tone";
import { Icon } from "../Icon/Icon";
import { Progress } from "../Progress/Progress";
import { SampleChip, sampleFade } from "../Sample/Sample";
export interface ChecklistItem {
  id: string; label: string; done: boolean; meta?: string; group?: string;
  /** A sample row (the row's `_sample`): shown lighter, with a Sample chip. */
  sample?: boolean;
}
export interface ChecklistProps {
  items: ChecklistItem[]; onToggle: (id: string, done: boolean) => void; onAdd?: (label: string, group?: string) => void;
  style?: "task" | "note"; grouped?: boolean; showProgress?: boolean;
  /** Show only the first N rows (across groups) behind a "Show all" button. Set by the chat renderer, not by agents; it
   *  never hides a single row. */
  collapseAfter?: number;
}
function AddRow({ group, onAdd }: { group?: string; onAdd: (label: string, group?: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => { const t = text.trim(); if (!t) return; onAdd(t, group); setText(""); };
  return (
    <div className="fl-check-add">
      <Icon name="plus" size={15} />
      <input type="text" value={text} placeholder="Add item" aria-label={group ? `Add item to ${group}` : "Add item"}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
    </div>
  );
}
export function Checklist({ items: all, onToggle, onAdd, style = "task", grouped, showProgress, collapseAfter }: ChecklistProps) {
  const [expanded, setExpanded] = useState(false);
  const done = all.filter((i) => i.done).length;
  const collapsed = !expanded && collapseAfter !== undefined && all.length > collapseAfter + 1;
  // Grouped rows show in group order, so the first N are taken in that order.
  const ordered = grouped ? [...new Set(all.map((i) => i.group ?? ""))].flatMap((g) => all.filter((i) => (i.group ?? "") === g)) : all;
  const items = collapsed ? ordered.slice(0, collapseAfter) : all;
  const row = (it: ChecklistItem) => (
    <button key={it.id} type="button" role="checkbox" aria-checked={it.done} className={cx("fl-check", style === "note" && "fl-check-round", it.done && "fl-check-done")}
      onClick={() => onToggle(it.id, !it.done)}>
      <span className="fl-cbx" aria-hidden><Icon name="check" size={13} /></span>
      <span className={cx("fl-check-t", sampleFade(!!it.sample))}><span>{it.label}</span>{it.meta ? <small>{it.meta}</small> : null}</span>
      {it.sample ? <SampleChip /> : null}
    </button>
  );
  let body;
  if (grouped) {
    const order: string[] = []; const by = new Map<string, ChecklistItem[]>();
    for (const it of items) { const g = it.group ?? ""; if (!by.has(g)) { by.set(g, []); order.push(g); } by.get(g)!.push(it); }
    body = order.map((g) => {
      const list = by.get(g)!;
      return (
        <div className="fl-check-grp" key={g}>
          {g ? <div className="fl-check-grp-h"><h4>{g}</h4><span>{list.filter((i) => i.done).length} of {list.length}</span></div> : null}
          {list.map(row)}
          {onAdd && g ? <AddRow group={g} onAdd={onAdd} /> : null}
        </div>
      );
    });
    // Ungrouped items (or an empty list) get one bare add row; named groups carry their own.
    if (onAdd && (by.has("") || order.length === 0)) body.push(<AddRow key="__add" onAdd={onAdd} />);
  } else {
    body = <>{items.map(row)}{onAdd ? <AddRow onAdd={onAdd} /> : null}</>;
  }
  return (
    <div className="fl-checklist">
      {showProgress ? (
        <div className="fl-check-prog"><b>{done} of {all.length}</b><Progress value={done} limit={all.length} showValue={false} /></div>
      ) : null}
      <div className="fl-check-list">{body}</div>
      {collapsed ? <button type="button" className="fl-check-more" onClick={() => setExpanded(true)}>Show all {all.length}</button> : null}
    </div>
  );
}
