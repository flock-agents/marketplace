import { KINDS, PINNED_LABELS } from "../../server/db/constants";
import { nutritionLine } from "../../server/meals/plan";

export interface Metric {
  id: string; label: string; value: number; unit: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
}
export interface DashEvent {
  id: string; title: string; at: string; kind: string | null; kcal: number | null; protein_g: number | null; fiber_g: number | null;
  created_at: string; updated_at: string; updated_by: string | null;
}
export const EVENT_FIELDS = [
  { type: "text", name: "title", label: "What happened", required: true },
  { type: "text", name: "at", label: "When (2026-10-08 or 2026-10-08T14:30)", required: true },
  { type: "select", name: "kind", label: "Kind", options: [...KINDS] as string[] },
  { type: "number", name: "kcal", label: "Calories (kcal, for a meal)" },
  { type: "number", name: "protein_g", label: "Protein (g, for a meal)" },
  { type: "number", name: "fiber_g", label: "Fiber (g, for a meal)" },
] as const;
export const KIND_TONES = { Meal: "info", Sale: "success", Alert: "danger", Milestone: "accent", Note: "muted" } as const;

/** "155 kcal · 9 g protein · 4 g fiber" for a meal, as far as its nutrition is known; null when it carries none. */
export const nutritionText = (e: Pick<DashEvent, "kcal" | "protein_g" | "fiber_g">): string | null => nutritionLine(e);

/** "₹" shows as money, "%" as a share (a plain 64%), "min" as minutes, anything else as a plain number. */
export const kindOf = (unit: string | null): "money" | "share" | "minutes" | "number" => (unit === "₹" ? "money" : unit === "%" ? "share" : unit === "min" ? "minutes" : "number");

/** What the number strip shows for a reading: money, minutes, shares (%) and plain numbers are formatted; any other unit is text with the unit after it. */
export function statValue(m: Pick<Metric, "value" | "unit" | "label">): { value: number | string; kind?: "money" | "minutes" | "share" } {
  const k = kindOf(m.unit);
  if (k === "money" || k === "minutes" || k === "share") return { value: m.value, kind: k };
  const u = m.unit?.trim();
  return u && !m.label.toLowerCase().includes(u.toLowerCase()) ? { value: `${m.value} ${u}` } : { value: m.value };
}

/** Percent change of a label's newest reading from its previous one, to one decimal; null without a previous non-zero reading. `rows` must be newest first. */
export function deltaOf(rows: Metric[], label: string): number | null {
  const [now, prev] = rows.filter((r) => r.label === label);
  return now && prev && prev.value !== 0 ? Math.round(((now.value - prev.value) / Math.abs(prev.value)) * 1000) / 10 : null;
}

/** The newest reading of each label, the pinned labels first (in their own order), then the rest as latestPerLabel orders them. */
export function headlineReadings(rows: Metric[], pinned: readonly string[] = PINNED_LABELS): Metric[] {
  const latest = latestPerLabel(rows);
  const rank = (m: Metric) => { const i = pinned.indexOf(m.label); return i < 0 ? pinned.length : i; };
  return latest.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(({ m }) => m);
}

export function latestPerLabel(rows: Metric[]): Metric[] {
  const seen = new Map<string, Metric>();
  for (const r of [...rows].reverse()) seen.set(r.label, r);   // walk oldest to newest so the newest wins, labels keep first-seen order
  return [...seen.values()];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A stored time as the viewer's local date and time. A bare "2026-10-08T14:30" is already local; one ending in Z or an offset is converted. */
function local(at: string): { y: number; m: number; d: number; h: number; min: number; hasTime: boolean } {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(at.slice(10)) && at.length > 10) {
    const t = new Date(at);
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), min: t.getMinutes(), hasTime: true };
  }
  const [date, time] = at.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time ? time.split(":").map(Number) : [0, 0];
  return { y, m, d, h, min, hasTime: !!time };
}
/** The viewer's local date of a stored time, as "YYYY-MM-DD". */
export function localDate(at: string): string {
  const t = local(at);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
}
/** "8 Oct" for a plain date, "8 Oct, 2:30 pm" when the value carries a time (in the viewer's local time); `withTime: false` drops the time. */
export function whenText(at: string, withTime = true): string {
  const t = local(at);
  const day = `${t.d} ${MONTHS[t.m - 1]}`;
  return t.hasTime && withTime ? `${day}, ${t.h % 12 || 12}:${String(t.min).padStart(2, "0")} ${t.h < 12 ? "am" : "pm"}` : day;
}

/** A YYYY-MM-DD date `days` later (or earlier, when negative). */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** Today in the viewer's local time, as "YYYY-MM-DD". */
export const todayLocal = () => localDate(new Date().toISOString());
