// send_draft on the person's press, and what a closed card does. Expectations from the brief, the Op contract, Review
// Focus 1 and 3, and the source (send-email.ts, approved-draft.ts, card-closed.ts), written before the code:
//   - no press token: NO_APPROVAL, always, and Gmail is never called;
//   - a press sends the draft as its record stands at the press: Gmail's draft is first made to hold that text, then
//     gmail sendDraft runs with the press token and sideEffect; the ledger says sent, the row has sent_at;
//   - an edit on the card (editedBody) is saved as the person's, then that text is sent;
//   - a second press (a second token) answers from the ledger and sends nothing;
//   - a Gmail failure answers SEND_FAILED (502) with the reason; the draft stays open and the next press tries again;
//   - a send a crash cut short (in_flight row): if Gmail no longer holds the draft it went out, so it is recorded sent and
//     nothing is sent again; if Gmail still holds it, the press sends it;
//   - the card closed as declined discards the draft as the person (their edit lock does not stop their own no);
//     done and expired change nothing.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { appendEvents, normalizeInboxRow, setEventBody, GMAIL_SOURCE } from "../journal";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { ops, _setOpsLogForTesting } from "../ops";
import { handleCardClosed } from "../drafts/send";
import { _setLogForTesting } from "../drafts/card";

const ACCOUNT = "acct-1";
const THREAD = "thread-1";

interface Call { functionName: string; params: Record<string, unknown>; accountHint?: string; pressToken?: string; sideEffect?: boolean }

interface Fake {
  platform: any;
  calls: Call[];
  published: any[];
  withdrawn: string[];
  gmail: Map<string, string>;
  failNext: Partial<Record<string, { reason: string; code?: string; status?: number; unknown?: boolean; throws?: boolean }>>;
  /** sendDraft waits on this when set (two presses at once). */
  sendGate: Promise<void> | null;
  /** The thread as getThread reads it (ruling R33's re-read); null fails the read. */
  thread: Array<{ from: string; date: string; body: string }> | null;
  /** The read turn: "ok", "busy" (refused), or "none" (a Flock without read turns). */
  turn: "ok" | "busy" | "none";
  turns: Array<{ consumer: string; released: boolean }>;
}

function fake(): Fake {
  const f: Fake = {
    platform: null, calls: [], published: [], withdrawn: [], gmail: new Map(), failNext: {}, sendGate: null,
    thread: [], turn: "ok", turns: [],
  };
  let n = 0;
  f.platform = {
    appId: "email-desk", pairedAgent: { id: "inbox-assistant-7", name: "Inbox Assistant" }, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [{ accountId: ACCOUNT, email: "me@acme.com", label: null }] } }),
      readTurn: async (_account: string, consumer: string) => {
        if (f.turn === "none") throw new Error("no read turns");
        if (f.turn === "busy") return { ok: false, reason: "busy", code: "busy" };
        const t = { consumer, released: false };
        f.turns.push(t);
        return { ok: true, data: { turnId: `turn-${f.turns.length}`, accountId: ACCOUNT, release: async () => { t.released = true; } } };
      },
      exec: async (req: any) => {
        f.calls.push({ functionName: req.functionName, params: req.params ?? {}, accountHint: req.accountHint, pressToken: req.pressToken, sideEffect: req.sideEffect });
        const fail = f.failNext[req.functionName];
        if (fail) {
          delete f.failNext[req.functionName];
          if (fail.throws) throw new Error(fail.reason);
          return { ok: false, reason: fail.reason, ...(fail.code ? { code: fail.code } : {}), ...(fail.status !== undefined ? { status: fail.status } : {}) };
        }
        const p = req.params ?? {};
        if (req.functionName === "createReplyDraft") {
          const draftId = `gm-${++n}`;
          f.gmail.set(draftId, String(p.body));
          return { ok: true, data: { draftId, draftMessageId: `msg-${n}`, threadId: p.threadId, bodyAsSaved: String(p.body) } };
        }
        if (req.functionName === "updateDraft") {
          f.gmail.set(String(p.draftId), String(p.body));
          return { ok: true, data: { ok: true, draftId: p.draftId, bodyAsSaved: String(p.body) } };
        }
        if (req.functionName === "getDraft") {
          const body = f.gmail.get(String(p.draftId));
          return { ok: true, data: { draftId: p.draftId, body: body ?? null, threadId: THREAD } };
        }
        if (req.functionName === "discardDraft") {
          if (!f.gmail.has(String(p.draftId))) return { ok: false, reason: "Draft not found", code: "DRAFT_NOT_FOUND" };
          f.gmail.delete(String(p.draftId));
          return { ok: true, data: { draftId: p.draftId, discarded: true } };
        }
        if (req.functionName === "getThread") {
          if (!f.thread) return { ok: false, reason: "Gmail did not load the thread" };
          return { ok: true, data: { subject: "Tuesday?", messages: f.thread } };
        }
        if (req.functionName === "sendDraft") {
          if (f.sendGate) await f.sendGate;
          f.gmail.delete(String(p.draftId));
          return { ok: true, data: { sent: true, draftId: p.draftId } };
        }
        return { ok: false, reason: `unexpected ${req.functionName}` };
      },
    },
    tasks: {
      publish: async (t: any) => { f.published.push(t); return { ok: true, data: {} }; },
      withdraw: async (ref: string) => { f.withdrawn.push(ref); return { ok: true, data: undefined }; },
    },
  };
  return f;
}

