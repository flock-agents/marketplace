// WHAT THE HOME PAGE SAYS ABOUT SLACK, AND WHETHER IT IS TRUE.
//
// Owner, 2026-10-16: Home showed two red "Slack · Still reading your Slack" rows under the
// greeting. Three things were wrong at once:
//   1. Both rows belonged to Slack accounts deleted from Flock weeks earlier. Nothing ever cleared
//      this app's records for them, so progress() reported them forever.
//   2. "Stopped on its read budget" was recorded as `failed`, which progress() shows as an error.
//      It is unfinished, not failed — and only a boot or a reconnect ever resumed it.
//   3. Every row was titled just "Slack", so two workspaces were indistinguishable.

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";

process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "slack-desk-progress-"));

const { _db, getInit, listInit, getWorkspace, setWorkspace, markInitStarted, markInitFinished, markPartialSpend } =
  await import("../store");
const { slackDeskHooks } = await import("../lifecycle");
const { harvestDayKey, DEFAULT_HARVEST_HOUR, READS_PER_PASS } = await import("../harvest");

const LIVE = "acct-live";
const GONE_A = "acct-deleted-a";
const GONE_B = "acct-deleted-b";

function base(): Record<string, unknown> {
  return {
    appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    memory: { extract: async () => ok(undefined as unknown) },
  };
}

function refusingPlatform(): PlatformContext {
  return { ...base(), connectors: { exec: async () => ({ ok: false, reason: "guard_busy" }) } } as unknown as PlatformContext;
}

function workingPlatform(): PlatformContext {
  const ts = String(Math.floor(Date.now() / 1000) - 300);
  return {
    ...base(),
    connectors: {
      exec: async (req: any) => {
        if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME", url: "https://acme.slack.com/" });
        if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: "Someone" } });
        if (req.functionName === "conversations_search_messages") {
          return ok({ matches: [{ ts, channel: { id: "C-REAL" }, user: "U-ME", text: "shipping friday" }] });
        }
        if (req.functionName === "conversations_history") return ok([{ ts, channel: "C-REAL", user: "U8", text: "sounds good" }]);
        return ok([]);
      },
    },
  } as unknown as PlatformContext;
}

/** Spend today's whole read budget, so the next pass stops on it before reading anything. */
function exhaustReads(accountId: string): void {
  markPartialSpend(accountId, harvestDayKey(new Date(), DEFAULT_HARVEST_HOUR), READS_PER_PASS, "reads-exhausted");
}

function seed(accountId: string, team: string | null): void {
  markInitStarted(accountId, "Connecting to Slack");
  markInitFinished(accountId, "done", "Slack is set up");
  if (team) setWorkspace(accountId, { userId: "U1", userName: "me", team, teamId: "T1", url: null });
}

const ids = () => listInit().map((r) => r.accountId).sort();

beforeEach(() => {
  for (const t of ["init_state", "messages", "harvest_days", "cursors", "workspace", "user_names", "ledger", "threads", "channel_engagement"]) {
    try { _db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist */ }
  }
});

// --- a. records for accounts that no longer exist ---------------------------------------------

describe("accounts that no longer exist", () => {
  test("a call naming the full account set (landing / boot) drops every other account's records", async () => {
    seed(LIVE, "Gostych");
    seed(GONE_A, "Old A");
    seed(GONE_B, null);

    await slackDeskHooks.initialize({ reason: "onboarding", accountIds: [LIVE], platform: workingPlatform() } as any);

    expect(ids()).toEqual([LIVE]);
    expect(getWorkspace(GONE_A)).toBeNull();
    expect(getWorkspace(LIVE)?.team).toBe("Gostych");
    const rows = await slackDeskHooks.progress!();
    expect(rows.map((r) => r.id)).toEqual([LIVE]);
  });

  test("a connect names only the NEW account — it says nothing about the others, so nothing is dropped", async () => {
    seed(LIVE, "Gostych");
    await slackDeskHooks.initialize({ reason: "account-added", accountIds: [GONE_A], platform: workingPlatform() } as any);
    expect(ids()).toEqual([GONE_A, LIVE].sort());
  });

  test("a call that names no accounts cannot tell who is live, so nothing is dropped", async () => {
    seed(LIVE, "Gostych");
    seed(GONE_A, null);
    await slackDeskHooks.initialize({ reason: "onboarding", platform: workingPlatform() } as any);
    expect(ids()).toEqual([GONE_A, LIVE].sort());
  });
});

// --- b. stopped on the read budget is unfinished, not failed ----------------------------------

describe("a first pass that stops on its read budget", () => {
  test("is recorded as owed, not failed, and shown as running with honest copy", async () => {
    exhaustReads(LIVE);
    await slackDeskHooks.initialize({ reason: "account-added", accountIds: [LIVE], platform: workingPlatform() } as any);

    const rec = getInit(LIVE)!;
    expect(rec.outcome).toBe("owed");
    const [row] = await slackDeskHooks.progress!();
    expect(row!.state).toBe("running");
    expect(row!.message).toBe("Reading more of your Slack in the next pass");
  });

  test("a refused pass is still a real failure, shown as an error", async () => {
    await slackDeskHooks.initialize({ reason: "account-added", accountIds: [LIVE], platform: refusingPlatform() } as any);
    expect(getInit(LIVE)!.outcome).toBe("failed");
    const [row] = await slackDeskHooks.progress!();
    expect(row!.state).toBe("error");
  });

  test("the next scheduled tick resumes the first read and finishes it", async () => {
    exhaustReads(LIVE);
    await slackDeskHooks.initialize({ reason: "account-added", accountIds: [LIVE], platform: workingPlatform() } as any);
    expect(getInit(LIVE)!.outcome).toBe("owed");

    // A fresh budget (the next day, or the platform's lease released) — no boot, no reconnect.
    _db.exec("DELETE FROM harvest_days");
    await slackDeskHooks.tick!({
      readRoutines: [{ id: "r1", appId: "slack-desk", appRoutineId: "memory-extraction", trigger: { type: "schedule" } }],
      platform: workingPlatform(),
    } as any);

    const rec = getInit(LIVE)!;
    expect(rec.outcome).toBe("done");
    const [row] = await slackDeskHooks.progress!();
    expect(row!.state).toBe("done");
  });

  test("a tick that is still out of budget leaves it owed, never failed", async () => {
    exhaustReads(LIVE);
    await slackDeskHooks.initialize({ reason: "account-added", accountIds: [LIVE], platform: workingPlatform() } as any);
    await slackDeskHooks.tick!({
      readRoutines: [{ id: "r1", appId: "slack-desk", appRoutineId: "memory-extraction", trigger: { type: "schedule" } }],
      platform: workingPlatform(),
    } as any);
    expect(getInit(LIVE)!.outcome).toBe("owed");
  });
});

// --- c. which workspace a row is about -------------------------------------------------------

describe("row titles", () => {
  test("name the workspace when it is known", async () => {
    seed(LIVE, "Gostych");
    seed(GONE_A, null);
    const rows = await slackDeskHooks.progress!();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.title]));
    expect(byId[LIVE]).toBe("Slack · Gostych");
    expect(byId[GONE_A]).toBe("Slack");
  });
});
