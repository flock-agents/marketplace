// The memory-extraction routine: kept mail into memory (memory.extract, in chunks), a personal mailbox's family items to the
// Family Calendar (one import per run, through Flock's gate), and the routine's agent woken for the mail that may want a
// reply. Expectations written from the brief and the source (memory-relay.ts blockToItem, harvest-runner extract half):
//   - each kept mail is one extract item, its thread as text, the mailbox's kind on it; a personal mailbox asks for family
//     candidates back;
//   - only mail whose extraction succeeded is handed over; a failed chunk does not stop the next, and the run reports it;
//   - the wake is one line of counts; mail text rides only in data; mail with an open draft is not offered again;
//   - the wake goes to the routine's own agent, whatever it is.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import {
  memoryExtraction, runMemoryExtraction, runFirstRead, wakeLine, EXTRACT_SERVABLE_ITEMS, _setLogForTesting,
} from "../routines/memory-extraction";
import { noteTickCadence, _resetTickCadenceForTesting } from "../routines/harvest-schedule";
import { recordHarvestRun } from "../platform-ops";
import type { GatherResult, KeptMail } from "../routines/gather";
import type { FamilyBlockWire, ImportPayload, MemoryExtractAnswer } from "@flock/app-sdk";

type ExtractAnswer = Partial<MemoryExtractAnswer>;

const ACCOUNT = "acct-1";

function kept(n: number, over: Partial<KeptMail> = {}): KeptMail {
  return {
    accountId: ACCOUNT, threadId: `t-${n}`, messageId: `m-${n}`,
    from: `Asha Rao <asha${n}@acme.com>`, to: "me@acme.com", date: new Date(Date.UTC(2026, 10, 23, 9, n)).toISOString(),
    subject: `Subject ${n}`,
    body: [`From: Asha Rao <asha${n}@acme.com>\nFirst message ${n}.`, `From: Asha Rao <asha${n}@acme.com>\nAre you free on Tuesday? (mail ${n})`].join(THREAD_BODY_SEPARATOR),
    mailboxKind: "work", draftEligible: false,
    ...over,
  };
}

interface Fake {
  ctx: any;
  extracts: { items: any[]; source: any }[];
  wakes: { message: string; data: any }[];
  handed: string[][];
  imports: ImportPayload[];
  published: any[];
  models: any[];
  targetsCalls: number;
  /** Change between runs: the next run's kept mail, and whether the agent can be woken. */
  next: { kept: KeptMail[]; wakeFails: boolean };
}

