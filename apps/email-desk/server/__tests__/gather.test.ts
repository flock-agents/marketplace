import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { gatherNewMail, HARVEST_CONSUMER, EARLIER_MESSAGE_MARK } from "../routines/gather";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { markHandedOver, wasHandedOver } from "../routines/seen";
import { getCursor, setCursor, GMAIL_SOURCE } from "../journal";
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

interface Msg { from: string; body: string; minutesAgo: number; to?: string[] }
/** A thread as the inbox lists it (its newest message) and as a thread read returns it (`earlier` messages first). */
interface Mail { threadId: string; from: string; subject: string; body: string; minutesAgo: number; to?: string[]; earlier?: Msg[] }

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
  /** Threads the person started: listed by in:sent, read like any thread. */
  sent?: Mail[];
  label?: string | null;
  platformExtra?: Record<string, unknown>;
}): Fake {
  const f: Fake = { ctx: null as unknown as RoutineCtx, calls: [], released: 0, turns: [] };
  const rowOf = (m: Mail) => ({
    id: m.threadId, from: m.from, subject: m.subject, snippet: m.body.slice(0, 40),
    date: "", dateFull: dateFull(m.minutesAgo), isUnread: true,
  });
  const msgOf = (m: Msg) => ({ from: m.from, to: m.to ?? [opts.mailbox], cc: [], date: dateFull(m.minutesAgo), body: m.body, recipientsVerified: true });
  const threadOf = (m: Mail) => ({ threadId: m.threadId, subject: m.subject, messages: [...(m.earlier ?? []).map(msgOf), msgOf(m)] });
  const all = () => [...opts.inbox, ...(opts.sent ?? [])];
  const exec = async (skillId: string, fn: string, params: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
    f.calls.push({ fn, params, opts: o });
    if (skillId !== "gmail") return { ok: false as const, reason: "unknown skill" };
    if (opts.throwOn === fn) throw new Error(`${fn} blew up`);
    if (fn === "listInbox") return { ok: true as const, data: opts.inbox.map(rowOf) };
    if (fn === "getThreads") {
      const ids = (params.threadIds as string[]) ?? [];
      return { ok: true as const, data: { threads: all().filter((m) => ids.includes(m.threadId)).map(threadOf) } };
    }
    if (fn === "getThread") {
      const m = all().find((x) => x.threadId === params.threadId);
      return m ? { ok: true as const, data: threadOf(m) } : { ok: false as const, reason: "not found" };
    }
    if (fn === "checkEngagedDomains") return { ok: true as const, data: [] };
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

  test('busy read-turn: no read, cursor unchanged, run ends ok with "mailbox busy"', async () => {
    setCursor(db, GMAIL_SOURCE, ACCOUNT, "1234");
    const f = fake({ mailbox: "me@acme.com", inbox: [ASHA], turn: { ok: false, reason: "busy", code: "busy", retryAfterMs: 60_000 } });
    const r = await gatherNewMail(f.ctx, ACCOUNT);
    expect(r).toMatchObject({ kept: [], skipped: 0, cursor: "1234", busy: true, note: "mailbox busy", retryAfterMs: 60_000 });
    expect(f.calls).toHaveLength(0);
    expect(getCursor(db, GMAIL_SOURCE, ACCOUNT)).toBe("1234");
    expect((db.query("SELECT COUNT(*) AS n FROM ingest_events").get() as { n: number }).n).toBe(0);
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
