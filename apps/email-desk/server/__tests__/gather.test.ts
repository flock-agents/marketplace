import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { gatherNewMail, HARVEST_CONSUMER, EARLIER_MESSAGE_MARK } from "../routines/gather";
import { runMemoryExtraction } from "../routines/memory-extraction";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { markHandedOver, wasHandedOver } from "../routines/seen";
import { getCursor, setCursor, GMAIL_SOURCE } from "../journal";
import { recordMailDeleted } from "../mail-data";
import type { RoutineCtx, ReadTurnResult } from "../platform-ext";

const ACCOUNT = "acct-1";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** One "now" for the file, so a message read in two runs carries the same date (and fingerprint). */
const BASE = Date.now();
/** Gmail's row title ("23 Nov 2026, 09:14") for a time `minutesAgo` before BASE. */
function dateFull(minutesAgo: number): string {
  const d = new Date(BASE - minutesAgo * 60_000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

interface Msg { from: string; body: string; minutesAgo: number; to?: string[]; cc?: string[] }
/** A thread as the inbox lists it (its newest message) and as a thread read returns it (`earlier` messages first). */
interface Mail { threadId: string; from: string; subject: string; body: string; minutesAgo: number; to?: string[]; cc?: string[]; earlier?: Msg[]; participants?: string[] }

interface Fake {
  ctx: RoutineCtx;
  calls: { fn: string; params: Record<string, unknown>; opts: Record<string, unknown> }[];
  released: number;
  turns: { accountHint: string | undefined; consumer: string; opts: unknown }[];
}

function fake(opts: {
  mailbox: string;
  inbox: Mail[];
  turn?: ReadTurnResult;
  throwOn?: string;
  /** A Gmail function that answers this refusal instead. */
  refuseOn?: { fn: string; result: Record<string, unknown> };
  /** Threads the person started: listed by in:sent, read like any thread. */
  sent?: Mail[];
  label?: string | null;
  platformExtra?: Record<string, unknown>;
  /** What the in:sent lookup (checkEngagedDomains) finds engaged; "fails": the lookup could not run. Default: none. */
  engaged?: string[] | "fails";
  /** Domains whose lookup fails (the call that asks about one of them answers an error). */
  engagedFailsFor?: string[];
}): Fake {
  const f: Fake = { ctx: null as unknown as RoutineCtx, calls: [], released: 0, turns: [] };
  const rowOf = (m: Mail) => ({
    id: m.threadId, from: m.from, subject: m.subject, snippet: m.body.slice(0, 40),
    date: "", dateFull: dateFull(m.minutesAgo), isUnread: true, ...(m.participants ? { participants: m.participants } : {}),
  });
  const msgOf = (m: Msg) => ({ from: m.from, to: m.to ?? [opts.mailbox], cc: m.cc ?? [], date: dateFull(m.minutesAgo), body: m.body, recipientsVerified: true });
  const threadOf = (m: Mail) => ({ threadId: m.threadId, subject: m.subject, messages: [...(m.earlier ?? []).map(msgOf), msgOf(m)] });
  const all = () => [...opts.inbox, ...(opts.sent ?? [])];
  const exec = async (skillId: string, fn: string, params: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
    f.calls.push({ fn, params, opts: o });
    if (skillId !== "gmail") return { ok: false as const, reason: "unknown skill" };
    if (opts.throwOn === fn) throw new Error(`${fn} blew up`);
    if (opts.refuseOn?.fn === fn) return { ok: false as const, ...opts.refuseOn.result } as { ok: false; reason: string };
    if (fn === "listInbox") return { ok: true as const, data: opts.inbox.map(rowOf) };
    if (fn === "getThreads") {
      const ids = (params.threadIds as string[]) ?? [];
      return { ok: true as const, data: { threads: all().filter((m) => ids.includes(m.threadId)).map(threadOf) } };
    }
    if (fn === "getThread") {
      const m = all().find((x) => x.threadId === params.threadId);
      return m ? { ok: true as const, data: threadOf(m) } : { ok: false as const, reason: "not found" };
    }
    if (fn === "checkEngagedDomains") {
      if (opts.engaged === "fails") return { ok: false as const, reason: "search did not finish" };
      const asked = (params.domains as string[]) ?? [];
      if (asked.some((d) => (opts.engagedFailsFor ?? []).includes(d))) return { ok: false as const, reason: "BROWSER_ERROR: did not finish rendering" };
      return { ok: true as const, data: asked.filter((d) => (opts.engaged ?? []).includes(d)) };
    }
    if (fn === "searchEmails") return { ok: true as const, data: (opts.sent ?? []).map((m) => ({ ...rowOf(m), from: "me" })) };
    return { ok: false as const, reason: `unexpected ${fn}` };
  };
  const platform = {
    appId: "email-desk", pairedAgent: { id: "pa-1", name: "Butler" }, dataDir: "test", configured: true,
    connectors: {
      readTurn: async (accountHint: string | undefined, consumer: string, o?: unknown): Promise<ReadTurnResult> => {
        f.turns.push({ accountHint, consumer, opts: o });
        return opts.turn ?? { ok: true, data: { turnId: "turn-1", accountId: ACCOUNT, release: async () => { f.released++; } } };
      },
      accounts: async () => ({ ok: true as const, data: { accounts: [{ accountId: ACCOUNT, email: opts.mailbox, label: opts.label ?? null }] } }),
      exec: async () => ({ ok: false as const, reason: "use ctx.connectors.exec" }),
      list: async () => [],
    },
    ...(opts.platformExtra ?? {}),
  };
  f.ctx = {
    routine: { id: "r1", appRoutineId: "memory-extraction", handler: "memory-extraction", agentId: "pa-1", name: "Build memory", accounts: { gmail: ACCOUNT }, trigger: {}, values: {} },
    trigger: "event",
    platform,
    connectors: { exec },
    wakeAgent: async () => ({ ok: true as const, data: {} }),
    notify: async () => ({ ok: true as const, data: { delivered: 0 } }),
    state: { get: () => null, set: () => {} },
  } as unknown as RoutineCtx;
  return f;
}

let db: Database;
beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-gather-")));
  _setStoreForTesting(db);
});
afterEach(() => {
  _setStoreForTesting(null);
  db.close();
});