function fake(opts: {
  kept?: KeptMail[];
  gather?: Partial<GatherResult>;
  extract?: (items: any[], call: number) => { ok: true; data: ExtractAnswer } | { ok: false; reason: string };
  agentId?: string;
  pairedAgent?: { id: string; name: string } | null;
  accounts?: Record<string, string>;
  family?: { targets?: string[]; importAnswer?: (p: ImportPayload) => any } | null;
  household?: string[];
  openTasks?: any[];
  wakeFails?: boolean;
  /** The run's trigger: "manual" (Run now, never gated) unless a test asks for the cadence with "event". */
  trigger?: "event" | "manual" | "scheduled";
  values?: Record<string, unknown>;
  now?: () => number;
} = {}): Fake & { run: () => Promise<void> } {
  const f: Fake = { ctx: null, extracts: [], wakes: [], handed: [], imports: [], published: [], models: [], targetsCalls: 0,
    next: { kept: opts.kept ?? [], wakeFails: opts.wakeFails ?? false } };
  let call = 0;
  const platform: any = {
    appId: "email-desk-p1", pairedAgent: opts.pairedAgent === undefined ? { id: "pa-1", name: "Butler" } : opts.pairedAgent,
    dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [{ accountId: ACCOUNT, email: "me@acme.com", label: "Shiva" }] } }),
      readTurn: async () => ({ ok: false, reason: "unused", code: "busy" }),
      exec: async () => ({ ok: false, reason: "unused" }),
      list: async () => [],
    },
    memory: {
      extract: async (items: any[], source: any) => {
        f.extracts.push({ items, source });
        const n = call++;
        return opts.extract ? opts.extract(items, n) : { ok: true, data: { ok: true, processedItems: items.length, failedItems: 0, deferredItems: 0 } };
      },
    },
    tasks: {
      publish: async (t: any) => { f.published.push(t); return { ok: true, data: {} }; },
      list: async () => ({ ok: true, data: { tasks: [] } }),
      withdraw: async () => ({ ok: true, data: undefined }),
    },
    model: {
      json: async (req: any) => { f.models.push(req); return { ok: true, json: [], model: "fast" }; },
    },
    identity: { names: async () => ({ ok: true, data: { names: ["Shiva Shankar"] } }) },
  };
  if (opts.family !== null && opts.family !== undefined) {
    platform.family = {
      targets: async () => { f.targetsCalls++; return { ok: true, data: { appIds: opts.family!.targets ?? ["family-calendar"] } }; },
      importEvents: async (p: ImportPayload) => {
        f.imports.push(p);
        return { ok: true, data: { answer: opts.family!.importAnswer ? opts.family!.importAnswer(p) : { results: p.items.map((i) => ({ ref: i.ref, id: "e", result: "added" })) } } };
      },
      household: async () => ({ ok: true, data: { names: opts.household ?? ["Agastya Shankar", "Shiva"] } }),
    };
  }
  if (opts.openTasks) {
    platform.board = { openTasks: async () => ({ ok: true, data: { tasks: opts.openTasks } }) };
  }
  f.ctx = {
    routine: { id: "r1", appRoutineId: "memory-extraction", handler: "memory-extraction", agentId: opts.agentId ?? "pa-1", name: "Build memory",
      accounts: opts.accounts ?? { gmail: ACCOUNT }, trigger: {}, values: opts.values ?? {} },
    trigger: opts.trigger ?? "manual",
    platform,
    connectors: { exec: async () => ({ ok: false, reason: "unused" }) },
    wakeAgent: async (message: string, data: any) => {
      f.wakes.push({ message, data });
      return f.next.wakeFails ? { ok: false, reason: "agent busy" } : { ok: true, data: { sessionId: "s1" } };
    },
    notify: async () => ({ ok: true, data: { delivered: 0 } }),
    state: { get: () => null, set: () => {} },
  };
  const run = () => runMemoryExtraction(f.ctx, {
    gather: async () => ({ kept: f.next.kept, skipped: 0, cursor: "1", deferred: 0, ...opts.gather } as GatherResult),
    handOver: (ids) => { f.handed.push([...ids]); },
    // The voice catch-up crawl is voice.test.ts's: here the mailbox has no voice and starts none.
    ensureVoice: async () => {},
    ...(opts.now ? { now: opts.now } : {}),
  });
  return Object.assign(f, { run });
}

let db: Database;
const logs: string[] = [];
beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-extract-")));
  _setStoreForTesting(db);
  logs.length = 0;
  _setLogForTesting((line) => { logs.push(line); });
});
afterEach(() => {
  _resetTickCadenceForTesting();
  _setLogForTesting(null);
  _setStoreForTesting(null);
  db.close();
});

