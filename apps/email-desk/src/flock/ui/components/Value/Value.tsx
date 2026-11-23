import "./value.css";
import type { ToneT } from "../../tone";
import { cx } from "../../tone";
import { figure, formatINR, formatNumber, formatPercentChange, readable, relativeDate, safeHref } from "../../format";
import type { ValueKind } from "./kind";
export type { ValueKind };
export interface ValueProps {
  kind: ValueKind; value: unknown; tones?: Record<string, ToneT>; today?: string;
  /** select: the words shown for a stored value (an owner's renamed stage); a value with no entry shows as stored. */
  labels?: Record<string, string>;
}
const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  // Colour comes from a token chosen by a stable hash of the name — never a literal.
  const n = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;
  return <i className={cx("fl-avatar", `fl-avatar-${size}`, `fl-av-${n}`)} aria-hidden>{name.slice(0, 1).toUpperCase()}</i>;
}
export function Value({ kind, value, tones, today, labels }: ValueProps) {
  if (empty(value)) return <span className="fl-dash">—</span>;
  // A figure written as text ("₹1,42,000", "1.2L", "7.25%") is still a number; anything else shows as words, never
  // "[object Object]" (an object reads as its label, else "key: value").
  const num = figure(value);
  const words = readable(value);
  switch (kind) {
    case "money": return num === null ? <>{words}</> : <span className="fl-num">{formatINR(num)}</span>;
    case "compact": return num === null ? <>{words}</> : <span className="fl-num">{formatINR(num, { compact: true })}</span>;
    case "signed": return num === null ? <>{words}</> : <span className={cx("fl-num", "fl-amt", num > 0 && "fl-pos")}>{formatINR(num, { signed: true })}</span>;
    case "percent": return num === null ? <>{words}</> : <span className={num >= 0 ? "fl-pos" : "fl-neg"}>{formatPercentChange(num)}</span>;
    case "share": return num === null ? <>{words}</> : <span className="fl-num">{formatNumber(num)}%</span>;
    case "number": return num === null ? <>{words}</> : <span className="fl-num">{formatNumber(num)}</span>;
    case "minutes": return <span className="fl-num">{words} min</span>;
    case "date": return <span className="fl-due">{relativeDate(words, today)}</span>;
    case "select": return <span className={cx("fl-pill", `fl-tone-${tones?.[words] ?? "neutral"}`)}>{labels?.[words] ?? words}</span>;
    case "multi": return <span className="fl-tags">{(Array.isArray(value) ? value : [value]).map((x, i) => <span key={i}>{readable(x)}</span>)}</span>;
    case "person": return <span className="fl-who"><Avatar name={words} />{words}</span>;
    case "checkbox": return value ? <span className="fl-pos" aria-label="yes">✓</span> : <span className="fl-dash" aria-label="no">○</span>;
    case "url": { const href = safeHref(value); return href ? <a className="fl-link" href={href} target="_blank" rel="noopener noreferrer">{String(value).replace(/^https?:\/\//, "")}</a> : <span>{words}</span>; }
    default: return <>{words}</>;
  }
}
