// Voice in the app (Task 2.9). Expectations from the brief, the Op contract (create_draft VOICE_LEARNING "error names the
// time"; reply_context voice / voiceState), spec §2.6, §5.2 ("voice still learning, try after <time>"), Review Focus 5
// (never blocks forever) and the source (voice-crawl.ts, voice-store.ts, wiki-ops.ts owner-edit, voice-page.ts):
//   - the crawl reads sent mail under the mailbox's read turn (consumer email-desk:voice), every read carrying the turn's id,
//     releases the turn, makes ONE Balanced model call, and stores the rows under that mailbox only;
//   - a row the person wrote survives a re-learn; a forgotten row is not learned back; restoring lets it be learned again;
//   - while a crawl is in flight, create_draft answers VOICE_LEARNING naming a time (words and ISO) and writes nothing;
//   - past the crawl's cap, create_draft drafts without voice;
//   - reply_context carries the voice block (ready), or null while learning / none;
//   - the routine's wake carries the voice block; a mailbox with no voice starts its crawl from the routine;
//   - the settings routes answer the person only, and their edits are written as theirs.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { appendEvents, normalizeInboxRow, setEventBody, GMAIL_SOURCE } from "../journal";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { ops, _setOpsLogForTesting } from "../ops";
import { _setLogForTesting as _setCardLogForTesting } from "../drafts/card";
import { allOps } from "../registry";
import {
  runVoiceCrawl, beginVoiceCrawl, ensureVoiceCrawl, voiceStateFor, voiceCrawlProgress, VOICE_PENDING_CAP_MS, VOICE_CONSUMER,
  RECRAWL_AFTER_MS, _setVoiceCrawlSeamsForTesting, _resetVoiceCrawlsForTesting,
} from "../voice/crawl";
import { editVoiceRow, forgetVoiceRow, restoreVoiceRow, voiceRows, OWNER_SOURCE, CRAWL_SOURCE } from "../voice/store";
import { buildVoiceBlock, VOICE_HEADING } from "../voice/block";
import { runMemoryExtraction, _setLogForTesting as _setRoutineLogForTesting } from "../routines/memory-extraction";
import { voiceRoutes } from "../routes/voice";
import type { GatherResult, KeptMail } from "../routines/gather";

const A1 = "acct-1";
const A2 = "acct-2";
const ME: Record<string, string> = { [A1]: "me@acme.com", [A2]: "me@home.example" };
const THREAD = "thread-1";

// Sent mail the person wrote: long enough to be a sample, and holding the lines the fake model quotes.
const sentBody = (i: number, signOff = "Thanks, Shiva") =>
  `Hi Sam,\n\nCould you send the numbers when you get a chance? We are closing the quarter this week and I want the ` +
  `figures in before Thursday so the board pack goes out on time. Flagging that this is now blocking the launch review. ` +
  `Thanks for the note, will come back to you on this shortly once finance has signed off on everything (${i}).\n\n${signOff}`;

const PROFILE = {
  greeting: "Hi Sam,",
  signOff: "Thanks, Shiva",
  commonPhrases: ["when you get a chance"],
  voiceExamples: {
    request: "Could you send the numbers when you get a chance?",
    escalate: "Flagging that this is now blocking the launch review.",
  },
};

interface Fake {
  platform: any;
  turns: Array<{ account: string | undefined; consumer: string; opts: any }>;
  released: number;
  reads: Array<{ functionName: string; turnId?: string; account?: string }>;
  writes: string[];
  models: any[];
  published: any[];
  /** When set, the crawl's page read (getThreads) waits on this until it resolves. */
  hold: Promise<void> | null;
  turnRefusal: { reason: string; code: string } | null;
  profile: unknown;
}

