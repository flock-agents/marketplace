// create_draft / update_draft / discard_draft, and the approval card. Expectations from the brief, the Op contract and the
// source (gmail-middleware.ts gates, approval-card.ts, save-draft.ts), written before the code:
//   - create_draft: the thread must be one this copy read (its journal), the body passes the rules, one open draft per
//     thread; then Gmail createReplyDraft, a draft_records row, and ONE card in the contract's exact shape;
//   - the card names the copy's paired agent, whoever it is, never the caller and never an assumed PA;
//   - update_draft: by:"person" only counts with a press token (ruling R5); the person's edit is written to Gmail and
//     locks the draft against the agent; an agent update re-publishes the card (same sourceRef) with the new body;
//   - discard_draft: Gmail discardDraft, the row gone, the card withdrawn; again is still ok.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { appendEvents, normalizeInboxRow, setEventBody, GMAIL_SOURCE } from "../journal";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { ops, withThreadTurn, changeDraft, _setOpsLogForTesting } from "../ops";
import { _setLogForTesting } from "../drafts/card";

const ACCOUNT = "acct-1";
const THREAD = "thread-1";

interface Call { functionName: string; params: Record<string, unknown>; accountHint?: string; pressToken?: string }

interface Fake {
  platform: any;
  calls: Call[];
  published: any[];
  withdrawn: string[];
  /** What Gmail holds per draft id (getDraft answers this). */
  gmail: Map<string, string>;
  failNext: Partial<Record<string, { reason: string; code?: string }>>;
}