let db: Database;
let f: Fake;

const agentCtx = () => ({ platform: f.platform, agentId: "butler-1", pressToken: null });
const pressCtx = (token = "press-token-1") => ({ platform: f.platform, agentId: null, pressToken: token });

function seedThread(): void {
  const at = new Date(Date.UTC(2026, 10, 23, 9, 0));
  const r = normalizeInboxRow({ id: THREAD, from: "Asha Rao <asha@acme.com>", subject: "Tuesday?", snippet: "Are you free on Tuesday?", dateFull: "Mon, Nov 23, 2026, 9:00 AM" }, ACCOUNT, at);
  appendEvents(db, ACCOUNT, [r]);
  setEventBody(db, { sourceId: GMAIL_SOURCE, accountId: ACCOUNT, eventId: r.eventId },
    ["From: Me <me@acme.com>\nHow about next week?", "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?"].join(THREAD_BODY_SEPARATOR));
}

const create = async (body = "Hi Asha, Tuesday works.") => (await ops.create_draft({ threadId: THREAD, body }, agentCtx() as any) as any).id as string;
const send = (payload: Record<string, unknown>, ctx: any = pressCtx()) => ops.send_draft(payload, ctx) as Promise<any>;
const row = (id: string) => db.query("SELECT * FROM draft_records WHERE id = ?").get(id) as any;
const ledger = (id: string) => db.query("SELECT * FROM send_ledger WHERE idempotency_key = ?").get(`draft:${id}`) as any;
const sends = () => f.calls.filter((c) => c.functionName === "sendDraft");

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-send-")));
  _setStoreForTesting(db);
  _setLogForTesting(() => {});
  _setOpsLogForTesting(() => {});
  f = fake();
  seedThread();
});
afterEach(() => {
  _setStoreForTesting(null);
  _setLogForTesting(null);
  _setOpsLogForTesting(null);
  db.close();
});

/** sendDraft's own failure before Send was pressed, as the platform hands it to the app (in-band, HTTP 400, the
 *  executor's exec_error code, the script's code and message in the text: skill-executor.ts, sdk transport.ts). */
const NOTHING_SENT = {
  reason: "platform 400: BROWSER_ERROR: Failed to send draft, nothing was sent: Send button not found in this draft's compose",
  code: "exec_error", status: 400,
};