function fake(): Fake {
  const f: Fake = { platform: null, turns: [], released: 0, reads: [], writes: [], models: [], published: [], hold: null, turnRefusal: null, profile: PROFILE };
  let n = 0;
  f.platform = {
    appId: "email-desk", pairedAgent: { id: "butler-1", name: "Butler" }, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [A1, A2].map((a) => ({ accountId: a, email: ME[a], label: null })) } }),
      readTurn: async (account: string | undefined, consumer: string, opts: any) => {
        f.turns.push({ account, consumer, opts });
        if (f.turnRefusal) return { ok: false, ...f.turnRefusal };
        return { ok: true, data: { turnId: `turn-${f.turns.length}`, accountId: account, release: async () => { f.released++; } } };
      },
      exec: async (req: any) => {
        const p = req.params ?? {};
        if (["getThreads", "searchEmails", "getThread"].includes(req.functionName)) {
          f.reads.push({ functionName: req.functionName, turnId: req.turnId, account: req.accountHint });
          if (req.functionName === "getThreads") {
            if (f.hold) await f.hold; // only the crawl's read waits: reply_context's own getThread never does
            const me = ME[req.accountHint] ?? "";
            const threads = Array.from({ length: 4 }, (_, i) => ({
              threadId: `s-${i}`, subject: "Re: numbers",
              messages: [
                { from: "Sam <sam@acme.com>", body: "Any update on the numbers?" },
                { from: `Me <${me}>`, body: sentBody(i) },
              ],
            }));
            return { ok: true, data: { listed: threads.length, threads, truncated: false } };
          }
          return { ok: false, reason: "not used" };
        }
        f.writes.push(req.functionName);
        if (req.functionName === "createReplyDraft") {
          const draftId = `gm-${++n}`;
          return { ok: true, data: { draftId, draftMessageId: `msg-${n}`, threadId: p.threadId, bodyAsSaved: String(p.body) } };
        }
        if (req.functionName === "getThread") return { ok: false, reason: "not used" };
        return { ok: false, reason: `unexpected ${req.functionName}` };
      },
    },
    model: {
      json: async (req: any) => { f.models.push(req); return { ok: true, json: f.profile, model: "balanced-model" }; },
    },
    memory: { search: async () => ({ ok: true, data: { facts: [] } }) },
    tasks: {
      publish: async (t: any) => { f.published.push(t); return { ok: true, data: {} }; },
      withdraw: async () => ({ ok: true, data: undefined }),
    },
  };
  return f;
}

let db: Database;
let f: Fake;
let clock: number;

function seedThread(threadId = THREAD, account = A1): void {
  const at = new Date(Date.UTC(2026, 10, 23, 9, 0));
  const row = normalizeInboxRow({ id: threadId, from: "Asha Rao <asha@acme.com>", subject: "Tuesday?", snippet: "Are you free on Tuesday?", dateFull: "Mon, Nov 23, 2026, 9:00 AM" }, account, at);
  appendEvents(db, account, [row]);
  setEventBody(db, { sourceId: GMAIL_SOURCE, accountId: account, eventId: row.eventId },
    ["From: Me <me@acme.com>\nHow about next week?", "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?"].join(THREAD_BODY_SEPARATOR));
}

const agentCtx = () => ({ platform: f.platform, agentId: "butler-1", pressToken: null });

/** A crawl held mid-read: the returned call lets it finish. */
let release: (() => void) | null = null;
function holdReads(): () => void {
  let open!: () => void;
  f.hold = new Promise<void>((r) => { open = r; });
  release = () => { f.hold = null; open(); };
  return release;
}

/** Let every held crawl finish before the store closes. */
async function settle(): Promise<void> {
  release?.();
  release = null;
  for (const a of [A1, A2]) {
    for (let i = 0; i < 200 && voiceCrawlProgress(a) && !voiceCrawlProgress(a)!.done; i++) await Bun.sleep(1);
  }
}

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-voice-")));
  _setStoreForTesting(db);
  _setOpsLogForTesting(() => {});
  _setCardLogForTesting(() => {});
  _setRoutineLogForTesting(() => {});
  clock = Date.UTC(2026, 10, 23, 10, 0);
  _setVoiceCrawlSeamsForTesting({ sleep: async () => {}, now: () => clock, log: () => {} });
  _resetVoiceCrawlsForTesting();
  f = fake();
  seedThread();
});
afterEach(async () => {
  await settle();
  _setStoreForTesting(null);
  _setOpsLogForTesting(null);
  _setCardLogForTesting(null);
  _setRoutineLogForTesting(null);
  _setVoiceCrawlSeamsForTesting(null);
  _resetVoiceCrawlsForTesting();
  db.close();
});

const dims = (account: string) => Object.fromEntries(voiceRows(account, db).map((r) => [r.dimension, r]));

