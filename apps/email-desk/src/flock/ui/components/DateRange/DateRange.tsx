import "./daterange.css";
import { Button } from "../Button/Button";
export type Preset = "this-week" | "this-month" | "last-30" | "this-year";
export interface Range { from: string | null; to: string | null }
export interface DateRangeProps { from: string | null; to: string | null; onChange: (r: Range) => void; presets?: Preset[]; today?: string }
const LABEL: Record<Preset, string> = { "this-week": "This week", "this-month": "This month", "last-30": "Last 30 days", "this-year": "This year" };
const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;
export function presetRange(p: Preset, today: string): Range {
  const t = ms(today), d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (p) {
    case "this-week": { const mon = t - ((d.getUTCDay() + 6) % 7) * DAY; return { from: iso(mon), to: iso(mon + 6 * DAY) }; } // Monday to Sunday
    case "this-month": return { from: iso(Date.UTC(y, m, 1)), to: iso(Date.UTC(y, m + 1, 0)) };
    case "last-30": return { from: iso(t - 29 * DAY), to: today };
    case "this-year": return { from: iso(Date.UTC(y, 0, 1)), to: iso(Date.UTC(y, 11, 31)) };
  }
}
export function DateRange({ from, to, onChange, presets = ["this-week", "this-month", "last-30", "this-year"], today = localToday() }: DateRangeProps) {
  return (
    <div className="fl-range">
      {presets.length ? (
        <div className="fl-range-presets">
          {presets.map((p) => {
            const r = presetRange(p, today);
            return <button key={p} type="button" className="fl-range-pill" aria-pressed={r.from === from && r.to === to} onClick={() => onChange(r)}>{LABEL[p]}</button>;
          })}
        </div>
      ) : null}
      <div className="fl-range-dates">
        <label><span>From</span><input type="date" value={from ?? ""} max={to ?? undefined} onChange={(e) => onChange({ from: e.target.value || null, to })} /></label>
        <label><span>To</span><input type="date" value={to ?? ""} min={from ?? undefined} onChange={(e) => onChange({ from, to: e.target.value || null })} /></label>
        {from || to ? <Button variant="ghost" size="sm" onClick={() => onChange({ from: null, to: null })}>Clear</Button> : null}
      </div>
    </div>
  );
}