describe("send_draft", () => {
  test("no press token: refused, Gmail not called", async () => {
    const id = await create();
    f.calls.length = 0;
    const out = await send({ id }, agentCtx());
    expect(out.code).toBe("NO_APPROVAL");
    expect(out.error).not.toMatch(/[–—]/);
    expect(f.calls).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id)).toBeNull();
    // Even with an edit, and even for an id that does not exist.
    expect((await send({ id, editedBody: "Hi Asha, sure." }, agentCtx())).code).toBe("NO_APPROVAL");
    expect((await send({ id: "nope" }, agentCtx())).code).toBe("NO_APPROVAL");
    expect(f.calls).toHaveLength(0);
  });

  test("press token: sends the draft as it stands now", async () => {
    const id = await create();
    // The agent changed it after the card first went up: the press sends the change.
    expect(await ops.update_draft({ id, body: "Hi Asha, Tuesday at 3 works." }, agentCtx() as any)).toEqual({ ok: true });
    f.calls.length = 0;
    const out = await send({ id });
    expect(out.ok).toBe(true);
    expect(typeof out.sentAt).toBe("string");
    expect(Number.isNaN(Date.parse(out.sentAt))).toBe(false);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ params: { draftId: "gm-1" }, accountHint: ACCOUNT, pressToken: "press-token-1", sideEffect: true });
    // Gmail already held the text: one read, no write before the send.
    expect(f.calls.map((c) => c.functionName)).toEqual(["getDraft", "sendDraft"]);
    expect(row(id).sent_at).toBe(Date.parse(out.sentAt));
    expect(ledger(id)).toMatchObject({ state: "sent", account_id: ACCOUNT, thread_id: THREAD, draft_id: "gm-1" });
    // Sending closes the card through the platform (the answer), never a withdraw of the app's own.
    expect(f.withdrawn).toHaveLength(0);
  });

  test("edited body is saved then sent", async () => {
    const id = await create();
    f.calls.length = 0;
    f.published.length = 0;
    const out = await send({ id, editedBody: "Hi Asha, Tuesday works. I'll bring the notes." });
    expect(out.ok).toBe(true);
    const names = f.calls.map((c) => c.functionName);
    expect(names.indexOf("updateDraft")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("updateDraft")).toBeLessThan(names.indexOf("sendDraft"));
    expect(f.calls.find((c) => c.functionName === "updateDraft")!.params).toEqual({ draftId: "gm-1", body: "Hi Asha, Tuesday works. I'll bring the notes." });
    expect(sends()).toHaveLength(1);
    const r = row(id);
    expect(r.body_written).toBe("Hi Asha, Tuesday works. I'll bring the notes.");
    expect(r.person_edited).toBe(1);
    expect(r.sent_at).not.toBeNull();
  });

  test("an edit the same as the draft is not a person's edit", async () => {
    const id = await create();
    f.calls.length = 0;
    expect((await send({ id, editedBody: "Hi Asha, Tuesday works." })).ok).toBe(true);
    expect(f.calls.map((c) => c.functionName)).toEqual(["getDraft", "sendDraft"]);
    expect(row(id).person_edited).toBe(0);
  });

  test("an empty edit is refused and nothing sends", async () => {
    const id = await create();
    f.calls.length = 0;
    const out = await send({ id, editedBody: "   " });
    expect(out.code).toBe("SEND_FAILED");
    expect(out.error).toContain("Could not send: ");
    expect(sends()).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
  });

  test("send_draft twice with two tokens sends once", async () => {
    const id = await create();
    const first = await send({ id }, pressCtx("press-token-1"));
    const second = await send({ id }, pressCtx("press-token-2"));
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, sentAt: first.sentAt });
    expect(sends()).toHaveLength(1);
  });

  test("two presses at once send once", async () => {
    const id = await create();
    let open!: () => void;
    f.sendGate = new Promise((r) => { open = r; });
    const a = send({ id }, pressCtx("press-token-1"));
    const b = send({ id }, pressCtx("press-token-2"));
    await new Promise((r) => setTimeout(r, 10));
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok).toBe(true);
    expect(rb).toEqual({ ok: true, sentAt: ra.sentAt });
    expect(sends()).toHaveLength(1);
  });

  test("the ledger answers even when the draft row was replaced by a new draft on the thread", async () => {
    const id = await create();
    const first = await send({ id });
    const next = await create("Hi Asha, see you then.");
    expect(next).not.toBe(id);
    expect(row(id)).toBeNull();
    expect(await send({ id }, pressCtx("press-token-2"))).toEqual({ ok: true, sentAt: first.sentAt });
    expect(sends()).toHaveLength(1);
    // The new draft is its own send.
    expect((await send({ id: next }, pressCtx("press-token-3"))).ok).toBe(true);
    expect(sends()).toHaveLength(2);
  });

  test("a failure before Send was pressed leaves the draft pending with the reason", async () => {
    const id = await create();
    f.failNext.sendDraft = { ...NOTHING_SENT };
    const out = await send({ id });
    expect(out).toEqual({ error: `Could not send: ${NOTHING_SENT.reason}`, code: "SEND_FAILED", status: 502 });
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id)).toMatchObject({ state: "failed", result: NOTHING_SENT.reason });
    expect(f.withdrawn).toHaveLength(0);
    // The next press tries again and sends.
    const again = await send({ id }, pressCtx("press-token-2"));
    expect(again.ok).toBe(true);
    expect(sends()).toHaveLength(2);
    expect(ledger(id).state).toBe("sent");
  });

  test("Gmail holds other text: the card's text is written into the draft, then sent", async () => {
    const id = await create();
    f.gmail.set("gm-1", "Something typed in Gmail");
    f.calls.length = 0;
    expect((await send({ id })).ok).toBe(true);
    expect(f.calls.map((c) => c.functionName)).toEqual(["getDraft", "updateDraft", "getDraft", "sendDraft"]);
    expect(f.calls[1]!.params).toEqual({ draftId: "gm-1", body: "Hi Asha, Tuesday works." });
  });

  test("Gmail cannot take the card's text: nothing is sent", async () => {
    const id = await create();
    f.gmail.set("gm-1", "Something typed in Gmail");
    f.failNext.updateDraft = { reason: "compose did not open" };
    const out = await send({ id });
    expect(out.code).toBe("SEND_FAILED");
    expect(out.status).toBe(502);
    expect(out.error).toContain("compose did not open");
    expect(sends()).toHaveLength(0);
    // Nothing reached sendDraft: no ledger row, so the next press is a plain first send.
    expect(ledger(id)).toBeNull();
    const again = await send({ id }, pressCtx("press-token-2"));
    expect(again.ok).toBe(true);
    expect(sends()).toHaveLength(1);
    expect(f.gmail.has("gm-1")).toBe(false);
    expect(ledger(id).state).toBe("sent");
  });

  test("a draft deleted in Gmail: two presses both fail, nothing is recorded sent", async () => {
    const id = await create();
    f.gmail.delete("gm-1");
    const first = await send({ id });
    const second = await send({ id }, pressCtx("press-token-2"));
    for (const out of [first, second]) {
      expect(out.code).toBe("SEND_FAILED");
      expect(out.error).not.toMatch(/[–—]/);
    }
    expect(sends()).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id)).toBeNull();
    expect(f.withdrawn).toHaveLength(0);
  });

  test("sendDraft failed, then Gmail shows no draft: SEND_FAILED asking to check Gmail, never sent again", async () => {
    const id = await create();
    f.failNext.sendDraft = { ...NOTHING_SENT };
    expect((await send({ id })).code).toBe("SEND_FAILED");
    f.gmail.delete("gm-1");
    const out = await send({ id }, pressCtx("press-token-2"));
    expect(out).toEqual({ error: "Could not send: it may already have gone out. Check Sent in Gmail.", code: "SEND_FAILED", status: 502 });
    expect(sends()).toHaveLength(1);
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id).state).toBe("failed");
  });

  test("an edit pressed after a failed send whose draft is gone is not saved or sent", async () => {
    const id = await create();
    f.failNext.sendDraft = { ...NOTHING_SENT };
    await send({ id });
    f.gmail.delete("gm-1");
    f.calls.length = 0;
    const out = await send({ id, editedBody: "Hi Asha, changed my mind." }, pressCtx("press-token-2"));
    expect(out.error).toContain("Check Sent in Gmail");
    expect(f.calls.map((c) => c.functionName)).toEqual(["getDraft"]);
    expect(row(id).sent_at).toBeNull();
  });

  const UNCONFIRMED = { error: "Couldn't confirm the send. Check Sent before sending again.", code: "SEND_FAILED", status: 502 };

  test("a send a crash cut short, gone from Gmail: answered from the ledger, nothing sent (R30)", async () => {
    const id = await create();
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, created_at, updated_at) VALUES (?, ?, ?, 'gm-1', 'in_flight', 1, 1)", [`draft:${id}`, ACCOUNT, THREAD]);
    f.gmail.delete("gm-1");
    expect(await send({ id })).toEqual(UNCONFIRMED);
    expect(sends()).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id).state).toBe("in_flight");
  });

  test("a send a crash cut short, still in Gmail: a new press never sends it (R30)", async () => {
    const id = await create();
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, created_at, updated_at) VALUES (?, ?, ?, 'gm-1', 'in_flight', 1, 1)", [`draft:${id}`, ACCOUNT, THREAD]);
    f.calls.length = 0;
    expect(await send({ id }, pressCtx("press-token-2"))).toEqual(UNCONFIRMED);
    expect(f.calls).toHaveLength(0);
    expect(ledger(id).state).toBe("in_flight");
  });

  test("a send that timed out stays in flight: two more presses never send again (R30)", async () => {
    const id = await create();
    f.failNext.sendDraft = { reason: "timeout" };
    expect(await send({ id })).toEqual(UNCONFIRMED);
    expect(ledger(id).state).toBe("in_flight");
    expect(await send({ id }, pressCtx("press-token-2"))).toEqual(UNCONFIRMED);
    expect(await send({ id }, pressCtx("press-token-3"))).toEqual(UNCONFIRMED);
    expect(sends()).toHaveLength(1);
  });

  // Ruling R31: only a failure known to come before Send was pressed is definite; every other sendDraft failure may have
  // gone out, so its row stays in_flight and no later press sends again.
  const pressAgainSendsNothing = async (failure: Fake["failNext"][string]) => {
    const id = await create();
    f.failNext.sendDraft = failure;
    expect(await send({ id })).toEqual(UNCONFIRMED);
    expect(ledger(id).state).toBe("in_flight");
    expect(await send({ id }, pressCtx("press-token-2"))).toEqual(UNCONFIRMED);
    expect(sends()).toHaveLength(1);
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id).state).toBe("in_flight");
  };
  const clear = () => { db.run("DELETE FROM draft_records"); db.run("DELETE FROM send_ledger"); f.calls.length = 0; };

  test("(a) a transport timeout, then a press with a new token: one sendDraft in all", async () => {
    await pressAgainSendsNothing({ reason: "timeout" });
  });

  test("(a) the platform unreachable, a 5xx, or the call throwing: one sendDraft in all", async () => {
    await pressAgainSendsNothing({ reason: "unreachable" });
    clear();
    await pressAgainSendsNothing({ reason: "platform 502: bad gateway", status: 502 });
    clear();
    await pressAgainSendsNothing({ reason: "socket closed", throws: true });
  });

  test("(b) in-band 400 'Send was pressed but Gmail did not confirm': the next press sends nothing", async () => {
    await pressAgainSendsNothing({
      reason: "platform 400: BROWSER_ERROR: Send was pressed but Gmail did not confirm it was sent. Check the thread in Gmail before trying again (notice=none, editorPresent=true, composes=1).",
      code: "exec_error", status: 400,
    });
  });

  test("(c) skill_timeout: the next press sends nothing", async () => {
    await pressAgainSendsNothing({ reason: "platform 400: The gmail operation took too long (>120s) and was stopped.", code: "skill_timeout", status: 400 });
  });

  test("an exec_error with no word on Send, or a session that never reported back, is not definite either", async () => {
    await pressAgainSendsNothing({ reason: "platform 400: Script execution failed (exit=1 after 30ms, no output at all)", code: "exec_error", status: 400 });
    clear();
    // The browser ran the open-and-press actions in the same request that came back without a session id.
    await pressAgainSendsNothing({ reason: "platform 400: SESSION_ERROR: Failed to create persistent session for draft", code: "exec_error", status: 400 });
  });

  test("(d) a confirmed failure before the press: the next press may send (one more sendDraft)", async () => {
    const id = await create();
    f.failNext.sendDraft = { ...NOTHING_SENT };
    expect((await send({ id })).code).toBe("SEND_FAILED");
    expect(ledger(id).state).toBe("failed");
    expect((await send({ id }, pressCtx("press-token-2"))).ok).toBe(true);
    expect(sends()).toHaveLength(2);
    expect(ledger(id).state).toBe("sent");
  });

  test("the platform or the script refusing before the press is definite", async () => {
    const definite: Array<Fake["failNext"][string]> = [
      { reason: "platform 400: BROWSER_ERROR: The draft did not open; nothing was sent. (reason=timeout, composes=0, heading=none, hash=none)", code: "exec_error", status: 400 },
      { reason: "platform 400: MISSING_PARAM: draftId is required", code: "exec_error", status: 400 },
      { reason: "guard busy", code: "guard_busy" },
      { reason: "no account", code: "resolution_account_hint_unmatched" },
      { reason: "not allowed", code: "send_not_authorized" },
      { reason: "not allowed", code: "sideeffect_not_authorized" },
      { reason: "not allowed", code: "forbidden" },
      { reason: "not connected", code: "not_connected" },
      { reason: "bad params", code: "invalid_params" },
      { reason: "platform 403: Side-effectful skill requires a valid approval token", status: 403 },
      { reason: "platform 403: Connector 'gmail' is not connected: the paired agent does not have it", status: 403 },
    ];
    for (const failure of definite) {
      clear();
      const id = await create();
      f.failNext.sendDraft = failure;
      expect((await send({ id })).code).toBe("SEND_FAILED");
      expect(ledger(id).state).toBe("failed");
      expect((await send({ id }, pressCtx("press-token-2"))).ok).toBe(true);
      expect(sends()).toHaveLength(2);
    }
  });

  test("a failed row (a definite Gmail error) with the draft still there sends once on the next press", async () => {
    const id = await create();
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at) VALUES (?, ?, ?, 'gm-1', 'failed', 'banner', 1, 1)", [`draft:${id}`, ACCOUNT, THREAD]);
    expect((await send({ id })).ok).toBe(true);
    expect((await send({ id }, pressCtx("press-token-2"))).ok).toBe(true);
    expect(sends()).toHaveLength(1);
    expect(ledger(id).state).toBe("sent");
  });

  test("an unknown id is NOT_FOUND", async () => {
    const out = await send({ id: "nope" });
    expect(out.code).toBe("NOT_FOUND");
    expect(f.calls).toHaveLength(0);
  });
});

