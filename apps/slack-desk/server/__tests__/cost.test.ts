// The cost work: triage, the ledger, the budget, and the two sources that never parsed.
//
// Everything here is about spending less without remembering less, so each test names the failure
// it prevents rather than the function it calls. The pure decisions run without a platform; the
// rest goes through the real self-fetch path with a fake PlatformContext, as in harvest.test.ts.

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";

process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "slack-desk-cost-"));

const {
  readConfig, dayKey, harvestOnce, normalizeHistory, attentionOf, tierOf, isWorthRemembering,
  splitOversized, blockHash, toBlock, MAX_MESSAGES_PER_BLOCK,
} = await import("../harvest");
const {
  _db, harvestRanToday, upsertMessages, messagesSince, threadMessages,
  getLedger, writeLedger, upsertThread, threadsToPoll, isThreadAttended, callsSpentToday,
} = await import("../store");

const ACCT = "cost-acct";
const NOW = Math.floor(Date.now() / 1000);
const ago = (s: number): string => `${NOW - s}.000100`;

function wipe() {
  for (const t of ["messages", "cursors", "init_state", "harvest_days", "workspace",
                   "user_names", "threads", "ledger", "channel_engagement"]) {
    _db.exec(`DELETE FROM ${t}`);
  }
}
beforeEach(wipe);

/** A platform whose connector answers per FUNCTION, so the activity sources can be shaped. */
function platform(
  answers: Record<string, unknown>,
  opts: { onExtract?: (items: any[]) => { ok: boolean; data?: unknown; reason?: string } } = {},
): { ctx: PlatformContext; sent: any[][]; calls: string[] } {
  const sent: any[][] = [];
  const calls: string[] = [];
  const ctx = {
    appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined as void) },
    tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
    connectors: {
      exec: async (req: any) => {
        if (req.functionName === "checkTokenHealth") {
          return ok({ healthy: true, userId: "U-ME", user: "yogesh", url: "https://acme.slack.com/" });
        }
        if (req.functionName === "getUserInfo") return ok({ user: { id: req.params.user, real_name: `Name-${req.params.user}` } });
        calls.push(req.functionName);
        const key = req.params?.channel ? `${req.functionName}:${req.params.channel}` : req.functionName;
        if (key in answers) return ok(answers[key]);
        if (req.functionName in answers) return ok(answers[req.functionName]);
        return ok([]);
      },
    },
    memory: {
      extract: async (items: any[]) => {
        sent.push(items);
        const r = opts.onExtract?.(items);
        if (r && !r.ok) return { ok: false as const, reason: r.reason ?? "boom" };
        return ok((r?.data ?? undefined) as unknown);
      },
    },
  } as unknown as PlatformContext;
  return { ctx, sent, calls };
}

// ---------------------------------------------------------------------------
describe("the two sources that parsed to nothing", () => {
  test("conversations_unreads: messages nested under channels[] are read, and are DMs", () => {
    // The envelope is {channel_types, unread_channels, channels:[{…, messages:[…]}]}. The old
    // normaliser accepted only a bare array, `messages` or `matches` — so the DM source returned
    // ZERO rows on every run, and an unanswered DM, the most addressed-to-you object in Slack,
    // was never read at all.
    const raw = {
      channel_types: "im,mpim",
      unread_channels: 2,
      channels: [
        { id: "D1", is_im: true, messages: [{ ts: ago(100), user: "U9", text: "can you look?" }] },
        { id: "G7", is_mpim: true, messages: [{ ts: ago(90), user: "U8", text: "group ask" }] },
      ],
    };
    const rows = normalizeHistory("im", raw, "dms");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channelId).sort()).toEqual(["D1", "G7"]);
    expect(rows.every((r) => r.source === "dms")).toBe(true);
    // A group DM is a DM. The old D-prefix test matched neither G7 nor an mpim id, so the whole
    // class — where a colleague asks and nobody @-mentions anyone — scored zero signals.
    const att = attentionOf(rows, { ownerId: "U-ME", ownerName: "yogesh" });
    expect(att.signals).toContain("dm");
  });

  test("saved_list: items[] with message_ts are read, not dropped for having no `ts`", () => {
    // Dead twice over: wrong envelope AND its rows carry `message_ts`, so even reading `items`
    // the `if (!ts) continue` guard would have dropped every one.
    const raw = { filter: "saved", total: 1, counts: {}, items: [
      { message_ts: ago(50), channel_id: "C5", user: "U2", text: "remember this" },
    ] };
    const rows = normalizeHistory("saved", raw, "saved");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ts).toBe(ago(50));
    expect(rows[0]!.channelId).toBe("C5");
    expect(attentionOf(rows, { ownerId: "U-ME", ownerName: "y" }).signals).toContain("saved");
  });

  test("a search hit's author is read from `username`, which used to match nothing", () => {
    const rows = normalizeHistory("mention", { matches: [
      { ts: ago(30), channel: { id: "C1" }, username: "alice", text: "hi" },
    ] }, "mentions");
    expect(rows[0]!.author).toBe("alice");
  });
});

