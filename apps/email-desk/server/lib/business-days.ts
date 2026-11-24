// Business days = Monday-Friday in the user's timezone (spec Part 2). No holiday calendar.
// A day is added 24h at a time and counted only when it lands on a weekday IN `timeZone`;
// mail sent on a weekend starts counting from the next weekday at the same clock time.
const DAY_MS = 24 * 60 * 60 * 1000;

function weekdayIn(ms: number, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(ms));
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wd] ?? 1;
}
const isWeekend = (ms: number, tz: string) => { const d = weekdayIn(ms, tz); return d === 0 || d === 6; };

export function addBusinessDays(fromMs: number, n: number, timeZone: string): number {
  let t = fromMs;
  let counted = 0;
  while (counted < n) {
    t += DAY_MS;
    if (!isWeekend(t, timeZone)) counted++;
  }
  return t;
}

export function isBusinessDaysElapsed(sentAtMs: number, nowMs: number, n: number, timeZone: string): boolean {
  return nowMs >= addBusinessDays(sentAtMs, n, timeZone);
}
