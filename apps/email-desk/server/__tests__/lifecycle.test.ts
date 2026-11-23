// Lifecycle (Task 2.10): the first read, its progress rows, the tick's owed work and "Delete my mail data". Expectations from
// the brief, spec §3 (an owner losing mail history or re-harvesting from scratch is an anti-goal) and §5.4, and the built-in
// desk's wording (mailbox-progress.ts), written before the code:
//   - initialize reads then learns the voice, one mailbox after the other, reporting the built-in desk's own lines;
//   - a db that already holds a mailbox's history (a last harvest, extracted rows, or a cursor) is not read from scratch;
//   - a first read that did not land stays owed ("Still finishing your email"), and the tick reads it again after the backoff;
//   - the tick does owed work only;
//   - deleting needs the confirm flag and the person, empties the app's own data, and never touches memory or TODOs.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import {
  createEmailDeskHooks, isInitialized, historyOf, STALL_MS, RETRY_AFTER_MS, DONE_VISIBLE_MS,
  READING_LABEL, VOICE_LABEL, STILL_LABEL, SETUP_DONE_LABEL,
} from "../lifecycle";
import { runFirstRead, FIRST_READ_WINDOW, _setLogForTesting } from "../routines/memory-extraction";
import { removalRoutes } from "../removal";
import { recordHarvestRun } from "../platform-ops";
import { putFollowUp } from "../routines/follow-up-store";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import type { KeptMail } from "../routines/gather";

const A1 = "acct-1";
const A2 = "acct-2";
const EMAILS: Record<string, string> = { [A1]: "me@acme.com", [A2]: "me@home.example" };

let db: Database;
let clock: number;
let events: string[];
let reports: Array<{ accountId: string; report: any }>;
let mid: Record<string, unknown>;

function platform(accounts: string[] = [A1, A2]): any {
  return {
    appId: "email-desk", pairedAgent: { id: "pa-1", name: "Butler" }, dataDir: "test", configured: true,
    connectors: { accounts: async () => ({ ok: true, data: { accounts: accounts.map((id) => ({ accountId: id, email: EMAILS[id] ?? null, label: null })) } }) },
    progress: { report: async (accountId: string, report: any) => { reports.push({ accountId, report }); return { ok: true, data: undefined }; } },
  };
}

function hooks(over: Parameters<typeof createEmailDeskHooks>[0] = {}, p = platform()) {
  const h = createEmailDeskHooks({
    platform: () => p, now: () => clock, sleep: async () => {}, log: () => {}, heartbeatMs: 0,
    firstRead: async (_p, a) => { events.push(`read ${a}`); return "read"; },
    voice: async (_p, a) => { events.push(`voice ${a}`); return { started: true }; },
    settle: async () => 0,
    ...over,
  });
  return { h, p };
}

const seedExtracted = (account: string) =>
  db.run("INSERT INTO ingest_comprehension (source_id, account_id, event_id, consumer, state, reason, attempts, updated_at) VALUES ('gmail', ?, 'm1', 'memory', 'extracted', 'handed_over', 0, 1)", [account]);
const seedCursor = (account: string) =>
  db.run("INSERT INTO ingest_cursors (source_id, account_id, cursor, updated_at) VALUES ('gmail', ?, '1700000000000', 1)", [account]);

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-life-")));
  _setStoreForTesting(db);
  clock = Date.UTC(2026, 10, 23, 9, 0);
  events = [];
  reports = [];
  mid = {};
});
afterEach(() => {
  _setStoreForTesting(null);
  db.close();
});

