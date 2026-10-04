import type { OpHandler, OpError } from "@flock/app-sdk";
import { insertReminder, updateReminder, getReminder, searchActiveReminders, findActiveReminderByTitleDate, listActiveReminders, listEvents, setEventNote, listRowFires, getEventNote, type ReminderRow } from "./store";
import { rowSourceRef } from "./scheduler";
import { nextOccurrenceDate, prevOccurrenceDate } from "./rules";
import { ymd } from "./events";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const err = (code: string, message: string, status = 400): OpError => ({ error: message, code, status });
const isRealDate = (s: string) => { if (!DATE_RE.test(s)) return false; const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y!, m! - 1, d!)) === s; };
const today = () => ymd(new Date());
const newId = () => `rem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function resolveOne(p: Record<string, unknown>): { r: ReturnType<typeof getReminder> } | OpError {
  if (typeof p.id === "string") { const r = getReminder(p.id); return r && r.state === "active" ? { r } : err("NOT_FOUND", "No active reminder with that id", 404); }
  if (typeof p.match === "string" && p.match.trim()) {
    const hits = searchActiveReminders(p.match.trim());
    if (hits.length === 1) return { r: hits[0]! };
    if (hits.length === 0) return err("NOT_FOUND", "No reminder matches that", 404);
    return { ...err("AMBIGUOUS", "Several reminders match; ask which one", 409), candidates: hits.map((h) => ({ id: h.id, title: h.title, dueDate: h.dueDate })) } as OpError;
  }
  return err("MISSING_ARG", "Give id or match");
}
// Lead, day-of and Missed rows share one sourceRef per occurrence. The live row is found from the fires
// ledger, not from dueDate: a lead row is showing BEFORE the due date, and a yearly reminder's dueDate
// is its anchor year. Candidates are the next and the previous occurrence (a yesterday's Missed row).
const candidateOccurrences = (r: ReminderRow) => [...new Set([nextOccurrenceDate(r, today()), prevOccurrenceDate(r, today())].filter((o): o is string => !!o))];
const liveRowOccurrences = (r: ReminderRow) => candidateOccurrences(r).filter((occ) => listRowFires(r.id, occ).length > 0);
/** The occurrence whose row was published most recently (any lead day, day-of or Missed), or null.
 *  The next/current occurrence's row always counts; the previous one only while its newest fire is at most a day old. */
const PREV_LIVE_MS = 24 * 3600_000;
function liveRowOccurrence(r: ReminderRow): string | null {
  let best: { occ: string; at: number } | null = null;
  for (const occ of candidateOccurrences(r)) {
    const f = listRowFires(r.id, occ)[0];
    if (!f || (occ < today() && Date.now() - f.firedAt > PREV_LIVE_MS)) continue;
    if (!best || f.firedAt > best.at) best = { occ, at: f.firedAt };
  }
  return best?.occ ?? null;
}
const isErr = (v: unknown): v is OpError => !!v && typeof v === "object" && "code" in (v as any);

export const ops: Record<string, OpHandler> = {
  async add_reminder(p) {
    const title = typeof p.title === "string" ? p.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (!title) return err("MISSING_TITLE", "A reminder needs a title");
    const dueDate = typeof p.dueDate === "string" ? p.dueDate.trim() : "";
    if (!isRealDate(dueDate)) return err("BAD_DATE", "dueDate must be YYYY-MM-DD");
    if (dueDate < today()) return err("PAST_DATE", `${dueDate} is already past`, 422);
    const dueTime = typeof p.dueTime === "string" && p.dueTime.trim() ? p.dueTime.trim() : null;
    if (dueTime && !TIME_RE.test(dueTime)) return err("BAD_TIME", "dueTime must be HH:MM (24h)");
    const twin = findActiveReminderByTitleDate(title, dueDate);
    if (twin) return { ...twin, duplicate: true };
    const r = insertReminder({ id: newId(), title, body: typeof p.body === "string" ? p.body.slice(0, 2000) : null, dueDate, dueTime, recurrence: p.recurrence === "yearly" ? "yearly" : "none",
      leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    return r;
  },
  async cancel_reminder(p, { platform }) {
    const got = resolveOne(p); if (isErr(got)) return got;
    const r = got.r!;
    updateReminder(r.id, { state: "cancelled" });
    for (const occ of liveRowOccurrences(r)) {
      const res = await platform.tasks.withdraw(rowSourceRef(r.id, occ));
      if (!res.ok) return err("PLATFORM", `Cancelled, but could not withdraw its row: ${res.reason}`, 502);
    }
    return { ok: true, id: r.id, title: r.title };
  },
  async snooze_reminder(p, { platform }) {
    const got = resolveOne(p); if (isErr(got)) return got;
    const r = got.r!;
    const untilDate = typeof p.untilDate === "string" ? p.untilDate.trim() : "";
    if (!isRealDate(untilDate)) return err("BAD_DATE", "untilDate must be YYYY-MM-DD");
    if (untilDate <= today()) return err("PAST_DATE", "untilDate must be after today", 422);
    // A live row (lead, day-of, or a timed one's Missed row) is the platform's to hide — the reminder's
    // dueDate is unchanged; with no live row, reschedule the reminder itself.
    const occ = liveRowOccurrence(r);
    if (occ) {
      const res = await platform.tasks.snooze(rowSourceRef(r.id, occ), untilDate);
      if (res.ok) return { ok: true, via: "row", id: r.id, untilDate };
      // 404: the owner already completed that row, so there is nothing for the platform to hide — reschedule instead.
      if (("status" in res ? res.status : undefined) !== 404) return err("PLATFORM", `Could not snooze the row: ${res.reason}`, 502);
    }
    updateReminder(r.id, { dueDate: untilDate });
    return { ok: true, via: "reschedule", id: r.id, untilDate };
  },
  async list_upcoming(p) {
    const days = typeof p.days === "number" && p.days > 0 ? Math.min(p.days, 36500) : 14;
    const from = today(); const to = ymd(new Date(Date.now() + days * 86_400_000));
    const items = [
      ...listEvents({ fromDate: from, toDate: to }).map((e) => ({ kind: "event" as const, date: e.localDate, time: e.allDay || e.startAt == null ? null : new Date(e.startAt).toTimeString().slice(0, 5), title: e.title, eventKey: e.eventKey, hasNote: !!getEventNote(e.accountId, e.eventKey) })),
      ...listActiveReminders().filter((r) => r.dueDate >= from && r.dueDate <= to).map((r) => ({ kind: "reminder" as const, date: r.dueDate, time: r.dueTime, title: r.title, id: r.id, source: r.sourceKind })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    return { from, to, items };
  },
  async set_event_note(p) {
    const note = typeof p.note === "string" ? p.note.trim().slice(0, 2000) : "";
    if (!note) return err("MISSING_NOTE", "A note needs text");
    const m = p.match as { date?: string; titleContains?: string } | undefined;
    let hits = typeof p.eventKey === "string" ? listEvents({ fromDate: "0000", toDate: "9999" }).filter((e) => e.eventKey === p.eventKey) : [];
    if (!hits.length && m?.date && isRealDate(m.date)) {
      const words = (m.titleContains ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      hits = listEvents({ fromDate: m.date, toDate: m.date }).filter((e) => words.every((w) => e.title.toLowerCase().includes(w)));
    }
    if (hits.length === 0) return err("NOT_FOUND", "No event matches that day and title", 404);
    if (hits.length > 1) return { ...err("AMBIGUOUS", "Several events match; ask which one", 409), candidates: hits.map((h) => ({ eventKey: h.eventKey, title: h.title, time: h.rawTimeText })) } as OpError;
    const e = hits[0]!;
    setEventNote(e.accountId, e.eventKey, note, "user");
    return { eventKey: e.eventKey, title: e.title, date: e.localDate, note };
  },
};