describe("the crawl", () => {
  test("crawl samples sent mail and stores dimensions per mailbox", async () => {
    const out = await runVoiceCrawl(f.platform, A1);
    expect(out.started).toBe(true);
    if (!out.started) return;
    expect(out.progress.sampled).toBe(4);
    expect(out.progress.stored).toBeGreaterThan(0);

    // Read under the mailbox's turn, every read carrying it, then released.
    expect(f.turns).toEqual([{ account: A1, consumer: VOICE_CONSUMER, opts: { skillId: "gmail", ttlMs: VOICE_PENDING_CAP_MS } }]);
    expect(f.reads.length).toBeGreaterThan(0);
    for (const r of f.reads) expect(r).toMatchObject({ turnId: "turn-1", account: A1 });
    expect(f.released).toBe(1);

    // One Balanced model call with a schema; the person's own prose is in it.
    expect(f.models).toHaveLength(1);
    expect(f.models[0]).toMatchObject({ tier: "balanced", purpose: "voice" });
    expect(f.models[0].schema).toBeTruthy();
    expect(f.models[0].user).toContain("Could you send the numbers");
    expect(f.models[0].user).not.toContain("Any update on the numbers?");

    const a1 = dims(A1);
    expect(a1.greeting_style!.value).toContain("Hi Sam,");
    expect(a1.sign_off!.value).toContain("Thanks, Shiva");
    expect(a1.phrasing_request!.value).toBe("Could you send the numbers when you get a chance?");
    expect(a1.sign_off!.source).toBe(CRAWL_SOURCE);
    expect(a1.sign_off!.observationCount).toBe(4);
    // Kept for this mailbox only.
    expect(voiceRows(A2, db)).toEqual([]);
    expect(voiceStateFor(A1)).toBe("ready");
    expect(voiceStateFor(A2)).toBe("none");

    // The second mailbox learns its own, apart.
    f.profile = { ...PROFILE, signOff: "Thanks, Shiva" };
    await runVoiceCrawl(f.platform, A2);
    expect(dims(A2).sign_off!.value).toContain("Thanks, Shiva");
    expect(Object.keys(dims(A1)).sort()).toEqual(Object.keys(dims(A2)).sort());
  });

  test("a refused turn starts no crawl and reads nothing", async () => {
    f.turnRefusal = { reason: "held by email-desk:harvest", code: "busy" };
    const out = await runVoiceCrawl(f.platform, A1);
    expect(out).toEqual({ started: false, reason: "busy" });
    expect(f.reads).toEqual([]);
    expect(f.models).toEqual([]);
    expect(voiceStateFor(A1)).toBe("none");
  });

  test("a learned mailbox is not crawled again unless forced; a running one never twice", async () => {
    await runVoiceCrawl(f.platform, A1);
    expect(await beginVoiceCrawl(f.platform, A1)).toEqual({ started: false, reason: "learned" });
    const open = holdReads();
    const forced = await beginVoiceCrawl(f.platform, A1, { force: true });
    expect(forced.started).toBe(true);
    expect(await beginVoiceCrawl(f.platform, A1, { force: true })).toEqual({ started: false, reason: "running" });
    open();
    if (forced.started) await forced.done;
  });

  test("an answer with nothing groundable stores nothing", async () => {
    f.profile = { greeting: "Dear Valued Customer, kindly revert", voiceExamples: { request: "Kindly revert at the earliest possible." } };
    const out = await runVoiceCrawl(f.platform, A1);
    expect(out.started && out.progress.stored).toBe(0);
    expect(voiceRows(A1, db)).toEqual([]);
    expect(voiceStateFor(A1)).toBe("none");
  });

  test("person's edit is kept over a re-learn", async () => {
    await runVoiceCrawl(f.platform, A1);
    expect(editVoiceRow(A1, "sign_off", "Cheers, S", undefined, db)).toBe(true);
    forgetVoiceRow(A1, "phrasing_request", db);

    await runVoiceCrawl(f.platform, A1, { force: true });
    const a1 = dims(A1);
    expect(a1.sign_off).toMatchObject({ source: OWNER_SOURCE, value: 'Signs off "Cheers, S".' });
    expect(a1.phrasing_request).toMatchObject({ source: OWNER_SOURCE, value: "" });
    const block = buildVoiceBlock(A1, db);
    expect(block).toContain("Cheers, S");
    expect(block).not.toContain("Thanks, Shiva");
    expect(block).not.toContain("Could you send the numbers");

    // Restore hands the row back to the crawl.
    restoreVoiceRow(A1, "phrasing_request", db);
    await runVoiceCrawl(f.platform, A1, { force: true });
    expect(dims(A1).phrasing_request).toMatchObject({ source: CRAWL_SOURCE, value: "Could you send the numbers when you get a chance?" });
  });
});

