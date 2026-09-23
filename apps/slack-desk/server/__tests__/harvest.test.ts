// slack-desk's daily harvest — the decisions, without a Slack or a platform.
//
// Everything that DECIDES is pure and takes its inputs as arguments: what counts as worth
// remembering, how threads group, what the connector's reply becomes. The one impure part
// (harvestOnce) takes a fake PlatformContext, so this exercises the real self-fetch path —
// connectors.exec → store → memory.extract — with no network and no Slack.

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";

// BEFORE the store is imported. It opens its Database at module load and falls back to "." when
// APP_DATA_DIR is unset — which is how a stray slack-desk.db landed in the repo and its WAL
// sidecars got committed (`.gitignore` had *.db but not *.db-wal). A static import would hoist
// above this line, so the store and everything that touches it load dynamically below.
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "slack-desk-test-"));

const {
  readConfig, dayKey, isWorthRemembering, groupByThread, toBlock, normalizeHistory, harvestOnce,
} = await import("../harvest");
const { _db, harvestRanToday } = await import("../store");

const ACCT = "team-1";

function wipe() {
  for (const t of ["messages", "cursors", "init_state", "harvest_days"]) _db.exec(`DELETE FROM ${t}`);
}

/** A platform that records what the app asked of it and answers with canned Slack history. */
function fakePlatform(history: Record<string, any[]>, calls: string[] = []): { ctx: PlatformContext; calls: string[]; blocks: unknown[][] } {
  const blocks: unknown[][] = [];
  const ctx = {
    appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    connectors: {
      exec: async (req: any) => {
        calls.push(`${req.functionName}:${req.params.channel}:${req.accountHint}`);
        return ok(history[req.params.channel] ?? []);
      },
    },
    memory: { extract: async (items: unknown[]) => { blocks.push(items); return ok(undefined as unknown); } },
  } as unknown as PlatformContext;
  return { ctx, calls, blocks };
}

describe("harvest — the pure decisions", () => {
  test("config defaults are conservative: no channels means read NOTHING", () => {
    const cfg = readConfig(undefined);
    expect(cfg.channels).toEqual([]);      // never "read everything"
    expect(cfg.ignoreBots).toBe(true);
    expect(cfg.lookbackHours).toBe(24);
  });

  test("a bot post is not worth remembering; a person's is", () => {
    const cfg = readConfig({ channels: ["C1"] });
    expect(isWorthRemembering({ channelId: "C1", ts: "1", author: "U123", text: "ship friday" }, cfg)).toBe(true);
    expect(isWorthRemembering({ channelId: "C1", ts: "2", author: "B999", text: "deploy ok" }, cfg)).toBe(false);
    // A join/leave notice has no author and no meaning.
    expect(isWorthRemembering({ channelId: "C1", ts: "3", text: "joined" }, cfg)).toBe(false);
    expect(isWorthRemembering({ channelId: "C1", ts: "4", author: "U1", text: "   " }, cfg)).toBe(false);
  });

  test("a thread is the unit of meaning — replies group with their parent", () => {
    const groups = groupByThread([
      { channelId: "C1", ts: "1", author: "U1", text: "a" },
      { channelId: "C1", ts: "2", threadTs: "1", author: "U2", text: "b" },
      { channelId: "C1", ts: "9", author: "U3", text: "unrelated" },
      { channelId: "C2", ts: "1", author: "U1", text: "other channel" },
    ]);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 2]);
    const block = toBlock(groups[0]!);
    expect(block.text).toBe("U1: a\nU2: b");
    // The route REJECTS an item without these three — a 400 the app used to log as
    // "extraction failed" and carry on from, dropping every harvest on the floor.
    expect(block.id).toBe("C1:1");
    expect(Number.isNaN(Date.parse(block.timestamp))).toBe(false);
  });

  test("normalizeHistory tolerates shape drift rather than throwing", () => {
    expect(normalizeHistory("C1", null)).toEqual([]);
    expect(normalizeHistory("C1", { messages: [{ ts: "2", user: "U1", text: "b" }, { ts: "1", user: "U2", text: "a" }] })
      .map((m) => m.ts)).toEqual(["1", "2"]);          // oldest first
    expect(normalizeHistory("C1", [{ no_ts: true }])).toEqual([]);   // unusable rows are dropped
  });
});

