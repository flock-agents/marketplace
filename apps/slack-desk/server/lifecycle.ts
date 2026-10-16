// Slack Desk's lifecycle: what the platform may ask, answered from THIS app's own records.
//
// Every hook here reads slack-desk.db and nothing else. That is the U4 contract — the platform
// calls freely and the app decides — and it is what makes initialize safe to call at boot, on
// landing, and again whenever a workspace is connected.

import type { AppLifecycleHooks, ProgressItem } from "@flock/app-sdk";
import type { PlatformContext } from "@flock/app-sdk";
import {
  getInit, listInit, markInitFinished, markInitStarted, harvestRanToday, clearHarvestDay,
  knownAccounts, forgetAccount, getWorkspace,
} from "./store";
import { harvestDayKey, harvestOnce, readConfig, FIRST_RUN_MAX_BLOCKS, DEFAULT_HARVEST_HOUR } from "./harvest";

/**
 * How far back the FIRST harvest reads — NARROW, then widening only if it finds nothing.
 *
 * This was a flat 14 days, paired with a rule that treated every channel as picked, so the first
 * pass was the widest window times the widest tier: the biggest spend the app ever makes, on the
 * one pass the owner is watching, on a source where most content concerns nobody in particular.
 *
 * The tension that produced it is real — a 48-hour window on a quiet install finds nothing, and an
 * empty memory reads as broken. The answer is to widen the WINDOW and never the rule: a normally
 * active workspace pays for two days of engaged conversations, and only a genuinely quiet one
 * reaches further back, where reaching back is cheap precisely because it is quiet.
 */
const FIRST_RUN_WINDOWS_HOURS = [48, 7 * 24, 14 * 24];

/**
 * The harvest hour the routine last handed us. progress() has no routine to read, and must key
 * the day the same way the tick did or it reports "reading again tomorrow" for a day that ran.
 */
let lastHarvestHour = DEFAULT_HARVEST_HOUR;

/**
 * Accounts initialize still owes work to: never started, stopped on its read budget (`owed`), or
 * started and failed. A failed or owed record stays pending precisely so the next initialize (or
 * tick) picks it up — a transient refusal (a busy
 * account guard, an expired token, Slack itself being slow) must not permanently convince the
 * app that this workspace was set up.
 */
function pending(): string[] {
  return listInit()
    .filter((r) => !r.finishedAt || r.outcome !== "done")
    .map((r) => r.accountId);
}

const OWED_NOTE = "Reading more of your Slack in the next pass";

/** Accounts a first pass is running for in this process, so a tick never doubles an initialize. */
const inFlight = new Set<string>();

/**
 * "Slack · Gostych" when the workspace is known, else "Slack". Two workspaces titled just "Slack"
 * are indistinguishable on Home.
 */
function rowTitle(accountId: string): string {
  const team = getWorkspace(accountId)?.team?.trim();
  return team ? `Slack · ${team}` : "Slack";
}

/**
 * Forget accounts that no longer exist.
 *
 * THE APP HAS NO "ACCOUNT REMOVED" SIGNAL — the lifecycle contract is initialize/tick/status/
 * progress, and none of them says an account went away. What it does have: a landing or boot call
 * (anything but `account-added`) names EVERY Slack account the paired agent holds (platform
 * app-lifecycle.ts, 2026-10-08). That list is authoritative, so any account we hold records for
 * that is not on it is gone — deleted from Flock, or no longer this agent's to read.
 *
 * A connect names only the new account, and a call naming nothing (an older platform, or an agent
 * holding no Slack account) says nothing about the rest — neither may drop anything.
 */
function forgetDeparted(reason: string, accountIds: string[] | undefined): void {
  if (reason === "account-added" || !accountIds || accountIds.length === 0) return;
  const live = new Set(accountIds);
  for (const accountId of knownAccounts()) {
    if (live.has(accountId) || inFlight.has(accountId)) continue;
    console.log(`[slack-desk] forgetting ${accountId}: no longer among the platform's accounts`);
    forgetAccount(accountId);
  }
}

/**
 * The first read of a workspace, and its verdict on the init record. Called by initialize and,
 * for a workspace whose first read is still owed, by the hourly tick.
 */
