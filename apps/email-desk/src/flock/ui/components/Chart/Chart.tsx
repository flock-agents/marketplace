import "./chart.css";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { figure, formatINR, formatNumber } from "../../format";
import { foldShare } from "./share";
import { cx, type ToneT } from "../../tone";
import type { ValueKind } from "../Value/Value";
import { Empty } from "../States/Empty";
export interface ChartSeries { key: string; label: string; tone?: ToneT }
export interface ChartProps {
  type: "line" | "bar" | "share";
  data: { label: string; [series: string]: number | string }[];
  series: ChartSeries[]; kind?: ValueKind; height?: number;
}
const ORDER: ToneT[] = ["accent", "info", "success", "warning", "danger", "muted"];
const toneOf = (s: ChartSeries | undefined, i: number): ToneT => s?.tone ?? ORDER[i % ORDER.length];
/** A plotted value: a number, or a figure written as text ("₹1,200", "1.2L", "7.25%"); anything else is 0. */
const num = (v: unknown) => figure(v) ?? 0;
function fmt(n: number, kind?: ValueKind, compact = false): string {
  if (kind === "money") return formatINR(n, { compact });
  if (kind === "compact") return formatINR(n, { compact: true }).replace("₹", "");
  if (kind === "percent" || kind === "share") return `${n}%`;
  return formatNumber(n);
}
const axisFmt = (n: number, kind?: ValueKind) => (kind === "money" || kind === "compact" ? fmt(n, kind, true) : fmt(n, kind));
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
/** The value axis. Bars stand on zero, and the axis reaches below it when a bar is negative. A line fits its own range, so a move shows (owner 2026-10-21: the Sensex going from
 *  76,900 to 72,500 drew flat on a 0-to-100,000 axis): nice steps around the lowest and highest point. */
export function axisRange(vals: number[], type: "line" | "bar"): { bottom: number; top: number; ticks: number[] } {
  const hi = Math.max(...vals), lo = Math.min(...vals);
  if (!vals.length || (type === "bar" && lo >= 0)) { const top = niceMax(Math.max(0, hi)); return { bottom: 0, top, ticks: [0, 1, 2, 3, 4].map((i) => (top / 4) * i) }; }
  if (type === "bar") {
    const step = niceMax((Math.max(0, hi) - lo) / 4);
    const bottom = Math.floor(lo / step) * step, top = Math.max(step, Math.ceil(Math.max(0, hi) / step) * step);
    const ticks: number[] = [];
    for (let t = bottom; t <= top + step / 2 && ticks.length < 9; t += step) ticks.push(Number(t.toPrecision(12)));
    return { bottom, top, ticks };
  }
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const step = niceMax(span / 4);
  let bottom = Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step;
  if (top === bottom) top = bottom + step;
  if (lo >= 0 && bottom < 0) bottom = 0;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2 && ticks.length < 8; t += step) ticks.push(Number(t.toPrecision(12)));
  return { bottom, top, ticks };
}
const FALLBACK_W = 600, PR = 12, PT = 12, PB = 28;
const TIP_GAP = 10;
/** Where the value label sits along x, in the chart box's px: right of the point, flipped left of it near the right edge,
 *  and never outside the box. Before the label is measured (width 0), the half of the box the point is in decides the side. */
export function placeTip(anchor: number, tipW: number, boxW: number, gap = TIP_GAP): { left?: number; right?: number; flipped: boolean } {
  if (tipW <= 0) return anchor > boxW / 2 ? { right: boxW - anchor + gap, flipped: true } : { left: anchor + gap, flipped: false };
  if (anchor + gap + tipW <= boxW) return { left: anchor + gap, flipped: false };
  if (anchor - gap - tipW >= 0) return { left: anchor - gap - tipW, flipped: true };
  return { left: Math.max(0, boxW - tipW), flipped: true };
}
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The highlighted point of a chart: set by the pointer (hover), a tap (stays until tapped again or focus leaves) and the keyboard. */
function usePoint(count: number) {
  const [at, setAt] = useState<number | null>(null);
  const pinned = useRef(false);
  const show = (i: number | null) => { pinned.current = false; setAt(i == null ? null : Math.max(0, Math.min(count - 1, i))); };
  const tap = (i: number) => { const same = pinned.current && at === i; pinned.current = !same; setAt(same ? null : i); };
  const leave = (e: PointerEvent) => { if (e.pointerType !== "touch" && !pinned.current) setAt(null); };
  const key = (e: KeyboardEvent, valid: (i: number) => boolean = () => true) => {
    const step = (from: number, d: number) => { for (let i = from + d; i >= 0 && i < count; i += d) if (valid(i)) return i; return from; };
    const first = step(-1, 1), last = step(count, -1);
    let next: number | null | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = at == null ? first : step(at, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = at == null ? last : step(at, -1);
    else if (e.key === "Home") next = first;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") next = null;
    if (next === undefined || (next != null && (next < 0 || next >= count))) return;
    e.preventDefault(); pinned.current = false; setAt(next);
  };
  return { at, show, tap, leave, key, hide: () => { pinned.current = false; setAt(null); } };
}

/** The value label: an overlay in the chart's box (it never changes the chart's height), placed by placeTip once measured. */
function Tip({ anchor, top, boxRef, children }: { anchor: number; top: number; boxRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ tipW: 0, boxW: 0 });
  useIsoLayoutEffect(() => {
    const tipW = ref.current?.offsetWidth ?? 0, boxW = boxRef.current?.clientWidth ?? 0;
    if (tipW !== size.tipW || boxW !== size.boxW) setSize({ tipW, boxW });
  });
  const p = placeTip(anchor, size.boxW > 0 ? size.tipW : 0, size.boxW > 0 ? size.boxW : anchor * 2 || 1);
  return (
    <div ref={ref} className="fl-tip" aria-hidden="true" data-flipped={p.flipped || undefined}
      style={{ top, ...(p.left != null ? { left: p.left } : { right: p.right }) }}>{children}</div>
  );
}
const TipRow = ({ tone, label, value, extra }: { tone: ToneT; label: string; value: string; extra?: string }) => (
  <div className={cx("fl-tip-row", fs(tone))}><i /><em>{label}</em><b>{value}</b>{extra && <span>{extra}</span>}</div>
);
const fs = (t: ToneT) => `fl-s-${t}`;