describe("create_draft and the voice", () => {
  test("create_draft while learning answers VOICE_LEARNING with the time", async () => {
    const open = holdReads();
    const begun = await beginVoiceCrawl(f.platform, A1);
    expect(begun.started).toBe(true);
    expect(voiceStateFor(A1)).toBe("learning");

    const out: any = await ops.create_draft({ threadId: THREAD, body: "Hi Asha, Tuesday works." }, agentCtx() as any);
    const until = new Date(clock + VOICE_PENDING_CAP_MS).toISOString();
    expect(out.code).toBe("VOICE_LEARNING");
    expect(out.tryAfter).toBe(until);
    expect(out.error).toStartWith("Voice still learning, try after ");
    expect(out.error).toContain(until);
    expect(out.error).not.toMatch(/[—–]/);
    expect(f.writes).toEqual([]);
    expect(f.published).toEqual([]);
    expect(db.query("SELECT COUNT(*) AS n FROM draft_records").get()).toEqual({ n: 0 });

    // Once the voice is learned, the same call drafts.
    open();
    if (begun.started) await begun.done;
    expect(voiceStateFor(A1)).toBe("ready");
    const again: any = await ops.create_draft({ threadId: THREAD, body: "Hi Asha, Tuesday works." }, agentCtx() as any);
    expect(again.id).toBeTruthy();
  });

  test("voice cap passed: draft allowed without voice", async () => {
    holdReads(); // the crawl wedges mid-read and never finishes
    const begun = await beginVoiceCrawl(f.platform, A1);
    expect(begun.started).toBe(true);
    clock += VOICE_PENDING_CAP_MS - 1;
    expect(voiceStateFor(A1)).toBe("learning");
    clock += 1;
    expect(voiceStateFor(A1)).toBe("none");

    const out: any = await ops.create_draft({ threadId: THREAD, body: "Hi Asha, Tuesday works." }, agentCtx() as any);
    expect(out.code).toBeUndefined();
    expect(out.id).toBeTruthy();
    expect(f.writes).toEqual(["createReplyDraft"]);
  });

  test("a mailbox with no crawl at all drafts without voice", async () => {
    expect(voiceStateFor(A1)).toBe("none");
    const out: any = await ops.create_draft({ threadId: THREAD, body: "Hi Asha, Tuesday works." }, agentCtx() as any);
    expect(out.id).toBeTruthy();
  });
});

describe("reply_context", () => {
  test("reply_context carries the voice block", async () => {
    await runVoiceCrawl(f.platform, A1);
    const out: any = await allOps.reply_context!({ threadId: THREAD }, agentCtx() as any);
    expect(out.voiceState).toBe("ready");
    expect(out.voice).toStartWith(VOICE_HEADING);
    expect(out.voice).toContain("Hi Sam,");
    expect(out.voice).toContain("Could you send the numbers when you get a chance?");
    expect(out.voice).toBe(buildVoiceBlock(A1, db));
  });

  test("while learning, no block and voiceState learning", async () => {
    holdReads();
    await beginVoiceCrawl(f.platform, A1);
    const out: any = await allOps.reply_context!({ threadId: THREAD }, agentCtx() as any);
    expect(out.voice).toBeNull();
    expect(out.voiceState).toBe("learning");
  });
});

describe("the routine's wake", () => {
  const kept = (over: Partial<KeptMail> = {}): KeptMail => ({
    messageId: "m-1", threadId: THREAD, accountId: A1, from: "Asha Rao <asha@acme.com>", subject: "Tuesday?",
    to: "me@acme.com", date: "2026-11-23T09:00:00Z", body: "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?",
    mailboxKind: "work", draftEligible: true, ...over,
  });

  function routine(wakes: Array<{ message: string; data: any }>) {
    return {
      routine: { id: "r1", appRoutineId: "memory-extraction", handler: "memory-extraction", agentId: "butler-1", name: "Build memory",
        accounts: { gmail: A1 }, trigger: {}, values: {} },
      trigger: "event",
      platform: {
        ...f.platform,
        memory: { extract: async (items: any[]) => ({ ok: true, data: { ok: true, processedItems: items.length, failedItems: 0, deferredItems: 0 } }) },
      },
      connectors: { exec: async () => ({ ok: false, reason: "unused" }) },
      wakeAgent: async (message: string, data: any) => { wakes.push({ message, data }); return { ok: true, data: { sessionId: "s1" } }; },
      notify: async () => ({ ok: true, data: { delivered: 0 } }),
      state: { get: () => null, set: () => {} },
    } as any;
  }
  const gather = async () => ({ kept: [kept()], skipped: 0, cursor: "1", deferred: 0 } as unknown as GatherResult);

  test("wake data carries the voice block", async () => {
    await runVoiceCrawl(f.platform, A1);
    f.turns.length = 0;
    const wakes: Array<{ message: string; data: any }> = [];
    await runMemoryExtraction(routine(wakes), { gather, handOver: () => {} });
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.data.mails.map((m: any) => m.threadId)).toEqual([THREAD]);
    expect(wakes[0]!.data.voice).toBe(buildVoiceBlock(A1, db));
    expect(wakes[0]!.data.voice).toContain("Hi Sam,");
    expect(wakes[0]!.data.voiceState).toBe("ready");
    expect(f.turns).toEqual([]); // a learned mailbox is not crawled again
  });

  test("a mailbox with no voice starts its crawl from the routine, and the wake says it is learning", async () => {
    const open = holdReads();
    const wakes: Array<{ message: string; data: any }> = [];
    await runMemoryExtraction(routine(wakes), { gather, handOver: () => {} });
    expect(f.turns.map((t) => t.consumer)).toEqual([VOICE_CONSUMER]);
    expect(wakes[0]!.data).toMatchObject({ voice: null, voiceState: "learning" });
    open();
  });

  test("the catch-up waits a week after a crawl that learned nothing", async () => {
    f.profile = { greeting: "Dear Valued Customer, kindly revert" };
    await runVoiceCrawl(f.platform, A1);
    expect(await ensureVoiceCrawl(f.platform, A1)).toEqual({ started: false, reason: "recent" });
    clock += RECRAWL_AFTER_MS;
    const again = await ensureVoiceCrawl(f.platform, A1);
    expect(again.started).toBe(true);
    if (again.started) await again.done;
  });
});

