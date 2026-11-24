import "./progress.css";
import { cx } from "../../tone";
import { Value, type ValueKind } from "../Value/Value";
export interface ProgressProps { value: number; limit: number; label?: string; kind?: ValueKind; showValue?: boolean }
export function Progress({ value, limit, label, kind = "number", showValue = true }: ProgressProps) {
  const over = value > limit;
  const pct = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className={cx("fl-prog", over && "fl-over", !label && !showValue ? "fl-prog-solo" : !label && "fl-prog-bare")} role="progressbar" aria-label={label || "Progress"}
      aria-valuenow={value} aria-valuemin={0} aria-valuemax={limit}>
      {label ? <span className="fl-prog-label">{label}</span> : null}
      <span className="fl-prog-track"><i className="fl-prog-fill" style={{ width: `${pct}%` }} /></span>
      {showValue ? <span className="fl-prog-text"><Value kind={kind} value={value} /> / <Value kind={kind} value={limit} /></span> : null}
    </div>
  );
}

export interface ProgressListProps { items: { label: string; value: number; limit: number; kind?: ValueKind }[] }
/** Several Progress rows sharing one label column, so the bars line up. */
export function ProgressList({ items }: ProgressListProps) {
  return <div className="fl-proglist">{items.map((it, i) => <Progress key={`${it.label}-${i}`} {...it} />)}</div>;
}
