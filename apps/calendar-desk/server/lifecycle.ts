import type { AppLifecycleHooks, ProgressItem } from "@flock/app-sdk";
import { listInit, markInitStarted } from "./store";
import { syncAccount, lastSyncAt, lastFault, faultKind } from "./sync";
import { storeRoutineState, routineKey } from "./scheduler";
import { runPlanning } from "./planner";
import { syncFactEvents } from "./facts";
import { completeFirstRead, retryUnfinishedInits, storeInitRoutines, planAfterFirstRead } from "./init-retry";

const SCHEDULED_SCRAPE_HOURS = [6, 13];
const pending = () => listInit().filter((r) => !r.finishedAt || r.outcome === "failed").map((r) => r.accountId);

export const calendarDeskHooks: AppLifecycleHooks = {
  async initialize(ctx) {
    for (const a of ctx.accountIds ?? []) { const rec = listInit().find((r) => r.accountId === a); if (!(rec?.finishedAt && rec.outcome === "done")) markInitStarted(a, "Reading your calendar"); }
    const todo = (ctx.accountIds?.length ? pending().filter((a) => ctx.accountIds!.includes(a)) : pending());
    const clock = () => ((ctx as any).now as (() => Date) | undefined)?.() ?? new Date();
    const now = clock();
    // The platform's list of enabled routines (an older platform sends none): kept so a retried first read knows too.
    const ids = (ctx as any).enabledRoutines as string[] | undefined;
    storeInitRoutines(ids);
    let anyDone = false;
    for (const a of todo) {
      const r = await syncAccount(a, { platform: ctx.platform }, "init");
      if ((await completeFirstRead(ctx.platform, a, r, clock, ids, { defer: true })) === "done") anyDone = true;
    }
    try { await syncFactEvents(ctx.platform, now); } catch (err: any) { console.warn(`[calendar-desk] fact events: ${err?.message ?? err}`); }
    // First read done: plan now instead of waiting for the hourly routine. Only when the owner has planning on
    // (the enabled routines; without them, the last tick's snapshot or the stored list decides), through runPlanning
    // so its guards (open plan, give-up, limits) still apply, and with a fresh clock: the first read can take minutes.
    if (anyDone) await planAfterFirstRead(ctx.platform, clock, ids);
  },
  async tick(ctx) {
    storeRoutineState(ctx.readRoutines);
    const clock = () => ((ctx as any).now as (() => Date) | undefined)?.() ?? new Date();
    const now = clock();
    // A first read that did not land (busy, or failed) is read again once its backoff has passed.
    try { await retryUnfinishedInits(ctx.platform, now, { clock }); } catch (err: any) { console.warn(`[calendar-desk] first-read retry: ${err?.message ?? err}`); }
    for (const rec of listInit()) {
      if (!rec.finishedAt) continue;
      if (SCHEDULED_SCRAPE_HOURS.includes(now.getHours()) && (lastSyncAt(rec.accountId) ?? 0) < now.getTime() - 50 * 60_000) {
        await syncAccount(rec.accountId, { platform: ctx.platform, now: () => now }, "scheduled");
      }
      // A light re-read at every tick in waking hours (07:00-20:59): shouldScrape allows it only when the last scrape is over 2h old and
      // the daily cap is not spent, so most ticks do nothing. This is how an event made after 13:00 is seen.
      if (rec.outcome === "done" && now.getHours() >= 7 && now.getHours() < 21) await syncAccount(rec.accountId, { platform: ctx.platform, now: () => now }, "light");
    }
    try { await syncFactEvents(ctx.platform, now); } catch (err: any) { console.warn(`[calendar-desk] fact events: ${err?.message ?? err}`); }
    // Planning runs after this tick's read (initialize also plans once, right after a first read), when the tick names the routine (it names only due, enabled routines; Run now is a tick too).
    if (ctx.readRoutines.some((r) => routineKey(r) === "event-planning")) {
      try { await runPlanning(ctx.platform, clock()); } catch (err: any) { console.warn(`[calendar-desk] planning: ${err?.message ?? err}`); }
    }
  },
  status(accountId) { const rec = listInit().find((r) => r.accountId === accountId); return !rec || !!rec.finishedAt; },
  progress(): ProgressItem[] {
    return listInit().map((rec) => {
      if (!rec.finishedAt) return { id: rec.accountId, title: "Calendar", message: "Reading your calendar…", state: "running" as const };
      const fault = lastFault(rec.accountId);
      // Only a sign-in or session fault asks the owner to look at Google; anything else is retried on its own.
      if (fault && faultKind(fault) === "session") return { id: rec.accountId, title: "Calendar", message: "Google session needs attention", state: "error" as const };
      if (rec.outcome === "failed") return { id: rec.accountId, title: "Calendar", message: rec.note ?? "Could not read your calendar yet", state: "error" as const };
      return { id: rec.accountId, title: "Calendar", message: "Watching your calendar", state: "done" as const };
    });
  },
};
