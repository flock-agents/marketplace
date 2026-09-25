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
  CONVERSATION_GAP_MS,
} = await import("../harvest");
const { _db, harvestRanToday } = await import("../store");

const ACCT = "team-1";

// SLACK TIMESTAMPS ARE REAL CLOCK TIMES. The fixtures used "100"/"200" — 1970 — which only ever
// worked because the lookback window was (wrongly) measured on `seen_at`, the moment this process
// happened to store the row. Now that `messagesSince` windows on the message's own `ts`, a fixture
// has to sit inside the window it claims to be in, exactly as a real message does.
const NOW = Math.floor(Date.now() / 1000);
/** A Slack ts `secondsAgo` in the past, in Slack's epoch-seconds-with-fraction form. */
const ago = (secondsAgo: number): string => `${NOW - secondsAgo}.000100`;

function wipe() {
  // Every table, including the ones the cost work added. Leaving `threads` behind leaked state
  // between tests: a thread registered by one test was re-polled by the next, which added
  // conversations_replies calls and doubled `fetched` in assertions about a single read.
  for (const t of ["messages", "cursors", "init_state", "harvest_days", "workspace", "user_names",
                   "threads", "ledger", "channel_engagement"]) {
    _db.exec(`DELETE FROM ${t}`);
  }
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
        // Identity lookups are not channel reads; recording them under the channel key would make
        // every call-sequence assertion in this file about plumbing instead of about harvesting.
        if (req.functionName === "checkTokenHealth") {
          return ok({ healthy: true, userId: "U-ME", user: "owner", team: "T", teamId: "T1", url: "https://acme.slack.com/" });
        }
        if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: `Name-${req.params.user}` } });
        // Names are resolved for the whole pass in ONE call now, not one per author — a serial
        // getUserInfo loop spent a lease and one of the account's 60 daily reads per person.
        if (req.functionName === "users_list") {
          const wanted = String(req.params?.users ?? "").split(",").filter(Boolean);
          return ok({ users: wanted.map((id) => ({ id, real_name: `Name-${id}` })), count: wanted.length, nextCursor: "" });
        }
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
      C1: [{ ts: ago(600), user: "U1", text: "ship friday" }, { ts: ago(590), thread_ts: ago(600), user: "U2", text: "agreed" }],
      C2: [{ ts: ago(300), user: "U3", text: "invoice is late" }],
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
    const first = fakePlatform({ C1: [{ ts: ago(600), user: "U1", text: "hi" }] });
    await harvestOnce(ACCT, cfg, { platform: first.ctx });
    expect(harvestRanToday(ACCT, dayKey(new Date()))).toBe(true);

    const second = fakePlatform({ C1: [{ ts: ago(500), user: "U1", text: "again" }] });
    const out = await harvestOnce(ACCT, cfg, { platform: second.ctx });
    expect(out.skipped).toBe("already-ran-today");
    expect(second.calls).toEqual([]);     // it did not even ask Slack
  });

  test("no channels chosen ⇒ it reads the OWNER'S OWN activity, not nothing and not everything", async () => {
    // Owner, 2026-09-23. "Read nothing" made a freshly installed app do nothing at all, silently.
    // The default is the part of Slack this person is actually in: DMs, mentions, their own
    // messages, saved — and then the channels those searches named.
    const calls: string[] = [];
    const ctx = {
      appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: {
        exec: async (req: any) => {
          calls.push(req.functionName);
          if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME", url: "https://acme.slack.com/" });
          if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: `Name-${req.params.user}` } });
          if (req.functionName === "users_list") return ok({ users: [], count: 0, nextCursor: "" });
          if (req.functionName === "conversations_unreads") return ok([{ ts: ago(400), channel: "D1", user: "U9", text: "dm to me" }]);
          if (req.functionName === "conversations_search_messages") {
            // Real search.messages replies are `{matches:[…]}`, not a bare array. Normalising
            // only arrays/`messages` dropped every match silently.
            return ok({ total: 1, matches: [{ ts: ago(300), channel: { id: "C7" }, user: "U8", text: "hey <@U-ME>" }] });
          }
          if (req.functionName === "conversations_history") return ok([{ ts: ago(250), channel: "C7", user: "U8", text: "more context" }]);
          return ok([{ ts: ago(200), channel: "C9", user: "U7", text: "saved for later" }]);
        },
      },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;

    const out = await harvestOnce(ACCT, readConfig({ channels: [] }), { platform: ctx });
    expect(out.scope).toBe("activity");
    expect(out.skipped).toBeUndefined();
    // "who am I" is answered by auth.test (checkTokenHealth), not by users.info with no argument —
    // the connector validates `user` and refused that call every time, so mentions never ran.
    expect(calls.filter((c) => c !== "getUserInfo" && c !== "users_list")).toEqual([
      "conversations_unreads",
      "checkTokenHealth",
      "conversations_search_messages",   // mentions: where the owner was tagged
      "conversations_search_messages",   // engaged: where the owner has been speaking
      "saved_list",
      "channels_list",                   // membership: the channels the owner is IN, read or not
      // …and then the CONVERSATIONS those reads named. Not just the search hits: the DM itself
      // is read too, because `conversations_unreads` returns only what is UNREAD — an ask the
      // owner already opened in Slack would otherwise never be seen at all — and the channel a
      // saved item lives in is read for the same reason.
      "conversations_history",           // D1, the DM
      "conversations_history",           // C7, where a search found a mention
      "conversations_history",           // C9, where the saved item lives
    ]);
    // ...and ONCE: the workspace's identity is cached in the store, so building the blocks after
    // the read does not ask again.
    expect(calls.filter((c) => c === "checkTokenHealth")).toHaveLength(1);
    // 4, not 5: the DM, the mention, the saved item and the discovered channel's own message.
    // Both searches surface the SAME C7 match here and the store dedupes it on (channel, ts) —
    // overlapping discovery sources must not double-count a message.
    expect(out.newMessages).toBe(4);
    // THE POINT OF THE DISCOVERY PASS: it read conversations nobody picked, because the owner is
    // demonstrably part of them — the DM, the channel a mention was found in, and the channel the
    // saved item lives in. Three, not one: reading the DM's own history is what makes an ask the
    // owner had already opened in Slack visible at all, since unreads returns only the unread.
    expect(out.channelsRead).toBe(3);
  });

  test("with no picker, the channels the OWNER speaks in are found and read in full", async () => {
    // Owner, 2026-09-24: "even without the slack channels selection, it should look at every
    // channel and see where the user has been engaging in the past or the user was tagged".
    // A mention search alone only finds where OTHERS pulled them in; a person's own messages are
    // the truer signal of which channels matter to them.
    const searches: any[] = [];
    const read: string[] = [];
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: {
        exec: async (req: any) => {
          if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME", url: "https://acme.slack.com/" });
          if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: "N" } });
          if (req.functionName === "conversations_unreads") return ok([]);
          if (req.functionName === "saved_list") return ok([]);
          if (req.functionName === "conversations_search_messages") {
            searches.push(req.params);
            const tagged = { ts: ago(300), channel: { id: "C-TAGGED" }, user: "U8", text: "<@U-ME> thoughts?" };
            const mine = { ts: ago(280), channel: { id: "C-MINE" }, user: "U-ME", text: "shipping friday" };
            return ok({ matches: [String(req.params.query).startsWith("from:") ? mine : tagged] });
          }
          read.push(req.params.channel);
          return ok([{ ts: ago(200), channel: req.params.channel, user: "U8", text: "context" }]);
        },
      },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;

    const out = await harvestOnce("acct-discovery", readConfig({ channels: [] }), { platform: ctx });

    // One search for mentions of the owner, one for messages FROM the owner.
    expect(searches).toHaveLength(2);
    expect(searches.some((p) => String(p.query) === "<@U-ME>")).toBe(true);          // mentions
    expect(searches.some((p) => String(p.query) === "from:<@U-ME>")).toBe(true);      // engaged

    // NEVER BOTH. `filter_users_from` is the connector's own way of writing from: — it
    // appends `from:<@UID>` to the query. Sending the filter alongside a query that already
    // says from: produced `from:<@U…> from:<@U…>`, two conjunctive filters that match nothing.
    expect(searches.every((p) => p.filter_users_from === undefined)).toBe(true);
    // Both look further back than the daily window — "which channels do you live in" is not a
    // question yesterday can answer.
    expect(searches.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.filter_date_after))).toBe(true);

    // BOTH channels get read, though neither was ever picked.
    expect(read.sort()).toEqual(["C-MINE", "C-TAGGED"]);
    expect(out.channelsRead).toBe(2);
    expect(out.blocks).toBeGreaterThan(0);
  });

  test("a picked channel list is an instruction — discovery does not widen it", async () => {
    // The flip side: someone who chose channels chose them. Discovery is what fills the vacuum
    // when nothing was chosen, never something that overrides an explicit answer.
    const read: string[] = [];
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: {
        exec: async (req: any) => {
          if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME" });
          if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: "N" } });
          if (req.functionName === "conversations_search_messages") throw new Error("must not search");
          read.push(req.params.channel);
          return ok([{ ts: ago(200), channel: req.params.channel, user: "U8", text: "hi" }]);
        },
      },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;

    const out = await harvestOnce("acct-picked", readConfig({ channels: ["C-PICKED"] }), { platform: ctx });
    expect(out.scope).toBe("channels");
    expect(read).toEqual(["C-PICKED"]);
  });

  test("a pass where every call was refused reports its errors rather than looking quiet", async () => {
    // This is what initialize needs to tell "nobody said anything" apart from "Slack refused me",
    // which are identical from the outside: both read zero messages.
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: { exec: async () => ({ ok: false, reason: "guard_busy" }) },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;

    const out = await harvestOnce("acct-refused", readConfig({ channels: ["C1", "C2"] }), { platform: ctx });
    expect(out.fetched).toBe(0);
    expect(out.errors).toBeGreaterThan(0);
  });

  test("DM unreads cover group DMs too — a four-person DM is where nobody needs to @-mention", async () => {
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
    expect(params?.channel_types).toBe("im,mpim");
  });

  test("one activity source failing costs that source, not the pass", async () => {
    const ctx = {
      appId: "slack-desk", pairedAgent: null, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: { exec: async (req: any) => {
        if (req.functionName === "conversations_unreads") return { ok: false as const, reason: "platform 429", status: 429 };
        if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME", url: "https://acme.slack.com/" });
        if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: `Name-${req.params.user}` } });
        return ok([{ ts: ago(200), channel: "C1", user: "U2", text: "still read" }]);
      } },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;
    const out = await harvestOnce(ACCT, readConfig({ channels: [] }), { platform: ctx });
    expect(out.newMessages).toBeGreaterThan(0);        // mentions + saved still landed
  });

  test("one refusing channel does not abort the run", async () => {
    const calls: string[] = [];
    const { ctx, blocks } = fakePlatform({ C2: [{ ts: ago(300), user: "U3", text: "kept" }] }, calls);
    // C1 is absent from the canned history, but exec still succeeds with []; simulate a refusal
    // by making it the one channel the platform rejects.
    const rejecting = {
      ...ctx,
      connectors: {
        exec: async (req: any) => {
          calls.push(req.params.channel);
          return req.params.channel === "C1"
            ? { ok: false as const, reason: "platform 429", status: 429 }
            : ok([{ ts: ago(300), user: "U3", text: "kept" }]);
        },
      },
    } as unknown as PlatformContext;

    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1", "C2"] }), { platform: rejecting });
    expect(calls).toEqual(["C1", "C2"]);   // it carried on
    expect(out.blocks).toBe(1);
    expect(blocks.length + 1).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // The three things a real workspace showed were wrong (owner, 2026-09-23).
  // ---------------------------------------------------------------------------

  test("the owner's own lines are marked `You`; everyone else keeps their own name", () => {
    const dir = {
      ownerId: "U-ME", ownerName: "owner", url: "https://acme.slack.com/",
      names: new Map([["U-THEM", "Priya"]]),
    };
    const block = toBlock([
      { channelId: "C1", ts: "1758000000.000100", author: "U-THEM", text: "Bug: the panel is too crowded" },
      { channelId: "C1", ts: "1758000060.000100", author: "U-ME", text: "noted, I'll look" },
    ], dir);

    // THE BUG THIS PINS: both lines used to read `U0C2S2W19EZ: …`, so extraction could not tell
    // the owner from a colleague and filed everyone's words as things the owner had said.
    expect(block.text).toBe("Priya: Bug: the panel is too crowded\nYou: noted, I'll look");
    expect(block.participants).toEqual(["Priya", "You"]);
  });

  test("an unresolvable author degrades to their id, never to the owner", () => {
    const dir = { ownerId: "U-ME", ownerName: "owner", url: null, names: new Map() };
    const block = toBlock([{ channelId: "C1", ts: "1758000000.000100", author: "U-NEW", text: "hi" }], dir);
    expect(block.text).toBe("U-NEW: hi");           // opaque, but honest
    expect(block.text).not.toContain("You");
  });

  test("addressing is computed, not guessed: mentioned ⇒ to, absent ⇒ not-addressed", () => {
    const dir = { ownerId: "U-ME", ownerName: "owner", url: null, names: new Map() };
    const mentioned = toBlock(
      [{ channelId: "C1", ts: "1758000000.000100", author: "U-THEM", text: "<@U-ME> can you take this?" }], dir,
    ) as any;
    expect(mentioned.context.addressing).toBe("to");

    const overheard = toBlock(
      [{ channelId: "C1", ts: "1758000000.000100", author: "U-THEM", text: "deploying now" }], dir,
    ) as any;
    expect(overheard.context.addressing).toBe("not-addressed");

    // The owner spoke but nobody asked them anything: no verdict rather than a wrong one.
    const spoke = toBlock(
      [{ channelId: "C1", ts: "1758000000.000100", author: "U-ME", text: "deploying now" }], dir,
    ) as any;
    expect((spoke.context as any)?.addressing).toBeUndefined();

    // With no owner id there is nothing to be addressed to — say nothing.
    const blind = toBlock(
      [{ channelId: "C1", ts: "1758000000.000100", author: "U-THEM", text: "<@U-ME> ping" }],
    ) as any;
    expect(blind.context).toBeUndefined();
  });

  test("the block carries a Slack permalink as `reference` — the field that becomes a task's deeplink", () => {
    const dir = { ownerId: "U-ME", ownerName: "o", url: "https://acme.slack.com/", names: new Map() };
    const block = toBlock([{ channelId: "C0C35UNKZ7V", ts: "1790083513.588829", author: "U1", text: "x" }], dir);
    // `context.permalink` — where this used to go — is dropped by /api/memory/extract. `reference`
    // is what reaches wiki_entry_sources.external_link and tasks.deeplink.
    expect(block.reference).toBe("https://acme.slack.com/archives/C0C35UNKZ7V/p1790083513588829");
    // An older connector returns no workspace url: no link is better than a wrong one.
    expect(toBlock([{ channelId: "C1", ts: "1790083513.588829", author: "U1", text: "x" }],
      { ...dir, url: null }).reference).toBeUndefined();
  });

  test("a thread's reply anchors the whole block on the PARENT's permalink and time", () => {
    const dir = { ownerId: "U-ME", ownerName: "o", url: "https://acme.slack.com/", names: new Map() };
    const block = toBlock([
      { channelId: "C1", ts: "1790000000.000100", threadTs: "1790000000.000100", author: "U1", text: "parent" },
      { channelId: "C1", ts: "1790000900.000100", threadTs: "1790000000.000100", author: "U2", text: "reply" },
    ], dir);
    expect(block.id).toBe("C1:1790000000.000100");
    expect(block.reference).toContain("p1790000000000100");
  });

  test("unthreaded messages in one channel become ONE conversation when they are close in time", () => {
    // THE BUG THIS PINS: a channel where nobody uses threads produced one block per message, so
    // "Are you fixing these bugs? Or do you want me to fix it?" and its answer arrived as two
    // unrelated fragments and nothing was ever surfaced to act on.
    const base = 1790000000;
    const groups = groupByThread([
      { channelId: "C1", ts: `${base}.000100`, author: "U1", text: "a" },
      { channelId: "C1", ts: `${base + 120}.000100`, author: "U2", text: "b" },
      { channelId: "C1", ts: `${base + 300}.000100`, author: "U1", text: "c" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  test("a long silence starts a new conversation, and channels never merge", () => {
    const base = 1790000000;
    const far = base + Math.floor(CONVERSATION_GAP_MS / 1000) + 60;
    const groups = groupByThread([
      { channelId: "C1", ts: `${base}.000100`, author: "U1", text: "morning" },
      { channelId: "C1", ts: `${far}.000100`, author: "U1", text: "afternoon" },
      { channelId: "C2", ts: `${base + 60}.000100`, author: "U1", text: "elsewhere" },
    ]);
    expect(groups).toHaveLength(3);
  });

  test("a thread parent does not drift into a neighbouring run", () => {
    const base = 1790000000;
    const groups = groupByThread([
      { channelId: "C1", ts: `${base}.000100`, author: "U1", text: "parent" },
      { channelId: "C1", ts: `${base + 60}.000100`, threadTs: `${base}.000100`, author: "U2", text: "reply" },
      { channelId: "C1", ts: `${base + 120}.000100`, author: "U3", text: "separate chatter" },
    ]);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes).toEqual([1, 2]);                       // the thread, and the loose message
    const thread = groups.find((g) => g.length === 2)!;
    expect(thread.map((m) => m.text)).toEqual(["parent", "reply"]);   // parent first
  });

  test("the lookback window is measured on the message's time, not on when we stored it", async () => {
    const { ctx } = fakePlatform({
      C1: [
        { ts: ago(3600), user: "U1", text: "an hour ago" },
        { ts: ago(60 * 60 * 30), user: "U1", text: "thirty hours ago" },
      ],
    });
    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1"], lookbackHours: 24 }), { platform: ctx });
    expect(out.fetched).toBe(2);        // both were read...
    expect(out.blocks).toBe(1);         // ...only the one inside 24h was extracted
  });

  test("an UNPAIRED app does nothing at all", async () => {
    const { ctx, calls } = fakePlatform({ C1: [{ ts: ago(60), user: "U1", text: "x" }] });
    const unpaired = { ...ctx, configured: false } as unknown as PlatformContext;
    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: unpaired });
    expect(out.skipped).toBe("not-configured");
    expect(calls).toEqual([]);
  });
});

// DAY ONE HAS A BACKLOG; A DAILY PASS DOES NOT.
//
// initialize used the steady-state recipe verbatim — readConfig(undefined), a 24-hour window.
// That is right for a routine that ran yesterday and useless on the day you install: a workspace
// whose last real conversation was two days ago produced an agent with no memory at all, which
// reads as "it didn't work" rather than "there was nothing in the last 24 hours".
describe("the first harvest reaches further back than a daily one", () => {
  test("a message from three days ago is eligible on the first pass, not on a daily one", async () => {
    const threeDaysAgo = `${NOW - 3 * 24 * 3600}.000100`;
    const { ctx } = fakePlatform({ C1: [{ ts: threeDaysAgo, user: "U1", text: "the thing from Monday" }] });

    // Daily recipe: outside the 24h window, so nothing is extracted.
    const daily = await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: ctx });
    expect(daily.fetched).toBe(1);
    expect(daily.blocks).toBe(0);

    // First-run recipe: the same message is in range.
    wipe();
    const { ctx: ctx2 } = fakePlatform({ C1: [{ ts: threeDaysAgo, user: "U1", text: "the thing from Monday" }] });
    const first = await harvestOnce(
      ACCT, { ...readConfig({ channels: ["C1"] }), lookbackHours: 14 * 24 }, { platform: ctx2 },
    );
    expect(first.blocks).toBe(1);
  });
});
