// The person replied to a thread in Gmail itself (owner-approved 2026-11-23): whenever the app reads a thread and its newest
// message is the person's own (from one of the copy's own addresses) and newer than an open item, that item closes. The
// copy's own draft card comes down as replied (no send, no chat line), its record is marked replied in Gmail, a send hold on
// the thread resolves as sent; the copy's own follow-up TODO closes as replied; and Flock is told once per newest message
// (`POST /api/apps/:appId/tasks/thread-replied`), its failures logged, never fatal.
// Mail dates have no zone: they read in the process zone, so the tests pin it.
process.env.TZ = "Asia/Kolkata";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { recordDraft, getDraft, openDraftForThread } from "../drafts/records";
import { getFollowUp, putFollowUp } from "../routines/follow-up-store";
import { closeIfRepliedInGmail, _setRepliedLogForTesting } from "../replied-in-gmail";
import { runFollowUpForAccount, _resetFollowUpPassMemoryForTesting, type FollowUpDeps } from "../routines/follow-up";
import { readThreadInTurn } from "../desk-thread";
import { gatherNewMail } from "../routines/gather";

const OWNER = "shiva@bimacred.com";
const OTHER_OWN = "shiva.home@gmail.com";
const ACCT = "acct-1";
const THREAD = "18a1b2c3d4e5f601";
const DRAFTED_AT = Date.parse("2026-09-30T10:00:00+05:30");
const PRIYA_AT = "Wed, 30 Sept 2026, 09:30";
const MY_REPLY_AT = "Wed, 30 Sept 2026, 11:15";

const msg = (from: string, date: string, body = "Any update on the MSA?") => ({ from, to: [OWNER], cc: [], date, body });
const priya = (date: string) => msg("Priya Shah <priya@acme.com>", date);
const me = (date: string, addr = OWNER) => ({ ...msg(`Shiva <${addr}>`, date, "Sent it, see attached."), to: ["Priya Shah <priya@acme.com>"] });
const read = (...messages: any[]) => ({ threadId: THREAD, subject: "MSA", messages, incomplete: false });

let db: Database;
let logs: string[];
const saved = { ...process.env };
const realFetch = globalThis.fetch;
let posts: Array<{ url: string; auth: string | null; body: any }>;
let answer: { status: number; body: unknown };

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-replied-")));
  _setStoreForTesting(db);
  _resetFollowUpPassMemoryForTesting();
  logs = [];
  _setRepliedLogForTesting((line) => { logs.push(line); });
  // Paired: the app's own token reaches Flock's route (the SDK transport reads the launch env).
  process.env.APP_ID = "email-desk-p1";
  process.env.FLOCK_API_URL = "http://flock.test";
  process.env.FLOCK_APP_TOKEN = "app-token-1";
  posts = [];
  answer = { status: 200, body: { closed: 1 } };
  globalThis.fetch = (async (url: any, init: any) => {
    posts.push({ url: String(url), auth: init?.headers?.authorization ?? null, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ["APP_ID", "FLOCK_API_URL", "FLOCK_APP_TOKEN"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  _setRepliedLogForTesting(null);
  _setStoreForTesting(null);
  db.close();
});

function platform() {
  const withdrawn: Array<{ ref: string; reason?: string }> = [];
  const published: any[] = [];
  const p: any = {
    appId: "email-desk-p1", pairedAgent: { id: "pa-1", name: "Butler" }, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [{ accountId: ACCT, email: OWNER }, { accountId: "acct-2", email: OTHER_OWN }] } }),
    },
    tasks: {
      publish: async (t: any) => { published.push(t); return { ok: true, data: {} }; },
      withdraw: async (ref: string, opts?: { reason?: string }) => { withdrawn.push({ ref, reason: opts?.reason }); return { ok: true, data: undefined }; },
    },
  };
  return { p, withdrawn, published };
}

function seedDraft(at = DRAFTED_AT) {
  return recordDraft(db, { accountId: ACCT, threadId: THREAD, draftId: "gd-1", bodyWritten: "Thanks Priya, will send it today." }, at);
}
function seedFollowUp(offeredAt = DRAFTED_AT) {
  putFollowUp({ accountId: ACCT, threadId: THREAD, ownerMsgKey: "owner:Thu, 24 Sept 2026, 10:00", status: "offered", checkedAt: offeredAt, offeredAt, recipientName: "Priya" });
}
function seedHold(draftId: string, at = DRAFTED_AT + 60_000) {
  db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [`draft:${draftId}`, ACCT, THREAD, "gd-1", "in_flight", null, at, at]);
}
const ledger = () => db.query("SELECT state FROM send_ledger WHERE account_id = ? AND thread_id = ?").all(ACCT, THREAD) as Array<{ state: string }>;

