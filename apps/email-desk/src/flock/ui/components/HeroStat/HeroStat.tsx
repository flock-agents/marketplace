import "./herostat.css";
import { Value, type ValueKind } from "../Value/Value";
export interface HeroStatProps { label: string; value: number; kind?: ValueKind; delta?: number; caption?: string }
export function HeroStat({ label, value, kind = "number", delta, caption }: HeroStatProps) {
  return (
    <div className="fl-hero">
      <span className="fl-hero-label">{label}</span>
      <b className="fl-hero-value"><Value kind={kind} value={value} /></b>
      {delta !== undefined ? <span className="fl-hero-delta"><Value kind="percent" value={delta} /></span> : null}
      {caption ? <span className="fl-hero-caption">{caption}</span> : null}
    </div>
  );
}
