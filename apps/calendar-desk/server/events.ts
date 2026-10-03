import { createHash } from "node:crypto";
import type { EventRow } from "./store";

export interface ScrapedEvent { eventId?: string; title: string; time?: string; date?: string }

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

/** "9:30 – 10am", "3 – 3:30pm", "14:00 – 15:00", "6:40am", "All day". Local time (TZ is the owner's). */
export function parseTimeText(text: string | undefined, localDate: string): { startAt: number | null; endAt: number | null; allDay: boolean } {
  const none = { startAt: null, endAt: null, allDay: true };
  if (!text) return none;
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || /all.day/.test(t)) return none;
  const parts = t.split(/\s*[–—-]\s*/);
  const parse = (s: string, inheritMeridiem?: "am" | "pm"): { h: number; m: number; hadMeridiem: boolean } | null => {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s.trim());
    if (!m) return null;
    let h = +m[1]!; const min = m[2] ? +m[2] : 0;
    const hadMeridiem = !!m[3];
    const mer = (m[3] as "am" | "pm" | undefined) ?? inheritMeridiem;
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, m: min, hadMeridiem };
  };
  const [y, mo, da] = localDate.split("-").map(Number);
  const at = (hm: { h: number; m: number }, dayOffset = 0) => new Date(y!, mo! - 1, da! + dayOffset, hm.h, hm.m).getTime();
  const endMer = /(am|pm)\s*$/.exec(parts[1] ?? "")?.[1] as "am" | "pm" | undefined;
  let start = parse(parts[0]!, endMer);
  if (!start) return none;
  if (parts.length < 2) return { startAt: at(start), endAt: null, allDay: false };
  const end = parse(parts[1]!);
  if (!end) return { startAt: at(start), endAt: null, allDay: false };
  // Prefer start < end: if start inherited end's meridiem and that puts start >= end (same day), try opposite
  if (!start.hadMeridiem && endMer && start.h * 60 + start.m >= end.h * 60 + end.m) {
    const opposite = endMer === "pm" ? "am" : "pm";
    const altStart = parse(parts[0]!, opposite);
    if (altStart && altStart.h * 60 + altStart.m < end.h * 60 + end.m) {
      start = altStart;
    }
  }
  const endMs = at(end, end.h * 60 + end.m < start.h * 60 + start.m ? 1 : 0);
  return { startAt: at(start), endAt: endMs, allDay: false };
}

export function parseDateHeader(text: string | undefined, fallbackYear: number): string | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const m1 = /(\d{1,2}) ([a-z]{3,})(?: (\d{4}))?/.exec(t);          // 5 oct [2026]
  const m2 = /([a-z]{3,}) (\d{1,2})(?: (\d{4}))?/.exec(t);          // october 5 [2026]
  const pick = (dayS: string, monS: string, yearS?: string) => {
    const mon = MONTHS.indexOf(monS.slice(0, 3)); if (mon < 0) return null;
    const day = +dayS; if (day < 1 || day > 31) return null;
    return `${yearS ? +yearS : fallbackYear}-${pad(mon + 1)}-${pad(day)}`;
  };
  return (m1 && pick(m1[1]!, m1[2]!, m1[3])) || (m2 && pick(m2[2]!, m2[1]!, m2[3])) || null;
}

/** No stable ids from the scrape (spec D2): identity is where+when+what. */
export function eventKey(p: { calendar: string | null; localDate: string; startAt: number | null; title: string }): string {
  const title = p.title.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha1").update(`${p.calendar ?? ""}|${p.localDate}|${p.startAt ?? "allday"}|${title}`).digest("hex").slice(0, 16);
}

export function normalizeScrape(events: ScrapedEvent[], opts: { calendar: string | null; fallbackDate: string; now: Date }) {
  const seen = new Set<string>();
  const out: Array<Omit<EventRow, "accountId" | "firstSeenAt" | "lastSeenAt" | "missingSince">> = [];
  for (const e of events) {
    const title = (e.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const localDate = parseDateHeader(e.date, opts.now.getFullYear()) ?? opts.fallbackDate;
    const { startAt, endAt, allDay } = parseTimeText(e.time, localDate);
    const key = eventKey({ calendar: opts.calendar, localDate, startAt, title });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ eventKey: key, calendar: opts.calendar, title, startAt, endAt, allDay, localDate, attendeesText: null, location: null, rawTimeText: e.time ?? null });
  }
  return out;
}