describe("the settings routes", () => {
  const app = () => {
    const hono = new Hono();
    hono.route("/", voiceRoutes(f.platform) as never);
    return hono;
  };
  const person = { "x-flock-user": "shiva" };
  const put = (body: unknown, headers: Record<string, string> = person) =>
    app().request("/api/voice", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  test("only the person: an agent or nobody is refused", async () => {
    expect((await app().request("/api/voice")).status).toBe(403);
    expect((await app().request("/api/voice", { headers: { ...person, "x-flock-agent": "butler-1" } })).status).toBe(403);
    expect((await put({ accountId: A1, dimension: "sign_off", value: "x" }, { "x-flock-agent": "butler-1" })).status).toBe(403);
    expect(voiceRows(A1, db)).toEqual([]);
  });

  test("GET lists each mailbox with its state and rows", async () => {
    await runVoiceCrawl(f.platform, A1);
    const res = await app().request("/api/voice", { headers: person });
    expect(res.status).toBe(200);
    const { accounts } = await res.json() as any;
    expect(accounts.map((a: any) => [a.accountId, a.email, a.state])).toEqual([[A1, ME[A1], "ready"], [A2, ME[A2], "none"]]);
    const opening = accounts[0].groups.find((g: any) => g.title === "Opening and closing");
    expect(opening.rows.map((r: any) => [r.label, r.value])).toEqual([["Greeting", "Hi Sam,"], ["Sign-off", "Thanks, Shiva"]]);
  });

  test("PUT edits as the person, forgets and restores; a bad dimension or mailbox is refused", async () => {
    await runVoiceCrawl(f.platform, A1);
    const edited = await put({ accountId: A1, dimension: "greeting_style", action: "edit", value: "Hey Sam," });
    expect(edited.status).toBe(200);
    expect(dims(A1).greeting_style).toMatchObject({ source: OWNER_SOURCE, examples: ["Hey Sam,"] });
    const view = (await edited.json() as any).account;
    expect(view.groups[0].rows[0]).toMatchObject({ label: "Greeting", value: "Hey Sam,", editedByYou: true });

    expect((await put({ accountId: A1, dimension: "phrasing_closing", action: "forget" })).status).toBe(200);
    expect(dims(A1).phrasing_closing).toMatchObject({ source: OWNER_SOURCE, value: "" });
    expect((await put({ accountId: A1, dimension: "phrasing_closing", action: "restore" })).status).toBe(200);
    expect(dims(A1).phrasing_closing).toBeUndefined();

    expect((await put({ accountId: A1, dimension: "secret_rule", action: "edit", value: "x" })).status).toBe(400);
    expect((await put({ accountId: "someone-else", dimension: "sign_off", action: "edit", value: "x" })).status).toBe(400);
  });

  test("PUT relearn starts a crawl for that mailbox", async () => {
    const open = holdReads();
    const res = await put({ accountId: A2, action: "relearn" });
    expect(res.status).toBe(200);
    expect((await res.json() as any).account.state).toBe("learning");
    expect((await put({ accountId: A2, action: "relearn" })).status).toBe(409);
    open();
  });

  test("the settings page is served", async () => {
    const res = await app().request("/settings");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your voice");
    expect(html).toContain('"api/voice"');
    expect(html).not.toMatch(/[—–]/);
  });
});