describe("memory-extraction: into memory", () => {
  test("kept mail goes to memory.extract with mailboxKind", async () => {
    const work = fake({ kept: [kept(1)] });
    await work.run();
    expect(work.extracts).toHaveLength(1);
    const { items, source } = work.extracts[0]!;
    expect(source).toMatchObject({ type: "email", connectorSkill: "gmail", account: ACCOUNT });
    expect(source.familyCandidates).toBeFalsy();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "t-1", text: kept(1).body, timestamp: kept(1).date });
    expect(items[0].context.mailboxKind).toBeUndefined();
    expect(items[0].context.ownerAddresses).toEqual(["me@acme.com"]);
    // The thread kept apart, message by message, for Flock's item gate and closure judge.
    expect(items[0].messages).toEqual([
      { index: 0, from: "Asha Rao <asha1@acme.com>", text: "First message 1." },
      { index: 1, from: "Asha Rao <asha1@acme.com>", text: "Are you free on Tuesday? (mail 1)" },
    ]);
    expect(items[0].reference).toBe("https://mail.google.com/mail/?authuser=me%40acme.com#all/t-1");
    expect(work.handed).toEqual([["m-1"]]);

    const personal = fake({ kept: [kept(2, { mailboxKind: "personal" })], family: {} });
    await personal.run();
    expect(personal.extracts[0]!.items[0].context.mailboxKind).toBe("personal");
    expect(personal.extracts[0]!.source.familyCandidates).toBe(true);
  });

  test("a thread only the person wrote carries selfAuthored; every item carries its sender kind", async () => {
    const own = kept(1, { body: [`From: Me <me@acme.com>\nCan you send the deck, Raj?`, `From: me@acme.com\nPinging again.`].join(THREAD_BODY_SEPARATOR) });
    const bot = kept(2, { body: `From: Acme Billing <no-reply@acme.com>\nYour invoice is ready.` });
    const f = fake({ kept: [own, bot, kept(3)] });
    await f.run();
    const [a, b] = f.extracts[0]!.items;
    expect(a.context.selfAuthored).toBe(true);
    expect(a.context.senderKind).toBe("human");
    expect(b.context.selfAuthored).toBeUndefined();
    expect(b.context.senderKind).toBe("automated");
    const c = f.extracts[1]!.items[0];
    expect(c.context.selfAuthored).toBeUndefined();
    expect(c.context.senderKind).toBe("human");
    // KeptMail has no to/cc, so no addressing verdict is claimed.
    expect(a.context.addressing).toBeUndefined();
  });

  test(`mail goes in chunks of EXTRACT_SERVABLE_ITEMS (${EXTRACT_SERVABLE_ITEMS})`, async () => {
    expect(EXTRACT_SERVABLE_ITEMS).toBe(2);
    const f = fake({ kept: [1, 2, 3, 4, 5].map((n) => kept(n)) });
    await f.run();
    expect(f.extracts.map((e) => e.items.map((i) => i.id))).toEqual([["t-1", "t-2"], ["t-3", "t-4"], ["t-5"]]);
    expect(f.handed.flat()).toEqual(["m-1", "m-2", "m-3", "m-4", "m-5"]);
  });

  test("extract failure on one chunk: later chunks still run, run reports the failure", async () => {
    const f = fake({
      kept: [1, 2, 3, 4].map((n) => kept(n)),
      extract: (_items, n) => (n === 0 ? { ok: false, reason: "timeout" } : { ok: true, data: { failedItems: 0, deferredItems: 0 } }),
    });
    await expect(f.run()).rejects.toThrow(/2 of 4 mails could not be read into memory/);
    expect(f.extracts).toHaveLength(2);
    // Only the chunk that went in is handed over; the failed one is offered again next run.
    expect(f.handed.flat()).toEqual(["m-3", "m-4"]);
  });

  test("a chunk Flock answered with a failed item is not handed over; a deferred one is left for later without a failure", async () => {
    const failed = fake({ kept: [kept(1), kept(2)], extract: () => ({ ok: true, data: { failedItems: 1, deferredItems: 0 } }) });
    await expect(failed.run()).rejects.toThrow(/could not be read into memory/);
    expect(failed.handed.flat()).toEqual([]);

    const deferred = fake({ kept: [kept(1), kept(2)], extract: () => ({ ok: true, data: { failedItems: 0, deferredItems: 1 } }) });
    await deferred.run();
    expect(deferred.handed.flat()).toEqual([]);
  });

  test("busy mailbox: the run ends ok with the note, nothing extracted", async () => {
    const f = fake({ gather: { busy: true, note: "mailbox busy", kept: [] } });
    await f.run();
    expect(f.extracts).toEqual([]);
    expect(f.wakes).toEqual([]);
    expect(logs.join("\n")).toContain("mailbox busy");
  });

  test("the thread's open TODOs ride along when Flock serves them (closure)", async () => {
    const f = fake({
      kept: [kept(1), kept(2)],
      openTasks: [
        { id: "task-9", threadKey: "t-1", title: "Send Asha the deck", why: "Can you send the deck?", anchor: 0, createdAt: 2 },
        { id: "task-8", threadKey: "t-1", title: "Book the room", createdAt: 1 },
      ],
    });
    await f.run();
    const [first, second] = f.extracts[0]!.items;
    expect(first.context.openTasks).toEqual([
      { ref: "T1", id: "task-8", title: "Book the room", anchor: null, createdAt: 1 },
      { ref: "T2", id: "task-9", title: "Send Asha the deck", why: "Can you send the deck?", anchor: 0, createdAt: 2 },
    ]);
    expect(second.context.openTasks).toBeUndefined();
  });

  test("with no account on the routine, every Gmail account of the agent is read", async () => {
    const f = fake({ kept: [kept(1)], accounts: {} });
    await f.run();
    expect(f.extracts).toHaveLength(1);
  });
});

