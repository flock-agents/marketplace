// Who a draft's reply reaches, on its card (Ruling P3-R5). Expectations written from the ruling and Flock's mail-rule scope
// (asks/scope.ts mailSendScope: the card's To/Cc and its replyAllRecipients must agree, else no rule sends), before the
// code:
//   - from Gmail's live read of the thread (reply_context): the newest message's sender plus its To and Cc, minus the
//     mailbox; the card's `to` is the sender as shown, `cc` the others, `replyAllRecipients` the set;
//   - no set (fail closed) when the read cannot say who Reply all reaches: a Reply-To naming anyone else, a read without
//     verified header rows, the person's own newest message, a stored (not live) read, no mailbox address;
//   - no set when the draft is written long after the read, or with no read at all, or when Gmail did not open Reply all
//     for a reply that reaches more than one person;
//   - every publish of the draft's card (an update re-publishes it) carries the same set;
//   - review fix 1: Gmail's Reply all answers the message newest when the draft is composed, so the set holds only when a
//     read taken after the draft was written shows the same newest message reaching the same people. A message that came
//     in between the read and the draft (another sender, the same sender again, someone added), or a failed re-read: no set.
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
import { replyAddressingOf, _resetAddressingForTesting, ADDRESSING_FRESH_MS } from "../drafts/addressing";

const ME = "me@acme.com";
const A1 = "acct-1";
const T1 = "thread-1";
const TOKEN = "app-token";

let db: Database;
let gmailThread: any;
let gmailFails: boolean;
let replyMode: string | undefined;
let published: any[];
let now: number;
let threadReads: number;

function platform(): any {
  return {
    appId: "email-desk", pairedAgent: { id: "ia-1", name: "Inbox Assistant" }, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [{ accountId: A1, email: ME, label: null }] } }),
      readTurn: async (account: string) => ({ ok: true, data: { turnId: `turn-${account}`, accountId: account, release: async () => {} } }),
      exec: async (req: any) => {
        if (req.functionName === "getThread") { threadReads++; return gmailFails ? { ok: false, reason: "mailbox busy" } : { ok: true, data: gmailThread }; }
        if (req.functionName === "createReplyDraft") {
          return { ok: true, data: { draftId: "gm-1", draftMessageId: "m-1", bodyAsSaved: String(req.params.body), ...(replyMode ? { replyMode } : {}) } };
        }
        if (req.functionName === "getDraft") return { ok: true, data: { draftId: req.params.draftId, body: "Hi all, Tuesday works.", threadId: T1 } };
        if (req.functionName === "updateDraft") return { ok: true, data: { ok: true, draftId: req.params.draftId, bodyAsSaved: String(req.params.body) } };
        return { ok: false, reason: `unexpected ${req.functionName}` };
      },
    },
    memory: { search: async () => ({ ok: true, data: { facts: [] } }) },
    tasks: { publish: async (t: any) => { published.push(t); return { ok: true, data: {} }; }, withdraw: async () => ({ ok: true, data: undefined }) },
  };
}

async function call(name: string, payload: Record<string, unknown>): Promise<any> {
  const res = await createOpsRouter({ handlers: allOps, token: TOKEN, platform: platform() }).request(`/ops/${name}`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  return res.json();
}

/** The newest message: Asha writes to the person, Sam and the person's other address on Cc. */
const newest = (m: Record<string, unknown> = {}) => ({
  from: "Asha Rao <asha@acme.com>", to: [ME], cc: ["sam@acme.com", "Ravi <ravi@acme.com>"], replyTo: [], replyToKnown: true,
  date: "Mon, 23 Nov 2026, 09:00", body: "Are you free on Tuesday?", ...m,
});
const threadWith = (m: Record<string, unknown> = {}) => ({
  threadId: T1, subject: "Re: Tuesday?",
  messages: [{ from: `Me <${ME}>`, to: ["asha@acme.com"], cc: [], replyTo: [], replyToKnown: true, date: "d", body: "How about next week?" }, newest(m)],
});

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-addressing-")));
  _setStoreForTesting(db);
  _setLogForTesting(() => {});
  _setOpsLogForTesting(() => {});
  now = Date.UTC(2026, 10, 23, 9, 30);
  _resetAddressingForTesting(() => now);
  published = []; gmailFails = false; replyMode = "reply-all"; threadReads = 0;
  gmailThread = threadWith();
  const r = normalizeInboxRow({ id: T1, from: "Asha Rao <asha@acme.com>", subject: "Tuesday?", snippet: "Are you free on Tuesday?", dateFull: "Mon, Nov 23, 2026, 9:00 AM" }, A1, new Date(Date.UTC(2026, 10, 23, 9, 0)));
  appendEvents(db, A1, [r]);
  setEventBody(db, { sourceId: GMAIL_SOURCE, accountId: A1, eventId: r.eventId }, [`From: Me <${ME}>\nHow about next week?`, "From: Asha Rao <asha@acme.com>\nAre you free on Tuesday?"].join(THREAD_BODY_SEPARATOR));
});
afterEach(() => {
  _setStoreForTesting(null);
  _setLogForTesting(null);
  _setOpsLogForTesting(null);
  _resetAddressingForTesting();
  db.close();
});