describe("initialize", () => {
  test("initialize runs extract then voice per mailbox, reporting progress with today's wording", async () => {
    const { h, p } = hooks({
      firstRead: async (_p, a) => { events.push(`read ${a}`); mid[`read:${a}`] = await h.progress!(); return "read"; },
      voice: async (_p, a) => { events.push(`voice ${a}`); mid[`voice:${a}`] = await h.progress!(); return { started: true }; },
    });
    await h.initialize!({ reason: "onboarding", platform: p });
    // One mailbox after the other: its read, then its voice, then the next mailbox.
    expect(events).toEqual([`read ${A1}`, `voice ${A1}`, `read ${A2}`, `voice ${A2}`]);
    // The words of the built-in desk, in the built-in desk's order, per mailbox.
    for (const a of [A1, A2]) {
      const lines = reports.filter((r) => r.accountId === a).map((r) => r.report);
      expect(lines.map((l) => l.status)).toEqual(["in_progress", "in_progress", "in_progress", "done"].slice(0, lines.length));
      expect(lines.find((l) => l.phase === "reading")).toMatchObject({ status: "in_progress", activeLabel: "Reading your email and learning about you…" });
      expect(lines.find((l) => l.phase === "voice")).toMatchObject({ status: "in_progress", activeLabel: "Learning your email communication style…" });
      expect(lines[lines.length - 1]).toEqual({ status: "done", phase: "drafting", doneLabel: "Setup complete. Your assistant will prepare replies as mail arrives." });
    }
    // The rows the panel showed while it ran.
    const rowOf = (key: string, a: string) => (mid[key] as any[]).find((i) => i.id === a);
    expect(rowOf(`read:${A1}`, A1)).toEqual({ id: A1, title: EMAILS[A1], message: READING_LABEL, state: "running" });
    expect(rowOf(`voice:${A1}`, A1)).toEqual({ id: A1, title: EMAILS[A1], message: VOICE_LABEL, state: "running" });
    // Setup is done for both, and the row says so, then goes after its linger.
    expect(await h.progress!()).toEqual([
      { id: A1, title: EMAILS[A1], message: SETUP_DONE_LABEL, state: "done" },
      { id: A2, title: EMAILS[A2], message: SETUP_DONE_LABEL, state: "done" },
    ]);
    clock += DONE_VISIBLE_MS;
    expect(await h.progress!()).toEqual([]);
    expect(h.status!(A1)).toBe(true);
  });

  test("the panel counts the emails read so far while reading", async () => {
    const { h, p } = hooks({
      firstRead: async (_p, a) => { seedExtracted(a); db.run("INSERT INTO ingest_comprehension (source_id, account_id, event_id, consumer, state, attempts, updated_at) VALUES ('gmail', ?, 'm2', 'memory', 'extracted', 0, 1)", [a]); mid.read = await h.progress!(); return "read"; },
    }, platform([A1]));
    await h.initialize!({ reason: "onboarding", platform: p });
    expect((mid.read as any[])[0]).toMatchObject({ message: "Read 2 emails so far", state: "running" });
  });

  test("initialize for named accounts reads only those", async () => {
    const { h, p } = hooks();
    await h.initialize!({ reason: "account-added", accountIds: [A2], platform: p });
    expect(events).toEqual([`read ${A2}`, `voice ${A2}`]);
  });

  test("a mailbox another reader holds is read again, then goes on", async () => {
    let tries = 0;
    const { h, p } = hooks({ firstRead: async (_p, a) => { events.push(`read ${a}`); return ++tries < 3 ? "busy" : "read"; } }, platform([A1]));
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(events.filter((e) => e.startsWith("read")).length).toBe(3);
    expect(isInitialized(db, A1, clock)).toBe(true);
  });

  test("a first read that did not land stays owed, says so, and a failing voice crawl does not stop setup", async () => {
    const { h, p } = hooks({
      firstRead: async () => "failed",
      voice: async () => { throw new Error("no model"); },
    }, platform([A1]));
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(reports[reports.length - 1]!.report).toEqual({ status: "owed", phase: "reading", activeLabel: STILL_LABEL });
    expect(await h.progress!()).toEqual([{ id: A1, title: EMAILS[A1], message: STILL_LABEL, state: "running" }]);
    expect(isInitialized(db, A1, clock)).toBe(false);
    // The gate is released: the mailbox's sequence ended.
    expect(h.status!(A1)).toBe(true);
  });

  test("a throw in the first read leaves the mailbox owed, never a hanging row", async () => {
    const { h, p } = hooks({ firstRead: async () => { throw new Error("boom"); } }, platform([A1]));
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(reports[reports.length - 1]!.report.status).toBe("owed");
    expect(h.status!(A1)).toBe(true);
  });

  test("a second initialize for a mailbox that is done reads nothing", async () => {
    const { h, p } = hooks({}, platform([A1]));
    await h.initialize!({ reason: "onboarding", platform: p });
    events.length = 0;
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(events).toEqual([]);
    expect(reports[reports.length - 1]!.report).toMatchObject({ status: "done" });
  });

  test("owner's db with an old cursor: initialize does not re-harvest from scratch", async () => {
    // The moved db: the built-in desk's journal, its extracted ledger and its cursor, and no lifecycle row (it kept that
    // elsewhere). Each of the three is enough alone; a fresh mailbox is read.
    seedExtracted(A1);
    seedCursor(A2);
    recordHarvestRun("acct-3", clock - 3_600_000);
    expect(historyOf(db, A1)).toBe("extracted");
    expect(historyOf(db, A2)).toBe("cursor");
    expect(historyOf(db, "acct-3")).toBe("last_harvest");
    expect(historyOf(db, "acct-4")).toBeNull();
    const all = [A1, A2, "acct-3", "acct-4"];
    const { h, p } = hooks({}, platform(all));
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(events).toEqual(["read acct-4", "voice acct-4"]);
    // The others are done at once, and the db now says so: the next run continues incrementally.
    for (const a of [A1, A2, "acct-3"]) {
      expect(reports.filter((r) => r.accountId === a).map((r) => r.report)).toEqual([{ status: "done", phase: "drafting", doneLabel: SETUP_DONE_LABEL }]);
      expect(db.query("SELECT outcome FROM lifecycle_state WHERE account_id = ? AND stage = 'sequence'").get(a)).toEqual({ outcome: "done" });
    }
    // Nothing was written to the journal or its cursor by the check.
    expect(db.query("SELECT cursor FROM ingest_cursors WHERE account_id = ?").get(A2)).toEqual({ cursor: "1700000000000" });
  });

  test("a cursor row with no cursor value is not history", () => {
    db.run("INSERT INTO ingest_cursors (source_id, account_id, cursor, updated_at) VALUES ('gmail', ?, NULL, 1)", [A1]);
    expect(historyOf(db, A1)).toBeNull();
  });
});