/** A new empty store for a second scenario in one test. */
function freshDb(): void {
  _setStoreForTesting(null);
  db.close();
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-gather-")));
  _setStoreForTesting(db);
}

const stateOf = (eventLike: string) =>
  (db.query("SELECT c.state, c.reason FROM ingest_comprehension c JOIN ingest_events e USING (source_id, account_id, event_id) WHERE e.thread_key = ?")
    .get(eventLike) as { state: string; reason: string | null } | null);

const ASHA: Mail = { threadId: "t-asha", from: "Asha Rao <asha@acme.com>", subject: "Tuesday lunch", body: "Are you free for lunch on Tuesday?", minutesAgo: 30 };

describe("gatherNewMail", () => {
  test("reads from the cursor and advances it", async () => {
    setCursor(db, GMAIL_SOURCE, ACCOUNT, "1000");
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA] });
    const r = await gatherNewMail(f.ctx, ACCOUNT);

    expect(f.turns).toEqual([{ accountHint: ACCOUNT, consumer: "email-desk:harvest", opts: { skillId: "gmail", ttlMs: 20 * 60_000 } }]);
    expect(HARVEST_CONSUMER).toBe("email-desk:harvest");
    // Every Gmail read ran under the held turn, on this account.
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) expect(c.opts).toMatchObject({ turnId: "turn-1", account: ACCOUNT });
    expect(f.calls[0]!.fn).toBe("listInbox");

    expect(r.busy).toBeFalsy();
    expect(r.kept).toHaveLength(1);
    const k = r.kept[0]!;
    expect(k).toMatchObject({ accountId: ACCOUNT, threadId: "t-asha", from: "Asha Rao <asha@acme.com>", subject: "Tuesday lunch", mailboxKind: "work", draftEligible: true });
    expect(k.body).toContain("Are you free for lunch on Tuesday?");
    expect(k.to).toBe("me@acme.com");

    expect(Number(r.cursor)).toBeGreaterThan(1000);
    expect(getCursor(db, GMAIL_SOURCE, ACCOUNT)).toBe(r.cursor);
    expect(f.released).toBe(1);

    // A second read of the same inbox journals nothing new; the cursor never rewinds.
    const again = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [{ ...ASHA, minutesAgo: 600 }] }).ctx, ACCOUNT);
    expect(again.cursor).toBe(r.cursor);
  });

  // Ruling P3-R13: the kept mail carries each message's To/Cc as the read gave them, in the order of the body's messages, so
  // Flock's item gate can tell a cc-only ask from one to the person.
  test("each kept message's To and Cc ride along, aligned with the body's messages", async () => {
    const cc: Mail = { threadId: "t-cc", from: "Priya <priya@acme.com>", subject: "MSA", body: "Raj, please send the signed MSA today.", minutesAgo: 20,
      to: ["raj@acme.com"], cc: ["me@acme.com"], earlier: [{ from: "Raj <raj@acme.com>", body: "Which MSA?", minutesAgo: 60, to: ["priya@acme.com", "me@acme.com"] }] };
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [cc] }).ctx, ACCOUNT);
    const k = r.kept[0]!;
    expect(k.body.split(THREAD_BODY_SEPARATOR)).toHaveLength(2);
    expect(k.recipients).toEqual([
      { to: ["priya@acme.com", "me@acme.com"], cc: [] },
      { to: ["raj@acme.com"], cc: ["me@acme.com"] },
    ]);
  });

  test('busy read-turn: no read, cursor unchanged, run ends ok with "mailbox busy"', async () => {
    setCursor(db, GMAIL_SOURCE, ACCOUNT, "1234");
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], turn: { ok: false, reason: "busy", code: "busy", retryAfterMs: 60_000 } });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r).toMatchObject({ kept: [], skipped: 0, cursor: "1234", busy: true, note: "mailbox busy", retryAfterMs: 60_000 });
    expect(f.calls).toHaveLength(0);
    expect(getCursor(db, GMAIL_SOURCE, ACCOUNT)).toBe("1234");
    expect((db.query("SELECT COUNT(*) AS n FROM ingest_events").get() as { n: number }).n).toBe(0);
  });

  test("a refused turn other than busy is a run that did not read the mailbox (stopped)", async () => {
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], turn: { ok: false, reason: "quarantined", code: "quarantined" } });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r.busy).toBeFalsy();
    expect(r.stopped).toBe("quarantined");
  });

  test("a sign-in wall on the read stops the run: stopped, the mail left pending", async () => {
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], refuseOn: { fn: "getThreads", result: { reason: "paused", code: "guard_quarantined" } } });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r.stopped).toBe("quarantined");
    expect(r.kept).toEqual([]);
    expect(r.deferred).toBeGreaterThan(0);
  });

  test("threads over the run's cap are left pending and counted (overCap)", async () => {
    const BEN: Mail = { ...ASHA, threadId: "t-ben", from: "Ben Ito <ben@acme.com>", subject: "Wednesday call", body: "Can we talk on Wednesday?", minutesAgo: 20 };
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA, BEN] });
    const r = await gatherNewMail(f.ctx, ACCOUNT, { maxThreads: 1 });
    expect(r.kept).toHaveLength(1);
    expect(r.overCap).toBe(1);
    expect(r.stopped).toBeUndefined();
  });

  test("a full read sets neither stopped nor overCap", async () => {
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA] }).ctx, ACCOUNT);
    expect(r.stopped).toBeUndefined();
    expect(r.overCap).toBeUndefined();
  });

  test("bulk mail skipped by body link", async () => {
    const news: Mail = { threadId: "t-news", from: "Priya at Acme <priya@acme.com>", subject: "This week at Acme",
      body: "Ten things we shipped.\n\nUnsubscribe: https://news.acme.com/unsubscribe?u=42", minutesAgo: 20 };
    const f = fake({ mailbox: "me@acme.com", inbox: [news, ASHA] });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r.kept.map((k) => k.threadId)).toEqual(["t-asha"]);
    expect(r.skipped).toBe(1);
    expect(stateOf("t-news")).toEqual({ state: "filtered", reason: "bulk_unsubscribe_link" });
  });

  test("personal mailbox (plain @gmail.com) applies personal rules", async () => {
    const alert: Mail = { threadId: "t-alert", from: "HDFC Bank <alerts@hdfcbank.net>", subject: "You have done a UPI txn", body: "Rs 450 debited from your account.", minutesAgo: 15 };
    const friend: Mail = { threadId: "t-friend", from: "Meera <meera.k@gmail.com>", subject: "Sunday?", body: "Coming over on Sunday?", minutesAgo: 10, to: ["family.home@gmail.com"] };

    const personal = await gatherNewMail(fake({ mailbox: "family.home@gmail.com", inbox: [alert, friend] }).ctx, ACCOUNT);
    expect(personal.kept.map((k) => k.threadId)).toEqual(["t-friend"]);
    expect(personal.kept[0]!.mailboxKind).toBe("personal");
    expect(stateOf("t-alert")).toEqual({ state: "filtered", reason: "personal_sender_role" });

    // The same alert on a work mailbox is not the personal rules' to drop.
    _setStoreForTesting(null);
    db.close();
    db = openStore(mkdtempSync(join(tmpdir(), "email-desk-gather-")));
    _setStoreForTesting(db);
    const work = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [{ ...alert, from: "HDFC Bank <alerts@acme.com>" }] }).ctx, ACCOUNT);
    expect(work.kept.map((k) => [k.threadId, k.mailboxKind])).toEqual([["t-alert", "work"]]);
  });

  test("a mail handed over once is never kept again", async () => {
    const first = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA] }).ctx, ACCOUNT);
    expect(first.kept).toHaveLength(1);
    // Not handed over yet: a run that ended before the hand-over offers it again.
    const retry = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA] }).ctx, ACCOUNT);
    expect(retry.kept.map((k) => k.messageId)).toEqual([first.kept[0]!.messageId]);

    markHandedOver(first.kept.map((k) => k.messageId));
    expect(wasHandedOver(first.kept[0]!.messageId)).toBe(true);
    const after = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA] }).ctx, ACCOUNT);
    expect(after.kept).toEqual([]);
    expect(stateOf("t-asha")).toEqual({ state: "extracted", reason: "handed_over" });
  });

  test("turn released when a read throws", async () => {
    setCursor(db, GMAIL_SOURCE, ACCOUNT, "77");
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], throwOn: "listInbox" });
    await expect(gatherNewMail(f.ctx, ACCOUNT)).rejects.toThrow("listInbox blew up");
    expect(f.released).toBe(1);
    expect(getCursor(db, GMAIL_SOURCE, ACCOUNT)).toBe("77");
  });

  test("personal mailbox with no family given: bulk mail naming no one is kept (fail open)", async () => {
    const society: Mail = { threadId: "t-society", from: "Lakeview Society <lakeviewsociety@gmail.com>", subject: "Diwali meet-up",
      body: "Join us on the lawn at 7.\n\nUnsubscribe: https://lists.example.org/unsubscribe?u=9", minutesAgo: 25 };
    const r = await gatherNewMail(fake({ mailbox: "family.home@gmail.com", inbox: [society] }).ctx, ACCOUNT);
    expect(r.kept.map((k) => k.threadId)).toEqual(["t-society"]);

    // With Flock's family (optional seam) the names are known, and bulk mail naming none of them drops (rule 7).
    freshDb();
    const family = { context: async () => ({ ok: true as const, data: { names: ["Agastya", "Priya"], addresses: [], schoolDomains: [] } }) };
    const withFamily = await gatherNewMail(fake({ mailbox: "family.home@gmail.com", inbox: [society], platformExtra: { family } }).ctx, ACCOUNT);
    expect(withFamily.kept).toEqual([]);
    expect(stateOf("t-society")).toEqual({ state: "filtered", reason: "bulk_impersonal" });
  });

  test("a new reply on a thread handed over before: earlier messages under the mark, only the new one above it", async () => {
    const first = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA] }).ctx, ACCOUNT);
    expect(first.kept[0]!.body).not.toContain(EARLIER_MESSAGE_MARK);
    markHandedOver(first.kept.map((k) => k.messageId));
    expect((db.query("SELECT COUNT(*) AS n FROM extracted_messages WHERE thread_key = 't-asha'").get() as { n: number }).n).toBe(1);

    const reply: Mail = {
      threadId: "t-asha", from: ASHA.from, subject: ASHA.subject, body: "Also, could you bring the deck?", minutesAgo: 5,
      earlier: [{ from: ASHA.from, body: ASHA.body, minutesAgo: ASHA.minutesAgo }],
    };
    const second = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [reply] }).ctx, ACCOUNT);
    expect(second.kept).toHaveLength(1);
    expect(second.kept[0]!.body).toBe(
      `${EARLIER_MESSAGE_MARK}\nFrom: ${ASHA.from}\n${ASHA.body}` + THREAD_BODY_SEPARATOR + `From: ${ASHA.from}\nAlso, could you bring the deck?`,
    );
  });

  test("after Delete my mail data, only mail newer than the delete is read; older messages of a thread are context", async () => {
    recordMailDeleted(BASE - 60 * 60_000);
    const old: Mail = { threadId: "t-old", from: "Ravi <ravi@acme.com>", subject: "Old news", body: "This came before the delete.", minutesAgo: 120 };
    const reply: Mail = {
      threadId: "t-asha", from: ASHA.from, subject: ASHA.subject, body: "Also, could you bring the deck?", minutesAgo: 5,
      earlier: [{ from: ASHA.from, body: ASHA.body, minutesAgo: 90 }],
    };
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [old, reply] }).ctx, ACCOUNT);
    expect(r.kept.map((k) => k.threadId)).toEqual(["t-asha"]);
    // The older mail is not even journaled: nothing will read it later.
    expect(db.query("SELECT 1 FROM ingest_events WHERE thread_key = 't-old'").get()).toBeNull();
    // The message from before the delete rides as context only, under the earlier mark.
    expect(r.kept[0]!.body).toBe(
      `${EARLIER_MESSAGE_MARK}\nFrom: ${ASHA.from}\n${ASHA.body}` + THREAD_BODY_SEPARATOR + `From: ${ASHA.from}\nAlso, could you bring the deck?`,
    );
  });

  test("owner names come from the Gmail account label when Flock gives none", async () => {
    const receipt: Mail = { threadId: "t-receipt", from: "Acme Billing <no-reply@billing.acme.com>", subject: "Your invoice",
      body: "Hi Shiva, your invoice for November is ready.\n\nUnsubscribe: https://billing.acme.com/unsubscribe", minutesAgo: 12 };
    const blast: Mail = { threadId: "t-blast", from: "Acme Offers <no-reply@offers.acme.com>", subject: "Big sale",
      body: "Big sale this week only.\n\nUnsubscribe: https://offers.acme.com/unsubscribe", minutesAgo: 11 };

    const named = await gatherNewMail(fake({ mailbox: "ss@acme.com", label: "Shiva", inbox: [receipt, blast] }).ctx, ACCOUNT);
    expect(named.kept.map((k) => k.threadId)).toEqual(["t-receipt"]);
    expect(stateOf("t-blast")).toEqual({ state: "filtered", reason: "bulk_impersonal" });

    // No label and a two-letter address: no names, so the bulk test cannot judge and keeps both.
    freshDb();
    const unnamed = await gatherNewMail(fake({ mailbox: "ss@acme.com", inbox: [receipt, blast] }).ctx, ACCOUNT);
    expect(unnamed.kept.map((k) => k.threadId).sort()).toEqual(["t-blast", "t-receipt"]);
  });

  test("sent mail is journaled under the turn, never draft-eligible, and handed over once", async () => {
    const proposal: Mail = { threadId: "t-sent", from: "me <me@acme.com>", subject: "Proposal", body: "Here is the proposal we discussed.",
      minutesAgo: 40, to: ["client@globex.com"] };
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], sent: [proposal] });
    const r = await gatherNewMail(f.ctx, ACCOUNT);

    const search = f.calls.find((c) => c.fn === "searchEmails")!;
    expect(search.params).toEqual({ query: "in:sent newer_than:2d", maxResults: 50 });
    expect(search.opts).toMatchObject({ turnId: "turn-1", account: ACCOUNT });
    const row = db.query("SELECT event_id, raw, actor FROM ingest_events WHERE thread_key = 't-sent'").get() as { event_id: string; raw: string; actor: string };
    expect(row.event_id.endsWith(":sent")).toBe(true);
    expect(JSON.parse(row.raw).folder).toBe("sent");
    expect(JSON.parse(row.actor).email).toBe("me@acme.com");

    const sentMail = r.kept.find((k) => k.threadId === "t-sent")!;
    expect(sentMail).toMatchObject({ draftEligible: false, mailboxKind: "work" });
    expect(sentMail.body).toContain("Here is the proposal we discussed.");

    markHandedOver(r.kept.map((k) => k.messageId));
    const again = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [ASHA], sent: [proposal] }).ctx, ACCOUNT);
    expect(again.kept).toEqual([]);
  });
});