export function Chart({ type, data, series, kind, height = 200 }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(FALLBACK_W);
  const pt = usePoint(data.length);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setW(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length, series.length, type]);
  if (!data.length || !series.length) return <Empty title="No data yet" />;
  if (type === "share") return <Share data={data} series={series} kind={kind} />;

  const { bottom, top, ticks } = axisRange(data.flatMap((d) => series.map((s) => num(d[s.key]))), type);
  // The axis column fits its longest label (a fixed 52px cut "100,000" to "00,000").
  const PL = Math.max(36, Math.max(...ticks.map((t) => axisFmt(t, kind).length)) * 7.5 + 14);
  const iw = W - PL - PR, ih = height - PT - PB;
  const y = (v: number) => PT + ih - ((v - bottom) / (top - bottom)) * ih;
  const label = `${type === "line" ? "Line" : "Bar"} chart of ${series.map((s) => s.label).join(", ")} across ${data.length} points`;
  const slot = iw / data.length;
  const xLine = (i: number) => PL + (data.length === 1 ? iw / 2 : (iw * i) / (data.length - 1));
  const xBar = (i: number) => PL + slot * i + slot / 2;
  const x = type === "line" ? xLine : xBar;
  const maxLen = Math.max(...data.map((d) => String(d.label).length));
  const step = Math.max(1, Math.ceil((maxLen * 7 + 12) / Math.max(1, slot)));
  const bw = Math.min(28, (slot * 0.7) / series.length);
  /** svg units per CSS px: the plot may be drawn narrower than W (max-width: 100%) before the observer reports. */
  const scale = () => { const r = svgRef.current?.getBoundingClientRect(); return r && r.width > 0 ? r.width / W : 1; };
  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - r.left) / scale();
    const i = type === "line" ? (data.length === 1 ? 0 : Math.round(((sx - PL) / iw) * (data.length - 1))) : Math.floor((sx - PL) / slot);
    return Math.max(0, Math.min(data.length - 1, i));
  };
  const at = pt.at != null && pt.at < data.length ? pt.at : null;
  const values = at == null ? [] : series.map((s, si) => ({ s, t: toneOf(s, si), v: fmt(num(data[at][s.key]), kind) }));
  const said = at == null ? "" : `${data[at].label}: ${values.map(({ s, v }) => `${s.label} ${v}`).join(", ")}`;
  return (
    <div className="fl-chart" ref={ref}>
      <svg ref={svgRef} className="fl-plot" role="img" aria-label={label} width={W} height={height} viewBox={`0 0 ${W} ${height}`} tabIndex={0}
        data-active={at != null || undefined}
        onPointerMove={(e) => { if (e.pointerType !== "touch") pt.show(indexAt(e)); }}
        onPointerDown={(e) => { if (e.pointerType === "touch" || e.pointerType === "pen") pt.tap(indexAt(e)); }}
        onPointerLeave={pt.leave} onKeyDown={(e) => pt.key(e)} onBlur={pt.hide}>
        {at != null && type === "bar" && <rect className="fl-col-on" x={PL + slot * at} y={PT} width={slot} height={ih} rx={4} />}
        {ticks.map((t) => (
          <g key={t}>
            <line className="fl-grid" x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} />
            <text className="fl-ax" x={PL - 8} y={y(t) + 4} textAnchor="end">{axisFmt(t, kind)}</text>
          </g>
        ))}
        {data.map((d, i) => i % step === 0 && <text key={i} className="fl-ax" x={x(i)} y={height - 8}
          // a line's first and last labels sit at the plot's edges: anchored inward, they are not cut off
          textAnchor={type === "line" && data.length > 1 && i === 0 ? "start" : type === "line" && data.length > 1 && i === data.length - 1 ? "end" : "middle"}>{d.label}</text>)}
        {type === "line" && at != null && <line className="fl-guide" x1={xLine(at)} x2={xLine(at)} y1={PT} y2={PT + ih} />}
        {type === "line" && series.map((s, si) => {
          const t = toneOf(s, si);
          const path = data.map((d, i) => `${i ? "L" : "M"}${xLine(i).toFixed(1)} ${y(num(d[s.key])).toFixed(1)}`).join(" ");
          return (
            <g key={s.key} className={cx("fl-series", fs(t))}>
              <path className="fl-line" d={path} fill="none" />
              {data.map((d, i) => <circle key={i} className={i === at ? "fl-dot fl-dot-on" : "fl-dot"} cx={xLine(i)} cy={y(num(d[s.key]))} r={i === at ? 5.5 : 3.5}><title>{`${s.label} · ${d.label}: ${fmt(num(d[s.key]), kind)}`}</title></circle>)}
            </g>
          );
        })}
        {type === "bar" && series.map((s, si) => {
          const t = toneOf(s, si);
          return (
            <g key={s.key} className={cx("fl-series", fs(t))}>
              {data.map((d, i) => {
                const v = num(d[s.key]); const bx = xBar(i) - (bw * series.length) / 2 + bw * si;
                const base = y(Math.min(top, Math.max(bottom, 0)));
                return <rect key={i} className={i === at ? "fl-bar fl-bar-on" : "fl-bar"} x={bx} y={Math.min(y(v), base)} width={Math.max(1, bw - 2)} height={Math.abs(base - y(v))} rx={3}><title>{`${s.label} · ${d.label}: ${fmt(num(d[s.key]), kind)}`}</title></rect>;
              })}
            </g>
          );
        })}
      </svg>
      {at != null && (
        <Tip anchor={x(at) * scale()} top={0} boxRef={ref}>
          <div className="fl-tip-head">{data[at].label}</div>
          {values.map(({ s, t, v }) => <TipRow key={s.key} tone={t} label={s.label} value={v} />)}
        </Tip>
      )}
      <div className="fl-chart-sr" aria-live="polite">{said}</div>
      {series.length > 1 && (
        <div className="fl-legend">
          {series.map((s, si) => <span key={s.key} className={fs(toneOf(s, si))}><i />{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

function Share({ data: given, series, kind }: Pick<ChartProps, "data" | "series" | "kind">) {
  const key = series[0].key;
  const data = foldShare(given, key);
  const pt = usePoint(data.length);
  const wrap = useRef<HTMLDivElement>(null);
  const vals = data.map((d) => Math.max(0, num(d[key])));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return <Empty title="No data yet" />;
  const pcts = vals.map((v) => (v / total) * 100);
  const at = pt.at != null && pt.at < data.length && pcts[pt.at] > 0 ? pt.at : null;
  const pctText = (p: number) => `${Number(p.toFixed(1))}%`;
  /** The slice's middle, as a fraction of the bar (the 2px gaps between slices aside). */
  const mid = at == null ? 0 : (pcts.slice(0, at).reduce((a, b) => a + b, 0) + pcts[at] / 2) / 100;
  const said = at == null ? "" : `${data[at].label}: ${fmt(vals[at], kind)}, ${pctText(pcts[at])} of total`;
  return (
    <div className="fl-share-wrap" ref={wrap}>
      <div className="fl-share" role="img" aria-label={`Share of ${series[0].label}: ${data.map((d, i) => `${d.label} ${pcts[i].toFixed(0)}%`).join(", ")}`}
        tabIndex={0} data-active={at != null || undefined} onPointerLeave={pt.leave} onKeyDown={(e) => pt.key(e, (i) => pcts[i] > 0)} onBlur={pt.hide}>
        {data.map((d, i) => pcts[i] > 0 && <i key={i} className={cx("fl-share-seg", fs(ORDER[i % ORDER.length]), i === at && "fl-share-on")} style={{ width: `${pcts[i]}%` }} title={`${d.label}: ${fmt(vals[i], kind)}`}
          onPointerMove={(e) => { if (e.pointerType !== "touch") pt.show(i); }}
          onPointerDown={(e) => { if (e.pointerType === "touch" || e.pointerType === "pen") pt.tap(i); }} />)}
      </div>
      {at != null && (
        <Tip anchor={mid * (wrap.current?.clientWidth || 0)} top={20} boxRef={wrap}>
          <TipRow tone={ORDER[at % ORDER.length]} label={String(data[at].label)} value={fmt(vals[at], kind)} extra={pctText(pcts[at])} />
        </Tip>
      )}
      <div className="fl-chart-sr" aria-live="polite">{said}</div>
      <div className="fl-slegend">
        {data.map((d, i) => (
          <div key={i} className={fs(ORDER[i % ORDER.length])}><i /><em>{d.label}</em><span>{pcts[i].toFixed(0)}%</span></div>
        ))}
      </div>
    </div>
  );
}