describe("a mailbox waiting behind a long sequence", () => {
  test("is not taken for dead: read once, held by the gate until read, never queued twice", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const { h, p } = hooks({
      firstRead: async (_p, a) => { events.push(`read ${a}`); if (a === A1) { await held; } return "read"; },
    });
    const first = h.initialize!({ reason: "onboarding", platform: p });
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([`read ${A1}`]);
    clock += STALL_MS + 60_000; // the first sequence outlives the stall bound
    expect(h.status!(A2)).toBe(false);
    await h.tick!({ readRoutines: [], platform: p });
    await h.tick!({ readRoutines: [], platform: p });
    await h.initialize!({ reason: "onboarding", platform: p });
    expect(events).toEqual([`read ${A1}`]);
    expect(h.status!(A2)).toBe(false);
    release();
    await first;
    expect(events.filter((e) => e === `read ${A2}`).length).toBe(1);
    expect(events.filter((e) => e === `voice ${A2}`).length).toBe(1);
    expect(h.status!(A2)).toBe(true);
  });
});

describe("status", () => {
  test("held while a sequence is live, released when it ends or stalls, open for a mailbox with no row", () => {
    const { h } = hooks();
    expect(h.status!(A1)).toBe(true);
    db.run("INSERT INTO lifecycle_state (account_id, stage, started_at, last_progress_at, updated_at) VALUES (?, 'sequence', ?, ?, ?)", [A1, clock, clock, clock]);
    expect(h.status!(A1)).toBe(false);
    clock += STALL_MS;
    expect(h.status!(A1)).toBe(true);
  });
});

