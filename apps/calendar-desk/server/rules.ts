import type { ReminderRow } from "./store";

export interface RemindersConfig { publishHour: number; includeFound: boolean; leadDaysBirthday: number; leadDaysTravel: number; leadDaysDeadline: number[] }
export function readRemindersConfig(filter: Record<string, unknown> | undefined): RemindersConfig {
  const raw = filter ?? {};
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  const list = typeof raw.leadDaysDeadline === "string" ? raw.leadDaysDeadline.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0) : [];
  return {
    publishHour: Math.min(23, num(raw.publishHour, 6)),
    includeFound: raw.includeFound !== false,
    leadDaysBirthday: num(raw.leadDaysBirthday, 7),
    leadDaysTravel: num(raw.leadDaysTravel, 2),
    leadDaysDeadline: list.length ? list : [14, 3],
  };
}

export interface FactLike { id: number; content: string; kind: string; dateRole: string | null; when: { date: string; time: string | null; recurrence: "yearly" | null } | null; salience: number | null; sourceLink: string | null }
const MIN_SALIENCE = 0.4;

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y!, m! - 1, d!); };
const fmt = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const addDays = (ymd: string, n: number) => { const d = toDate(ymd); d.setDate(d.getDate() + n); return fmt(d); };

export function leadDaysFor(role: string | null, cfg: RemindersConfig): number[] {
  const uniqDesc = (xs: number[]) => [...new Set(xs)].sort((a, b) => b - a);
  switch (role) {
    case "deadline": case "milestone": return uniqDesc([...cfg.leadDaysDeadline, 0]);
    case "travel": return uniqDesc([cfg.leadDaysTravel, 0]);
    case "occasion": return uniqDesc([cfg.leadDaysBirthday, 0]);
    case "appointment": return [1, 0];
    case "renewal": return [7, 1, 0];
    default: return [0];
  }
}

/** Deterministic (spec amendment A1): extraction already judged role, date and salience. */
export function reminderFromFact(f: FactLike, cfg: RemindersConfig, today: string): Omit<ReminderRow, "createdAt" | "updatedAt"> | null {
  if (!cfg.includeFound || !f.when || !f.dateRole) return null;
  if (f.salience != null && f.salience < MIN_SALIENCE) return null;
  const recurrence = f.when.recurrence === "yearly" ? "yearly" : "none";
  const dueDate = recurrence === "yearly" ? (nextOccurrenceDate({ dueDate: f.when.date, recurrence }, today) ?? f.when.date) : f.when.date;
  if (dueDate < today) return null;
  const title = f.content.replace(/\s+/g, " ").trim().replace(/[.。]$/, "").slice(0, 80);
  return { id: `rem_${f.id}_${Math.random().toString(36).slice(2, 8)}`, title, body: f.content, dueDate, dueTime: f.when.time ?? null, recurrence,
    leadDays: leadDaysFor(f.dateRole, cfg), sourceKind: "fact", sourceRef: `fact:${f.id}`, sourceLink: f.sourceLink, accountId: null, state: "active" };
}

export function nextOccurrenceDate(r: Pick<ReminderRow, "dueDate" | "recurrence">, today: string): string | null {
  if (r.recurrence !== "yearly") return r.dueDate;
  const [, m, d] = r.dueDate.split("-").map(Number);
  const [ty] = today.split("-").map(Number);
  for (const y of [ty!, ty! + 1]) {
    const last = new Date(y, m!, 0).getDate();
    const cand = `${y}-${pad(m!)}-${pad(Math.min(d!, last))}`;
    if (cand >= today) return cand;
  }
  return null;
}

/** Occurrence dates to PUBLISH A ROW for today. A timed reminder gets rows on lead days only — the
 *  day itself is a chat (D6). An untimed one gets its day-of row even when today is past the lead
 *  days (created late in the day, or the laptop was shut: Review Focus 1/2). */
export function rowOccurrencesDue(r: ReminderRow, today: string): string[] {
  const occ = nextOccurrenceDate(r, today) ?? r.dueDate;
  const out: string[] = [];
  for (const lead of r.leadDays) {
    if (lead === 0 && r.dueTime) continue;
    if (addDays(occ, -lead) === today) out.push(occ);
  }
  if (!r.dueTime && occ <= today && !out.includes(occ) && r.recurrence === "none") out.push(occ);   // overdue untimed: still today's row
  return [...new Set(out)];
}

export function timedFireDue(r: ReminderRow, now: Date): { occurrence: string; dueAt: number } | null {
  if (!r.dueTime) return null;
  const today = fmt(now);
  const occ = nextOccurrenceDate(r, today);
  if (occ !== today) return null;
  const [h, mi] = r.dueTime.split(":").map(Number);
  const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h!, mi!).getTime();
  return now.getTime() >= dueAt ? { occurrence: occ, dueAt } : null;
}

export function titleForLead(r: ReminderRow, occurrence: string, today: string): string {
  if (occurrence === today) return r.title;
  const days = Math.round((toDate(occurrence).getTime() - toDate(today).getTime()) / 86_400_000);
  const d = toDate(occurrence);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${r.title} — in ${days} day${days === 1 ? "" : "s"} (${d.getDate()} ${mon})`;
}
