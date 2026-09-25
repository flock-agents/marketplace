// Slack Desk's lifecycle: what the platform may ask, answered from THIS app's own records.
//
// Every hook here reads slack-desk.db and nothing else. That is the U4 contract — the platform
// calls freely and the app decides — and it is what makes initialize safe to call at boot, on
// landing, and again whenever a workspace is connected.

import type { AppLifecycleHooks, ProgressItem } from "@flock/app-sdk";
import { getInit, listInit, markInitFinished, markInitStarted, harvestRanToday } from "./store";
import { dayKey, harvestOnce, readConfig, FIRST_RUN_MAX_BLOCKS } from "./harvest";

/** How far back the FIRST harvest reads. Steady state is 24h; day one has a backlog. */
const FIRST_RUN_LOOKBACK_HOURS = 14 * 24;

/** Workspaces this app has been told about but has not finished. */
/**
 * Accounts initialize still owes work to: never started, or started and failed. A failed record
 * stays pending precisely so the next initialize picks it up — a transient refusal (a busy
 * account guard, an expired token, Slack itself being slow) must not permanently convince the
 * app that this workspace was set up.
 */
function pending(): string[] {
  return listInit()
    .filter((r) => !r.finishedAt || r.outcome === "failed")
    .map((r) => r.accountId);
}

export const slackDeskHooks: AppLifecycleHooks = {
  /**
   * IDEMPOTENT BY CONSTRUCTION. A workspace that finished SUCCESSFULLY is already ready and is
   * skipped; one that is unfinished (a process that died mid-run) or that finished having read
   * nothing is work this app still OWES, and is resumed. The platform does not need to tell us
   * which case it is, and deliberately does not: `reason` is for the log.
   */
  async initialize(ctx) {
    const named = ctx.accountIds ?? [];
    for (const accountId of named) {
      const rec = getInit(accountId);
      // Only a `done` record ends the obligation. `failed` is finished-but-not-ready, and
      // treating it as ready is what made one bad first pass permanent.
      if (rec?.finishedAt && rec.outcome === "done") continue;
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
        // FIRST-RUN TIERING, and it is not a detail. `readConfig(undefined)` yields NO picked
        // channels, so on a first pass every channel is discovered — and under the tier rules
        // every conversation without a direct owner signal would land in `skip`. The one harvest
        // whose whole job is to make the agent visibly know something would extract almost
        // nothing. So a first run treats discovered channels as picked and lets the BLOCK CAP
        // bound the spend instead of the tier, which is what email-desk's onboarding does.
        const cfg = {
          ...readConfig(undefined),
          lookbackHours: FIRST_RUN_LOOKBACK_HOURS,
          firstRun: true,
          maxBlocks: FIRST_RUN_MAX_BLOCKS,
        };
        const out = await harvestOnce(accountId, cfg, { platform: ctx.platform });

        // "SET UP" MUST MEAN SOMETHING WAS READ.
        //
        // A harvest degrades instead of throwing, so a pass in which every connector call was
        // refused returns normally with nothing in it. Marking that "done" was the reason the
        // memory never appeared AND never recovered: `pending()` only returns records with no
        // `finishedAt`, so the first failed pass was also the last one. A pass that read
        // nothing because it was refused is recorded as failed, which leaves it retryable on
        // the next boot or connect; a genuinely quiet workspace read fine and is done.
        // A pass that stopped on its read budget has not finished initialising either — it must
        // stay pending so the next boot or connect resumes it, exactly like a refused pass.
        if (out.stopReason === "reads-exhausted") {
          console.warn(`[slack-desk] initialize for ${accountId} stopped on its read budget — will resume`);
          markInitFinished(accountId, "failed", "Still reading your Slack");
        } else if (out.errors > 0 && out.fetched === 0) {
          console.warn(`[slack-desk] initialize read nothing for ${accountId} (${out.errors} refused call(s)) — will retry`);
          markInitFinished(accountId, "failed", "Could not read Slack yet");
        } else {
          markInitFinished(accountId, "done", "Slack is set up");
        }
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