describe("tick", () => {
  test("tick runs owed work only", async () => {
    const settled: string[] = [];
    const { h, p } = hooks({ settle: async (_p, a, owner) => { settled.push(`${a}:${owner}`); return 0; } }, platform([A1, A2, "acct-3", "acct-4"]));
    // A1: finished long ago. A2: failed but inside its backoff. acct-3: failed past its backoff. acct-4: no row, no history.
    const sequence = (a: string, over: { finished?: number; outcome?: string; last?: number }) =>
      db.run("INSERT INTO lifecycle_state (account_id, stage, started_at, finished_at, outcome, last_progress_at, updated_at) VALUES (?, 'sequence', ?, ?, ?, ?, ?)",
        [a, clock - 1e7, over.finished ?? null, over.outcome ?? null, over.last ?? null, clock]);
    sequence(A1, { finished: clock - 1e7, outcome: "done", last: clock - 1e7 });
    sequence(A2, { finished: clock - 60_000, outcome: "failed", last: clock - 60_000 });
    sequence("acct-3", { finished: clock - RETRY_AFTER_MS, outcome: "failed", last: clock - RETRY_AFTER_MS });
    await h.tick!({ readRoutines: [], platform: p });
    expect(events.sort()).toEqual(["read acct-3", "read acct-4", "voice acct-3", "voice acct-4"]);
    // Nothing owed on the next tick.
    events.length = 0;
    await h.tick!({ readRoutines: [], platform: p });
    expect(events).toEqual([]);
    expect(settled).toEqual([]);
  });

  test("a sequence whose process died is resumed, a live one is not", async () => {
    const { h, p } = hooks({}, platform([A1]));
    db.run("INSERT INTO lifecycle_state (account_id, stage, started_at, last_progress_at, updated_at) VALUES (?, 'sequence', ?, ?, ?)", [A1, clock - STALL_MS - 1, clock - STALL_MS - 1, clock]);
    await h.tick!({ readRoutines: [], platform: p });
    expect(events).toEqual([`read ${A1}`, `voice ${A1}`]);
    // Fresh progress: left alone.
    events.length = 0;
    db.run("UPDATE lifecycle_state SET finished_at = NULL, outcome = NULL, last_progress_at = ? WHERE stage = 'sequence'", [clock - 1000]);
    await h.tick!({ readRoutines: [], platform: p });
    expect(events).toEqual([]);
  });

  test("a follow-up TODO's thread is checked for a reply, only for a mailbox that has one", async () => {
    const settled: string[] = [];
    const { h, p } = hooks({ settle: async (_p, a, owner) => { settled.push(`${a}:${owner}`); return 0; } }, platform([A1, A2]));
    await h.initialize!({ reason: "onboarding", platform: p });
    putFollowUp({ accountId: A2, threadId: "t1", ownerMsgKey: "k", status: "offered", checkedAt: clock - 1000 });
    await h.tick!({ readRoutines: [], platform: p });
    expect(settled).toEqual([`${A2}:${EMAILS[A2]}`]);
  });

  test("one mailbox failing in the tick does not stop the next", async () => {
    const { h, p } = hooks({ firstRead: async (_p, a) => { events.push(`read ${a}`); if (a === A1) throw new Error("boom"); return "read"; } }, platform([A1, A2]));
    await h.tick!({ readRoutines: [], platform: p });
    expect(events).toContain(`read ${A2}`);
  });
});

describe("the first read reuses the routine's run", () => {
  const mail = (n: number): KeptMail => ({
    accountId: A1, threadId: `t-${n}`, messageId: `m-${n}`, from: `Asha <asha${n}@acme.com>`, to: "me@acme.com",
    date: new Date(Date.UTC(2026, 10, 23, 9, n)).toISOString(), subject: `Subject ${n}`,
    body: `From: Asha <asha${n}@acme.com>\nAre you free? (${n})${THREAD_BODY_SEPARATOR}From: Asha <asha${n}@acme.com>\nReply please.`,
    mailboxKind: "work", draftEligible: true,
  });
  function ctx(extractOk = true) {
    const woke: string[] = [];
    const extracted: any[] = [];
    const c: any = {
      routine: { id: "app", appRoutineId: "app", handler: "app", agentId: "pa-1", name: "Email Desk", accounts: { gmail: A1 }, trigger: {}, values: {} },
      trigger: "manual",
      platform: {
        appId: "email-desk", dataDir: "test", pairedAgent: { id: "pa-1", name: "Butler" },
        connectors: { accounts: async () => ({ ok: true, data: { accounts: [{ accountId: A1, email: EMAILS[A1], label: null }] } }) },
        memory: { extract: async (items: any[]) => { extracted.push(...items); return extractOk ? { ok: true, data: { ok: true, processedItems: items.length, failedItems: 0, deferredItems: 0 } } : { ok: false, reason: "refused" }; } },
        tasks: { list: async () => ({ ok: true, data: { tasks: [] } }) },
      },
      connectors: { exec: async () => ({ ok: false, reason: "unused" }) },
      wakeAgent: async (m: string) => { woke.push(m); return { ok: true, data: {} }; },
      notify: async () => ({ ok: true, data: { delivered: 0 } }),
      state: { get: () => null, set: () => {} },
    };
    return { c, woke, extracted };
  }
  const gather = (kept: KeptMail[], over: object = {}) => async () => ({ kept, skipped: 0, deferred: 0, cursor: "1", ...over }) as any;
  beforeEach(() => _setLogForTesting(() => {}));
  afterEach(() => _setLogForTesting(null));

  test("mail goes into memory and is handed over, the harvest is stamped, nothing wakes the agent", async () => {
    const { c, woke, extracted } = ctx();
    const handed: string[][] = [];
    const out = await runFirstRead(c, A1, EMAILS[A1], { gather: gather([mail(1)]), handOver: (ids) => { handed.push([...ids]); } });
    expect(out).toBe("read");
    expect(extracted.length).toBe(1);
    expect(handed).toEqual([["m-1"]]);
    expect(woke).toEqual([]);
    expect(historyOf(db, A1)).toBe("last_harvest");
    // The reply offer waits for the routine's run, which wakes for it.
    expect(db.query("SELECT COUNT(*) AS n FROM app_meta WHERE key LIKE 'draft-offer:%'").get()).toEqual({ n: 1 });
  });

  test("a held mailbox is busy and stamps nothing; a refused extraction fails and leaves the mail pending", async () => {
    const a = ctx();
    expect(await runFirstRead(a.c, A1, null, { gather: gather([], { busy: true, note: "mailbox busy" }) })).toBe("busy");
    expect(historyOf(db, A1)).toBeNull();
    const b = ctx(false);
    const handed: string[][] = [];
    expect(await runFirstRead(b.c, A1, null, { gather: gather([mail(1)]), handOver: (ids) => { handed.push([...ids]); } })).toBe("failed");
    expect(handed).toEqual([]);
    expect(historyOf(db, A1)).toBeNull();
    expect(await runFirstRead(a.c, A1, null, { gather: async () => { throw new Error("list failed"); } })).toBe("failed");
  });

  test("the window is the built-in desk's landing window", () => {
    expect(FIRST_READ_WINDOW).toEqual({ openDays: 14, horizonDays: 30, maxThreads: 10 });
  });
});

