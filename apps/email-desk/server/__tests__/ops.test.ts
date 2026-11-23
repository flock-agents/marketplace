// reply_context and the platform ops, through the real ops router. Expectations from the Op contract table and the sources
// (reply-context.ts topicTerms/gather, store.ts newestStoredThreadMessage, follow-up-rules.ts followUpKindForTo,
// send-email.ts draftSendRecorded, the journal's donate door, pa-brief/bundle.ts), written before the code:
//   - reply_context answers thread, sender facts (memory by topic, else sender), voice (null and "none" while the mailbox
//     has learned none) and the thread's open draft; a thread of another mailbox of the same person works with no accountId;
//   - each platform op answers its contract shape, and none is reachable by a bad token;
//   - the manifest declares none of them (manifest.test.ts) yet the router serves them and send_draft.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createOpsRouter } from "@flock/app-sdk";
import { openStore, _setStoreForTesting } from "../store";
import { appendEvents, normalizeInboxRow, setEventBody, GMAIL_SOURCE } from "../journal";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { _setOpsLogForTesting } from "../ops";
import { _setLogForTesting } from "../drafts/card";
import { allOps } from "../registry";
import { replyContext } from "../reply-context";
import { recordHarvestRun } from "../platform-ops";
import { topicTerms, followUpKindForTo, senderOf, threadFromRead } from "../lib/reply-context";

const ME = "me@acme.com";
const A1 = "acct-1";
const A2 = "acct-2";
const T1 = "thread-1";
const T2 = "thread-2";
const TOKEN = "app-token";

let db: Database;
let calls: Array<{ functionName: string; accountHint?: string }>;
let memoryQueries: string[];
let gmailThread: any;
let gmailFails: boolean;
let accountsAnswer: any;
let published: any[];
let turnAnswer: (() => any) | null;
let released: string[];
let getThreadTurnIds: Array<string | undefined>;
/** Set: Gmail answers getThread per mailbox and thread (`account|thread`); a pair it lacks reads as no such thread. */
let gmailByThread: Map<string, any> | null;
let turnsAsked: string[];

function platform(): any {
  return {
    appId: "email-desk", pairedAgent: { id: "ia-1", name: "Inbox Assistant" }, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => accountsAnswer,
      readTurn: async (account: string) => { turnsAsked.push(account); return turnAnswer
        ? turnAnswer()
        : { ok: true, data: { turnId: `turn-${account}`, accountId: account, release: async () => { released.push(`turn-${account}`); } } }; },
      exec: async (req: any) => {
        calls.push({ functionName: req.functionName, accountHint: req.accountHint });
        if (req.functionName === "getThread") {
          getThreadTurnIds.push(req.turnId);
          if (gmailFails) return { ok: false, reason: "mailbox busy" };
          if (gmailByThread) {
            const tid = String(req.params?.threadId ?? "");
            return { ok: true, data: gmailByThread.get(`${req.accountHint}|${tid}`) ?? { threadId: tid, subject: "", messages: [], incomplete: true, reason: "print view returned no messages" } };
          }
          return { ok: true, data: gmailThread };
        }
        if (req.functionName === "createReplyDraft") return { ok: true, data: { draftId: "gm-1", draftMessageId: "m-1", bodyAsSaved: String(req.params.body) } };
        // Gmail still holds the draft it wrote.
        if (req.functionName === "getDraft") return { ok: true, data: { draftId: req.params.draftId, body: "held" } };
        return { ok: false, reason: `unexpected ${req.functionName}` };
      },
    },
    memory: {
      search: async (q: string) => { memoryQueries.push(q); return { ok: true, data: { facts: q === "Tuesday" ? ["Asha runs the Acme account", "Asha prefers mornings"] : [] } }; },
    },
    tasks: { publish: async (t: any) => { published.push(t); return { ok: true, data: {} }; }, withdraw: async () => ({ ok: true, data: undefined }) },
  };
}

