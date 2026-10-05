import type { OpHandler, OpError } from "@flock/app-sdk";
import { listEvents, setEventNote, getEventNote, listInit } from "./store";
import { ymd } from "./events";
import { syncAccount } from "./sync";
import { syncFactEvents } from "./facts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const err = (code: string, message: string, status = 400): OpError => ({ error: message, code, status });
const isRealDate = (s: string) => { if (!DATE_RE.test(s)) return false; const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y!, m! - 1, d!)) === s; };
const REFRESH_WAIT_MS = 15_000;
const today = () => ymd(new Date());

export const ops: Record<string, OpHandler> = {
  async refresh_calendar(_p, ctx) {
    // Only the user (through their agent) calls this: it always scrapes, within the daily cap, and answers within waitMs.
    // The scrape is never cancelled by the race; it finishes in the background (syncAccount's in-flight guard stops a second one).
    const { platform } = ctx;
    const waitMs = (ctx as { waitMs?: number }).waitMs ?? REFRESH_WAIT_MS;
    const accounts: { accountId: string; ok: boolean; events: number; skipped?: string; fault: string | null; running?: true }[] = [];
    for (const rec of listInit().filter((r) => r.finishedAt && r.outcome === "done")) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const job = syncAccount(rec.accountId, { platform }, "forced");
        job.catch(() => {}); // a late failure after the op answered is not an unhandled rejection
        const r = await Promise.race([job, new Promise<"running">((res) => { timer = setTimeout(() => res("running"), waitMs); })]);
        if (r === "running" || ("skipped" in r && r.skipped === "busy")) { accounts.push({ accountId: rec.accountId, ok: true, events: 0, fault: null, running: true }); continue; }
        accounts.push({ accountId: rec.accountId, ok: r.ok, events: r.events, ...("skipped" in r && r.skipped ? { skipped: r.skipped } : {}), fault: r.fault ?? null });
      } catch (e: any) { accounts.push({ accountId: rec.accountId, ok: false, events: 0, fault: String(e?.message ?? e) }); }
      finally { if (timer) clearTimeout(timer); }
    }
    let facts = { created: 0, updated: 0, withdrawn: 0, suppressed: 0 };
    try { const f = await syncFactEvents(platform); facts = { created: f.created, updated: f.updated, withdrawn: f.withdrawn, suppressed: f.suppressed }; } catch (e: any) { console.warn(`[calendar-desk] fact events: ${e?.message ?? e}`); }
    const note = accounts.some((a) => a.running) ? "Google Calendar is still reading; the new events land within a minute." : undefined;
    return { ok: true, accounts, facts, ...(note ? { note } : {}) };
  },
  async list_upcoming(p) {
    const days = typeof p.days === "number" && p.days > 0 ? Math.min(p.days, 36500) : 14;
    const from = today(); const to = ymd(new Date(Date.now() + days * 86_400_000));
    const items = [
      ...listEvents({ fromDate: from, toDate: to }).map((e) => ({ kind: "event" as const, date: e.localDate, time: e.allDay || e.startAt == null ? null : new Date(e.startAt).toTimeString().slice(0, 5), title: e.title, eventKey: e.eventKey, source: e.source, hasNote: !!getEventNote(e.accountId, e.eventKey) })),
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
