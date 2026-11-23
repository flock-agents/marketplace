import "./gallery.css";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import { safeSrc } from "../../format";
import { cx } from "../../tone";
import { ownActivate, ownClick } from "../../interactive";
import { Button } from "../Button/Button";
import { Empty } from "../States/Empty";
import { ErrorCard } from "../States/ErrorCard";
import { Skeleton } from "../States/Skeleton";
import { ObjectIcon } from "../ObjectIcon/ObjectIcon";
import { SampleChip, isSample, sampleFade } from "../Sample/Sample";
import { inlineFor, type InlineSlot } from "../InlinePanel/InlinePanel";
export interface GalleryProps<R> {
  rows: R[]; image?: (r: R) => string | null; object?: (r: R) => string | null | undefined; title: (r: R) => ReactNode; meta?: (r: R) => ReactNode;
  onClick?: (r: R) => void; columns?: 2 | 3 | 4;
  loading?: boolean; error?: string | null; empty?: ReactNode; hasMore?: boolean; onLoadMore?: () => void;
  rowKey?: (r: R) => string;
  /** A form or detail shown in place, a full-width band right under the card whose key is `expanded.at`. */
  expanded?: InlineSlot | null;
}
const TINTS = 5;   // fl-tint-0..4 in gallery.css, a fixed cycle of theme tint tokens
function Cover({ src, object, tint, fade }: { src: string | null | undefined; object?: string | null; tint: number; fade?: string }) {
  const [bad, setBad] = useState(false);
  const safe = safeSrc(src);
  if (!safe || bad) return <div className={cx("fl-cover fl-img-empty", `fl-tint-${tint % TINTS}`, fade)} aria-hidden="true">{object ? <ObjectIcon name={object} size={48} /> : <span />}</div>;
  return <div className={cx("fl-cover", fade)}><img src={safe} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /></div>;
}
export function Gallery<R>({ rows, image, title, meta, onClick, columns, object, loading, error, empty, hasMore, onLoadMore, rowKey, expanded }: GalleryProps<R>) {
  if (error && rows.length === 0) return <ErrorCard message={error} />;
  if (loading && rows.length === 0) return <Skeleton variant="card" lines={4} />;
  if (!rows.length) return <>{empty ?? <Empty title="No data yet" />}</>;
  const onKey = (e: KeyboardEvent, r: R) => { if (onClick && ownActivate(e)) { e.preventDefault(); onClick(r); } };
  return (
    <>
      <div className={cx("fl-gal", columns && `fl-cols-${columns}`, expanded && "fl-gal-open")}>
        {rows.map((r, i) => { const sample = isSample(r), fade = sampleFade(sample), k = rowKey?.(r) ?? String((r as { id?: unknown }).id ?? i); return (
          <Fragment key={k}>
          <div className={cx("fl-gc", onClick && "fl-clickable")} tabIndex={onClick ? 0 : undefined} role={onClick ? "button" : undefined}
            onClick={onClick ? (e) => { if (ownClick(e)) onClick(r); } : undefined} onKeyDown={(e) => onKey(e, r)}>
            <Cover key={`${image?.(r) ?? ""}|${object?.(r) ?? ""}`} src={image?.(r)} object={object?.(r)} tint={i} fade={fade} />
            <div className={cx("fl-gb", fade)}><b>{title(r)}</b>{meta && <div className="fl-gm">{meta(r)}</div>}</div>
            {sample ? <SampleChip /> : null}
          </div>
          {inlineFor(expanded, k, (panel) => <div className="fl-gal-inline" data-fl-inline="">{panel}</div>)}
          </Fragment>
        ); })}
      </div>
      {error ? <p role="alert" className="fl-gal-note">{error}</p> : null}
      {hasMore && onLoadMore ? <div className="fl-gal-foot"><Button variant="ghost" size="sm" loading={loading} onClick={onLoadMore}>Load more</Button></div> : null}
    </>
  );
}