describe("card closed", () => {
  const closed = (id: string, outcome: "done" | "declined" | "expired") =>
    handleCardClosed({ sourceRef: `draft:${id}`, outcome, closedAt: Date.now() }, { platform: f.platform });

  test("card closed as declined marks the draft discarded", async () => {
    const id = await create();
    f.calls.length = 0;
    await closed(id, "declined");
    expect(f.calls.map((c) => c.functionName)).toEqual(["discardDraft"]);
    expect(f.calls[0]!.params).toEqual({ draftId: "gm-1" });
    expect(f.gmail.has("gm-1")).toBe(false);
    expect(row(id)).toBeNull();
  });

  test("declined discards a draft the person edited: it is their own no", async () => {
    const id = await create();
    expect(await ops.update_draft({ id, body: "Hi Asha, my own words.", by: "person" }, pressCtx() as any)).toEqual({ ok: true });
    await closed(id, "declined");
    expect(row(id)).toBeNull();
    expect(f.gmail.has("gm-1")).toBe(false);
  });

  test("declined on a draft already gone from Gmail clears the record", async () => {
    const id = await create();
    f.gmail.delete("gm-1");
    await closed(id, "declined");
    expect(row(id)).toBeNull();
  });

  test("declined with Gmail failing closes the draft at once; only Gmail's discard is tried again", async () => {
    const id = await create();
    f.withdrawn.length = 0;
    f.failNext.discardDraft = { reason: "browser busy" };
    await expect(closed(id, "declined")).rejects.toThrow("browser busy");
    // The thread is not muted: the row is gone and the card withdrawn on the first attempt.
    expect(row(id)).toBeNull();
    expect(f.withdrawn).toEqual([`draft:${id}`]);
    expect(f.gmail.has("gm-1")).toBe(true);
    // Flock asks again: Gmail's discard is retried on its own.
    await closed(id, "declined");
    expect(f.gmail.has("gm-1")).toBe(false);
    // And then there is nothing left to do.
    f.calls.length = 0;
    await closed(id, "declined");
    expect(f.calls).toHaveLength(0);
  });

  test("a retried Gmail discard never touches a newer draft on the same thread", async () => {
    const id = await create();
    f.failNext.discardDraft = { reason: "browser busy" };
    await expect(closed(id, "declined")).rejects.toThrow("browser busy");
    // Gmail's reply draft for the thread is reused by the new draft (same Gmail id).
    f.gmail.delete("gm-1");
    db.run("INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at, id) VALUES (?,?,?,?,?,?)", [ACCOUNT, THREAD, "gm-1", "new", 2, "new-id"]);
    f.gmail.set("gm-1", "new");
    f.calls.length = 0;
    await closed(id, "declined");
    expect(f.calls).toHaveLength(0);
    expect(f.gmail.get("gm-1")).toBe("new");
  });

  test("declined on a sent draft changes nothing", async () => {
    const id = await create();
    await send({ id });
    f.calls.length = 0;
    await closed(id, "declined");
    expect(f.calls).toHaveLength(0);
    expect(row(id).sent_at).not.toBeNull();
  });

  test("done changes nothing; other refs are ignored", async () => {
    const id = await create();
    f.calls.length = 0;
    await closed(id, "done");
    await handleCardClosed({ sourceRef: "followup:x", outcome: "declined", closedAt: Date.now() }, { platform: f.platform });
    expect(f.calls).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
  });

  test("expired leaves the draft in Gmail (as the source did) but never a cardless open row", async () => {
    const id = await create();
    f.calls.length = 0;
    await closed(id, "expired");
    expect(f.calls).toHaveLength(0);
    expect(f.gmail.has("gm-1")).toBe(true);
    expect(row(id)).toBeNull();
  });

  test("expired on a sent draft keeps its sent row", async () => {
    const id = await create();
    await send({ id });
    await closed(id, "expired");
    expect(row(id).sent_at).not.toBeNull();
  });
});

