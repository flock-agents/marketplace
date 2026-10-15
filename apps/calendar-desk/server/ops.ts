import type { OpHandler, OpError } from "@flock/app-sdk";
import { listEvents, setEventNote, getEventNote, listInit } from "./store";
import { ymd } from "./events";
import { syncAccount } from "./sync";
import { completeFirstRead } from "./init-retry";
import { syncFactEvents } from "./facts";
import { handlePlanReport } from "./plan-report";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const err = (code: string, message: string, status = 400): OpError => ({ error: message, code, status });
const isRealDate = (s: string) => { if (!DATE_RE.test(s)) return false; const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y!, m! - 1, d!)) === s; };
const REFRESH_WAIT_MS = 12_000;
const today = () => ymd(new Date());

export const ops: Record<string, OpHandler> = {
  async refresh_calendar(_p, ctx) {
    // Only the user (through their agent) calls this: it always scrapes, within the daily cap, and answers within ONE shared
    // deadline (waitMs) however many accounts there are. Scrapes are never cancelled by the race; they finish in the background
    // (syncAccount's in-flight guard stops a second one for the same account).
    const { platform } = ctx;
    const waitMs = (ctx as { waitMs?: number }).waitMs ?? REFRESH_WAIT_MS;
    const deadline = Date.now() + waitMs;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const within = <T,>(job: Promise<T>, ms: number) => Promise.race([job, new Promise<"late">((res) => { timers.push(setTimeout(() => res("late"), Math.max(0, ms))); })]);
    type Row = { accountId: string; ok: boolean; events: number; skipped?: string; fault: string | null; running?: true };
    try {
      // An account whose first read has not landed is read as a first read: a success marks it done and plans, even after the op answered.
      const jobs = listInit().map((rec) => {
        const first = !(rec.finishedAt && rec.outcome === "done");
        const job = first
          ? Promise.resolve().then(async () => { const r = await syncAccount(rec.accountId, { platform }, "init"); await completeFirstRead(platform, rec.accountId, r, () => new Date()); return r; })
          : Promise.resolve().then(() => syncAccount(rec.accountId, { platform }, "forced"));
        job.catch(() => {}); // a late failure after the op answered is not an unhandled rejection
        return { rec, first, job };
      });
      const accounts: Row[] = await Promise.all(jobs.map(async ({ rec, first, job }): Promise<Row> => {
        try {
          const r = await within(job, deadline - Date.now());
          if (r === "late" || r.skipped === "busy" || (first && r.busy)) return { accountId: rec.accountId, ok: true, events: 0, fault: null, running: true };
          return { accountId: rec.accountId, ok: r.ok, events: r.events, ...(r.skipped ? { skipped: r.skipped } : {}), fault: r.fault ?? null };
        } catch (e: any) { return { accountId: rec.accountId, ok: false, events: 0, fault: String(e?.message ?? e) }; }
      }));
      let facts: { created: number; updated: number; withdrawn: number; suppressed: number; running?: true } = { created: 0, updated: 0, withdrawn: 0, suppressed: 0 };
      const factJob = Promise.resolve().then(() => syncFactEvents(platform));
      factJob.catch((e: any) => console.warn(`[calendar-desk] fact events: ${e?.message ?? e}`));
      try {
        const f = await within(factJob, deadline - Date.now());
        if (f === "late") facts = { ...facts, running: true };
        else facts = { created: f.created, updated: f.updated, withdrawn: f.withdrawn, suppressed: f.suppressed };
      } catch { /* already logged */ }
      const note = accounts.some((a) => a.running) ? "Google Calendar is still reading; the new events land within a minute." : undefined;
      return { ok: true, accounts, facts, ...(note ? { note } : {}) };
    } finally { for (const t of timers) clearTimeout(t); }
  },
  async list_upcoming(p) {
    const days = typeof p.days === "number" && p.days > 0 ? Math.min(p.days, 36500) : 14;
    const from = today(); const to = ymd(new Date(Date.now() + days * 86_400_000));
    const items = [
      ...listEvents({ fromDate: from, toDate: to }).map((e) => ({ kind: "event" as const, date: e.localDate, time: e.allDay || e.startAt == null ? null : new Date(e.startAt).toTimeString().slice(0, 5), title: e.title, eventKey: e.eventKey, source: e.source, hasNote: !!getEventNote(e.accountId, e.eventKey) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    return { from, to, items };
  },
  async plan_events_done(p, ctx) { return handlePlanReport(p, ctx.platform, new Date()); },
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