describe("the person replied in Gmail", () => {
  test("their newer message closes the draft card, the follow-up TODO and the send hold, and tells Flock once", async () => {
    const draft = seedDraft();
    seedFollowUp();
    seedHold(draft.id);
    const { p, withdrawn, published } = platform();

    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));

    expect(out).toMatchObject({ replied: true, draftClosed: true, followUpClosed: true, holdsResolved: 1, flockCalled: true });
    // The card is withdrawn as replied: nothing is sent and nothing is published (no chat line).
    expect(withdrawn).toContainEqual({ ref: `draft:${draft.id}`, reason: "replied" });
    expect(published).toEqual([]);
    // The record is closed as replied in Gmail, not deleted: the thread has no open draft.
    expect(openDraftForThread(db, ACCT, THREAD)).toBeNull();
    const after = getDraft(db, draft.id)!;
    expect(after.sentBy).toBe("replied-in-gmail");
    expect(after.sentAt).toBe(Date.parse("2026-09-30T11:15:00+05:30"));
    expect(ledger()).toEqual([{ state: "sent" }]);
    // The follow-up TODO comes down as replied.
    expect(withdrawn).toContainEqual({ ref: `follow-up:${THREAD}`, reason: "replied" });
    expect(getFollowUp(ACCT, THREAD)?.status).toBe("replied");
    // Flock is told with the app's own token.
    expect(posts).toEqual([{
      url: "http://flock.test/api/apps/email-desk-p1/tasks/thread-replied", auth: "Bearer app-token-1",
      body: { accountId: ACCT, threadId: THREAD },
    }]);
  });

  test("a reply from another of the copy's own addresses counts as the person's", async () => {
    const draft = seedDraft();
    const { p } = platform();
    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT, OTHER_OWN)));
    expect(out.draftClosed).toBe(true);
    expect(getDraft(db, draft.id)!.sentBy).toBe("replied-in-gmail");
  });

  test("a second read of the same thread does not call Flock again", async () => {
    seedDraft();
    const { p } = platform();
    await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    const again = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    expect(again.flockCalled).toBe(false);
    expect(posts.length).toBe(1);
  });

  test("the same message read in another view (another date and body text) is not a new message", async () => {
    const { p } = platform();
    await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), { ...me("Sep 30, 2026, 11:15 AM"), body: "Sent it, see attached.\n> quoted" }));
    expect(posts.length).toBe(1);
  });

  test("a newer message of the person's on the same thread is told to Flock again", async () => {
    const { p } = platform();
    await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT), priya("Wed, 30 Sept 2026, 12:00"), me("Wed, 30 Sept 2026, 13:00")));
    expect(posts.length).toBe(2);
  });

  test("someone else's newer message closes nothing and does not call Flock", async () => {
    const draft = seedDraft();
    seedFollowUp();
    seedHold(draft.id);
    const { p, withdrawn } = platform();
    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(me("Wed, 30 Sept 2026, 09:00"), priya(MY_REPLY_AT)));
    expect(out).toMatchObject({ replied: false, draftClosed: false, followUpClosed: false, holdsResolved: 0, flockCalled: false });
    expect(withdrawn).toEqual([]);
    expect(openDraftForThread(db, ACCT, THREAD)?.id).toBe(draft.id);
    expect(getFollowUp(ACCT, THREAD)?.status).toBe("offered");
    expect(ledger()).toEqual([{ state: "in_flight" }]);
    expect(posts).toEqual([]);
  });

  test("the person's own message from before the draft and the TODO closes neither", async () => {
    // The person spoke last, then asked for a draft in chat: their older message is not a reply to it.
    const draft = seedDraft();
    seedFollowUp();
    const { p, withdrawn } = platform();
    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya("Wed, 30 Sept 2026, 08:00"), me("Wed, 30 Sept 2026, 09:00")));
    expect(out).toMatchObject({ replied: true, draftClosed: false, followUpClosed: false });
    expect(withdrawn).toEqual([]);
    expect(openDraftForThread(db, ACCT, THREAD)?.id).toBe(draft.id);
    expect(getFollowUp(ACCT, THREAD)?.status).toBe("offered");
  });

  test("Flock's 403 and 500 are logged, not thrown, and the local items still close", async () => {
    for (const status of [403, 500]) {
      seedDraft();
      answer = { status, body: { error: status === 403 ? "not an Email Desk copy" : "boom" } };
      const { p } = platform();
      const out = await closeIfRepliedInGmail(p, ACCT, `${THREAD}-${status}`, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
      expect(out.flockCalled).toBe(true);
      expect(logs.some((l) => l.includes(String(status)) && l.includes("thread-replied"))).toBe(true);
    }
    const draft = seedDraft();
    answer = { status: 500, body: { error: "boom" } };
    const { p } = platform();
    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    expect(out.draftClosed).toBe(true);
    expect(getDraft(db, draft.id)!.sentBy).toBe("replied-in-gmail");
  });

  test("an unpaired copy closes its own items and calls nothing", async () => {
    delete process.env.FLOCK_APP_TOKEN;
    seedDraft();
    const { p } = platform();
    const out = await closeIfRepliedInGmail(p, ACCT, THREAD, read(priya(PRIYA_AT), me(MY_REPLY_AT)));
    expect(out.draftClosed).toBe(true);
    expect(posts).toEqual([]);
  });
});

