// The person's clock: every local day and time the app files or shows follows the `timezone` setting (server/profile).

const SYSTEM_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let zoneOf: () => string = () => SYSTEM_ZONE;

/** Where the time zone comes from (the app's `timezone` setting); an empty value falls back to the server's own zone. */
export function useTimezone(get: () => string): void { zoneOf = get; }
export const timezone = (): string => zoneOf() || SYSTEM_ZONE;

const part = (type: string, parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === type)!.value;
const wallParts = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);

/** Minutes the zone is ahead of UTC at `ms`. */
function offsetMinutes(ms: number): number {
  const p = wallParts(new Date(ms));
  const wall = Date.UTC(+part("year", p), +part("month", p) - 1, +part("day", p), +part("hour", p), +part("minute", p));
  return Math.round((wall - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** The YYYY-MM-DD date in the person's zone, `daysAgo` days before `now`. */
export function localDate(now: Date, daysAgo = 0): string {
  const at = new Date(now.getTime() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** A fixed moment on a local date, as a UTC ISO stamp: the same date always gives the same stamp, which is how re-runs dedupe. */
export function stampOn(date: string, time: string): string {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - offsetMinutes(wall) * 60_000;
  return new Date(wall - offsetMinutes(first) * 60_000).toISOString();   // second pass: the offset in force at that moment (DST)
}

/** A moment as the local "YYYY-MM-DDTHH:MM" the dashboard shows, whatever offset it was written with. Null when unreadable. */
export function localDateTime(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = wallParts(at);
  return `${part("year", parts)}-${part("month", parts)}-${part("day", parts)}T${part("hour", parts)}:${part("minute", parts)}`;
}

/** A moment as the viewer reads it: "8:13 PM" today, "20 Oct, 7:21 PM" on another day. */
export function spokenTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone(), hour: "numeric", minute: "2-digit" }).format(at);
  if (localDate(at) === localDate(now)) return time;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone(), day: "numeric", month: "short" }).format(at);
  return `${day}, ${time}`;
}