function fake(pairedAgent: { id: string; name: string } | null = { id: "inbox-assistant-7", name: "Inbox Assistant" }): Fake {
  const f: Fake = { platform: null, calls: [], published: [], withdrawn: [], gmail: new Map(), failNext: {} };
  let n = 0;
  f.platform = {
    appId: "email-desk", pairedAgent, dataDir: "test", configured: true,
    connectors: {
      exec: async (req: any) => {
        f.calls.push({ functionName: req.functionName, params: req.params ?? {}, accountHint: req.accountHint, pressToken: req.pressToken });
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
          f.gmail.delete(String(p.draftId));
          return { ok: true, data: { draftId: p.draftId, discarded: true } };
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

const agentCtx = (agentId: string | null = "butler-1") => ({ platform: f.platform, agentId, pressToken: null });
const pressCtx = () => ({ platform: f.platform, agentId: null, pressToken: "press-token-1" });

function seedThread(threadId = THREAD, account = ACCOUNT): void {
  const at = new Date(Date.UTC(2026, 10, 23, 9, 0));
  const row = normalizeInboxRow({ id: threadId, from: "Asha Rao <asha@acme.com>", subject: "Tuesday?", snippet: "Are you free on Tuesday?", dateFull: "Mon, Nov 23, 2026, 9:00 AM" }, account, at);
  appendEvents(db, account, [row]);
  setEventBody(db, { sourceId: GMAIL_SOURCE, accountId: account, eventId: row.eventId },
    ["From: Me <me@acme.com>\nHow about next week?", "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?"].join(THREAD_BODY_SEPARATOR));
}

const create = (payload: Record<string, unknown>, ctx = agentCtx()) => ops.create_draft(payload, ctx as any) as Promise<any>;
const update = (payload: Record<string, unknown>, ctx: any = agentCtx()) => ops.update_draft(payload, ctx) as Promise<any>;
const discard = (payload: Record<string, unknown>, ctx: any = agentCtx()) => ops.discard_draft(payload, ctx) as Promise<any>;
const row = (id: string) => db.query("SELECT * FROM draft_records WHERE id = ?").get(id) as any;

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-drafts-")));
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

describe("create_draft", () => {
  test("writes the Gmail reply draft and records it", async () => {
    const out = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works.", why: "Asha asked if you are free." });
    expect(typeof out.id).toBe("string");
    const gm = f.calls.filter((c) => c.functionName === "createReplyDraft");
    expect(gm).toHaveLength(1);
    expect(gm[0].params).toMatchObject({ threadId: THREAD, to: "asha@acme.com", body: "Hi Asha, Tuesday works." });
    expect(gm[0].accountHint).toBe(ACCOUNT);
    expect(gm[0].pressToken).toBeUndefined();
    const r = row(out.id);
    expect(r).toMatchObject({ account_id: ACCOUNT, thread_id: THREAD, draft_id: "gm-1", body_written: "Hi Asha, Tuesday works.", person_edited: 0, sent_at: null });
  });

  test("second draft on a thread is refused naming the first id", async () => {
    const first = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    const second = await create({ threadId: THREAD, body: "Hi Asha, Wednesday instead." });
    expect(second.code).toBe("DRAFT_EXISTS");
    expect(second.error).toContain(first.id);
    expect(f.calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(1);
  });

  test("two drafts for one thread at once: one is written, the other names it", async () => {
    const [a, b] = await Promise.all([
      create({ threadId: THREAD, body: "Hi Asha, Tuesday works." }),
      create({ threadId: THREAD, body: "Hi Asha, Wednesday instead." }),
    ]);
    expect(f.calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(1);
    expect(a.id).toBeTruthy();
    expect(b.code).toBe("DRAFT_EXISTS");
    expect(b.error).toContain(a.id);
  });

  test("a thread whose draft was sent takes a new draft", async () => {
    const first = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    db.run("UPDATE draft_records SET sent_at = 1 WHERE id = ?", [first.id]);
    const again = await create({ threadId: THREAD, body: "Hi Asha, see you then." });
    expect(again.id).toBeTruthy();
    expect(again.id).not.toBe(first.id);
    expect(row(again.id).sent_at).toBeNull();
  });

  test("placeholder like [Name] is refused and nothing is written", async () => {
    const out = await create({ threadId: THREAD, body: "Hi [Name], Tuesday works." });
    expect(out.code).toBe("PLACEHOLDER");
    expect(f.calls).toHaveLength(0);
    expect(f.published).toHaveLength(0);
  });

  test("quality check refusal carries its reason", async () => {
    const out = await create({ threadId: THREAD, body: "Hi Asha — Tuesday works." });
    expect(out.code).toBe("QUALITY");
    expect(out.error).toContain("dash");
    expect(f.calls).toHaveLength(0);
  });

  test("a thread this copy never read is refused NOT_DESK_THREAD", async () => {
    expect((await create({ threadId: "someone-elses", body: "Hi." })).code).toBe("NOT_DESK_THREAD");
    expect((await create({ threadId: THREAD, accountId: "acct-other", body: "Hi." })).code).toBe("NOT_DESK_THREAD");
    expect(f.calls).toHaveLength(0);
  });

  test("a Gmail failure records nothing and publishes nothing", async () => {
    f.failNext.createReplyDraft = { reason: "browser busy" };
    const out = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    expect(out.code).toBe("GMAIL_FAILED");
    expect(out.error).toContain("browser busy");
    expect(db.query("SELECT COUNT(*) AS n FROM draft_records").get()).toEqual({ n: 0 });
    expect(f.published).toHaveLength(0);
  });

  test("create_draft publishes one card with Send = send_draft, passesEdit, byReply, draftSaveOp update_draft", async () => {
    const out = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works.", why: "Asha asked if you are free." });
    expect(f.published).toHaveLength(1);
    const card = f.published[0];
    expect(card.title).toBe("Reply to Asha Rao");
    expect(card.sourceRef).toBe(`draft:${out.id}`);
    expect(card.context.why).toBe("Asha asked if you are free.");
    expect(card.context.card.draftSaveOp).toBe("update_draft");
    const blocks = card.context.card.blocks;
    expect(blocks.map((b: any) => b.type)).toEqual(["message", "draft"]);
    expect(blocks[0]).toMatchObject({ type: "message", from: "Asha Rao <asha@acme.com>", subject: "Tuesday?", body: "Are you free on Tuesday?" });
    expect(blocks[1]).toEqual({ type: "draft", from: "You", to: "Asha Rao <asha@acme.com>", body: "Hi Asha, Tuesday works." });
    expect(card.actions).toEqual([{
      id: "send", label: "Send", kind: "primary", sideEffect: true,
      executor: { mode: "app", op: "send_draft", opArgs: { id: out.id }, passesEdit: true, byReply: true },
    }]);
    expect(JSON.stringify(card)).not.toMatch(/[–—]/);
  });

  test("a card without a why says plainly that nothing sends", async () => {
    await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    const why = f.published[0].context.why as string;
    expect(why.length).toBeGreaterThan(0);
    expect(why).not.toMatch(/[–—]/);
  });

  test("card names the paired agent, not the PA", async () => {
    // Paired with a custom agent; the caller is the person's Butler. The card belongs to the copy's agent.
    await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." }, agentCtx("butler-1"));
    expect(f.published[0].context.agentId).toBe("inbox-assistant-7");
  });
});

describe("update_draft", () => {
  test("an agent update writes Gmail and re-publishes the card with the new body, same sourceRef", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works.", why: "Asha asked." });
    const out = await update({ id, body: "Hi Asha, Tuesday at 4 works." });
    expect(out).toEqual({ ok: true });
    expect(f.calls.find((c) => c.functionName === "updateDraft")?.params).toEqual({ draftId: "gm-1", body: "Hi Asha, Tuesday at 4 works." });
    expect(row(id).body_written).toBe("Hi Asha, Tuesday at 4 works.");
    expect(f.published).toHaveLength(2);
    expect(f.published[1].sourceRef).toBe(`draft:${id}`);
    expect(f.published[1].context.why).toBe("Asha asked.");
    expect(f.published[1].context.card.blocks[1].body).toBe("Hi Asha, Tuesday at 4 works.");
  });

  test("person edit is written to Gmail and kept", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    const out = await update({ id, body: "Asha, Tuesday is good [after lunch].", by: "person" }, pressCtx());
    expect(out).toEqual({ ok: true });
    expect(f.gmail.get("gm-1")).toBe("Asha, Tuesday is good [after lunch].");
    expect(row(id)).toMatchObject({ body_written: "Asha, Tuesday is good [after lunch].", person_edited: 1 });
    // The person's text is theirs: no placeholder rule. And no Gmail press token for a draft.
    expect(f.calls.find((c) => c.functionName === "updateDraft")?.pressToken).toBeUndefined();
    // Ruling R16: the card shows the person's text (same card, why kept).
    expect(f.published).toHaveLength(2);
    expect(f.published[1].sourceRef).toBe(`draft:${id}`);
    expect(f.published[1].context.why).toBe(f.published[0].context.why);
    expect(f.published[1].context.card.blocks[1].body).toBe("Asha, Tuesday is good [after lunch].");
  });

  test("agent update after a person's edit is refused", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    await update({ id, body: "Asha, Tuesday is good.", by: "person" }, pressCtx());
    const before = f.calls.length;
    const out = await update({ id, body: "Hi Asha, Wednesday instead." });
    expect(out.code).toBe("PERSON_EDITED");
    expect(f.calls.length).toBe(before);
    expect(row(id).body_written).toBe("Asha, Tuesday is good.");
  });

  test("an agent saying by:person without a press token is still the agent (ruling R5)", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    await update({ id, body: "Asha, Tuesday is good.", by: "person" }, pressCtx());
    const out = await update({ id, body: "Hi Asha, Wednesday instead.", by: "person" }, agentCtx());
    expect(out.code).toBe("PERSON_EDITED");
    expect(row(id).body_written).toBe("Asha, Tuesday is good.");
  });

  test("an agent cannot set the lock itself", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    expect(await update({ id, body: "Hi Asha, Tuesday at 4.", by: "person" }, agentCtx())).toEqual({ ok: true });
    expect(row(id).person_edited).toBe(0);
    // ...and the agent's body rules still apply to it.
    expect((await update({ id, body: "Hi [Name].", by: "person" }, agentCtx())).code).toBe("PLACEHOLDER");
    expect(await update({ id, body: "Hi Asha, Tuesday at 5." })).toEqual({ ok: true });
  });

  test("a person's edit made in Gmail itself locks the draft too", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    f.gmail.set("gm-1", "Hi Asha, Tuesday works. Bring the deck.");
    const out = await update({ id, body: "Hi Asha, Wednesday instead." });
    expect(out.code).toBe("PERSON_EDITED");
    expect(f.calls.some((c) => c.functionName === "updateDraft")).toBe(false);
    expect(row(id).person_edited).toBe(1);
  });

  test("a draft deleted in Gmail is gone: NOT_FOUND, row dropped, card withdrawn", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    f.gmail.delete("gm-1");
    const out = await update({ id, body: "Hi Asha, Wednesday instead." });
    expect(out.code).toBe("NOT_FOUND");
    expect(row(id)).toBeNull();
    expect(f.withdrawn).toEqual([`draft:${id}`]);
  });

  test("a sent draft is refused SENT; an unknown id NOT_FOUND", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    db.run("UPDATE draft_records SET sent_at = 1 WHERE id = ?", [id]);
    expect((await update({ id, body: "Hi again." })).code).toBe("SENT");
    expect((await update({ id, body: "Hi again.", by: "person" }, pressCtx())).code).toBe("SENT");
    expect((await update({ id: "nope", body: "Hi again." })).code).toBe("NOT_FOUND");
  });

  test("an agent update is held to the body rules", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    expect((await update({ id, body: "Hi [Name]." })).code).toBe("PLACEHOLDER");
    expect((await update({ id, body: "Hi Asha -- sure." })).code).toBe("QUALITY");
  });
});