const router = () => createOpsRouter({ handlers: allOps, token: TOKEN, platform: platform() });
async function call(name: string, payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await router().request(`/ops/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
}

function seed(accountId: string, threadId: string, from: string, subject: string, segments: string[], day = 23): void {
  const r = normalizeInboxRow({ id: threadId, from, subject, snippet: segments[segments.length - 1]!, dateFull: `Mon, Nov ${day}, 2026, 9:00 AM` }, accountId, new Date(Date.UTC(2026, 10, day, 9, 0)));
  appendEvents(db, accountId, [r]);
  setEventBody(db, { sourceId: GMAIL_SOURCE, accountId, eventId: r.eventId }, segments.join(THREAD_BODY_SEPARATOR));
}

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-ops-")));
  _setStoreForTesting(db);
  _setLogForTesting(() => {});
  _setOpsLogForTesting(() => {});
  calls = []; memoryQueries = []; published = [];
  gmailFails = false; turnAnswer = null; released = []; getThreadTurnIds = []; gmailByThread = null; turnsAsked = [];
  gmailThread = {
    threadId: T1, subject: "Re: Tuesday?",
    messages: [
      { from: `Me <${ME}>`, to: ["Asha Rao <asha@acme.com>"], cc: [], date: "Mon, 23 Nov 2026, 08:00", body: "How about next week?" },
      { from: "Asha Rao <asha@acme.com>", to: [ME], cc: [], date: "Mon, 23 Nov 2026, 09:00", body: "Are you free on Tuesday?" },
    ],
  };
  accountsAnswer = { ok: true, data: { accounts: [{ accountId: A1, email: ME, label: null }, { accountId: A2, email: "me@home.com", label: null }] } };
  seed(A1, T1, "Asha Rao <asha@acme.com>", "Tuesday?", [`From: Me <${ME}>\nHow about next week?`, "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?"]);
});
afterEach(() => {
  _setStoreForTesting(null);
  _setLogForTesting(null);
  _setOpsLogForTesting(null);
  db.close();
});

describe("pure helpers (ported)", () => {
  test("topicTerms: key terms without reply prefixes or filler", () => {
    expect(topicTerms("Re: PNB Metlife status")).toBe("PNB Metlife");
    expect(topicTerms("RE: Fwd: Employment Verification of Shubham Banerjee- BCGNDEAB040 -Emp 1")).toBe("Employment Verification Shubham Banerjee BCGNDEAB040 Emp");
    expect(topicTerms("Quick question")).toBe("");
    expect(topicTerms("")).toBe("");
  });
  test("followUpKindForTo: the first address, bare and lower-cased", () => {
    expect(followUpKindForTo('"Rao, Keshav" <Keshav@Acme.com>, ravi@acme.com')).toBe("keshav@acme.com");
    expect(followUpKindForTo(["Keshav <keshav@acme.com>", "Ravi <ravi@acme.com>"])).toBe("keshav@acme.com");
    expect(followUpKindForTo(["Keshav"])).toBeNull();
    expect(followUpKindForTo("")).toBeNull();
    expect(followUpKindForTo(null)).toBeNull();
  });
  test("threadFromRead caps the bodies and the message count", () => {
    const long = "x".repeat(10_000);
    const t = threadFromRead({ subject: "s", messages: Array.from({ length: 9 }, (_, i) => ({ from: `a${i}`, date: "d", body: long })) })!;
    expect(t.messages).toHaveLength(6);
    expect(t.messages[0]!.from).toBe("a3");
    expect(t.messages[0]!.body.length).toBeLessThanOrEqual(4_001);
    expect(threadFromRead({ subject: "s", messages: [] })).toBeNull();
  });
  test("senderOf: the newest message not from the mailbox", () => {
    expect(senderOf([{ from: "Asha <asha@acme.com>" }, { from: `Me <${ME}>` }], ME)).toBe("asha@acme.com");
  });
});

describe("reply_context", () => {
  test("answers the thread, sender facts, no voice yet, no draft", async () => {
    const { status, json } = await call("reply_context", { threadId: T1 });
    expect(status).toBe(200);
    expect(json.thread.subject).toBe("Re: Tuesday?");
    expect(json.thread.messages).toEqual([
      { from: `Me <${ME}>`, to: "Asha Rao <asha@acme.com>", date: "Mon, 23 Nov 2026, 08:00", body: "How about next week?" },
      { from: "Asha Rao <asha@acme.com>", to: ME, date: "Mon, 23 Nov 2026, 09:00", body: "Are you free on Tuesday?" },
    ]);
    expect(json.sender).toEqual({ facts: ["Asha runs the Acme account", "Asha prefers mornings"] });
    expect(memoryQueries).toEqual(["Tuesday"]);
    expect(json.voice).toBeNull();
    expect(json.voiceState).toBe("none");
    expect(json.existingDraft).toBeNull();
    expect(calls).toEqual([{ functionName: "getThread", accountHint: A1 }]);
    expect(getThreadTurnIds).toEqual([`turn-${A1}`]);
  });

  test("an open draft shows as existingDraft; a sent one does not", async () => {
    const made = await call("create_draft", { threadId: T1, body: "Hi Asha, Tuesday works." });
    expect(made.json.id).toBeTruthy();
    expect((await call("reply_context", { threadId: T1 })).json.existingDraft).toEqual({ id: made.json.id, body: "Hi Asha, Tuesday works." });
    db.run("UPDATE draft_records SET sent_at = 1 WHERE id = ?", [made.json.id]);
    expect((await call("reply_context", { threadId: T1 })).json.existingDraft).toBeNull();
  });

  test("a voice block from the injected reader is ready", async () => {
    const out: any = await replyContext({ threadId: T1 }, { platform: platform(), agentId: null, pressToken: null }, (acct) => `VOICE of ${acct}`);
    expect(out.voice).toBe(`VOICE of ${A1}`);
    expect(out.voiceState).toBe("ready");
  });

  test("a thread of another mailbox of the same person works", async () => {
    seed(A2, T2, "Dev <dev@club.org>", "Club night", ["From: Dev <dev@club.org>\nSaturday works for the club?"]);
    gmailThread = { threadId: T2, subject: "Club night", messages: [{ from: "Dev <dev@club.org>", to: ["me@home.com"], date: "Sat", body: "Saturday works for the club?" }] };
    const { status, json } = await call("reply_context", { threadId: T2 });
    expect(status).toBe(200);
    expect(json.thread.subject).toBe("Club night");
    expect(calls[0]).toEqual({ functionName: "getThread", accountHint: A2 });
    // Named explicitly, the same mailbox answers; named wrongly, it is not that mailbox's thread.
    expect((await call("reply_context", { threadId: T2, accountId: A2 })).status).toBe(200);
    // Named wrongly: A1's journal does not hold it, and A1's Gmail has no such thread.
    gmailByThread = new Map([[`${A2}|${T2}`, gmailThread]]);
    const wrong = await call("reply_context", { threadId: T2, accountId: A1 });
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe("NOT_DESK_THREAD");
  });

  test("the read runs under the mailbox's turn and releases it, also when Gmail fails", async () => {
    await call("reply_context", { threadId: T1 });
    expect(getThreadTurnIds).toEqual([`turn-${A1}`]);
    expect(released).toEqual([`turn-${A1}`]);
    gmailFails = true;
    await call("reply_context", { threadId: T1 });
    expect(released).toEqual([`turn-${A1}`, `turn-${A1}`]);
  });

  test("a refused turn (busy, quarantined, not_yours): the stored text answers and Gmail is not read", async () => {
    for (const code of ["busy", "quarantined", "not_yours"]) {
      turnAnswer = () => ({ ok: false, reason: code, code });
      calls.length = 0;
      const { status, json } = await call("reply_context", { threadId: T1 });
      expect(status).toBe(200);
      expect(json.thread.messages.map((m: any) => m.body)).toEqual(["How about next week?", "Are you free on Tuesday?"]);
      expect(calls).toEqual([]);
    }
    expect(released).toEqual([]);
  });

  test("a thread none of this person's mailboxes holds is NOT_DESK_THREAD, in plain words", async () => {
    gmailByThread = new Map();
    const out = await call("reply_context", { threadId: "nope" });
    expect(out.status).toBe(400);
    expect(out.json.code).toBe("NOT_DESK_THREAD");
    expect(out.json.error).toBe("There is no such email thread in this person's Gmail, so nothing was written.");
    // Each of the copy's own mailboxes was asked once, under its read turn; nothing was journaled.
    expect(calls).toEqual([{ functionName: "getThread", accountHint: A1 }, { functionName: "getThread", accountHint: A2 }]);
    expect(released).toEqual([`turn-${A1}`, `turn-${A2}`]);
    expect(db.query("SELECT COUNT(*) AS n FROM ingest_events WHERE thread_key = 'nope'").get()).toEqual({ n: 0 });
  });

  test("Gmail cannot be read: the stored thread answers", async () => {
    gmailFails = true;
    const { json } = await call("reply_context", { threadId: T1 });
    expect(json.thread.messages.map((m: any) => [m.from, m.body])).toEqual([
      [`Me <${ME}>`, "How about next week?"],
      ["Asha Rao <asha@acme.com>", "Are you free on Tuesday?"],
    ]);
    expect(json.thread.subject).toBe("Tuesday?");
  });

  test("no subject terms: memory is asked about the sender", async () => {
    gmailThread = { threadId: T1, subject: "Quick question", messages: [{ from: "Asha Rao <asha@acme.com>", to: [ME], date: "d", body: "hi" }] };
    await call("reply_context", { threadId: T1 });
    expect(memoryQueries).toEqual(["asha@acme.com"]);
  });
});

describe("an older thread the journal does not hold (the person's own ask)", () => {
  // Expectations (live 2026-11-23: "reply to contact.gshivashankar@gmail.com about the STK credit invoice", a thread
  // from 31 Oct, refused NOT_DESK_THREAD): the person's ask works for ANY thread of their own mailbox. Not in the
  // journal, the op reads it from Gmail once (under the mailbox's read turn, as the copy's own account), keeps it like a
  // gathered thread, then the usual draft rules apply. Only a thread Gmail does not have, or one named under an account
  // this copy does not hold, is refused; never a Gmail call with another account.
  const OLD = "thread-old";
  const oldThread = {
    threadId: OLD, subject: "STK credit invoice",
    messages: [
      { from: "Ravi K <contact.gshivashankar@gmail.com>", to: [ME], cc: [], date: "Sat, Oct 31, 2026, 10:15 AM", body: "Please send the STK credit invoice for October." },
    ],
  };

  test("create_draft: fetched once, kept in the journal, the draft written", async () => {
    gmailByThread = new Map([[`${A1}|${OLD}`, oldThread]]);
    const made = await call("create_draft", { threadId: OLD, body: "Hi Ravi, the invoice is attached here today." });
    expect(made.status).toBe(200);
    expect(made.json.id).toBeTruthy();
    const before = calls.slice(0, calls.findIndex((c) => c.functionName === "createReplyDraft"));
    expect(before).toEqual([{ functionName: "getThread", accountHint: A1 }]);
    expect(getThreadTurnIds[0]).toBe(`turn-${A1}`);
    expect(released).toContain(`turn-${A1}`);
    const draft = calls.find((c) => c.functionName === "createReplyDraft")!;
    expect(draft.accountHint).toBe(A1);
    // Kept like a gathered thread: a journal row of A1 with the thread's text and its sender.
    const row = db.query("SELECT e.actor, e.raw, COALESCE(c.body, e.body) AS body FROM ingest_events e LEFT JOIN ingest_content c USING (source_id, account_id, event_id) WHERE e.account_id = ? AND e.thread_key = ?").get(A1, OLD) as any;
    expect(JSON.parse(row.actor).email).toBe("contact.gshivashankar@gmail.com");
    expect(JSON.parse(row.raw).subject).toBe("STK credit invoice");
    expect(row.body).toContain("Please send the STK credit invoice for October.");
    expect(db.query("SELECT account_id, thread_id FROM draft_records").all()).toEqual([{ account_id: A1, thread_id: OLD }]);
  });

  test("then the usual rules: one draft per thread, and no second fetch", async () => {
    gmailByThread = new Map([[`${A1}|${OLD}`, oldThread]]);
    const first = await call("create_draft", { threadId: OLD, body: "Hi Ravi, the invoice is attached here today." });
    calls.length = 0;
    const second = await call("create_draft", { threadId: OLD, body: "Hi Ravi, sending it now." });
    expect(second.json.code).toBe("DRAFT_EXISTS");
    expect(second.json.error).toContain(first.json.id);
    expect(calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(0);
    expect(calls.filter((c) => c.functionName === "getThread")).toHaveLength(0);
  });

  test("a placeholder is still refused, and Gmail is not read for it", async () => {
    gmailByThread = new Map([[`${A1}|${OLD}`, oldThread]]);
    const out = await call("create_draft", { threadId: OLD, body: "Hi Ravi, the invoice is [AMOUNT]." });
    expect(out.json.code).toBe("PLACEHOLDER");
    expect(calls).toHaveLength(0);
  });

  test("reply_context: fetched once and answered from that read", async () => {
    gmailByThread = new Map([[`${A1}|${OLD}`, oldThread]]);
    const { status, json } = await call("reply_context", { threadId: OLD });
    expect(status).toBe(200);
    expect(json.thread.subject).toBe("STK credit invoice");
    expect(json.thread.messages.map((m: any) => m.body)).toEqual(["Please send the STK credit invoice for October."]);
    expect(calls).toEqual([{ functionName: "getThread", accountHint: A1 }]);
  });

  test("the thread of the person's other mailbox is found there", async () => {
    gmailByThread = new Map([[`${A2}|${OLD}`, oldThread]]);
    const made = await call("create_draft", { threadId: OLD, body: "Hi Ravi, the invoice is attached here today." });
    expect(made.json.id).toBeTruthy();
    expect(calls.find((c) => c.functionName === "createReplyDraft")!.accountHint).toBe(A2);
    expect(db.query("SELECT account_id FROM draft_records").all()).toEqual([{ account_id: A2 }]);
  });

  test("a thread Gmail does not have is refused, nothing written", async () => {
    gmailByThread = new Map();
    const out = await call("create_draft", { threadId: "no-such-thread", body: "Hi Ravi, the invoice is attached here today." });
    expect(out.status).toBe(400);
    expect(out.json.code).toBe("NOT_DESK_THREAD");
    expect(calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(0);
    expect(db.query("SELECT COUNT(*) AS n FROM draft_records").get()).toEqual({ n: 0 });
  });

  test("a thread named under an account this copy does not hold: refused, no Gmail call, no turn on it", async () => {
    gmailByThread = new Map([[`acct-someone-else|${OLD}`, oldThread]]);
    for (const op of ["create_draft", "reply_context"]) {
      const out = await call(op, { threadId: OLD, accountId: "acct-someone-else", body: "Hi Ravi, the invoice is attached here today." });
      expect(out.json.code).toBe("NOT_DESK_THREAD");
    }
    expect(calls).toHaveLength(0);
    expect(turnsAsked).toEqual([]);
  });

  test("Gmail could not be read: GMAIL_FAILED, try again; nothing journaled", async () => {
    gmailFails = true;
    const out = await call("create_draft", { threadId: OLD, body: "Hi Ravi, the invoice is attached here today." });
    expect(out.json.code).toBe("GMAIL_FAILED");
    expect(db.query("SELECT COUNT(*) AS n FROM ingest_events WHERE thread_key = ?").get(OLD)).toEqual({ n: 0 });
  });
});

describe("platform ops", () => {
  test("newest_thread_message: id, from, date, accountId, subject and the newest message's own body (F-R11, F-R14)", async () => {
    const { json } = await call("newest_thread_message", { threadId: T1 });
    expect(Object.keys(json)).toEqual(["message"]);
    expect(json.message).toEqual({
      id: expect.any(String), from: "Asha Rao <asha@acme.com>", date: "Mon, Nov 23, 2026, 9:00 AM", accountId: A1,
      subject: "Tuesday?", body: "Are you free on Tuesday?",
    });
    expect((await call("newest_thread_message", { threadId: "nope" })).json).toEqual({ message: null });
  });

  test("newest_thread_message: a one-message thread's body is that message, without its From line", async () => {
    seed(A2, "t-one", "Dev <dev@club.org>", "Club night", ["From: Dev <dev@club.org>\nSaturday works for the club?\nDev"]);
    const { json } = await call("newest_thread_message", { threadId: "t-one" });
    expect(json.message).toMatchObject({ from: "Dev <dev@club.org>", subject: "Club night", body: "Saturday works for the club?\nDev", accountId: A2 });
  });

  test("thread_body and store_thread_body", async () => {
    expect((await call("thread_body", { accountId: A1, threadId: T1 })).json.body).toContain("Are you free on Tuesday?");
    expect((await call("thread_body", { accountId: A2, threadId: T1 })).json).toEqual({ body: null });
    const stored = await call("store_thread_body", { accountId: A1, sourceId: "gmail", threadId: T1, rendered: "From: x\nnew text" });
    expect(stored.json).toEqual({ ok: true });
    expect((await call("thread_body", { accountId: A1, threadId: T1 })).json).toEqual({ body: "From: x\nnew text" });
    const content = db.query("SELECT body FROM ingest_content WHERE account_id = ?").all(A1) as any[];
    expect(content.every((r) => r.body === "From: x\nnew text")).toBe(true);
  });

  test("store_thread_body keeps the donation boundary", async () => {
    const other = await call("store_thread_body", { accountId: A1, sourceId: "slack", threadId: T1, rendered: "x" });
    expect(other.status).toBe(403);
    const big = await call("store_thread_body", { accountId: A1, sourceId: "gmail", threadId: T1, rendered: "x".repeat(500 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect((await call("store_thread_body", { accountId: A1, sourceId: "gmail", threadId: T1 })).status).toBe(400);
    // An empty or blank body would wipe the parked thread: refused INVALID, nothing written.
    for (const rendered of ["", "  \n\t "]) {
      const blank = await call("store_thread_body", { accountId: A1, sourceId: "gmail", threadId: T1, rendered });
      expect(blank.status).toBe(400);
      expect(blank.json.code).toBe("INVALID");
    }
    expect((await call("thread_body", { accountId: A1, threadId: T1 })).json.body).toContain("Are you free");
  });

  test("last_harvest: ISO of the last finished run, per account or the newest", async () => {
    expect((await call("last_harvest", {})).json).toEqual({ at: null });
    recordHarvestRun(A1, Date.UTC(2026, 10, 22, 5, 0));
    recordHarvestRun(A2, Date.UTC(2026, 10, 23, 5, 0));
    expect((await call("last_harvest", { accountId: A1 })).json).toEqual({ at: "2026-11-22T05:00:00.000Z" });
    expect((await call("last_harvest", { accountId: "acct-9" })).json).toEqual({ at: null });
    expect((await call("last_harvest", {})).json).toEqual({ at: "2026-11-23T05:00:00.000Z" });
  });

  test("follow_up_kind", async () => {
    expect((await call("follow_up_kind", { to: '"Rao, Keshav" <Keshav@Acme.com>, ravi@acme.com' })).json).toEqual({ kindRef: "keshav@acme.com" });
    expect((await call("follow_up_kind", { to: "Keshav" })).json).toEqual({ kindRef: null });
    expect((await call("follow_up_kind", {})).json).toEqual({ kindRef: null });
  });

  test("draft_send_recorded: from the row, from the ledger, else not sent", async () => {
    const made = (await call("create_draft", { threadId: T1, body: "Hi Asha, Tuesday works." })).json.id as string;
    expect((await call("draft_send_recorded", { sourceRef: `draft:${made}` })).json).toEqual({ sent: false });
    db.run("UPDATE draft_records SET sent_at = ? WHERE id = ?", [Date.UTC(2026, 10, 23, 10, 0), made]);
    expect((await call("draft_send_recorded", { sourceRef: `draft:${made}` })).json).toEqual({ sent: true, sentAt: "2026-11-23T10:00:00.000Z" });
    // Ledger says sent though the row was lost its stamp.
    db.run("UPDATE draft_records SET sent_at = NULL WHERE id = ?", [made]);
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [`draft:${made}`, A1, T1, "gm-1", "sent", JSON.stringify({ sentAt: "2026-11-23T11:00:00.000Z" }), 1, 1]);
    expect((await call("draft_send_recorded", { sourceRef: `draft:${made}` })).json).toEqual({ sent: true, sentAt: "2026-11-23T11:00:00.000Z" });
    db.run("UPDATE send_ledger SET state = 'in_flight' WHERE idempotency_key = ?", [`draft:${made}`]);
    expect((await call("draft_send_recorded", { sourceRef: `draft:${made}` })).json).toEqual({ sent: false });
    expect((await call("draft_send_recorded", { sourceRef: "draft:nope" })).json).toEqual({ sent: false });
    expect((await call("draft_send_recorded", { sourceRef: "garbage" })).json).toEqual({ sent: false });
    expect((await call("draft_send_recorded", {})).json).toEqual({ sent: false });
  });

  test("mailboxes", async () => {
    expect((await call("mailboxes", {})).json).toEqual({ accounts: [{ accountId: A1, email: ME }, { accountId: A2, email: "me@home.com" }] });
    accountsAnswer = { ok: false, reason: "down" };
    const down = await call("mailboxes", {});
    expect(down.status).toBe(502);
    expect(down.json.code).toBe("UNAVAILABLE");
  });

  test("bundle_rows: the sent replies since the time, in the named accounts, with the bundle's columns", async () => {
    const at = (h: number) => Date.UTC(2026, 10, 23, h, 0);
    const put = (acct: string, thread: string, sent: number | null) => db.run(
      "INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at, sent_at, id) VALUES (?,?,?,?,?,?,?)",
      [acct, thread, `d-${thread}`, "b", 1, sent, `id-${thread}`]);
    put(A1, "t-old", at(1)); put(A1, "t-new", at(9)); put(A2, "t-other", at(10)); put("acct-9", "t-x", at(11)); put(A1, "t-open", null);
    const { json } = await call("bundle_rows", { sinceIso: new Date(at(5)).toISOString(), accountIds: [A1, A2] });
    expect(json).toEqual({ rows: [{ account_id: A1, thread_id: "t-new", sent_at: at(9) }, { account_id: A2, thread_id: "t-other", sent_at: at(10) }] });
    expect((await call("bundle_rows", { sinceIso: new Date(at(5)).toISOString(), accountIds: [] })).json).toEqual({ rows: [] });
    expect((await call("bundle_rows", { sinceIso: "never", accountIds: [A1] })).status).toBe(400);
  });

  test("engaged_domains: the domains the named mailboxes wrote to, seeded ones too, each once; no other mailbox's", async () => {
    const put = (acct: string, domain: string, seeded = 0) => db.run(
      "INSERT INTO engaged_domains (account_id, domain, count, last_sent_at, seeded, updated_at) VALUES (?,?,0,0,?,1)", [acct, domain, seeded]);
    put(A1, "acme.com", 1); put(A1, "vendor.io"); put(A2, "vendor.io"); put(A2, "club.org"); put("acct-9", "other.net");
    expect((await call("engaged_domains", { accountIds: [A1, A2] })).json).toEqual({ domains: ["acme.com", "club.org", "vendor.io"] });
    expect((await call("engaged_domains", { accountIds: [A2] })).json).toEqual({ domains: ["club.org", "vendor.io"] });
    expect((await call("engaged_domains", { accountIds: [] })).json).toEqual({ domains: [] });
    expect((await call("engaged_domains", {})).status).toBe(400);
  });
});

describe("the router", () => {
  test("ops router serves the platform ops and send_draft though the manifest does not declare them", async () => {
    const declared = (await Bun.file(join(import.meta.dir, "../../flock.app.json")).json()).agentInterface.operations.map((o: any) => o.name);
    const served = ["newest_thread_message", "thread_body", "store_thread_body", "last_harvest", "follow_up_kind", "draft_send_recorded", "mailboxes", "bundle_rows", "engaged_domains", "republish_legacy_card", "import_voice", "send_draft"];
    for (const name of served) {
      expect(declared).not.toContain(name);
      expect(Object.keys(allOps)).toContain(name);
    }
    for (const name of ["reply_context", "create_draft", "update_draft", "discard_draft"]) expect(declared).toContain(name);
    // send_draft with no press token is refused by the app (NO_APPROVAL), not "unknown operation".
    const sent = await call("send_draft", { id: "x" });
    expect(sent.status).toBe(403);
    expect(sent.json.code).toBe("NO_APPROVAL");
    expect((await call("no_such_op", {})).status).toBe(404);
  });

  test("a bad token reaches nothing", async () => {
    const res = await router().request("/ops/last_harvest", { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
    expect(res.status).toBe(401);
  });
});
