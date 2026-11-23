import "./table.css";
import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
import { ownActivate, ownClick } from "../../interactive";
import { Value, type ValueKind } from "../Value/Value";
import { Button } from "../Button/Button";
import { Skeleton } from "../States/Skeleton";
import { ErrorCard } from "../States/ErrorCard";
import { Empty } from "../States/Empty";
import { SampleChip, isSample, sampleFade, sampleSoft } from "../Sample/Sample";
import { inlineFor, type InlineSlot } from "../InlinePanel/InlinePanel";
export interface ColumnSpec<R> {
  key: keyof R & string; label: string; kind?: ValueKind; tones?: Record<string, ToneT>; labels?: Record<string, string>;
  align?: "start" | "end"; width?: "auto" | "narrow" | "wide"; render?: (row: R) => ReactNode;
  /** "hide" leaves the column out of the card on phones. */
  phone?: "hide";
}
export interface TableProps<R> {
  rows: R[]; columns: ColumnSpec<R>[]; onRowClick?: (row: R) => void; selectedId?: string;
  loading?: boolean; error?: string | null; empty?: ReactNode; hasMore?: boolean; onLoadMore?: () => void;
  density?: "compact" | "comfortable"; rowKey?: (row: R) => string;
  /** A form or detail shown in place under the row whose key is `expanded.at`. */
  expanded?: InlineSlot | null;
}
const NARROW = "(max-width: 720px)";   // the breakpoint AppShell uses
function useNarrow(): boolean {
  const mq = () => (typeof matchMedia === "function" ? matchMedia(NARROW) : null);
  const [narrow, setNarrow] = useState(() => mq()?.matches ?? false);   // read before first paint: no jump
  useEffect(() => {
    const m = mq(); if (!m) return;
    const on = () => setNarrow(m.matches);
    on(); m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}
const CHIP_KINDS: ValueKind[] = ["select", "multi", "person", "date"];
const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function Table<R extends object>({
  rows, columns, onRowClick, selectedId, loading, error, empty, hasMore, onLoadMore, density = "comfortable", rowKey, expanded,
}: TableProps<R>) {
  const narrow = useNarrow();
  if (error && rows.length === 0) return <ErrorCard message={error} />;   // loaded rows are never wiped by a later failure
  if (loading && rows.length === 0) return <div className="fl-tbl"><Skeleton /></div>;
  if (rows.length === 0) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  const note = error ? <p role="alert" className="fl-tbl-note">{error}</p> : null;   // rows are loaded here, so a later failure is a notice, not a wipe
  const keyOf = (r: R, i: number) => rowKey?.(r) ?? String((r as { id?: unknown }).id ?? i);
  const onKey = (e: KeyboardEvent, r: R) => {
    if (ownActivate(e)) { e.preventDefault(); onRowClick?.(r); }
  };
  const cell = (c: ColumnSpec<R>, r: R) => (c.render ? c.render(r) : <Value kind={c.kind ?? "text"} value={r[c.key]} tones={c.tones} labels={c.labels} />);
  if (narrow) {
    const shown = columns.filter((c) => c.phone !== "hide");
    const title = shown.find((c) => c.width === "wide") ?? shown[0];
    const end = shown.find((c) => c !== title && c.align === "end");
    const rest = shown.filter((c) => c !== title && c !== end);
    const isChip = (c: ColumnSpec<R>) => !c.render && CHIP_KINDS.includes(c.kind ?? "text");
    return (
      <div className={cx("fl-tbl fl-tbl-cards", density === "compact" && "fl-tbl-compact")}>
        <ul className="fl-tcards">
          {rows.map((r, i) => {
            const k = keyOf(r, i);
            const has = (c: ColumnSpec<R>) => !!c.render || !blank(r[c.key]);
            const chips = rest.filter((c) => isChip(c) && has(c)), lines = rest.filter((c) => !isChip(c) && has(c));
            const richTitle = !!title && (!!title.render || title.kind === "url");   // may hold its own link or control
            const raw = title ? r[title.key] : undefined;
            const titleCell = title && has(title) ? cell(title, r) : <span className="fl-dash">—</span>;
            const sample = isSample(r), fade = sampleFade(sample);
            return (
              <Fragment key={k}>
              <li className={cx("fl-tcard", onRowClick && "fl-clickable", selectedId !== undefined && k === selectedId && "fl-selected")}
                aria-current={selectedId !== undefined && k === selectedId ? "true" : undefined}>
                {onRowClick && richTitle ? <button type="button" className="fl-tcard-open fl-tcard-cover" aria-label={(typeof raw === "string" || typeof raw === "number") && String(raw).trim() ? String(raw) : "Open row"} onClick={() => onRowClick(r)} /> : null}
                <div className="fl-tcard-main">
                  <span className="fl-tcard-head">
                    {onRowClick && !richTitle
                      ? <button type="button" className="fl-tcard-open fl-tcard-title" onClick={() => onRowClick(r)}>{sample ? <span className="fl-sample-fade">{titleCell}</span> : titleCell}</button>
                      : <span className={cx("fl-tcard-title", richTitle && "fl-tcard-layer", sampleSoft(sample))}>{titleCell}</span>}
                    {end && has(end) ? <span className={cx("fl-tcard-end", sampleSoft(sample))}>{cell(end, r)}</span> : null}
                  </span>
                  {chips.length || sample ? <span className="fl-tcard-chips">{sample ? <SampleChip /> : null}{chips.map((c) => <span key={c.key} className={cx("fl-tcard-chip", fade)}>{cell(c, r)}</span>)}</span> : null}
                  {lines.length ? <span className="fl-tcard-lines">{lines.map((c) => <span key={c.key} className={cx("fl-tcard-line", sampleSoft(sample))}><span className="fl-tcard-label">{c.label}:</span> {cell(c, r)}</span>)}</span> : null}
                </div>
              </li>
              {inlineFor(expanded, k, (panel) => <li className="fl-tcard-inline" data-fl-inline="">{panel}</li>)}
              </Fragment>
            );
          })}
        </ul>
        {note}
      {hasMore && onLoadMore ? <div className="fl-tbl-foot"><Button variant="ghost" size="sm" loading={loading} onClick={onLoadMore}>Load more</Button></div> : null}
      </div>
    );
  }
  return (
    <div className={cx("fl-tbl", density === "compact" && "fl-tbl-compact")}>
      <div className="fl-tbl-scroll">
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={cx(c.align === "end" && "fl-end", c.width && c.width !== "auto" && `fl-w-${c.width}`)}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const k = keyOf(r, i), sample = isSample(r);
              return (
                <Fragment key={k}>
                <tr className={cx(onRowClick && "fl-clickable")}
                  tabIndex={onRowClick ? 0 : undefined} aria-selected={selectedId !== undefined ? k === selectedId : undefined}
                  onClick={onRowClick ? (e) => { if (ownClick(e)) onRowClick(r); } : undefined} onKeyDown={onRowClick ? (e) => onKey(e, r) : undefined}>
                  {columns.map((c, ci) => {
                    const content = c.render ? c.render(r) : <Value kind={c.kind ?? "text"} value={r[c.key]} tones={c.tones} labels={c.labels} />;
                    return (
                      <td key={c.key} className={cx(c.align === "end" && "fl-end")}>
                        {sample ? <span className={c.render ? "fl-sample-soft" : "fl-sample-fade"}>{content}</span> : content}
                        {sample && ci === 0 ? <> <SampleChip /></> : null}
                      </td>
                    );
                  })}
                </tr>
                {inlineFor(expanded, k, (panel) => <tr className="fl-tbl-inline" data-fl-inline=""><td colSpan={columns.length}>{panel}</td></tr>)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {note}
      {hasMore && onLoadMore ? <div className="fl-tbl-foot"><Button variant="ghost" size="sm" loading={loading} onClick={onLoadMore}>Load more</Button></div> : null}
    </div>
  );
}
