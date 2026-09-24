// Slack Desk's lifecycle: what the platform may ask, answered from THIS app's own records.
//
// Every hook here reads slack-desk.db and nothing else. That is the U4 contract — the platform
// calls freely and the app decides — and it is what makes initialize safe to call at boot, on
// landing, and again whenever a workspace is connected.

import type { AppLifecycleHooks, ProgressItem } from "@flock/app-sdk";
import { getInit, listInit, markInitFinished, markInitStarted, harvestRanToday } from "./store";
import { dayKey, harvestOnce, readConfig } from "./harvest";

/** How far back the FIRST harvest reads. Steady state is 24h; day one has a backlog. */
const FIRST_RUN_LOOKBACK_HOURS = 14 * 24;

/** Workspaces this app has been told about but has not finished. */
function pending(): string[] {
  return listInit().filter((r) => !r.finishedAt).map((r) => r.accountId);
}

export const slackDeskHooks: AppLifecycleHooks = {
  /**
   * IDEMPOTENT BY CONSTRUCTION. A workspace with a finished record is already ready and is
   * skipped; one with a started-but-unfinished record is work this app OWES — from a process that
   * died mid-run — and is resumed. The platform does not need to tell us which case it is, and
   * deliberately does not: `reason` is for the log.
   */
  async initialize(ctx) {
    const named = ctx.accountIds ?? [];
    for (const accountId of named) {
      const rec = getInit(accountId);
      if (rec?.finishedAt) continue;                       // already ready → nothing to do
      markInitStarted(accountId, "Connecting to Slack");
    }

    const todo = named.length > 0 ? pending().filter((a) => named.includes(a)) : pending();
    if (todo.length === 0) {
      console.log(`[slack-desk] initialize (${ctx.reason}): nothing owed`);
      return;
    }

    for (const accountId of todo) {
      try {
        // THE FIRST PASS LOOKS FURTHER BACK THAN A DAILY ONE, because it is the only pass with a
        // backlog to find. The steady-state window is 24 hours — right for a routine that ran
        // yesterday, useless on the day you install: a workspace whose last real conversation was
        // two days ago yields an agent with no memory at all, which reads as "it didn't work"
        // rather than "there was nothing in the last 24 hours".
        //
        // email-desk draws the same distinction (a 14-day onboarding window) for the same reason.
        // Everything else is deliberately identical to the daily recipe — same sources, same
        // filters — so there is no separate first-run path to keep in step.
        const cfg = { ...readConfig(undefined), lookbackHours: FIRST_RUN_LOOKBACK_HOURS };
        await harvestOnce(accountId, cfg, { platform: ctx.platform });
        markInitFinished(accountId, "done", "Slack is set up");
      } catch (e: any) {
        console.error(`[slack-desk] initialize failed for ${accountId}: ${e?.message ?? e}`);
        markInitFinished(accountId, "failed", "Could not finish reading Slack");
      }
    }
  },

  /**
   * Called by the CRON tick for a due `schedule + app-relay` routine (and by the ingest tick,
   * which hands over nothing for this app since it has no event routines).
   */
  async tick(ctx) {
    // The wire shape, not the platform's: the lifecycle client reduces each routine to
    // {id, appId, trigger} because that is all an app needs to recognise its own work.
    for (const r of ctx.readRoutines) {
      const trigger = r.trigger as { filter?: Record<string, unknown> } | undefined;
      const cfg = readConfig(trigger?.filter);
      // A routine names its workspace through the app's own init records: this app is
      // account-partitioned and a scheduled routine carries no accountId.
      for (const rec of listInit()) {
        if (!rec.finishedAt) continue;                     // still initializing — leave it alone
        try {
          await harvestOnce(rec.accountId, cfg, { platform: ctx.platform });
        } catch (e: any) {
          console.error(`[slack-desk] harvest failed for ${rec.accountId}: ${e?.message ?? e}`);
        }
      }
    }
  },

  /** From our own record. Never started ⇒ nothing to wait on ⇒ released (fail open). */
  status(accountId) {
    const rec = getInit(accountId);
    return !rec || !!rec.finishedAt;
  },

  /**
   * What the home page should say, in this app's words. No app name — the platform concatenates
   * these with every other app's and the user is watching their setup, not our app.
   */
  progress(): ProgressItem[] {
    const today = dayKey(new Date());
    return listInit().map((rec) => {
      if (!rec.finishedAt) {
        return { id: rec.accountId, title: "Slack", message: rec.note ?? "Reading your channels…", state: "running" as const };
      }
      if (rec.outcome === "failed") {
        return { id: rec.accountId, title: "Slack", message: rec.note ?? "Could not finish reading Slack", state: "error" as const };
      }
      const ran = harvestRanToday(rec.accountId, today);
      return {
        id: rec.accountId,
        title: "Slack",
        message: ran ? "Up to date with your channels" : "Set up — reading again tomorrow",
        state: "done" as const,
      };
    });
  },
};