// The drafting wake, end to end (live 2026-11-23: every Build memory run logged woke=0). The kept mail there was all
// automated senders, which draw no draft; this pins that a plainly reply-worthy mail from a sender the person writes to
// does wake the routine's agent.
describe("the drafting wake", () => {
  const RAVI: Mail = { threadId: "t-ravi", from: "Ravi K <ravi@partner.io>", subject: "Signed contract", body: "Can you send the signed contract by Friday?", minutesAgo: 30 };

  test("a plainly reply-worthy mail from an engaged sender is draft-eligible, and the routine wakes for it", async () => {
    const woken: any[] = [];
    const f = fake({
      mailbox: "me@acme.com", inbox: [RAVI], engaged: ["partner.io"],
      platformExtra: { memory: { extract: async () => ({ ok: true, data: { failedItems: 0, deferredItems: 0 } }) } },
    });
    (f.ctx as any).trigger = "manual";
    (f.ctx as any).wakeAgent = async (message: string, data: any) => { woken.push({ message, data }); return { ok: true, data: {} }; };
    await runMemoryExtraction(f.ctx, { ensureVoice: async () => undefined, voiceFor: () => ({ voice: "VOICE", voiceState: "ready" }) });
    expect(woken).toHaveLength(1);
    expect(woken[0].data.mails).toEqual([expect.objectContaining({ threadId: "t-ravi", accountId: ACCOUNT, subject: "Signed contract" })]);
  });

  test("the live run's senders (no-reply, notification, role and support addresses) draw no draft", async () => {
    const senders = [
      "Meta <noreply@email.meta.com>", "Facebook <notification@facebookmail.com>", "Fathom <no-reply@fathom.video>",
      "WorldClaw <hello@worldclaw.ai>", "OpenRouter <support@openrouter.ai>", "OpenRouter <notifications@openrouter.ai>",
      "Meta for Business <advertise-noreply@global.metamail.com>", "Google <no-reply@accounts.google.com>",
    ];
    const inbox: Mail[] = senders.map((from, i) => ({ threadId: `t-${i}`, from, subject: `Notice ${i}`, body: "Your account was updated.", minutesAgo: 30 + i }));
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox }).ctx, ACCOUNT);
    expect(r.kept).toHaveLength(senders.length);
    expect(r.kept.filter((k) => k.draftEligible)).toEqual([]);
  });
});

