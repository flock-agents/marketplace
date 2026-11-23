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
  failNext: Partial<Record<string, { reason: string; code?: string }>>;
  /** sendDraft waits on this when set (two presses at once). */
  sendGate: Promise<void> | null;
}

function fake(): Fake {
  const f: Fake = { platform: null, calls: [], published: [], withdrawn: [], gmail: new Map(), failNext: {}, sendGate: null };
  let n = 0;
  f.platform = {
    appId: "email-desk", pairedAgent: { id: "inbox-assistant-7", name: "Inbox Assistant" }, dataDir: "test", configured: true,
    connectors: {
      exec: async (req: any) => {
        f.calls.push({ functionName: req.functionName, params: req.params ?? {}, accountHint: req.accountHint, pressToken: req.pressToken, sideEffect: req.sideEffect });
        const fail = f.failNext[req.functionName];
        if (fail) { delete f.failNext[req.functionName]; return { ok: false, reason: fail.reason, ...(fail.code ? { code: fail.code } : {}) }; }
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

  test("Gmail failure leaves the draft pending with the reason", async () => {
    const id = await create();
    f.failNext.sendDraft = { reason: "Gmail showed an error banner" };
    const out = await send({ id });
    expect(out).toEqual({ error: "Could not send: Gmail showed an error banner", code: "SEND_FAILED", status: 502 });
    expect(row(id).sent_at).toBeNull();
    expect(ledger(id)).toMatchObject({ state: "failed", result: "Gmail showed an error banner" });
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
    expect(ledger(id).state).toBe("failed");
  });

  test("a first press on a draft Gmail no longer holds fails and sends nothing", async () => {
    const id = await create();
    f.gmail.delete("gm-1");
    const out = await send({ id });
    expect(out.code).toBe("SEND_FAILED");
    expect(sends()).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
  });

  test("a send a crash cut short, gone from Gmail: recorded sent, nothing sent again", async () => {
    const id = await create();
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, created_at, updated_at) VALUES (?, ?, ?, 'gm-1', 'in_flight', 1, 1)", [`draft:${id}`, ACCOUNT, THREAD]);
    f.gmail.delete("gm-1");
    const out = await send({ id });
    expect(out.ok).toBe(true);
    expect(sends()).toHaveLength(0);
    expect(ledger(id).state).toBe("sent");
    expect(row(id).sent_at).not.toBeNull();
  });

  test("a send a crash cut short, still in Gmail: the press sends it", async () => {
    const id = await create();
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, created_at, updated_at) VALUES (?, ?, ?, 'gm-1', 'in_flight', 1, 1)", [`draft:${id}`, ACCOUNT, THREAD]);
    expect((await send({ id })).ok).toBe(true);
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

  test("declined with Gmail failing throws and keeps the draft, so Flock asks again", async () => {
    const id = await create();
    f.failNext.discardDraft = { reason: "browser busy" };
    await expect(closed(id, "declined")).rejects.toThrow("browser busy");
    expect(row(id)).not.toBeNull();
    await closed(id, "declined");
    expect(row(id)).toBeNull();
  });

  test("declined on a sent draft changes nothing", async () => {
    const id = await create();
    await send({ id });
    f.calls.length = 0;
    await closed(id, "declined");
    expect(f.calls).toHaveLength(0);
    expect(row(id).sent_at).not.toBeNull();
  });

  test("done and expired change nothing; other refs are ignored", async () => {
    const id = await create();
    f.calls.length = 0;
    await closed(id, "done");
    await closed(id, "expired");
    await handleCardClosed({ sourceRef: "followup:x", outcome: "declined", closedAt: Date.now() }, { platform: f.platform });
    expect(f.calls).toHaveLength(0);
    expect(row(id).sent_at).toBeNull();
  });
});