const cardContext = () => published[published.length - 1]?.context ?? null;
const STAMP = ["asha@acme.com", "sam@acme.com", "ravi@acme.com"];

describe("replyAddressingOf", () => {
  test("the newest message's sender, then its To and Cc, minus the mailbox", () => {
    expect(replyAddressingOf(threadWith(), ME)).toEqual({ to: "Asha Rao <asha@acme.com>", cc: "sam@acme.com, ravi@acme.com", recipients: STAMP });
    expect(replyAddressingOf(threadWith({ cc: [] }), "ME@acme.com")).toEqual({ to: "Asha Rao <asha@acme.com>", cc: "", recipients: ["asha@acme.com"] });
    // A Reply-To that is the sender itself changes nothing.
    expect(replyAddressingOf(threadWith({ replyTo: ["asha@ACME.com"] }), ME)?.recipients).toEqual(STAMP);
  });

  test("null when the read cannot say who Reply all reaches", () => {
    expect(replyAddressingOf(threadWith({ replyTo: ["lists@acme.com"] }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith({ replyToKnown: false }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith({ replyToKnown: undefined, replyTo: undefined }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith({ from: `Me <${ME}>` }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith({ cc: undefined }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith({ from: "Asha" }), ME)).toBeNull();
    expect(replyAddressingOf(threadWith(), "")).toBeNull();
    expect(replyAddressingOf({ messages: [] }, ME)).toBeNull();
  });
});

describe("the draft's card carries who the reply reaches", () => {
  test("reply_context's live read, then create_draft: the card's to, cc and replyAllRecipients; an update keeps them", async () => {
    await call("reply_context", { threadId: T1 });
    const made = await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    expect(made.id).toBeTruthy();
    expect(threadReads).toBe(2); // reply_context's read, then the one confirming the newest message after the write
    expect(cardContext()).toMatchObject({ to: "Asha Rao <asha@acme.com>", cc: "sam@acme.com, ravi@acme.com", replyAllRecipients: STAMP });
    // An update re-publishes the card with the same people.
    published = [];
    expect(await call("update_draft", { id: made.id, body: "Hi all, Tuesday at 4 works." })).toEqual({ ok: true });
    expect(cardContext()).toMatchObject({ to: "Asha Rao <asha@acme.com>", cc: "sam@acme.com, ravi@acme.com", replyAllRecipients: STAMP });
  });

  const unstamped = () => {
    const c = cardContext();
    expect(c).not.toBeNull();
    expect(c.replyAllRecipients).toBeUndefined();
    expect(c.to).toBeUndefined();
    expect(c.cc).toBeUndefined();
  };

  test("no read before the draft: no set", async () => {
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("the read is the journal's, not Gmail's (Gmail could not be read): no set", async () => {
    gmailFails = true;
    await call("reply_context", { threadId: T1 });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("a Reply-To naming someone else: no set", async () => {
    gmailThread = threadWith({ replyTo: ["lists@acme.com"] });
    await call("reply_context", { threadId: T1 });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("a later read that cannot say replaces an earlier one that could", async () => {
    await call("reply_context", { threadId: T1 });
    gmailThread = threadWith({ replyToKnown: false });
    await call("reply_context", { threadId: T1 });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("the draft written long after the read: no set", async () => {
    await call("reply_context", { threadId: T1 });
    now += ADDRESSING_FRESH_MS + 1;
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("Gmail opened plain Reply (or did not say) for a reply that reaches three people: no set", async () => {
    replyMode = "reply";
    await call("reply_context", { threadId: T1 });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("one person: plain Reply reaches them", async () => {
    gmailThread = threadWith({ cc: [] });
    replyMode = "reply";
    await call("reply_context", { threadId: T1 });
    await call("create_draft", { threadId: T1, body: "Hi Asha, Tuesday works." });
    expect(cardContext()).toMatchObject({ to: "Asha Rao <asha@acme.com>", cc: "", replyAllRecipients: ["asha@acme.com"] });
  });

  const newer = (m: Record<string, unknown>) => ({ ...gmailThread, messages: [...gmailThread.messages, { ...newest(), date: "Mon, 23 Nov 2026, 09:20", ...m }] });

  test("review fix 1: a newer message from someone else between the read and the draft: no set", async () => {
    await call("reply_context", { threadId: T1 });
    gmailThread = newer({ from: "Ben <ben@acme.com>", cc: ["sam@acme.com", "kim@acme.com"], body: "Adding Kim." });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("review fix 1: the same sender writes again, to the same people: no set (another message is newest)", async () => {
    await call("reply_context", { threadId: T1 });
    gmailThread = newer({ body: "Or Wednesday?" });
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });

  test("review fix 1: the read after the write fails: no set", async () => {
    await call("reply_context", { threadId: T1 });
    gmailFails = true;
    await call("create_draft", { threadId: T1, body: "Hi all, Tuesday works." });
    unstamped();
  });
});