describe("harvest — one workspace's daily pass", () => {
  beforeEach(wipe);

  test("fetches each watched channel, stores, and extracts one block per thread", async () => {
    const { ctx, calls, blocks } = fakePlatform({
      C1: [{ ts: "100", user: "U1", text: "ship friday" }, { ts: "101", thread_ts: "100", user: "U2", text: "agreed" }],
      C2: [{ ts: "200", user: "U3", text: "invoice is late" }],
    });
    const cfg = readConfig({ channels: ["C1", "C2"] });

    const out = await harvestOnce(ACCT, cfg, { platform: ctx });

    expect(calls).toEqual([
      "conversations_history:C1:team-1",
      "conversations_history:C2:team-1",
    ]);
    expect(out.fetched).toBe(3);
    expect(out.newMessages).toBe(3);
    expect(out.blocks).toBe(2);           // the C1 thread, and C2's lone message
    expect(blocks).toHaveLength(1);       // ONE extract call, not one per thread
  });

  test("it will not run twice in a day — the restart guard", async () => {
    const cfg = readConfig({ channels: ["C1"] });
    const first = fakePlatform({ C1: [{ ts: "100", user: "U1", text: "hi" }] });
    await harvestOnce(ACCT, cfg, { platform: first.ctx });
    expect(harvestRanToday(ACCT, dayKey(new Date()))).toBe(true);

    const second = fakePlatform({ C1: [{ ts: "101", user: "U1", text: "again" }] });
    const out = await harvestOnce(ACCT, cfg, { platform: second.ctx });
    expect(out.skipped).toBe("already-ran-today");
    expect(second.calls).toEqual([]);     // it did not even ask Slack
  });

  test("no channels chosen ⇒ it reads the OWNER'S OWN activity, not nothing and not everything", async () => {
    // Owner, 2026-09-23. "Read nothing" made a freshly installed app do nothing at all, silently.
    // The default is the part of Slack already addressed to this person: DMs, mentions, saved.
    const calls: string[] = [];
    const ctx = {
      appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: {
        exec: async (req: any) => {
          calls.push(req.functionName);
          if (req.functionName === "getUserInfo") return ok({ id: "U-ME" });
          if (req.functionName === "conversations_unreads") return ok([{ ts: "10", channel: "D1", user: "U9", text: "dm to me" }]);
          if (req.functionName === "conversations_search_messages") return ok([{ ts: "11", channel: "C7", user: "U8", text: "hey <@U-ME>" }]);
          return ok([{ ts: "12", channel: "C9", user: "U7", text: "saved for later" }]);
        },
      },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;

    const out = await harvestOnce(ACCT, readConfig({ channels: [] }), { platform: ctx });
    expect(out.scope).toBe("activity");
    expect(out.skipped).toBeUndefined();
    expect(calls).toEqual([
      "conversations_unreads", "getUserInfo", "conversations_search_messages", "saved_list",
    ]);
    expect(out.newMessages).toBe(3);
  });

  test("DM unreads are scoped to IM — reading every channel type is documented as minutes-slow", async () => {
    let params: any = null;
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: { exec: async (req: any) => {
        if (req.functionName === "conversations_unreads") params = req.params;
        return ok([]);
      } },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;
    await harvestOnce(ACCT, readConfig({ channels: [] }), { platform: ctx });
    expect(params?.channel_types).toBe("im");
  });

  test("one activity source failing costs that source, not the pass", async () => {
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: { exec: async (req: any) => {
        if (req.functionName === "conversations_unreads") return { ok: false as const, reason: "platform 429", status: 429 };
        if (req.functionName === "getUserInfo") return ok({ id: "U-ME" });
        return ok([{ ts: "20", channel: "C1", user: "U2", text: "still read" }]);
      } },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;
    const out = await harvestOnce(ACCT, readConfig({ channels: [] }), { platform: ctx });
    expect(out.newMessages).toBeGreaterThan(0);        // mentions + saved still landed
  });

  test("one refusing channel does not abort the run", async () => {
    const calls: string[] = [];
    const { ctx, blocks } = fakePlatform({ C2: [{ ts: "200", user: "U3", text: "kept" }] }, calls);
    // C1 is absent from the canned history, but exec still succeeds with []; simulate a refusal
    // by making it the one channel the platform rejects.
    const rejecting = {
      ...ctx,
      connectors: {
        exec: async (req: any) => {
          calls.push(req.params.channel);
          return req.params.channel === "C1"
            ? { ok: false as const, reason: "platform 429", status: 429 }
            : ok([{ ts: "200", user: "U3", text: "kept" }]);
        },
      },
    } as unknown as PlatformContext;

    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1", "C2"] }), { platform: rejecting });
    expect(calls).toEqual(["C1", "C2"]);   // it carried on
    expect(out.blocks).toBe(1);
    expect(blocks.length + 1).toBeGreaterThan(0);
  });

  test("an UNPAIRED app does nothing at all", async () => {
    const { ctx, calls } = fakePlatform({ C1: [{ ts: "1", user: "U1", text: "x" }] });
    const unpaired = { ...ctx, configured: false } as unknown as PlatformContext;
    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: unpaired });
    expect(out.skipped).toBe("not-configured");
    expect(calls).toEqual([]);
  });
});
