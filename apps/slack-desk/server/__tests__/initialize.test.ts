// INITIALIZE MUST NOT DECLARE VICTORY OVER A READ THAT NEVER HAPPENED.
//
// Owner, 2026-09-24: "the memory was never built, what exactly happened here?"
//
// It ran. A Slack account was connected, the platform called initialize (skill-connections.ts →
// initializeApps("account-added")), and the app wrote `done | "Slack is set up"`. What it did NOT
// do was read anything: every connector call came back `guard_busy`, the harvest degraded to zero
// messages as designed, and initialize marked it finished anyway.
//
// That is what made a transient failure permanent. `pending()` returned only records with no
// `finishedAt`, so the account that most needed a second attempt was the one account that could
// never get one. The rest of the system behaved correctly on top of a lie it had no way to see.
//
// These tests pin the contract that fixes it: "finished" and "ready" are different states.

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";

process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "slack-desk-init-"));

const { _db, getInit } = await import("../store");
const { slackDeskHooks } = await import("../lifecycle");

const ACCT = "acct-init";

/** A platform whose Slack calls all fail the way a held account-guard lease fails. */
function refusingPlatform(): PlatformContext {
  return {
    appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    connectors: { exec: async () => ({ ok: false, reason: "guard_busy" }) },
    memory: { extract: async () => ok(undefined as unknown) },
  } as unknown as PlatformContext;
}

/** A platform that answers, with one real message to find. */
function workingPlatform(): PlatformContext {
  const ts = String(Math.floor(Date.now() / 1000) - 300);
  return {
    appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    connectors: {
      exec: async (req: any) => {
        if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME", url: "https://acme.slack.com/" });
        if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: "Someone" } });
        if (req.functionName === "conversations_search_messages") {
          return ok({ matches: [{ ts, channel: { id: "C-REAL" }, user: "U-ME", text: "shipping friday" }] });
        }
        if (req.functionName === "conversations_history") {
          return ok([{ ts, channel: "C-REAL", user: "U8", text: "sounds good" }]);
        }
        return ok([]);
      },
    },
    memory: { extract: async () => ok(undefined as unknown) },
  } as unknown as PlatformContext;
}

describe("initialize — connecting an account", () => {
  beforeEach(() => {
    for (const t of ["init_state", "messages", "harvest_runs", "cursors", "workspace", "user_names"]) {
      try { _db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist in this migration set */ }
    }
  });

  test("a pass that could not read is NOT recorded as set up", async () => {
    await slackDeskHooks.initialize!({
      reason: "account-added", accountIds: [ACCT], platform: refusingPlatform(),
    } as any);

    const rec = getInit(ACCT);
    expect(rec).not.toBeNull();
    // It finished — but it finished FAILED. Claiming "Slack is set up" here is the bug.
    expect(rec!.outcome).toBe("failed");
    expect(rec!.note).not.toContain("is set up");
  });

  test("…and it is retried, because a failed account is still owed work", async () => {
    await slackDeskHooks.initialize!({
      reason: "account-added", accountIds: [ACCT], platform: refusingPlatform(),
    } as any);
    expect(getInit(ACCT)!.outcome).toBe("failed");

    // Second attempt — a later boot, or the owner reconnecting. Under the old rule this account
    // was permanently "finished" and initialize skipped it forever.
    await slackDeskHooks.initialize!({
      reason: "boot", accountIds: [ACCT], platform: workingPlatform(),
    } as any);

    const rec = getInit(ACCT)!;
    expect(rec.outcome).toBe("done");
    expect(rec.finishedAt).toBeTruthy();
  });

  test("a successful pass is never redone", async () => {
    await slackDeskHooks.initialize!({
      reason: "account-added", accountIds: [ACCT], platform: workingPlatform(),
    } as any);
    expect(getInit(ACCT)!.outcome).toBe("done");

    // A platform that would throw if touched: proving the second call does no Slack work at all.
    let touched = false;
    await slackDeskHooks.initialize!({
      reason: "boot", accountIds: [ACCT],
      platform: { ...workingPlatform(), connectors: { exec: async () => { touched = true; return ok([]); } } },
    } as any);
    expect(touched).toBe(false);
    expect(getInit(ACCT)!.outcome).toBe("done");
  });

  test("a retry in flight does not still show the previous failure", async () => {
    // The owner watches this state. Leaving `failed` on the row while the retry runs would show
    // "Could not read Slack" over an attempt that is going fine.
    await slackDeskHooks.initialize!({
      reason: "account-added", accountIds: [ACCT], platform: refusingPlatform(),
    } as any);

    const { markInitStarted } = await import("../store");
    markInitStarted(ACCT, "Connecting to Slack");

    const rec = getInit(ACCT)!;
    expect(rec.finishedAt).toBeNull();
    expect(rec.outcome).toBeNull();
  });
});
