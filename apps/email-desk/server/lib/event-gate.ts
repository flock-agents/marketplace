// Which dated facts are calendar events. Ported verbatim from Flock's wiki/event-gate.ts (pure: no I/O; `today` is the
// owner-local date, YYYY-MM-DD, supplied by the caller). The family push (family/push.ts factItem) gates a family fact the
// way Calendar Desk gates an event, and reads the owner-local date and time the gate gives. Flock gates the facts it hands
// back too (memory.extract `family.blocks`); the app gates again because it needs the gate's date and time, not only its yes.
// Unrated facts (salience null) never qualify.
import type { DateRole, FactWhenWire } from "../platform-ext";

export const EVENT_SALIENCE_FLOOR = 0.6; // owner-approved 2026-10-05 (eval 34/37 both runs; junk <= 0.5)
export const EVENT_HORIZON_DAYS = 90;
export type GateReason = "no-date" | "no-role" | "past" | "beyond-horizon" | "unrated" | "low-salience" | "deadline" | "milestone" | "state" | "family-calendar";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(d: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(d);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!, da = +m[3]!;
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null;
  return { y, m: mo, d: da };
}
const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function dayNumber(s: string): number {
  const p = parse(s)!;
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
}

/** The date an event for this `when` falls on: the stored date, or for yearly the next
 *  occurrence on or after `today` (Feb 29 becomes Feb 28 in non-leap years). */
export function eventDateOf(when: { date: string; recurrence?: "yearly" | null } | null, today: string): string | null {
  if (!when) return null;
  const p = parse(when.date);
  if (!p) return null;
  if (when.recurrence !== "yearly") return fmt(p.y, p.m, p.d);
  const t = parse(today);
  if (!t) return fmt(p.y, p.m, p.d);
  const on = (y: number) => (p.m === 2 && p.d === 29 && !isLeap(y) ? fmt(y, 2, 28) : fmt(y, p.m, p.d));
  const thisYear = on(t.y);
  return thisYear >= today ? thisYear : on(t.y + 1);
}

const validTz = (tz: string): boolean => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

/** Wall-clock `date` `time` in `fromTz` -> the same instant's date/time in `toTz`. */
function convertWall(date: string, time: string, fromTz: string, toTz: string): { date: string; time: string } | null {
  const d = parse(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !tm) return null;
  const offset = (at: number, tz: string) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at));
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(at / 1000) * 1000;
  };
  const wall = Date.UTC(d.y, d.m - 1, d.d, +tm[1]!, +tm[2]!);
  let instant = wall - offset(wall, fromTz);
  instant = wall - offset(instant, fromTz); // second pass for DST edges
  const local = new Date(instant + offset(instant, toTz));
  return { date: fmt(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()), time: `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}` };
}

/** `ownerTz` is the owner's IANA zone. A fact time stated in another zone (`when.tz`) is converted
 *  to it, and the converted date drives the past/horizon checks. An invalid `when.tz` is treated
 *  as the owner tz (the time is taken as owner-local rather than dropping the fact). */
export function qualifiesAsEvent(
  f: { when: FactWhenWire | null | undefined; dateRole: DateRole | null | undefined; salience: number | null | undefined; kind?: string | null; familyPush?: string | null },
  today: string,
  ownerTz: string,
): { ok: true; date: string; time: string | null } | { ok: false; reason: GateReason } {
  if (f.familyPush) return { ok: false, reason: "family-calendar" };
  // Multi-day events are dated by their start: `when.end` is ignored in v1.
  let date: string | null;
  let time: string | null = f.when?.time ?? null;
  const tz = f.when?.tz;
  const convert = !!(time && tz && tz !== ownerTz && validTz(tz) && validTz(ownerTz));
  if (convert && f.when?.recurrence === "yearly") {
    // Pick the occurrence AFTER converting to the owner tz: the stored-tz date may be
    // "yesterday" while the owner-local one is today (or the reverse), so try neighbouring years.
    const p = parse(f.when!.date), t = parse(today);
    date = null;
    if (p && t) {
      for (const y of [t.y - 1, t.y, t.y + 1, t.y + 2]) {
        const occ = p.m === 2 && p.d === 29 && !isLeap(y) ? fmt(y, 2, 28) : fmt(y, p.m, p.d);
        const c = convertWall(occ, time!, tz!, ownerTz);
        if (c && c.date >= today) { date = c.date; time = c.time; break; }
      }
    }
  } else {
    date = eventDateOf(f.when ?? null, today);
    if (date && convert) {
      const c = convertWall(date, time!, tz!, ownerTz);
      if (c) { date = c.date; time = c.time; }
    }
  }
  if (!date) return { ok: false, reason: "no-date" };
  // A promise or ask stays a TODO, never a calendar event.
  if (f.dateRole === "deadline") return { ok: false, reason: "deadline" };
  // A milestone records something landing or happening: a log entry, not a slot in the day.
  if (f.dateRole === "milestone") return { ok: false, reason: "milestone" };
  // A standing state (a routine, a goal) is not an event on its date.
  if (f.kind === "state") return { ok: false, reason: "state" };
  if (!f.dateRole) return { ok: false, reason: "no-role" };
  if (date < today) return { ok: false, reason: "past" };
  if (dayNumber(date) > dayNumber(today) + EVENT_HORIZON_DAYS) return { ok: false, reason: "beyond-horizon" };
  if (f.salience === null || f.salience === undefined) return { ok: false, reason: "unrated" };
  if (f.salience < EVENT_SALIENCE_FLOOR) return { ok: false, reason: "low-salience" };
  return { ok: true, date, time };
}