describe("delete my mail data", () => {
  const PERSON = { "x-flock-user": "u1", "x-flock-role": "member", "content-type": "application/json" };
  const app = () => new Hono().route("/", removalRoutes() as never);
  const post = (headers: Record<string, string>, body?: unknown) =>
    app().request("/api/mail-data/delete", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const count = (t: string) => (db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

  function seedMail() {
    seedExtracted(A1);
    seedCursor(A1);
    db.run("INSERT INTO ingest_events (source_id, account_id, event_id, kind, ts, created_at) VALUES ('gmail', ?, 'm1', 'email', 1, 1)", [A1]);
    db.run("INSERT INTO reply_messages (account_id, thread_id, kind, from_addr, body, updated_at) VALUES (?, 't1', 'reply', 'a@b.c', 'hello', 1)", [A1]);
    db.run("INSERT INTO voice_profile (account_id, dimension, value, source, updated_at) VALUES (?, 'greeting', 'Hi', 'voice-crawl', 1)", [A1]);
    db.run("INSERT INTO lifecycle_state (account_id, stage, updated_at) VALUES (?, 'sequence', 1)", [A1]);
    recordHarvestRun(A1);
  }

  test("delete needs the confirm flag and removes only the app's own data", async () => {
    seedMail();
    // No confirm, a wrong confirm, no body: nothing goes.
    expect((await post(PERSON, {})).status).toBe(400);
    expect((await post(PERSON, { confirm: "true" })).status).toBe(400);
    expect((await post(PERSON)).status).toBe(400);
    expect(count("ingest_events")).toBe(1);
    // An agent, a shared viewer and nobody are refused even with the confirm.
    expect((await post({ ...PERSON, "x-flock-agent": "pa-1" }, { confirm: true })).status).toBe(403);
    expect((await post({ ...PERSON, "x-flock-role": "app_viewer" }, { confirm: true })).status).toBe(403);
    expect((await post({ "content-type": "application/json" }, { confirm: true })).status).toBe(403);
    expect(count("ingest_events")).toBe(1);

    const res = await post(PERSON, { confirm: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ok).toBe(true);
    for (const t of ["ingest_events", "ingest_comprehension", "ingest_cursors", "reply_messages", "voice_profile", "lifecycle_state", "app_meta"]) expect(count(t)).toBe(0);
    // The store stays healthy: the schema is there, and the copy goes on from nothing.
    expect(historyOf(db, A1)).toBeNull();
    db.run("INSERT INTO app_meta (key, value, updated_at) VALUES ('k', 'v', 1)");
    expect(count("app_meta")).toBe(1);
    // Idempotent.
    expect((await post(PERSON, { confirm: true })).status).toBe(200);
  });

  test("the delete route reaches no platform call: memory and TODOs are not its to touch", () => {
    // removalRoutes takes no platform context, and its module imports neither the SDK's memory nor tasks.
    expect(removalRoutes.length).toBe(0);
  });
});
