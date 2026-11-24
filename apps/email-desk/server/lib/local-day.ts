// Owner-local days and times. Ported from Flock's local-day.ts (pure): only what the family push reads.

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DD` and `HH:MM` of the instant `ms` on the wall clock in `tz`. */
export function localDateAndTime(ms: number, tz: string): { date: string; time: string } {
  const local = new Date(ms + tzOffsetMs(new Date(ms), tz));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}`,
    time: `${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}`,
  };
}

/** Epoch ms of local midnight that starts `YYYY-MM-DD` in `tz`, or null when malformed. */
export function localDayStart(dateStr: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 12); // noon UTC is inside the local day for every tz
  const at = new Date(guess);
  const off = tzOffsetMs(at, tz);
  const local = new Date(at.getTime() + off);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let start = day - tzOffsetMs(new Date(day - off), tz);
  start = day - tzOffsetMs(new Date(start), tz); // one refinement for DST days
  return start;
}

/** The owner's zone as this process sees it (the app runs on the owner's machine), "UTC" when unreadable. */
export function processTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string, now = Date.now()): string {
  return localDateAndTime(now, tz).date;
}