describe("discard_draft", () => {
  test("discard withdraws the card", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    expect(await discard({ id })).toEqual({ ok: true });
    expect(f.calls.find((c) => c.functionName === "discardDraft")?.params).toEqual({ draftId: "gm-1" });
    expect(f.withdrawn).toEqual([`draft:${id}`]);
    // Gone: no open draft on the thread any more (memory-extraction reads sent_at IS NULL as open).
    expect(db.query("SELECT COUNT(*) AS n FROM draft_records WHERE thread_id = ? AND sent_at IS NULL").get(THREAD)).toEqual({ n: 0 });
    expect((await update({ id, body: "Hi." })).code).toBe("NOT_FOUND");
  });

  test("is idempotent: a second discard is ok and touches no Gmail", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    await discard({ id });
    const before = f.calls.length;
    expect(await discard({ id })).toEqual({ ok: true });
    expect(f.calls.length).toBe(before);
  });

  test("a draft already gone from Gmail is still discarded", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    f.failNext.discardDraft = { reason: "Draft gm-1 did not open", code: "DRAFT_NOT_FOUND" };
    expect(await discard({ id })).toEqual({ ok: true });
    expect(row(id)).toBeNull();
  });

  test("a Gmail failure is still a discard: row gone, card withdrawn (ruling R15)", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    f.failNext.discardDraft = { reason: "browser busy" };
    expect(await discard({ id })).toEqual({ ok: true });
    expect(row(id)).toBeNull();
    expect(f.withdrawn).toEqual([`draft:${id}`]);
  });

  test("an agent cannot discard a draft the person edited (ruling R18)", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    await update({ id, body: "Asha, Tuesday is good.", by: "person" }, pressCtx());
    const out = await discard({ id });
    expect(out.code).toBe("PERSON_EDITED");
    expect(out.error).not.toMatch(/[–—]/);
    expect(f.calls.some((c) => c.functionName === "discardDraft")).toBe(false);
    expect(f.withdrawn).toEqual([]);
    // ...so it cannot overwrite the edit by drafting again either.
    expect((await create({ threadId: THREAD, body: "Hi Asha, Wednesday instead." })).code).toBe("DRAFT_EXISTS");
    expect(f.calls.filter((c) => c.functionName === "createReplyDraft")).toHaveLength(1);
    expect(row(id)).toMatchObject({ body_written: "Asha, Tuesday is good.", person_edited: 1 });
    expect(f.gmail.get("gm-1")).toBe("Asha, Tuesday is good.");
  });

  test("with a press token, the person's own discard of their edited draft goes through", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    await update({ id, body: "Asha, Tuesday is good.", by: "person" }, pressCtx());
    expect(await discard({ id }, pressCtx())).toEqual({ ok: true });
    expect(row(id)).toBeNull();
  });
});

describe("withThreadTurn", () => {
  test("send_draft can edit inside the thread's turn without waiting on itself", async () => {
    const { id } = await create({ threadId: THREAD, body: "Hi Asha, Tuesday works." });
    const out = await withThreadTurn(ACCOUNT, THREAD, () =>
      changeDraft(id, { body: "Asha, Tuesday is good.", by: "person" }, pressCtx()));
    expect(out).toEqual({ ok: true });
    expect(row(id).person_edited).toBe(1);
  });
});

describe("ops", () => {
  test("serves the three draft ops and send_draft", () => {
    expect(Object.keys(ops).sort()).toEqual(["create_draft", "discard_draft", "send_draft", "update_draft"]);
  });
});
