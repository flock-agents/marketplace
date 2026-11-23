import "./slotpicker.css";
import { cx } from "../../tone";

export interface SlotPickerProps {
  open: string; close: string; slotMinutes: number; taken?: string[]; past?: string[]; value?: string | null;
  onChange: (time: string) => void; length?: number; label?: string;
}

const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const pad = (n: number) => String(n).padStart(2, "0");
const fromMin = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
/** "09:30" as "9:30 am". */
export function clockLabel(t: string): string {
  const m = toMin(t); const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "am" : "pm"}`;
}
/** Every slot start from opening up to the last one that still ends by closing. */
export function slotStarts(open: string, close: string, slotMinutes: number, length = slotMinutes): string[] {
  if (!(slotMinutes > 0)) return [];
  const out: string[] = [];
  for (let m = toMin(open); m + Math.max(length, 1) <= toMin(close); m += slotMinutes) out.push(fromMin(m));
  return out;
}

/** Free and taken time slots for one day as tappable chips. Taken ones stay in place, struck through and disabled, so the day's shape is visible. */
export function SlotPicker({ open, close, slotMinutes, taken = [], past = [], value = null, onChange, length, label = "Time slots" }: SlotPickerProps) {
  const starts = slotStarts(open, close, slotMinutes, length);
  const gone = new Set(taken), passed = new Set(past);
  const free = starts.filter((s) => !gone.has(s) && !passed.has(s)).length;
  if (!starts.length) return <p className="fl-slots-none" role="status">No slots on this day.</p>;
  return (
    <div className="fl-slots">
      <div role="group" aria-label={label} className="fl-slots-grid">
        {starts.map((s) => {
          const isTaken = gone.has(s), isPast = !isTaken && passed.has(s);
          return (
            <button key={s} type="button" className={cx("fl-slot", (isTaken || isPast) && "fl-slot-taken", value === s && "fl-slot-on")}
              disabled={isTaken || isPast} aria-pressed={value === s} onClick={() => onChange(s)}>
              {clockLabel(s)}<span className="fl-slots-sr">{isTaken ? ", taken" : isPast ? ", passed" : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="fl-slots-count" role="status">{free === 0 ? (past.length ? "No more times today." : "Fully booked.") : `${free} of ${starts.length} free`}</p>
    </div>
  );
}
