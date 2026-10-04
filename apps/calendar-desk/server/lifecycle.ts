import type { AppLifecycleHooks, ProgressItem } from "@flock/app-sdk";
import { listInit, markInitStarted, markInitFinished, getCursor } from "./store";
import { syncAccount, lastSyncAt, lastFault } from "./sync";
import { ingestFacts } from "./ingest";
import { publishDueRows, storeRoutineState, readRoutineState, routineKey } from "./scheduler";
import { migrateLegacyReminders } from "./migrate-legacy";
import { ymd } from "./events";

const SCHEDULED_SCRAPE_HOURS = [6, 13];
const pending = () => listInit().filter((r) => !r.finishedAt || r.outcome === "failed").map((r) => r.accountId);

export const calendarDeskHooks: AppLifecycleHooks = {
  async initialize(ctx) {
    try { migrateLegacyReminders(process.env.APP_DATA_DIR ?? ".", ymd(new Date())); } catch (e: any) { console.warn(`[calendar-desk] legacy migration: ${e?.message ?? e}`); }
    for (const a of ctx.accountIds ?? []) { const rec = listInit().find((r) => r.accountId === a); if (!(rec?.finishedAt && rec.outcome === "done")) markInitStarted(a, "Reading your calendar"); }
    const todo = (ctx.accountIds?.length ? pending().filter((a) => ctx.accountIds!.includes(a)) : pending());
    for (const a of todo) {
      const r = await syncAccount(a, { platform: ctx.platform }, "init");
      markInitFinished(a, r.ok ? "done" : "failed", r.ok ? "Calendar is set up" : "Could not read your calendar yet");
    }
  },
  async tick(ctx) {
    storeRoutineState(ctx.readRoutines);
    const now = ((ctx as any).now as (() => Date) | undefined)?.() ?? new Date();
    const st = readRoutineState();
    for (const rec of listInit()) {
      if (!rec.finishedAt) continue;
      if (SCHEDULED_SCRAPE_HOURS.includes(now.getHours()) && (lastSyncAt(rec.accountId) ?? 0) < now.getTime() - 50 * 60_000) {
        await syncAccount(rec.accountId, { platform: ctx.platform, now: () => now }, "scheduled");
      }
      // A light re-read at every tick in waking hours (07:00-20:59): shouldScrape allows it only when the last scrape is over 2h old and
      // the daily cap is not spent, so most ticks do nothing. This is how an event made after 13:00 is seen.
      if (rec.outcome === "done" && now.getHours() >= 7 && now.getHours() < 21) await syncAccount(rec.accountId, { platform: ctx.platform, now: () => now }, "light");
    }
    if (st.remindersEnabled || ctx.readRoutines.some((r) => routineKey(r) === "reminders")) {
      await ingestFacts(ctx.platform, st.remindersCfg, now);
      await publishDueRows(ctx.platform, st.remindersCfg, now);
    }
  },
  status(accountId) { const rec = listInit().find((r) => r.accountId === accountId); return !rec || !!rec.finishedAt; },
  progress(): ProgressItem[] {
    return listInit().map((rec) => {
      if (!rec.finishedAt) return { id: rec.accountId, title: "Calendar", message: rec.note ?? "Reading your calendar…", state: "running" as const };
      const fault = lastFault(rec.accountId);
      if (rec.outcome === "failed" || fault) return { id: rec.accountId, title: "Calendar", message: fault ? "Google session needs attention" : (rec.note ?? "Could not read your calendar"), state: "error" as const };
      const facts = getCursor("facts_since");
      return { id: rec.accountId, title: "Calendar", message: facts ? "Watching your calendar and dates" : "Set up — watching from the next hour", state: "done" as const };
    });
  },
};