// ---------------------------------------------------------------------------
describe("triage decides, and shadow mode proves it before it acts", () => {
  const dir = { ownerId: "U-ME", ownerName: "yogesh", groupIds: new Set(["S1"]) };
  const m = (o: any) => ({ channelId: "C1", ts: ago(100), ...o });

  test("a discovered channel the owner is absent from is skipped; a picked one is not", () => {
    const overheard = attentionOf([m({ author: "U2", text: "lunch?" })], dir);
    expect(tierOf(overheard, { channelWasPicked: false })).toBe("skip");
    // A picked channel is the owner saying "watch this", so it keeps TASKS — the first draft had
    // this inverted and stripped task detection from exactly the channels they had chosen.
    expect(tierOf(overheard, { channelWasPicked: true })).toBe("full");
  });

  test("@here / @channel earns FULL — it is addressed at the reader, and it is rare", () => {
    // Filed with active-channel as "not an ask" in an earlier cut. Wrong: that reasoning is about
    // a conversation nobody aimed at anyone, and @channel is aimed at the reader — Slack itself
    // decided to interrupt them. "Please fill this in by Friday" is a task. Measured rare on real
    // traffic (0 of 76 messages), so the volume cost of being generous here is close to nothing.
    for (const t of ["<!here> can someone fill the form by Friday", "<!channel> deploy freeze today"]) {
      const att = attentionOf([m({ author: "U2", text: t })], dir);
      expect(att.signals).toContain("broadcast");
      expect(tierOf(att, { channelWasPicked: false })).toBe("full");
    }
  });

  test("an unaddressed BOT broadcast is still dropped — alert channels are not asks", () => {
    // The generosity above is for humans. A bot @channel post does not name the owner, so it fails
    // the bot filter before any of this — which is what keeps a noisy alert channel out.
    const cfg = { channels: [], ignoreBots: true, lookbackHours: 24, triageMode: "enforce", maxBlocks: 40, firstRun: false } as any;
    expect(isWorthRemembering(
      { channelId: "C1", ts: ago(10), botId: "B1", text: "<!channel> build #42 failed" } as any, cfg, dir,
    )).toBe(false);
  });

  test("a first run does NOT widen the tier — the window is the whole adaptation", async () => {
    // An earlier cut made a first pass treat every channel as picked, so nothing could ever be
    // skipped on it: widest window times widest tier, exactly once, on the pass the owner is
    // watching. The rule is now identical on every pass; `lifecycle.ts` narrows the WINDOW instead
    // (48h, widening only when a pass finds nothing) and never the rule.
    const quiet = attentionOf([m({ author: "U2", text: "shipping friday" })], dir);
    expect(tierOf(quiet, { channelWasPicked: false })).toBe("skip");
    // No `firstRun` option exists to override it any more.
    expect(tierOf(quiet, { channelWasPicked: true })).toBe("full");
  });

  test("a channel the owner is historically very active in earns FACTS, not silence and not tasks", () => {
    // The third thing "engaged" means, and the one the app computed and never read: the owner may
    // not be named in this conversation, but they live in this channel, so a decision here is worth
    // remembering. Not tasks: no ask was directed at anyone, and a task minted here would belong to
    // somebody else.
    const att = attentionOf([m({ author: "U2", text: "we are moving the window to 02:00" })], dir,
      { activeChannel: true });
    expect(att.signals).toContain("active-channel");
    expect(tierOf(att, { channelWasPicked: false })).toBe("facts");
  });

  test("interaction must be RECENT — speaking once a year ago is history, not engagement", () => {
    const longAgo = attentionOf(
      [m({ author: "U-ME", ts: ago(40 * 86_400), text: "spoke here once" })], dir);
    expect(longAgo.signals).not.toContain("owner-spoke");
    expect(tierOf(longAgo, { channelWasPicked: false })).toBe("skip");
    const recent = attentionOf([m({ author: "U-ME", text: "spoke here today" })], dir);
    expect(recent.signals).toContain("owner-spoke");
  });

  test("shadow mode extracts what it would have skipped, and enforce does not", async () => {
    // A DISCOVERED channel (not picked) holding two conversations far enough apart to be separate
    // groups: one the owner spoke in, one they did not. Only the second is a skip.
    const answers = {
      // `from:me` discovers C1 — the owner demonstrably talks there.
      conversations_search_messages: { matches: [
        { ts: ago(70_000), channel: { id: "C1" }, user: "U-ME", text: "my own message" },
      ] },
      "conversations_history:C1": [
        { ts: ago(70_000), user: "U-ME", text: "my own message" },     // owner-spoke ⇒ full
        { ts: ago(200), user: "U2", text: "someone else's chatter" },  // no signal ⇒ skip
      ],
    };

    const shadow = platform(answers);
    await harvestOnce(ACCT, { ...readConfig({ channels: [] }), triageMode: "shadow" } as any,
      { platform: shadow.ctx });
    const shadowIds = shadow.sent.flat().map((b: any) => b.id).sort();

    wipe();
    const enforce = platform(answers);
    await harvestOnce(ACCT, { ...readConfig({ channels: [] }), triageMode: "enforce" } as any,
      { platform: enforce.ctx });
    const enforceIds = enforce.sent.flat().map((b: any) => b.id).sort();

    // Same input, same verdict, different spend. That asymmetry is the whole reason shadow exists:
    // a week of it says what enforcing WOULD have cost in memory, at no risk to any of it.
    // Both conversations survive here, but NOT at the same price: C1 is in the active set (the
    // owner talks there), so the conversation they are absent from drops to facts-only rather than
    // being skipped. Shadow extracts everything at full price; enforce prices by engagement.
    expect(shadowIds.length).toBe(2);
    const enforced = enforce.sent.flat() as any[];
    const own = enforced.find((b) => b.id === "C1:" + ago(70_000));
    const other = enforced.find((b) => b.id !== "C1:" + ago(70_000));
    expect(own?.hints?.extractTasks).toBeUndefined();   // full: tasks on
    expect(other?.hints?.extractTasks).toBe(false);     // facts only
    // In shadow, nothing is priced down — that is what makes it the expensive diagnostic.
    expect((shadow.sent.flat() as any[]).every((b) => b.hints?.extractTasks === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("attention is sticky, and scored over the thread rather than the window", () => {
  test("Monday's question and Tuesday's answers are one conversation", () => {
    // The shape that breaks a window-scored triage: the owner asks at 17:00 Monday, the answers
    // land at 10:00 Tuesday. Tuesday's slice alone has no owner message and no re-tag, so every
    // signal reads false and the answer to their OWN question would be skipped.
    upsertMessages(ACCT, [
      { channelId: "C1", ts: ago(100_000), author: "U-ME", text: "can someone confirm the window?" },
      { channelId: "C1", ts: ago(100), threadTs: ago(100_000), author: "U2", text: "confirmed, 02:00" },
    ]);
    const windowOnly = messagesSince(ACCT, (NOW - 3_600) * 1000);
    expect(windowOnly).toHaveLength(1);
    expect(attentionOf(windowOnly, { ownerId: "U-ME", ownerName: "y" }).signals).toEqual([]);

    const whole = threadMessages(ACCT, "C1", ago(100_000));
    expect(whole).toHaveLength(2);
    expect(attentionOf(whole, { ownerId: "U-ME", ownerName: "y" }).signals).toContain("owner-spoke");
  });

  test("once attended, always attended — going quiet for a day does not forfeit a thread", () => {
    upsertThread(ACCT, "C1", "111.1", { attended: true });
    upsertThread(ACCT, "C1", "111.1", { attended: false });   // a later, signal-free pass
    expect(isThreadAttended(ACCT, "C1", "111.1")).toBe(true);
    const att = attentionOf([{ channelId: "C1", ts: ago(10), author: "U2", text: "ok" }],
      { ownerId: "U-ME", ownerName: "y" }, { attended: true });
    expect(att.signals).toContain("attended");
    expect(tierOf(att, { channelWasPicked: false })).toBe("full");
  });
});

// ---------------------------------------------------------------------------
describe("the ledger: pay once, and never resurrect a finished task", () => {
  test("an unchanged conversation costs nothing on the next pass", async () => {
    const hist = { "conversations_history:C1": [{ ts: ago(300), user: "U-ME", text: "mine" }] };
    const first = platform(hist);
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: first.ctx });
    expect(first.sent.flat()).toHaveLength(1);
    const led = getLedger(ACCT, "C1:" + ago(300));
    expect(led?.textHash).toBeTruthy();

    // A second pass on the same day is refused by the day guard, so clear only that.
    _db.exec("DELETE FROM harvest_days");
    const second = platform(hist);
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: second.ctx });
    // Same newest ts, same rendered text ⇒ nothing to learn, nothing to pay.
    expect(second.sent.flat()).toHaveLength(0);
  });

  test("a new reply changes the hash, so the conversation is re-read", async () => {
    const hist = { "conversations_history:C1": [{ ts: ago(300), user: "U-ME", text: "mine" }] };
    const first = platform(hist);
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: first.ctx });
    expect(first.sent.flat()).toHaveLength(1);

    _db.exec("DELETE FROM harvest_days");
    upsertMessages(ACCT, [{ channelId: "C1", ts: ago(200), threadTs: ago(300), author: "U2", text: "answered" }]);
    const second = platform({ "conversations_history:C1": [] });
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: second.ctx });
    expect(second.sent.flat()).toHaveLength(1);
  });

  test("an EDIT reaches the store, so it cannot hide behind an unchanged hash", () => {
    const base = { channelId: "C1", ts: ago(100), author: "U2", text: "let's ship Thursday" };
    upsertMessages(ACCT, [base]);
    const before = blockHash(messagesSince(ACCT, 0).map((x) => x.text).join("\n"));
    // Slack surfaces an edit as the SAME ts with new text. Under ON CONFLICT DO NOTHING the row
    // never changed, so the wiki kept the wrong date forever and no hash could ever notice.
    upsertMessages(ACCT, [{ ...base, text: "moving to Tuesday", editedTs: ago(50) }]);
    const rows = messagesSince(ACCT, 0);
    expect(rows[0]!.text).toBe("moving to Tuesday");
    expect(blockHash(rows.map((x) => x.text).join("\n"))).not.toBe(before);
  });

  test("an unedited re-read does NOT rewrite the row, or every hash would churn", () => {
    const base = { channelId: "C1", ts: ago(100), author: "U2", text: "original" };
    upsertMessages(ACCT, [base]);
    upsertMessages(ACCT, [{ ...base, text: "somehow different but not flagged as edited" }]);
    expect(messagesSince(ACCT, 0)[0]!.text).toBe("original");
  });

  test("a thread whose task went terminal is re-read for FACTS only, never for tasks again", async () => {
    const { markTasksTerminal } = await import("../store");
    const id = "C1:" + ago(300);
    markTasksTerminal(ACCT, id);
    const hist = { "conversations_history:C1": [{ ts: ago(300), user: "U-ME", text: "yogesh please review" }] };
    const p = platform(hist);
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: p.ctx });
    const item = p.sent.flat()[0] as any;
    // The platform's task dedup index is PARTIAL — it excludes done/dismissed — so a plain
    // re-read would mint the completed task a second time.
    expect(item.hints?.extractTasks).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the budget bounds a pass, and an unfinished pass stays resumable", () => {
  test("over the cap, the surplus is deferred and the day is NOT claimed", async () => {
    // Twelve separate conversations, far apart so each is its own group.
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      ts: ago(100_000 - i * 5_000), user: "U-ME", text: `conversation ${i}`,
    }));
    const p = platform({ "conversations_history:C1": msgs });
    const out = await harvestOnce(
      ACCT, { ...readConfig({ channels: ["C1"] }), maxBlocks: 4 } as any, { platform: p.ctx });

    expect(out.blocks).toBe(4);
    expect(out.stopReason).toBe("block-budget");
    // THE POINT: a cap with no resumption is just truncation. The day must stay claimable or the
    // surplus is lost rather than deferred — which is how a first landing came to be mostly unread.
    expect(harvestRanToday(ACCT, dayKey(new Date()))).toBe(false);
    // …and the reads it spent are still recorded, so the resuming pass does not start over.
    expect(callsSpentToday(ACCT, dayKey(new Date()))).toBeGreaterThan(0);
  });

  test("a deferred block ages into priority instead of losing the same lottery forever", async () => {
    const { bumpDeferred, deferredCount } = await import("../store");
    bumpDeferred(ACCT, "C1:aged");
    bumpDeferred(ACCT, "C1:aged");
    expect(deferredCount(ACCT, "C1:aged")).toBe(2);
    expect(deferredCount(ACCT, "C1:fresh")).toBe(0);
  });

  test("a failed extraction records nothing in the ledger and does not claim the day", async () => {
    const p = platform(
      { "conversations_history:C1": [{ ts: ago(300), user: "U-ME", text: "mine" }] },
      { onExtract: () => ({ ok: false, reason: "platform 500" }) },
    );
    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: p.ctx });
    expect(out.stopReason).toBe("extract-failed");
    expect(getLedger(ACCT, "C1:" + ago(300))).toBeNull();
    expect(harvestRanToday(ACCT, dayKey(new Date()))).toBe(false);
  });

  test("a batch reporting failedItems records NONE of it — counts cannot attribute a failure", async () => {
    const p = platform(
      { "conversations_history:C1": [{ ts: ago(300), user: "U-ME", text: "mine" }] },
      { onExtract: () => ({ ok: true, data: { processedItems: 0, failedItems: 1 } }) },
    );
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: p.ctx });
    // The route reports counts with no per-item ids, so "some of this failed" is all we know.
    // Recording the batch anyway would be permanent silent loss.
    expect(getLedger(ACCT, "C1:" + ago(300))).toBeNull();
  });

  test("guard exhaustion aborts the pass and leaves the day owed", async () => {
    const ctx = {
      appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: { exec: async () => ({ ok: false as const, reason: "guard_busy" }) },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;
    const out = await harvestOnce(ACCT, readConfig({ channels: ["C1", "C2", "C3"] }), { platform: ctx });
    expect(out.stopReason).toBe("reads-exhausted");
    expect(harvestRanToday(ACCT, dayKey(new Date()))).toBe(false);
  });

  test("ONE refusing channel is still not the whole run", async () => {
    // Deliberately unchanged behaviour: guard_busy means the lease is held and everything after
    // will fail too, but a single channel's refusal must not cost the others.
    const calls: string[] = [];
    const ctx = {
      appId: "slack-desk", pairedAgent: { id: "a", name: "A" }, dataDir: ".", configured: true,
      progress: { report: async () => ok(undefined as void) },
      tasks: { publish: async () => ok(undefined as void), withdraw: async () => ok(undefined as void) },
      connectors: {
        exec: async (req: any) => {
          if (req.functionName === "checkTokenHealth") return ok({ healthy: true, userId: "U-ME" });
          calls.push(req.params?.channel ?? req.functionName);
          return req.params?.channel === "C1"
            ? { ok: false as const, reason: "ratelimited 429" }
            : ok([{ ts: ago(300), user: "U-ME", text: "kept" }]);
        },
      },
      memory: { extract: async () => ok(undefined as unknown) },
    } as unknown as PlatformContext;
    await harvestOnce(ACCT, readConfig({ channels: ["C1", "C2"] }), { platform: ctx });
    expect(calls).toContain("C2");
  });
});