// The built-in desk's drafting gate (shouldTrigger's §4 gate, ported unchanged into lib/significance-gate.ts): new mail wakes
// the drafting agent only from a domain the person has written to. Here the lookup FAILS CLOSED for drafting (an unresolved
// domain wakes nobody), while the mail still goes to memory. A thread the person takes part in is never cold, so these mails
// are kept whatever the lookup says: only the drafting wake depends on it.
describe("the engaged-domain drafting gate", () => {
  const NEW: Mail = {
    threadId: "t-new", from: "Ravi K <ravi@partner.io>", subject: "Signed contract", body: "Can you send the signed contract by Friday?",
    minutesAgo: 30, participants: ["me@acme.com", "ravi@partner.io"],
  };
  const extracted: unknown[] = [];
  const memory = { memory: { extract: async (req: unknown) => { extracted.push(req); return { ok: true, data: { failedItems: 0, deferredItems: 0 } }; } } };
  beforeEach(() => { extracted.length = 0; });

  async function runWith(engaged: string[] | "fails"): Promise<{ woken: any[]; f: Fake }> {
    const woken: any[] = [];
    const f = fake({ mailbox: "me@acme.com", inbox: [NEW], engaged, platformExtra: memory });
    (f.ctx as any).trigger = "manual";
    (f.ctx as any).wakeAgent = async (message: string, data: any) => { woken.push({ message, data }); return { ok: true, data: {} }; };
    await runMemoryExtraction(f.ctx, { ensureVoice: async () => undefined, voiceFor: () => ({ voice: "VOICE", voiceState: "ready" }) });
    return { woken, f };
  }

  test("a domain the person has never written to draws no draft: kept for memory, no wake", async () => {
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [NEW], engaged: [] }).ctx, ACCOUNT);
    expect(r.kept.map((k) => k.threadId)).toEqual(["t-new"]);
    expect(r.kept[0]!.draftEligible).toBe(false);

    freshDb();
    const { woken } = await runWith([]);
    expect(woken).toEqual([]);
    expect(extracted).toHaveLength(1);
  });

  test("an engaged domain wakes the drafting agent", async () => {
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [NEW], engaged: ["partner.io"] }).ctx, ACCOUNT);
    expect(r.kept[0]!.draftEligible).toBe(true);

    freshDb();
    const { woken } = await runWith(["partner.io"]);
    expect(woken).toHaveLength(1);
    expect(woken[0].data.mails).toEqual([expect.objectContaining({ threadId: "t-new" })]);
  });

  test("a lookup that fails wakes nobody (fail closed), and the mail still goes to memory", async () => {
    const f = fake({ mailbox: "me@acme.com", inbox: [NEW], engaged: "fails" });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(f.calls.some((c) => c.fn === "checkEngagedDomains")).toBe(true);
    expect(r.kept.map((k) => k.threadId)).toEqual(["t-new"]);
    expect(r.kept[0]!.draftEligible).toBe(false);

    freshDb();
    const { woken } = await runWith("fails");
    expect(woken).toEqual([]);
    expect(extracted).toHaveLength(1);
  });

  test("a sender whose domain was learned engaged before is gated on the cache, with no lookup", async () => {
    db.query("INSERT INTO engaged_domains (account_id, domain, count, last_sent_at, seeded, updated_at) VALUES (?,?,0,0,0,?)").run(ACCOUNT, "partner.io", Date.now());
    const f = fake({ mailbox: "me@acme.com", inbox: [NEW], engaged: "fails" });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r.kept[0]!.draftEligible).toBe(true);
    expect(f.calls.some((c) => c.fn === "checkEngagedDomains")).toBe(false);
  });

  test("a calendar auto-response from an engaged sender draws no draft (the gate's order, unchanged)", async () => {
    const accepted: Mail = { ...NEW, threadId: "t-acc", subject: "Accepted: Contract review" };
    const r = await gatherNewMail(fake({ mailbox: "me@acme.com", inbox: [accepted], engaged: ["partner.io"] }).ctx, ACCOUNT);
    expect(r.kept.find((k) => k.threadId === "t-acc")?.draftEligible ?? false).toBe(false);
  });
});