describe("memory-extraction: the wake", () => {
  test("no draft-eligible mail: no wake", async () => {
    const f = fake({ kept: [kept(1), kept(2, { draftEligible: false })] });
    await f.run();
    expect(f.wakes).toEqual([]);
  });

  test("wake message is counts only, mail text only in data", async () => {
    const f = fake({ kept: [kept(1, { draftEligible: true, subject: "Lunch on Tuesday?" }), kept(2, { draftEligible: true }), kept(3)] });
    await f.run();
    expect(f.wakes).toHaveLength(1);
    const { message, data } = f.wakes[0]!;
    expect(message).toBe("2 new mails may want a reply.");
    expect(message).toBe(wakeLine(2));
    expect(message).not.toContain("Lunch");
    expect(message).not.toContain("Asha");
    expect(data).toEqual({
      mails: [
        { threadId: "t-1", accountId: ACCOUNT, from: "Asha Rao <asha1@acme.com>", subject: "Lunch on Tuesday?", snippet: "Are you free on Tuesday? (mail 1)" },
        { threadId: "t-2", accountId: ACCOUNT, from: "Asha Rao <asha2@acme.com>", subject: "Subject 2", snippet: "Are you free on Tuesday? (mail 2)" },
      ],
      // The mailbox's voice rides with its mail (Task 2.9): none learned here.
      voice: null,
      voiceState: "none",
    });
  });

  test("a thread with an open draft is not offered again; one whose draft was sent is", async () => {
    db.run("INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at) VALUES (?,?,?,?,?)", [ACCOUNT, "t-1", "d1", "x", 1]);
    db.run("INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at, sent_at) VALUES (?,?,?,?,?,?)", [ACCOUNT, "t-2", "d2", "x", 1, 2]);
    const f = fake({ kept: [kept(1, { draftEligible: true }), kept(2, { draftEligible: true })] });
    await f.run();
    expect(f.wakes[0]!.message).toBe("1 new mails may want a reply.");
    expect(f.wakes[0]!.data.mails.map((m: any) => m.threadId)).toEqual(["t-2"]);
  });

  test("only mail that went into memory is offered to draft", async () => {
    const f = fake({
      kept: [kept(1, { draftEligible: true }), kept(2, { draftEligible: true }), kept(3, { draftEligible: true })],
      extract: (_items, n) => (n === 0 ? { ok: false, reason: "timeout" } : { ok: true, data: {} }),
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.wakes[0]!.data.mails.map((m: any) => m.threadId)).toEqual(["t-3"]);
  });

  test("wake is addressed to the paired agent whatever it is", async () => {
    const f = fake({ kept: [kept(1, { draftEligible: true })], agentId: "inbox-assistant-7", pairedAgent: null });
    await f.run();
    expect(f.wakes).toHaveLength(1);
    expect(f.wakes[0]!.message).toBe("1 new mails may want a reply.");
    expect(f.handed.flat()).toEqual(["m-1"]);
  });

  test("a failed wake: the mail is handed over all the same, and the next run offers it again with no second extract", async () => {
    const f = fake({ kept: [kept(1, { draftEligible: true }), kept(2)], wakeFails: true });
    await expect(f.run()).rejects.toThrow(/could not wake the agent/);
    // Into memory once: handed over, never extracted again.
    expect(f.handed.flat()).toEqual(["m-1", "m-2"]);
    expect(f.extracts).toHaveLength(1);

    // Next run: no new mail, the agent can be woken. The pending offer goes; nothing is extracted.
    f.next = { kept: [], wakeFails: false };
    await f.run();
    expect(f.extracts).toHaveLength(1);
    expect(f.wakes).toHaveLength(2);
    expect(f.wakes[1]!.message).toBe("1 new mails may want a reply.");
    expect(f.wakes[1]!.data.mails.map((m: any) => m.threadId)).toEqual(["t-1"]);

    // Woken once: the offer is cleared.
    await f.run();
    expect(f.wakes).toHaveLength(2);
  });

  test("a pending offer whose thread got a draft meanwhile is dropped, not woken", async () => {
    const f = fake({ kept: [kept(1, { draftEligible: true })], wakeFails: true });
    await expect(f.run()).rejects.toThrow();
    db.run("INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at) VALUES (?,?,?,?,?)", [ACCOUNT, "t-1", "d1", "x", 1]);
    f.next = { kept: [], wakeFails: false };
    await f.run();
    expect(f.wakes).toHaveLength(1);
    await f.run();
    expect(f.wakes).toHaveLength(1);
  });

  test("a pending offer met again in new mail is offered once", async () => {
    const f = fake({ kept: [kept(1, { draftEligible: true })], wakeFails: true });
    await expect(f.run()).rejects.toThrow();
    f.next = { kept: [kept(1, { draftEligible: true, messageId: "m-1b" })], wakeFails: false };
    await f.run();
    expect(f.wakes[1]!.data.mails.map((m: any) => m.threadId)).toEqual(["t-1"]);
  });

  test("the routine's entry point is the handler", () => {
    expect(typeof memoryExtraction).toBe("function");
  });
});

describe("memory-extraction: the family calendar", () => {
  const today = new Date().toLocaleDateString("en-CA");
  const inDays = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const EVENT_DAY = inDays(18), DUE = inDays(11);
  const annual = (threadKey: string): FamilyBlockWire => ({
    blockId: threadKey,
    facts: [{ content: `Agastya's Annual Day is on ${EVENT_DAY} at 10:00 at Greenwood High.`, kind: "event", salience: 0.8, dateRole: "occasion", audience: "family",
      category: "event", domain: "family", relationships: [], scope: "wiki", validFrom: null, validUntil: null,
      entities: [{ name: "Agastya", type: "person" }, { name: "Annual Day", type: "event" }], when: { date: EVENT_DAY, time: "10:00" } }],
    factIds: [`${threadKey}-f0`], prevRef: null,
    heldTasks: [{ title: "Buy Agastya's farmer costume", detail: null, due: DUE, audience: "family" }],
    ctx: { threadKey, messageId: null, mailDate: new Date().toISOString(), sender: "info@greenwoodhigh.edu.in" },
  });

  test("family items imported once per ref", async () => {
    const mails = [kept(1, { mailboxKind: "personal" }), kept(2, { mailboxKind: "personal" }), kept(3, { mailboxKind: "personal" })];
    const f = fake({
      kept: mails,
      family: {},
      // Both chunks hand back the same mail's family items (a mail met twice in one run).
      extract: () => ({ ok: true, data: { family: { blocks: [annual("t-1")] } } }),
    });
    await f.run();
    expect(f.extracts).toHaveLength(2);
    expect(f.imports).toHaveLength(1);
    expect(f.imports[0]!.items).toHaveLength(1);
    expect(f.imports[0]!.items[0]).toMatchObject({ ref: `gmail-thread:t-1#${EVENT_DAY}`, title: "Annual Day", who: "Agastya", start_time: "10:00",
      todos: [{ title: "Buy Agastya's farmer costume", due: DUE }] });
    expect(f.imports[0]).toMatchObject({ source: "email:email-desk-p1", label: "Shiva's email" });
    // The facts it came from, so Flock marks them imported (R24).
    expect(f.imports[0]!.items[0]!.factIds).toEqual(["t-1-f0"]);
    // The run's one naming call, on the Fast tier.
    expect(f.models).toHaveLength(1);
    expect(f.models[0]).toMatchObject({ tier: "fast" });
    // Pushed: nothing on Home.
    expect(f.published).toEqual([]);
    // Flock asked once per run where the family's items may go (R14).
    expect(f.targetsCalls).toBe(1);
  });

  test("nowhere to push (R14): no family candidates asked for, nothing imported, no app TODOs", async () => {
    const f = fake({ kept: [kept(1, { mailboxKind: "personal" })], family: { targets: [] } });
    await f.run();
    expect(f.targetsCalls).toBe(1);
    expect(f.extracts[0]!.source.familyCandidates).toBeFalsy();
    // Still read as a personal mailbox.
    expect(f.extracts[0]!.items[0].context.mailboxKind).toBe("personal");
    expect(f.imports).toEqual([]);
    expect(f.published).toEqual([]);
    expect(f.models).toEqual([]);
  });

  test("a Flock with no family import asks for no candidates", async () => {
    const f = fake({ kept: [kept(1, { mailboxKind: "personal" })] });
    await f.run();
    expect(f.extracts[0]!.source.familyCandidates).toBeFalsy();
  });

  test("a refused item's held to-dos go on Home", async () => {
    const f = fake({
      kept: [kept(1, { mailboxKind: "personal" })],
      family: { importAnswer: (p) => ({ results: p.items.map((i) => ({ ref: i.ref, id: "x", result: "refused", reason: "bad date" })) }) },
      extract: () => ({ ok: true, data: { family: { blocks: [annual("t-1")] } } }),
    });
    await f.run();
    expect(f.published).toHaveLength(1);
    expect(f.published[0]).toMatchObject({ title: "Buy Agastya's farmer costume", sourceRef: "todo:t-1#buy-agastyas-farmer-costume" });
  });

  test("a failed import puts the held to-dos on Home; the run still ends ok", async () => {
    const f = fake({ kept: [kept(1, { mailboxKind: "personal" })], family: { importAnswer: () => ({ nope: true }) }, extract: () => ({ ok: true, data: { family: { blocks: [annual("t-1")] } } }) });
    await f.run();
    expect(f.imports).toHaveLength(1);
    expect(f.published.map((t) => t.title)).toEqual(["Buy Agastya's farmer costume"]);
    expect(f.handed.flat()).toEqual(["m-1"]);
  });

  test("a work mailbox never asks for family candidates nor imports", async () => {
    const f = fake({ kept: [kept(1)], family: {} });
    await f.run();
    expect(f.extracts[0]!.source.familyCandidates).toBeFalsy();
    expect(f.imports).toEqual([]);
  });
});

describe("memory-extraction: last_harvest", () => {
  const stamp = () => (db.query("SELECT value FROM app_meta WHERE key = ?").get(`last_harvest:${ACCOUNT}`) as { value: string } | null)?.value ?? null;

  test("a finished run stamps the account; a busy mailbox or a failed chunk does not", async () => {
    const busy = fake({ gather: { busy: true, note: "mailbox busy", kept: [] } });
    await busy.run();
    expect(stamp()).toBeNull();

    const failed = fake({ kept: [kept(1)], extract: () => ({ ok: false, reason: "timeout" }) });
    await expect(failed.run()).rejects.toThrow();
    expect(stamp()).toBeNull();

    const before = Date.now();
    await fake({ kept: [kept(1)] }).run();
    expect(Number(stamp())).toBeGreaterThanOrEqual(before);
  });
});

describe("memory-extraction: when it runs (R25, the built-in desk's cadence)", () => {
  // The platform's cadence as a tick hands it: every day 09:00-19:00 hourly, no shoulder runs, in India time.
  const IST = "Asia/Kolkata";
  const at = (hhmm: string) => Date.parse(`2026-11-24T${hhmm}:00+05:30`);
  beforeEach(() => { noteTickCadence({ tz: IST, window: { days: [0, 1, 2, 3, 4, 5, 6], start: 9, end: 19 }, everyHours: 1, morningHour: 5 }); });

  test("a new-mail run before the harvest hour reads nothing", async () => {
    const f = fake({ kept: [kept(1)], trigger: "event", values: { harvestHour: 6 }, now: () => at("05:30") });
    await f.run();
    expect(f.extracts).toEqual([]);
    expect(f.wakes).toEqual([]);
  });

  test("at the harvest hour it runs, once; the next hour of the window owes another", async () => {
    let now = at("06:10");
    const f = fake({ kept: [kept(1)], trigger: "event", values: { harvestHour: 6 }, now: () => now });
    await f.run();
    expect(f.extracts).toHaveLength(1);
    now = at("06:40");
    f.next.kept = [kept(2)];
    await f.run();
    expect(f.extracts).toHaveLength(1);
    now = at("09:05");
    await f.run();
    expect(f.extracts).toHaveLength(2);
  });

  test("the routine's own harvest hour moves the morning run", async () => {
    const early = fake({ kept: [kept(1)], trigger: "event", values: { harvestHour: 3 }, now: () => at("03:30") });
    await early.run();
    expect(early.extracts).toHaveLength(1);
  });

  test("with no hour set, 05:00", async () => {
    const before = fake({ kept: [kept(1)], trigger: "event", now: () => at("04:50") });
    await before.run();
    expect(before.extracts).toEqual([]);
    const after = fake({ kept: [kept(1)], trigger: "event", now: () => at("05:01") });
    await after.run();
    expect(after.extracts).toHaveLength(1);
  });

  test("Run now (manual) always runs", async () => {
    const f = fake({ kept: [kept(1)], trigger: "manual", values: { harvestHour: 6 }, now: () => at("05:30") });
    await f.run();
    expect(f.extracts).toHaveLength(1);
  });

  test("a run that finished stamps the moment it asked", async () => {
    const f = fake({ kept: [kept(1)], trigger: "event", values: { harvestHour: 6 }, now: () => at("06:10") });
    await f.run();
    const v = (db.query("SELECT value FROM app_meta WHERE key = ?").get(`last_harvest:${ACCOUNT}`) as { value: string }).value;
    expect(Number(v)).toBe(at("06:10"));
  });

  test("the first read (lifecycle initialize) is never gated", async () => {
    recordHarvestRun(ACCOUNT, Date.now());
    const gated = fake({ kept: [kept(1)], trigger: "event" });
    await gated.run();
    expect(gated.extracts).toEqual([]);
    const f = fake({ kept: [kept(1)] });
    const outcome = await runFirstRead(f.ctx, ACCOUNT, "me@acme.com", {
      gather: async () => ({ kept: [kept(1)], skipped: 0, cursor: "1", deferred: 0 } as GatherResult),
      handOver: () => {},
    });
    expect(outcome).toBe("read");
    expect(f.extracts).toHaveLength(1);
  });
});

describe("memory-extraction: the day is closed only by a run that worked the whole mailbox", () => {
  const IST = "Asia/Kolkata";
  const at = (hhmm: string) => Date.parse(`2026-11-24T${hhmm}:00+05:30`);
  const stamp = () => (db.query("SELECT value FROM app_meta WHERE key = ?").get(`last_harvest:${ACCOUNT}`) as { value: string } | null)?.value ?? null;
  beforeEach(() => { noteTickCadence({ tz: IST, window: { days: [0, 1, 2, 3, 4, 5, 6], start: 9, end: 19 }, everyHours: 1, morningHour: 5 }); });
  const event = (over: Parameters<typeof fake>[0] = {}) => fake({ kept: [kept(1)], trigger: "event", now: () => at("06:10"), ...over });

  test("a full read stamps; mail left for good (deferred, not stopped, not over the cap) still counts as worked", async () => {
    const f = event({ gather: { deferred: 3 } });
    await f.run();
    expect(Number(stamp())).toBe(at("06:10"));
  });

  test("a mailbox not read through (a sign-in wall, a paused account) leaves the day owed", async () => {
    let now = at("06:10");
    const f = event({ gather: { stopped: "quarantined", note: "mailbox not read (quarantined)", kept: [], deferred: 2 }, now: () => now });
    await f.run();
    expect(stamp()).toBeNull();
    // The next run in the same hour is still owed: it reads the mailbox again.
    now = at("06:40");
    await f.run();
    expect(logs.filter((l) => l.includes("day left owed: mailbox not read (quarantined)"))).toHaveLength(2);
    expect(stamp()).toBeNull();
  });

  test("threads left over the run's cap leave the day owed", async () => {
    const f = event({ gather: { overCap: 4, deferred: 4 } });
    await f.run();
    expect(stamp()).toBeNull();
    expect(f.extracts).toHaveLength(1);
  });

  test("a chunk Flock deferred on its write limit leaves the day owed", async () => {
    const f = event({ extract: () => ({ ok: true, data: { ok: true, processedItems: 0, failedItems: 0, deferredItems: 1 } }) });
    await f.run();
    expect(stamp()).toBeNull();
  });

  test("a busy mailbox never stamps", async () => {
    const f = event({ gather: { busy: true, note: "mailbox busy", kept: [] } });
    await f.run();
    expect(stamp()).toBeNull();
  });

  test("an owed day is read again on the next new mail in the same hour", async () => {
    let now = at("06:10");
    const f = event({ now: () => now, extract: () => ({ ok: true, data: { ok: true, processedItems: 0, failedItems: 0, deferredItems: 1 } }) });
    await f.run();
    now = at("06:40");
    await f.run();
    expect(f.extracts).toHaveLength(2);
  });
});

describe("memory-extraction: the first read leaves the morning run owed (R27)", () => {
  const IST = "Asia/Kolkata";
  const at = (hhmm: string) => Date.parse(`2026-11-24T${hhmm}:00+05:30`);
  beforeEach(() => { noteTickCadence({ tz: IST, window: { days: [0, 1, 2, 3, 4, 5, 6], start: 9, end: 19 }, everyHours: 1, morningHour: 5 }); });

  test("the first read stamps nothing", async () => {
    const f = fake({ kept: [kept(1)] });
    expect(await runFirstRead(f.ctx, ACCOUNT, "me@acme.com", {
      gather: async () => ({ kept: [kept(1)], skipped: 0, cursor: "1", deferred: 0 } as GatherResult), handOver: () => {},
    })).toBe("read");
    expect(db.query("SELECT 1 FROM app_meta WHERE key = ?").get(`last_harvest:${ACCOUNT}`)).toBeNull();
  });

  test("first read at 05:30, then a new-mail run still reads for the 05:00 boundary", async () => {
    const first = fake({ kept: [kept(1)] });
    await runFirstRead(first.ctx, ACCOUNT, "me@acme.com", {
      gather: async () => ({ kept: [kept(1)], skipped: 0, cursor: "1", deferred: 0 } as GatherResult), handOver: () => {},
    });
    const f = fake({ kept: [kept(2)], trigger: "event", now: () => at("05:40") });
    await f.run();
    expect(f.extracts).toHaveLength(1);
  });
});