// ---------------------------------------------------------------------------
describe("replies are re-fetched for threads the channel cursor will never return", () => {
  test("a thread behind the cursor is re-polled, which is the only way new replies arrive", async () => {
    // `history(oldest=cursor)` returns PARENTS only and a reply never bumps its parent's ts, so a
    // thread read on Monday that gains replies on Tuesday is invisible to history forever. The
    // thread set is walked instead of the cursor.
    upsertThread(ACCT, "C1", ago(50_000), { replyCount: 3 });
    const due = threadsToPoll(ACCT, (NOW - 86_400 * 14) * 1000, 0, 10);
    expect(due.map((t) => t.threadTs)).toEqual([ago(50_000)]);

    const p = platform({
      "conversations_history:C1": [],
      "conversations_replies:C1": [{ ts: ago(40_000), thread_ts: ago(50_000), user: "U2", text: "late answer" }],
    });
    await harvestOnce(ACCT, readConfig({ channels: ["C1"] }), { platform: p.ctx });
    expect(p.calls).toContain("conversations_replies");
    expect(messagesSince(ACCT, 0).some((m) => m.text === "late answer")).toBe(true);
  });

  test("a thread polled recently is not polled again in the same window", () => {
    upsertThread(ACCT, "C1", ago(50_000), { replyCount: 3, polled: true });
    expect(threadsToPoll(ACCT, (NOW - 86_400 * 14) * 1000, 20 * 3600_000, 10)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("blocks carry what the platform actually reads", () => {
  test("messages[] and ownerAddresses are populated, so the task gate can run at all", () => {
    const dir = { ownerId: "U-ME", ownerName: "yogesh", url: null, names: new Map([["U2", "Alice"]]) } as any;
    const b = toBlock([
      { channelId: "C1", ts: ago(100), author: "U2", text: "yogesh can you review?" },
      { channelId: "C1", ts: ago(90), threadTs: ago(100), author: "U-ME", text: "yes" },
    ] as any, dir);
    // `task-gates.ts` guards on `block.source.messages`; an absent array skips the gate entirely,
    // which is why every Slack task used to pass ungated.
    expect(b.messages).toHaveLength(2);
    expect(b.messages![0]).toEqual({ index: 0, from: "Alice", text: "yogesh can you review?" });
    expect((b.context as any).ownerAddresses).toContain("You");
  });

  test("an oversized run is split at a boundary, not truncated — the decision is usually last", () => {
    const long = Array.from({ length: MAX_MESSAGES_PER_BLOCK * 2 + 5 }, (_, i) => ({
      channelId: "C1", ts: ago(1000 - i), author: "U2", text: "x".repeat(20),
    }));
    const parts = splitOversized(long as any);
    expect(parts.length).toBeGreaterThan(1);
    // Nothing is lost: every message ends up in exactly one part.
    expect(parts.reduce((n, p) => n + p.length, 0)).toBe(long.length);
  });
});

// ---------------------------------------------------------------------------
describe("bot content: the filter was excluding the one class that is reliably an ask", () => {
  const cfg = { channels: [], ignoreBots: true, lookbackHours: 24, triageMode: "shadow", maxBlocks: 40, firstRun: false } as any;
  const dir = { ownerId: "U-ME", ownerName: "yogesh", groupIds: new Set<string>() };

  test("an addressed bot message is kept — GitHub, Jira and PagerDuty asks were invisible", () => {
    // A bot post carries bot_id and NO user, so `author` was empty and the message died at
    // `if (!m.author)` before the B-prefix test was ever reached. The set that test was written
    // for is essentially empty; what it actually excluded was every review request.
    expect(isWorthRemembering(
      { channelId: "C1", ts: ago(10), botId: "B1", text: "review requested from yogesh" } as any, cfg, dir,
    )).toBe(true);
  });

  test("unaddressed bot chatter is still dropped", () => {
    expect(isWorthRemembering(
      { channelId: "C1", ts: ago(10), botId: "B1", text: "build #42 passed" } as any, cfg, dir,
    )).toBe(false);
  });

  test("a join notice is not the owner speaking", () => {
    // Carries user:<joiner> and "<@U…> has joined", so merely being ADDED to a channel used to
    // read as the owner speaking there and bought a full extraction with tasks.
    expect(isWorthRemembering(
      { channelId: "C1", ts: ago(10), author: "U-ME", text: "<@U-ME> has joined the channel", subtype: "channel_join" } as any,
      cfg, dir,
    )).toBe(false);
  });

  test("file_share and thread_broadcast are kept — the document often IS the memory", () => {
    for (const subtype of ["file_share", "thread_broadcast"]) {
      expect(isWorthRemembering(
        { channelId: "C1", ts: ago(10), author: "U2", text: "here is the spec", subtype } as any, cfg, dir,
      )).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE DEFERRAL THAT WOULD HAVE BEEN A LOSS.
//
// Found on a real first run, not in review: the pass deferred 12 conversations from a 14-day
// backfill, and the NEXT pass builds candidates from `messagesSince(now - 24h)`. Eleven of the
// twelve sat outside that window, so `deferred_count` was counting debts that could never be
// paid — a cap behaving as silent truncation, which is the exact failure the cap exists to avoid.
describe("a deferred conversation comes back even when the window moved past it", () => {
  test("the window widens to cover what is owed, and the ledger keeps it cheap", async () => {
    const { oldestDeferredTs, bumpDeferred } = await import("../store");

    // A conversation from six days ago — well outside a 24-hour lookback.
    const oldTs = ago(6 * 86_400);
    upsertMessages(ACCT, [{ channelId: "C1", ts: oldTs, author: "U-ME", text: "my old thread" }]);
    bumpDeferred(ACCT, `C1:${oldTs}`);

    // The store can say how far back the pass must reach.
    const owed = oldestDeferredTs(ACCT);
    expect(owed).not.toBeNull();
    expect(owed! * 1000).toBeLessThan(Date.now() - 24 * 3600_000);

    // A DAILY pass (24h lookback, not a first run) must still extract it.
    const p = platform({ "conversations_history:C1": [] });
    await harvestOnce(ACCT, { ...readConfig({ channels: ["C1"] }), lookbackHours: 24 } as any,
      { platform: p.ctx });
    const ids = p.sent.flat().map((b: any) => b.id);
    expect(ids).toContain(`C1:${oldTs}`);
  });

  test("nothing owed leaves the window exactly where the config put it", async () => {
    const { oldestDeferredTs } = await import("../store");
    expect(oldestDeferredTs(ACCT)).toBeNull();
    // A conversation older than the lookback and NOT deferred stays out — widening is for debts,
    // not a back door that re-reads history every pass.
    upsertMessages(ACCT, [{ channelId: "C2", ts: ago(6 * 86_400), author: "U-ME", text: "old, not owed" }]);
    const p = platform({ "conversations_history:C2": [] });
    await harvestOnce(ACCT, { ...readConfig({ channels: ["C2"] }), lookbackHours: 24 } as any,
      { platform: p.ctx });
    expect(p.sent.flat()).toHaveLength(0);
  });
});
