import "./statstrip.css";
import { cx } from "../../tone";
import { formatPercentChange } from "../../format";
import { Value, type ValueKind } from "../Value/Value";
export interface Stat { label: string; value: number | string; kind?: ValueKind; delta?: number; hint?: string }
export const MAX_STATS = 5;
export function StatStrip({ stats }: { stats: Stat[] }) {
  if (stats.length > MAX_STATS) console.warn(`StatStrip: ${stats.length} stats given; use at most ${MAX_STATS} (one quiet row, never a grid of number cards).`);
  return (
    <div className="fl-statstrip">
      {stats.map((s) => (
        <div key={s.label} className="fl-stat" title={s.hint}>
          <b><Value kind={s.kind ?? (typeof s.value === "number" ? "number" : "text")} value={s.value} /></b>
          <span>{s.label}</span>
          {s.delta !== undefined ? <em className={cx(s.delta < 0 && "fl-down")}>{formatPercentChange(s.delta)}</em> : null}
        </div>
      ))}
    </div>
  );
}