// Ruling R33: a send whose outcome is unknown (an in_flight ledger row for the thread's open draft) blocks any redraft.
// create_draft / update_draft re-read Gmail once under a read turn ("email-desk:send-check"): the person's own message on
// the thread with the draft's text, dated at or after the send was asked, proves it went (SENT, card closed); no such
// message with the Gmail draft still there proves it did not (drafting goes on as normal); anything else is unknown:
// SEND_UNCONFIRMED, nothing written, nothing dropped, the card left up.
describe("redraft over an unconfirmed send (R33)", () => {
  const SEND_UNCONFIRMED = { error: "A reply to this may have gone already. Check Sent first.", code: "SEND_UNCONFIRMED" };
  const BODY = "Hi Asha, Tuesday works.";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /** Gmail's full date for a time, in local time ("Nov 23, 2026, 14:05"), as getThread gives it. */
  const gmailDate = (ms: number) => {
    const d = new Date(ms);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const ASHA = { from: "Asha Rao <asha@acme.com>", date: "Nov 23, 2026, 9:00", body: "Are you free on Tuesday?" };
  const writes = () => f.calls.filter((c) => ["createReplyDraft", "updateDraft", "discardDraft", "sendDraft"].includes(c.functionName));

  /** A draft whose send timed out: the ledger row stays in_flight and Gmail still holds the draft. */
  const unknownSend = async (): Promise<string> => {
    const id = await create(BODY);
    f.failNext.sendDraft = { reason: "timeout" };
    expect((await send({ id })).code).toBe("SEND_FAILED");
    expect(ledger(id).state).toBe("in_flight");
    f.calls.length = 0;
    f.published.length = 0;
    f.withdrawn.length = 0;
    return id;
  };
  /** The send really went out: Gmail's draft is gone and the thread holds the person's reply. */
  const itWentOut = (text = BODY, from = "Me <me@acme.com>", at = Date.now() + 60_000) => {
    f.gmail.delete("gm-1");
    f.thread = [ASHA, { from, date: gmailDate(at), body: `${text}\n\nOn Nov 23, 2026, Asha Rao <asha@acme.com> wrote:\n> Are you free on Tuesday?` }];
  };
  const createAgain = () => ops.create_draft({ threadId: THREAD, body: "Hi Asha, Tuesday is good." }, agentCtx() as any) as Promise<any>;
  const updateAgain = (id: string, ctx: any = agentCtx()) => ops.update_draft({ id, body: "Hi Asha, Tuesday is good." }, ctx) as Promise<any>;
  const untouched = (id: string) => {
    expect(writes()).toHaveLength(0);
    expect(row(id)).not.toBeNull();
    expect(row(id).sent_at).toBeNull();
    expect(row(id).body_written).toBe(BODY);
    expect(ledger(id).state).toBe("in_flight");
    expect(f.withdrawn).toHaveLength(0);
    expect(f.published).toHaveLength(0);
  };

  test("(1) the re-read cannot run (turn busy, no read turns, the thread read failing): create_draft refused, nothing touched", async () => {
    const id = await unknownSend();
    f.gmail.delete("gm-1"); // Gmail shows no draft: the old code read this as gone and wrote a second reply.
    for (const setup of [() => { f.turn = "busy"; }, () => { f.turn = "none"; }, () => { f.turn = "ok"; f.thread = null; }]) {
      setup();
      expect(await createAgain()).toEqual(SEND_UNCONFIRMED);
      untouched(id);
    }
  });

  test("(1) ambiguous: no reply on the thread but Gmail shows no draft either: create_draft refused, nothing touched", async () => {
    const id = await unknownSend();
    f.gmail.delete("gm-1");
    f.thread = [ASHA];
    expect(await createAgain()).toEqual(SEND_UNCONFIRMED);
    untouched(id);
    expect(f.turns.map((t) => t.consumer)).toEqual(["email-desk:send-check"]);
    expect(f.turns.every((t) => t.released)).toBe(true);
    expect(f.calls.find((c) => c.functionName === "getThread")?.params).toEqual({ threadId: THREAD });
  });

  test("(1) ambiguous: the person's reply with the text but a date that does not read: refused", async () => {
    const id = await unknownSend();
    itWentOut();
    f.thread![1]!.date = "yesterday-ish";
    expect(await createAgain()).toEqual(SEND_UNCONFIRMED);
    untouched(id);
  });

  test("(1) someone else's message with the text, or the person's other text, is not the send", async () => {
    const id = await unknownSend();
    itWentOut(BODY, "Asha Rao <asha@acme.com>");
    expect(await createAgain()).toEqual(SEND_UNCONFIRMED);
    untouched(id);
    itWentOut("Hi Asha, I am away on Tuesday.");
    expect(await createAgain()).toEqual(SEND_UNCONFIRMED);
    untouched(id);
  });

  test("(1) update_draft over an unknown send: refused, nothing touched (the agent's, and the person's own save)", async () => {
    const id = await unknownSend();
    f.gmail.delete("gm-1");
    f.thread = [ASHA];
    expect(await updateAgain(id)).toEqual(SEND_UNCONFIRMED);
    untouched(id);
    expect(await ops.update_draft({ id, body: "Hi Asha, Tuesday is good.", by: "person" }, pressCtx("press-token-9") as any)).toEqual(SEND_UNCONFIRMED);
    untouched(id);
    f.turn = "busy";
    expect(await updateAgain(id)).toEqual(SEND_UNCONFIRMED);
    untouched(id);
  });

  test("(2) the re-read proves it went: ledger sent, row stamped, card closed, create_draft refused SENT", async () => {
    const id = await unknownSend();
    itWentOut();
    const out = await createAgain();
    expect(out.code).toBe("SENT");
    expect(out.error).not.toMatch(/[–—]/);
    expect(writes()).toHaveLength(0);
    expect(ledger(id).state).toBe("sent");
    expect(row(id).sent_at).not.toBeNull();
    expect(f.withdrawn).toEqual([`draft:${id}`]);
    // A press now answers from the ledger, and nothing is sent again.
    expect((await send({ id }, pressCtx("press-token-2"))).ok).toBe(true);
    expect(sends()).toHaveLength(0);
  });

  test("(2) Gmail's curly quotes and spacing still read as the same text", async () => {
    const id = await create("Hi Asha, \"Tuesday\" works.\nSee you then.");
    f.failNext.sendDraft = { reason: "timeout" };
    await send({ id });
    f.calls.length = 0;
    itWentOut("Hi Asha,  \u201cTuesday\u201d works.\r\nSee you then.  ");
    expect((await updateAgain(id)).code).toBe("SENT");
    expect(ledger(id).state).toBe("sent");
    expect(writes()).toHaveLength(0);
  });

  test("(2) update_draft finding the send went: SENT, card closed", async () => {
    const id = await unknownSend();
    itWentOut();
    expect((await updateAgain(id)).code).toBe("SENT");
    expect(writes()).toHaveLength(0);
    expect(row(id).sent_at).not.toBeNull();
    expect(f.withdrawn).toEqual([`draft:${id}`]);
  });

  test("(3) the re-read proves it did not go: the unknown is cleared and drafting goes on as normal", async () => {
    const id = await unknownSend();
    f.thread = [ASHA]; // no reply from the person; Gmail still holds the draft
    // create_draft is no longer held by the send: the thread's open draft answers as any open draft does.
    const out = await createAgain();
    expect(out.code).toBe("DRAFT_EXISTS");
    expect(ledger(id)).toBeNull();
    // update_draft writes the draft.
    expect(await updateAgain(id)).toEqual({ ok: true });
    expect(f.gmail.get("gm-1")).toBe("Hi Asha, Tuesday is good.");
    expect(row(id).body_written).toBe("Hi Asha, Tuesday is good.");
    // And the person's press sends it.
    expect((await send({ id }, pressCtx("press-token-2"))).ok).toBe(true);
    expect(sends()).toHaveLength(1);
  });

  test("(3) proved unsent with the draft gone afterwards: create_draft writes the new draft", async () => {
    const id = await unknownSend();
    f.thread = [ASHA];
    expect((await updateAgain(id)).ok).toBe(true); // proves unsent, clears the unknown
    expect(ledger(id)).toBeNull();
    f.gmail.delete("gm-1"); // the person then deletes the draft in Gmail
    f.calls.length = 0;
    const out = await createAgain();
    expect(typeof out.id).toBe("string");
    expect(f.calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(1);
  });

  test("(3) the person's own earlier reply with the same text, dated before the send, is not this send", async () => {
    const id = await unknownSend();
    f.thread = [{ from: "Me <me@acme.com>", date: gmailDate(Date.now() - 3 * 86_400_000), body: BODY }, ASHA];
    expect((await createAgain()).code).toBe("DRAFT_EXISTS");
    expect(ledger(id)).toBeNull();
  });
});

