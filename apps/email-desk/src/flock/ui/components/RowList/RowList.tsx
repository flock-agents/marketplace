import "./rowlist.css";
import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../tone";
import { ownActivate, ownClick } from "../../interactive";
import { Button } from "../Button/Button";
import { Skeleton } from "../States/Skeleton";
import { ErrorCard } from "../States/ErrorCard";
import { Empty } from "../States/Empty";
import { SampleChip, isSample, sampleFade, sampleSoft } from "../Sample/Sample";
import { inlineFor, type InlineSlot } from "../InlinePanel/InlinePanel";
export interface RowListProps<R> {
  rows: R[]; title: (r: R) => ReactNode; meta?: (r: R) => ReactNode; trailing?: (r: R) => ReactNode; leading?: (r: R) => ReactNode;
  onRowClick?: (r: R) => void; loading?: boolean; error?: string | null; empty?: ReactNode; hasMore?: boolean; onLoadMore?: () => void;
  rowKey?: (r: R) => string;
  /** A form or detail shown in place under the row whose key is `expanded.at`. */
  expanded?: InlineSlot | null;
}
export function RowList<R extends object>({ rows, title, meta, trailing, leading, onRowClick, loading, error, empty, hasMore, onLoadMore, rowKey, expanded }: RowListProps<R>) {
  if (error && rows.length === 0) return <ErrorCard message={error} />;   // loaded rows are never wiped by a later failure
  if (loading && rows.length === 0) return <Skeleton />;
  if (rows.length === 0) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  const onKey = (e: KeyboardEvent, r: R) => { if (ownActivate(e)) { e.preventDefault(); onRowClick?.(r); } };
  return (
    <div className="fl-rows">
      {rows.map((r, i) => { const sample = isSample(r), fade = sampleFade(sample), k = rowKey?.(r) ?? String((r as { id?: unknown }).id ?? i); return (
        <Fragment key={k}>
        <div className={cx("fl-row", onRowClick && "fl-row-click")}
          role={onRowClick ? "button" : undefined} tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? (e) => { if (ownClick(e)) onRowClick(r); } : undefined} onKeyDown={onRowClick ? (e) => onKey(e, r) : undefined}>
          {leading ? <span className={cx("fl-row-lead", sampleSoft(sample))}>{leading(r)}</span> : null}
          <div className={cx("fl-row-main", fade)}>
            <b className="fl-row-title">{title(r)}</b>
            {meta ? <small className="fl-row-meta">{meta(r)}</small> : null}
          </div>
          {sample ? <SampleChip /> : null}
          {trailing ? <span className={cx("fl-row-trail", sampleSoft(sample))}>{trailing(r)}</span> : null}
        </div>
        {inlineFor(expanded, k, (panel) => <div className="fl-rows-inline" data-fl-inline="">{panel}</div>)}
        </Fragment>
      ); })}
      {error ? <p role="alert" className="fl-rows-note">{error}</p> : null}
      {hasMore && onLoadMore ? <div className="fl-rows-foot"><Button variant="ghost" size="sm" loading={loading} onClick={onLoadMore}>Load more</Button></div> : null}
    </div>
  );
}