// Live 2026-11-23 (email-desk-0932fc3e): one checkEngagedDomains call carried the batch's domains, its second in-session
// Gmail search did not settle, and the script's all-or-nothing exit (400 after 61 s) threw away the first domain's answer
// too. Each domain is now its own call, so one slow search costs only its own domain, and the failure's reason is logged.
describe("the engaged-domain lookup, one domain per call", () => {
  const A: Mail = { threadId: "t-a", from: "Ravi K <ravi@partner.io>", subject: "Contract", body: "Can you send the signed contract by Friday?", minutesAgo: 30, participants: ["me@acme.com"] };
  const B: Mail = { threadId: "t-b", from: "Lee <lee@slow.io>", subject: "Invoice", body: "Could you confirm the invoice total?", minutesAgo: 40, participants: ["me@acme.com"] };

  test("each domain is asked alone; a domain whose search fails leaves the others' answers standing", async () => {
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => { warned.push(a.join(" ")); };
    try {
      const f = fake({ mailbox: "me@acme.com", inbox: [B, A], engaged: ["partner.io"], engagedFailsFor: ["slow.io"] });
      const r = await gatherNewMail(f.ctx, ACCOUNT, { lookupPauseMs: 0 });
      const asked = f.calls.filter((c) => c.fn === "checkEngagedDomains").map((c) => c.params.domains);
      expect(asked.length).toBe(2);
      for (const d of asked) expect(d).toHaveLength(1);
      expect(r.kept.find((k) => k.threadId === "t-a")?.draftEligible).toBe(true);
      expect(r.kept.find((k) => k.threadId === "t-b")?.draftEligible).toBe(false);
      // The confirmed positive is kept for the next run; the failed domain is not cached either way.
      const cached = (db.query("SELECT domain FROM engaged_domains WHERE account_id = ? AND seeded = 0").all(ACCOUNT) as { domain: string }[]).map((x) => x.domain);
      expect(cached).toEqual(["partner.io"]);
      expect(warned.some((w) => w.includes("did not finish rendering"))).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});
