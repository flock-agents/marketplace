// Gmail's full datetime parser, copied unchanged from Flock's ingest-manifest-loader (the only
// piece the message fingerprint needs; the rest of that module is platform code).

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Month token → index. Accepts the 3-letter form, Gmail's British "Sept", and any
// longer prefix of the full name ("September", "Septem"). Unknown → undefined.
function monthIndex(token: string): number | undefined {
  const key = token.toLowerCase();
  if (key in MONTHS) return MONTHS[key];
  const i = MONTH_NAMES.findIndex((name) => key.length >= 3 && name.startsWith(key));
  return i === -1 ? undefined : i;
}

// "7:04 PM" / "00:36" → { h, mi } in 24h, or null when out of range.
function clockTo24h(hourText: string, minuteText: string, meridiem?: string): { h: number; mi: number } | null {
  let h = Number(hourText);
  const mi = Number(minuteText);
  const ap = meridiem?.replace(/\./g, "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

const WEEKDAY_PREFIX = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;
// "<day> <month> <year>, <time>"  (British: "21 Sept 2026, 13:45")
// "<month> <day>, <year>, <time>" (US:      "Sep 21, 2026, 7:04 PM")
// Time is "H:MM", optional ":SS", optional AM/PM; the year↔time joiner is "," or "at".
const FULL_DATETIME = /^(?:(\d{1,2})\s+([A-Za-z]{3,9})\.?|([A-Za-z]{3,9})\.?\s+(\d{1,2}))\s*,?\s+(\d{4})\s*(?:,|at)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/;

/**
 * Parse the FULL datetime Gmail keeps on an inbox row's date element (its
 * `title` / hover text): "Mon, 21 Sept 2026, 13:45", "Tue, 22 Sept 2026, 00:36",
 * or the US-locale "Mon, Sep 21, 2026, 7:04 PM". The visible cell text is only a
 * time for today's mail and a bare date otherwise, so it can never order two
 * threads from the same day; the title is minute-precise and is what the
 * drafting routine's per-message watermark (lastProcessedMessageTimestamp) is
 * built from (owner decision, 2026-09-22).
 *
 * The string carries no timezone -- it is the mailbox's local time, which on
 * this desktop app is the machine's local time -- so it is interpreted as LOCAL.
 * Weekday is optional; month may be short, full, or Gmail's 4-letter "Sept";
 * 12h with AM/PM and 24h both parse. Anything else is null, never NaN.
 */
export function parseGmailDateTime(value: string): number | null {
  const s = typeof value === "string" ? value.trim().replace(/\s+/g, " ").replace(WEEKDAY_PREFIX, "") : "";
  if (!s) return null;
  const m = s.match(FULL_DATETIME);
  if (!m) return null;

  const [dayText, monthText] = m[1] ? [m[1], m[2]] : [m[4], m[3]];
  const month = monthIndex(monthText);
  const day = Number(dayText);
  const year = Number(m[5]);
  const clock = clockTo24h(m[6], m[7], m[9]);
  if (month === undefined || day < 1 || day > 31 || !clock) return null;

  const d = new Date(year, month, day, clock.h, clock.mi, Number(m[8] || 0));
  // "31 Feb" rolls over into March in Date's arithmetic; that is a junk row, not a date.
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return d.getTime();
}

/**
 * Parse the date string a Gmail inbox row shows, anchored to `now` (copied unchanged from Flock's
 * ingest-manifest-loader parseGmailDate). Today's mail is a bare time ("9:14 AM"), this year's a month
 * and day with NO year ("Aug 27"), older mail carries a year. A year-less date is this year, or last
 * year when this year's would be in the future. Junk is null, never a guess.
 */
export function parseGmailDate(value: string, now: Date): number | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;

  const t = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (t) {
    const clock = clockTo24h(t[1], t[2], t[3]);
    if (!clock) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.h, clock.mi).getTime();
  }

  const md = s.match(/^([A-Za-z]{3,5})\.?\s+(\d{1,2})$/) || s.match(/^(\d{1,2})\s+([A-Za-z]{3,5})\.?$/);
  if (md) {
    const [a, b] = md[1].match(/^\d/) ? [md[2], md[1]] : [md[1], md[2]];
    const month = monthIndex(a);
    const day = Number(b);
    if (month === undefined || day < 1 || day > 31) return null;
    let year = now.getFullYear();
    let d = new Date(year, month, day);
    if (d.getTime() > now.getTime() + 86_400_000) d = new Date(--year, month, day);
    return d.getTime();
  }

  if (/\d{4}/.test(s)) {
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