describe("the reads that look", () => {
  test("the follow-up routine's read closes the TODO, tells Flock, and a Flock 500 does not stop the pass", async () => {
    const NOW = Date.parse("2026-09-30T12:00:00+05:30");
    seedFollowUp(DRAFTED_AT);
    answer = { status: 500, body: { error: "boom" } };
    const threads: Record<string, any> = {
      [THREAD]: read(priya("Tue, 22 Sept 2026, 10:00"), me("Thu, 24 Sept 2026, 10:00"), me(MY_REPLY_AT)),
      "t-2": { ...read(priya("Tue, 22 Sept 2026, 10:00"), me("Thu, 24 Sept 2026, 10:00")), threadId: "t-2" },
    };
    const { p, withdrawn, published } = platform();
    p.connectors.exec = async (req: any) => {
      if (req.functionName === "searchEmails") return { ok: true, data: [{ id: THREAD, dateFull: MY_REPLY_AT }, { id: "t-2", dateFull: "Thu, 24 Sept 2026, 10:00" }] };
      if (req.functionName === "getThread") return { ok: true, data: threads[req.params.threadId] };
      return { ok: false, reason: "unexpected" };
    };
    p.connectors.readTurn = async () => ({ ok: true, data: { turnId: "turn-1", accountId: ACCT, release: async () => {} } });
    const ctx: any = { routine: { id: "r1", accounts: { gmail: ACCT } }, platform: p, connectors: { exec: (s: string, fn: string, params: any, o: any) => p.connectors.exec({ skillId: s, functionName: fn, params, accountHint: o?.account, turnId: o?.turnId }) } };
    const deps: FollowUpDeps = { now: () => NOW, tz: () => "Asia/Kolkata", sleep: async () => {}, log: () => {}, rules: async () => null };

    const tally = await runFollowUpForAccount(ctx, ACCT, OWNER, { businessDays: 3, lookbackDays: 14, maxReads: 10, dailyLimit: 25 }, deps);

    expect(withdrawn).toContainEqual({ ref: `follow-up:${THREAD}`, reason: "replied" });
    expect(getFollowUp(ACCT, THREAD)?.status).not.toBe("offered");
    expect(posts.filter((x) => x.body?.threadId === THREAD).length).toBe(1);
    expect(logs.some((l) => l.includes("500"))).toBe(true);
    // The pass went on to the next thread and raised its TODO.
    expect(published.map((t) => t.sourceRef)).toEqual(["follow-up:t-2"]);
    expect(tally.completed).toBe(true);
  });

  test("the memory gather's thread read closes the open draft and tells Flock", async () => {
    const at = (minutesAgo: number) => {
      const d = new Date(Date.now() - minutesAgo * 60_000);
      const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const draft = seedDraft(Date.now() - 60 * 60_000);
    const { p, withdrawn } = platform();
    p.connectors.readTurn = async () => ({ ok: true, data: { turnId: "turn-1", accountId: ACCT, release: async () => {} } });
    const thread = read(priya(at(90)), me(at(10)));
    const exec = async (_s: string, fn: string, params: any) => {
      if (fn === "listInbox") return { ok: true, data: [{ id: THREAD, from: "Priya Shah <priya@acme.com>", subject: "MSA", snippet: "Any update", date: "", dateFull: at(90), isUnread: true }] };
      if (fn === "searchEmails") return { ok: true, data: [] };
      if (fn === "getThreads") return { ok: true, data: { threads: [thread] } };
      // The person has written to acme.com: the thread is not cold outreach, so the gather reads it.
      if (fn === "checkEngagedDomains") return { ok: true, data: params.domains };
      return { ok: false, reason: `unexpected ${fn}` };
    };
    const ctx: any = { routine: { id: "r1", accounts: { gmail: ACCT } }, platform: p, connectors: { exec } };

    await gatherNewMail(ctx, ACCT);

    expect(withdrawn).toContainEqual({ ref: `draft:${draft.id}`, reason: "replied" });
    expect(getDraft(db, draft.id)!.sentBy).toBe("replied-in-gmail");
    expect(posts.map((x) => x.body)).toEqual([{ accountId: ACCT, threadId: THREAD }]);
  });

  test("a desk thread read (reply_context, the on-demand fetch) closes the open draft", async () => {
    const draft = seedDraft();
    const { p, withdrawn } = platform();
    p.connectors.readTurn = async () => ({ ok: true, data: { turnId: "turn-1", accountId: ACCT, release: async () => {} } });
    p.connectors.exec = async () => ({ ok: true, data: read(priya(PRIYA_AT), me(MY_REPLY_AT)) });
    const got = await readThreadInTurn(p, ACCT, THREAD);
    expect(got.status).toBe("found");
    expect(withdrawn).toContainEqual({ ref: `draft:${draft.id}`, reason: "replied" });
    expect(posts.length).toBe(1);
  });
});