async function firstPass(accountId: string, platform: PlatformContext): Promise<void> {
  if (inFlight.has(accountId)) return;
  inFlight.add(accountId);
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
    // Escalate only on an EMPTY result: each window is tried with the same engaged-only rule,
    // and the first one that finds anything wins. `firstRun` no longer widens the tier — the
    // window is the whole of the first-run adaptation.
    let out = await harvestOnce(accountId, {
      ...readConfig(undefined), lookbackHours: FIRST_RUN_WINDOWS_HOURS[0]!,
      maxBlocks: FIRST_RUN_MAX_BLOCKS,
    }, { platform });

    for (const hours of FIRST_RUN_WINDOWS_HOURS.slice(1)) {
      if (out.blocks > 0 || out.stopReason) break;
      console.log(`[slack-desk] first pass found nothing in ${FIRST_RUN_WINDOWS_HOURS[0]}h — widening to ${hours}h`);
      // The day guard would refuse a second pass, and this is still the FIRST harvest: the
      // previous attempt remembered nothing, so there is nothing to protect from a re-read.
      clearHarvestDay(accountId, harvestDayKey(new Date(), readConfig(undefined).harvestHour));
      out = await harvestOnce(accountId, {
        ...readConfig(undefined), lookbackHours: hours, maxBlocks: FIRST_RUN_MAX_BLOCKS,
      }, { platform });
    }

    // REFUSED FIRST: every call refused and nothing read is a real failure, even when the refusal
    // (a busy lease) also ended the pass's reads. Only then is a stopped-on-budget pass what it
    // is — UNFINISHED, not failed: `owed`, shown as running, resumed by the next hourly tick.
    if (out.errors > 0 && out.fetched === 0) {
      console.warn(`[slack-desk] initialize read nothing for ${accountId} (${out.errors} refused call(s)) — will retry`);
      markInitFinished(accountId, "failed", "Could not read Slack yet");
    } else if (out.stopReason === "reads-exhausted") {
      console.log(`[slack-desk] first pass for ${accountId} stopped on its read budget — the next tick resumes it`);
      markInitFinished(accountId, "owed", OWED_NOTE);
    } else {
      markInitFinished(accountId, "done", "Slack is set up");
    }
  } catch (e: any) {
    console.error(`[slack-desk] initialize failed for ${accountId}: ${e?.message ?? e}`);
    markInitFinished(accountId, "failed", "Could not finish reading Slack");
  } finally {
    inFlight.delete(accountId);
  }
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
    forgetDeparted(ctx.reason, ctx.accountIds);
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

    for (const accountId of todo) await firstPass(accountId, ctx.platform);
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
      lastHarvestHour = cfg.harvestHour;
      // A routine names its workspace through the app's own init records: this app is
      // account-partitioned and a scheduled routine carries no accountId.
      for (const rec of listInit()) {
        if (!rec.finishedAt) continue;                     // still initializing — leave it alone
        if (inFlight.has(rec.accountId)) continue;         // a first pass is already running for it
        // THE FIRST READ IS RESUMED HERE, not only on boot or connect. A first pass that stopped on
        // its read budget (or failed) is still owed, and the hourly tick is the one caller that
        // reliably comes back — waiting for a restart left the row unfinished for days.
        if (rec.outcome !== "done") {
          await firstPass(rec.accountId, ctx.platform);
          continue;
        }
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
    const today = harvestDayKey(new Date(), lastHarvestHour);
    return listInit().map((rec) => {
      const title = rowTitle(rec.accountId);
      if (!rec.finishedAt) {
        return { id: rec.accountId, title, message: rec.note ?? "Reading your channels…", state: "running" as const };
      }
      // Unfinished, not failed: shown as running, never as the red warning a real failure gets.
      if (rec.outcome === "owed") {
        return { id: rec.accountId, title, message: rec.note ?? OWED_NOTE, state: "running" as const };
      }
      if (rec.outcome === "failed") {
        return { id: rec.accountId, title, message: rec.note ?? "Could not finish reading Slack", state: "error" as const };
      }
      const ran = harvestRanToday(rec.accountId, today);
      return {
        id: rec.accountId,
        title,
        message: ran ? "Up to date with your channels" : "Set up — reading again tomorrow",
        state: "done" as const,
      };
    });
  },
};
