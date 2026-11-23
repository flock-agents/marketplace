// The follow-up routine: sent mail nobody answered raises one TODO for the person's paired agent, and an answer withdraws it.
// Expectations come from the built-in desk's runner tests (email-desk-follow-up-*, follow-up-runner/-rules/-store) and the spec
// (§2.2, §5.1): the gate is the mirror of the draft gate; threads are read under ONE read turn in print view; a heavy day spans
// ticks; the day is stamped only when its work is done; the TODO's source ref is `follow-up:<threadId>`, so a repeat is one TODO.
// What does not port, and why, is in the task report: no wake, no grant window, no `considered`/`nudged` judging (the person is
// the judge), no draft settling (no draft is written).
// Mail dates have no zone: they read in the process zone, so the tests pin it.
process.env.TZ = "Asia/Kolkata";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore, _setStoreForTesting } from "../store";
import { decideNudgeEligibility, nextFollowUpAction, ownerMsgKey, businessDaysSetting } from "../lib/follow-up-rules";
import { followUpKindForTo } from "../lib/reply-context";
import { sentQuery } from "../journal";
import {
  followUpConfig, isFollowUpDue, runFollowUpForAccount, settleRepliedFollowUps, followUp, _resetFollowUpPassMemoryForTesting,
  FOLLOW_UP_CONSUMER, type FollowUpDeps,
} from "../routines/follow-up";
import { getFollowUp, putFollowUp, lastFollowUpRunAt, listFollowUpsOfferedSince, recordFollowUpRun } from "../routines/follow-up-store";

const OWNER = "shiva@bimacred.com";
const ACCT = "acct-1";
const IST = "Asia/Kolkata";
const NOW = Date.parse("2026-09-30T12:00:00+05:30"); // Wed
const OLD = "Thu, 24 Sept 2026, 10:00"; // 4 business days before NOW
const OLDER = "Wed, 23 Sept 2026, 10:00";
const TODAY = "Wed, 30 Sept 2026, 09:00";
const REPLY = "Fri, 25 Sept 2026, 10:00";
const CFG = { businessDays: 3, lookbackDays: 14, maxReads: 10, dailyLimit: 25 };
const THREAD = "18a1b2c3d4e5f601";

const msg = (from: string, date: string, over: Record<string, unknown> = {}) =>
  ({ from, to: ["Priya Shah <priya@acme.com>"], cc: ["Ravi <ravi@acme.com>"], date, body: "Any update on the MSA?", ...over });
const me = (date: string, over: Record<string, unknown> = {}) => msg(`Shiva <${OWNER}>`, date, over);
const priya = (date: string) => msg("Priya Shah <priya@acme.com>", date, { to: [OWNER], cc: [] });
type Thread = { messages: any[]; incomplete: boolean; subject: string };
const th = (...messages: any[]): Thread => ({ messages, incomplete: false, subject: "MSA" });

let db: Database;
beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-follow-up-")));
  _setStoreForTesting(db);
  _resetFollowUpPassMemoryForTesting();
});
afterEach(() => { _setStoreForTesting(null); db.close(); });

interface WorldOpts {
  threads?: Record<string, Thread>;
  rows?: any[];
  turn?: any;
  list?: () => any;
  publishOk?: boolean;
  withdrawOk?: boolean;
  pairedAgent?: { id: string; name: string } | null;
  values?: Record<string, unknown>;
  trigger?: "scheduled" | "event" | "manual";
  now?: () => number;
}
function world(o: WorldOpts = {}) {
  const threads: Record<string, Thread> = o.threads ?? {
    [THREAD]: th(me(OLDER, { to: ["priya@acme.com"], cc: [] }), priya(OLDER), me(OLD)),
    "t-new": th(me(TODAY)),
    "t-replied": th(me(OLD), priya(REPLY)),
  };
  const rows = o.rows ?? [{ id: THREAD, dateFull: OLD }, { id: "t-new", dateFull: TODAY }, { id: "t-replied", dateFull: REPLY }];
  const calls: Array<{ skillId: string; fn: string; params: any; opts: any }> = [];
  const turns: Array<{ accountHint: any; consumer: string; opts: any }> = [];
  const published: any[] = [];
  const withdrawn: string[] = [];
  const logs: string[] = [];
  let released = 0;
  const platform: any = {
    appId: "email-desk-p1", pairedAgent: o.pairedAgent === undefined ? { id: "pa-1", name: "Butler" } : o.pairedAgent, dataDir: "test", configured: true,
    connectors: {
      accounts: async () => ({ ok: true, data: { accounts: [{ accountId: ACCT, email: OWNER, label: "Shiva" }] } }),
      readTurn: async (accountHint: any, consumer: string, opts: any) => {
        turns.push({ accountHint, consumer, opts });
        return o.turn ?? { ok: true, data: { turnId: "turn-1", accountId: ACCT, release: async () => { released++; } } };
      },
    },
    tasks: {
      publish: async (t: any) => { published.push(t); return o.publishOk === false ? { ok: false, reason: "down" } : { ok: true, data: {} }; },
      withdraw: async (ref: string) => { withdrawn.push(ref); return o.withdrawOk === false ? { ok: false, reason: "down" } : { ok: true, data: undefined }; },
    },
  };
  const ctx: any = {
    routine: { id: "r1", appRoutineId: "follow-up", handler: "follow-up", agentId: "pa-1", name: "Follow up", accounts: { gmail: ACCT }, trigger: {}, values: o.values ?? {} },
    trigger: o.trigger ?? "event",
    platform,
    connectors: {
      exec: async (skillId: string, fn: string, params: any, opts: any) => {
        calls.push({ skillId, fn, params, opts });
        if (fn === "searchEmails") return o.list ? o.list() : { ok: true, data: rows };
        if (fn === "getThread") {
          const t = threads[params.threadId];
          return t ? { ok: true, data: t } : { ok: false, reason: "no such thread" };
        }
        return { ok: false, reason: `unexpected ${fn}` };
      },
    },
    wakeAgent: async () => { throw new Error("the follow-up routine never wakes an agent"); },
    notify: async () => ({ ok: true, data: { delivered: 0 } }),
    state: { get: () => null, set: () => {} },
  };
  let sleeps = 0;
  const deps: FollowUpDeps = { now: o.now ?? (() => NOW), tz: () => IST, sleep: async () => { sleeps++; }, log: (s) => { logs.push(s); } };
  const of = (fn: string) => calls.filter((c) => c.fn === fn);
  return { ctx, deps, calls, turns, published, withdrawn, logs, of, released: () => released, sleeps: () => sleeps };
}
const run = (w: ReturnType<typeof world>, cfg = CFG) => runFollowUpForAccount(w.ctx, ACCT, OWNER, cfg, w.deps);

describe("decideNudgeEligibility (the gate)", () => {
  const thread = (...messages: any[]) => ({ messages, incomplete: false });
  test("owner spoke last, long enough ago, to someone else: ok", () => {
    expect(decideNudgeEligibility(OWNER, thread(priya(OLD), me(OLD)), NOW, 3, IST)).toEqual({ ok: true });
  });
  test("someone else spoke last: draft_not_owner_last", () => {
    expect(decideNudgeEligibility(OWNER, thread(me(OLD), priya("Tue, 29 Sept 2026, 10:00")), NOW, 3, IST)).toMatchObject({ ok: false, code: "draft_not_owner_last" });
  });
  test("too recent: draft_nudge_too_soon", () => {
    expect(decideNudgeEligibility(OWNER, thread(me("Tue, 29 Sept 2026, 10:00")), NOW, 3, IST)).toMatchObject({ ok: false, code: "draft_nudge_too_soon" });
  });
  test("note to self: draft_nudge_self", () => {
    expect(decideNudgeEligibility(OWNER, thread(me(OLD, { to: [OWNER.toUpperCase()], cc: [] })), NOW, 3, IST)).toMatchObject({ ok: false, code: "draft_nudge_self" });
  });
  test("a message with an unsubscribe link is bulk: draft_bulk_mail", () => {
    expect(decideNudgeEligibility(OWNER, thread(me(OLD, { unsubscribeLink: true })), NOW, 3, IST)).toMatchObject({ ok: false, code: "draft_bulk_mail" });
  });
  test("unparseable date, incomplete read, no owner address: refuse (fail closed)", () => {
    expect(decideNudgeEligibility(OWNER, thread(me("yesterday")), NOW, 3, IST)).toMatchObject({ ok: false, code: "draft_nudge_undated" });
    expect(decideNudgeEligibility(OWNER, { ...thread(me(OLD)), incomplete: true }, NOW, 3, IST)).toMatchObject({ ok: false });
    expect(decideNudgeEligibility("", thread(me(OLD)), NOW, 3, IST)).toMatchObject({ ok: false });
  });
  test("business days skip weekends: a Friday message is due on Wednesday, not Monday", () => {
    const fri = thread(me("Fri, 25 Sept 2026, 10:00"));
    expect(decideNudgeEligibility(OWNER, fri, Date.parse("2026-09-28T12:00:00+05:30"), 3, IST)).toMatchObject({ ok: false, code: "draft_nudge_too_soon" });
    expect(decideNudgeEligibility(OWNER, fri, Date.parse("2026-09-29T12:00:00+05:30"), 3, IST)).toMatchObject({ ok: false, code: "draft_nudge_too_soon" });
    expect(decideNudgeEligibility(OWNER, fri, Date.parse("2026-09-30T12:00:00+05:30"), 3, IST)).toEqual({ ok: true });
    // One business day later is Monday.
    expect(decideNudgeEligibility(OWNER, fri, Date.parse("2026-09-28T12:00:00+05:30"), 1, IST)).toEqual({ ok: true });
  });
});

describe("nextFollowUpAction", () => {
  const key = ownerMsgKey({ date: OLD });
  const later = ownerMsgKey({ date: "Tue, 29 Sept 2026, 10:00" });
  test("never seen + owner last: judge", () => {
    expect(nextFollowUpAction(null, { lastIsOwner: true, ownerMsgKey: key })).toBe("judge");
  });
  test("the TODO is already up for this message: skip (one TODO per thread, across runs)", () => {
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "offered" }, { lastIsOwner: true, ownerMsgKey: key })).toBe("skip");
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "replied" }, { lastIsOwner: true, ownerMsgKey: key })).toBe("skip");
  });
  test("same message still waiting: judge again", () => {
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "waiting" }, { lastIsOwner: true, ownerMsgKey: key })).toBe("judge");
  });
  test("the person wrote a NEW message: judge afresh", () => {
    for (const status of ["offered", "replied", "waiting"] as const) {
      expect(nextFollowUpAction({ ownerMsgKey: key, status }, { lastIsOwner: true, ownerMsgKey: later })).toBe("judge");
    }
  });
  test("someone replied after the TODO was raised (or while waiting): settle_replied; after nothing: skip", () => {
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "offered" }, { lastIsOwner: false, ownerMsgKey: null })).toBe("settle_replied");
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "waiting" }, { lastIsOwner: false, ownerMsgKey: null })).toBe("settle_replied");
    expect(nextFollowUpAction({ ownerMsgKey: key, status: "replied" }, { lastIsOwner: false, ownerMsgKey: null })).toBe("skip");
    expect(nextFollowUpAction(null, { lastIsOwner: false, ownerMsgKey: null })).toBe("skip");
  });
});

describe("followUpConfig and isFollowUpDue", () => {
  test("defaults, the daily limit, and a fixed read cap of 15 per pass", () => {
    expect(followUpConfig({})).toEqual({ hour: 8, businessDays: 3, lookbackDays: 14, dailyLimit: 25, maxReads: 15 });
    expect(followUpConfig({ dailyLimit: 3, businessDays: 1, followUpHour: 0 })).toMatchObject({ dailyLimit: 3, maxReads: 15, businessDays: 1, hour: 0 });
    expect(followUpConfig({ businessDays: 0 })).toMatchObject({ businessDays: 0 });
    expect(followUpConfig({ businessDays: "0" })).toMatchObject({ businessDays: 0 });
    expect(followUpConfig({ businessDays: "" })).toMatchObject({ businessDays: 3 });
    expect(followUpConfig({ businessDays: -1 })).toMatchObject({ businessDays: 3 });
    expect(followUpConfig({ businessDays: 2.7 })).toMatchObject({ businessDays: 2 });
    for (const bad of [0, -2, "abc", null]) expect(followUpConfig({ dailyLimit: bad }).dailyLimit).toBe(25);
    expect(followUpConfig({ dailyLimit: 100 }).maxReads).toBe(15);
    expect(businessDaysSetting(undefined)).toBe(3);
  });
  test("false before the hour; true after with no run today; false after a run today; true the next day", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(isFollowUpDue(null, at("2026-09-30T07:30:00+05:30"), 8, IST)).toBe(false);
    expect(isFollowUpDue(null, at("2026-09-30T08:05:00+05:30"), 8, IST)).toBe(true);
    expect(isFollowUpDue(at("2026-09-29T09:00:00+05:30"), at("2026-09-30T08:05:00+05:30"), 8, IST)).toBe(true);
    expect(isFollowUpDue(at("2026-09-30T08:05:00+05:30"), at("2026-09-30T15:00:00+05:30"), 8, IST)).toBe(false);
    expect(isFollowUpDue(at("2026-09-30T08:05:00+05:30"), at("2026-10-01T08:01:00+05:30"), 8, IST)).toBe(true);
  });
});

describe("the store", () => {
  test("upsert replaces the row for (account, thread); the offer fields are kept when a write omits them", () => {
    putFollowUp({ accountId: ACCT, threadId: "t1", ownerMsgKey: "owner:a", status: "offered", checkedAt: 1, offeredAt: 500, recipientName: "Priya" });
    putFollowUp({ accountId: ACCT, threadId: "t1", ownerMsgKey: "owner:a", status: "replied", checkedAt: 2 });
    expect(getFollowUp(ACCT, "t1")).toEqual({ accountId: ACCT, threadId: "t1", ownerMsgKey: "owner:a", status: "replied", checkedAt: 2, offeredAt: 500, recipientName: "Priya" });
  });
  test("run stamp per account", () => {
    expect(lastFollowUpRunAt(ACCT)).toBeNull();
    recordFollowUpRun(ACCT, 100);
    recordFollowUpRun(ACCT, 200);
    expect(lastFollowUpRunAt(ACCT)).toBe(200);
    expect(lastFollowUpRunAt("other")).toBeNull();
  });
  test("offers since a time, for that account only", () => {
    putFollowUp({ accountId: ACCT, threadId: "a", ownerMsgKey: "k", status: "offered", checkedAt: 1, offeredAt: 100 });
    putFollowUp({ accountId: ACCT, threadId: "b", ownerMsgKey: "k", status: "offered", checkedAt: 1, offeredAt: 300 });
    putFollowUp({ accountId: "other", threadId: "c", ownerMsgKey: "k", status: "offered", checkedAt: 1, offeredAt: 300 });
    putFollowUp({ accountId: ACCT, threadId: "d", ownerMsgKey: "k", status: "waiting", checkedAt: 1 });
    expect(listFollowUpsOfferedSince(ACCT, 200).map((r) => r.threadId)).toEqual(["b"]);
  });
});

describe("kinds", () => {
  test("the TODO's kind is the first To address, bare and lower-cased (the follow_up_kind op answers the same)", () => {
    expect(followUpKindForTo('"Rao, Keshav" <Keshav@Acme.com>, ravi@acme.com')).toBe("keshav@acme.com");
    expect(followUpKindForTo(["Keshav"])).toBeNull();
  });
});

describe("runFollowUpForAccount", () => {
  test("raises one follow-up TODO per unanswered sent thread, addressed to the paired agent", async () => {
    const w = world();
    const t = await run(w);
    expect(w.published).toHaveLength(1);
    const p = w.published[0];
    expect(p.sourceRef).toBe(`follow-up:${THREAD}`);
    expect(p.title).toBe("Follow up with Priya");
    expect(p.title).not.toMatch(/[—–]|--/);
    expect(p.context.agentId).toBe("pa-1");
    expect(p.context.threadId).toBe(THREAD);
    expect(p.context.why).toContain("MSA");
    expect(`${p.context.why}${p.body ?? ""}`).not.toMatch(/[—–]|--/);
    expect(p.context.kindRef).toEqual({ who: "priya@acme.com", guess: "follow-up" });
    expect(p.deeplink).toContain(THREAD);
    expect(t).toMatchObject({ completed: true, listed: 3, offered: 1 });
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "offered", ownerMsgKey: ownerMsgKey({ date: OLD }), recipientName: "Priya", offeredAt: NOW });
  });

  test("a second run raises nothing more for the same thread (idempotent across runs)", async () => {
    const w = world();
    await run(w);
    _resetFollowUpPassMemoryForTesting();
    await run(w);
    expect(w.published).toHaveLength(1);
    // The decided thread was not even read again.
    expect(w.of("getThread").filter((c) => c.params.threadId === THREAD)).toHaveLength(1);
  });

  test("the address is the paired agent's, whoever it is; with no paired agent the TODO still goes, without an assumed one", async () => {
    const butler = world({ pairedAgent: { id: "butler-9", name: "Butler" } });
    await run(butler);
    expect(butler.published[0].context.agentId).toBe("butler-9");
    db.run("DELETE FROM follow_up_state");
    _resetFollowUpPassMemoryForTesting();
    const none = world({ pairedAgent: null });
    await run(none);
    expect(none.published[0].context.agentId).toBeUndefined();
  });

  test("a reply received withdraws it", async () => {
    const w = world();
    await run(w);
    expect(w.published).toHaveLength(1);
    // They answered: the thread now ends with Priya's message, and the sent list dates it by the newest message.
    w.deps.log = () => {};
    const w2 = world({
      threads: { [THREAD]: th(me(OLDER, { to: ["priya@acme.com"], cc: [] }), priya(OLDER), me(OLD), priya("Thu, 1 Oct 2026, 10:00")) },
      rows: [{ id: THREAD, dateFull: "Thu, 1 Oct 2026, 10:00" }],
    });
    // Same store, so the row from the first run is there.
    _resetFollowUpPassMemoryForTesting();
    const t = await run(w2);
    expect(w2.withdrawn).toEqual([`follow-up:${THREAD}`]);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "replied" });
    expect(t.settled).toBe(1);
    expect(w2.published).toHaveLength(0);
  });

  test("a reply while the TODO was never raised (waiting) marks it replied and withdraws nothing it did not raise", async () => {
    putFollowUp({ accountId: ACCT, threadId: THREAD, ownerMsgKey: ownerMsgKey({ date: OLD }), status: "waiting", checkedAt: Date.parse("2026-09-24T18:00:00+05:30") });
    const w = world({ threads: { [THREAD]: th(me(OLD), priya(REPLY)) }, rows: [{ id: THREAD, dateFull: REPLY }] });
    await run(w);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "replied" });
    expect(w.published).toHaveLength(0);
  });

  test("a withdraw that failed leaves the row offered, so the next run withdraws again", async () => {
    putFollowUp({ accountId: ACCT, threadId: THREAD, ownerMsgKey: ownerMsgKey({ date: OLD }), status: "offered", checkedAt: Date.parse("2026-09-24T18:00:00+05:30"), offeredAt: 1 });
    const w = world({ withdrawOk: false, threads: { [THREAD]: th(me(OLD), priya(REPLY)) }, rows: [{ id: THREAD, dateFull: REPLY }] });
    await run(w);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "offered" });
    const retry = world({ threads: { [THREAD]: th(me(OLD), priya(REPLY)) }, rows: [{ id: THREAD, dateFull: REPLY }] });
    _resetFollowUpPassMemoryForTesting();
    await run(retry);
    expect(retry.withdrawn).toEqual([`follow-up:${THREAD}`]);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "replied" });
  });

  test("the person writing again (a fresh message, too soon) takes the TODO down and waits", async () => {
    putFollowUp({ accountId: ACCT, threadId: THREAD, ownerMsgKey: ownerMsgKey({ date: OLD }), status: "offered", checkedAt: Date.parse("2026-09-24T18:00:00+05:30"), offeredAt: 1 });
    const w = world({ threads: { [THREAD]: th(me(OLD), me(TODAY)) }, rows: [{ id: THREAD, dateFull: TODAY }] });
    await run(w);
    expect(w.withdrawn).toEqual([`follow-up:${THREAD}`]);
    expect(w.published).toHaveLength(0);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "waiting", ownerMsgKey: ownerMsgKey({ date: TODAY }) });
  });

  test("a thread the person wrote today is never raised: waiting, and read again once due", async () => {
    const w = world();
    await run(w);
    expect(w.published.map((p) => p.sourceRef)).toEqual([`follow-up:${THREAD}`]);
    expect(getFollowUp(ACCT, "t-new")).toBeNull(); // dated today: not even read
    expect(w.of("getThread").map((c) => c.params.threadId)).not.toContain("t-new");
    const soon = world({ threads: { s1: th(me("Mon, 28 Sept 2026, 10:00")) }, rows: [{ id: "s1", dateFull: "Mon, 28 Sept 2026, 10:00" }] });
    await run(soon);
    expect(soon.published).toHaveLength(0);
    expect(getFollowUp(ACCT, "s1")).toMatchObject({ status: "waiting" });
  });

  test("someone else spoke last with no prior state: skipped, no TODO, no row", async () => {
    const w = world();
    await run(w);
    expect(getFollowUp(ACCT, "t-replied")).toBeNull();
    expect(w.published.map((p) => p.sourceRef)).not.toContain("follow-up:t-replied");
  });

  test("bulk mail (the declared unsubscribe flag) and a note to self draw no TODO", async () => {
    const w = world({
      threads: { a2: th(me(OLD, { unsubscribeLink: true })), a4: th(me(OLD, { to: [OWNER], cc: [] })) },
      rows: ["a2", "a4"].map((id) => ({ id, dateFull: OLD })),
    });
    await run(w);
    expect(w.published).toHaveLength(0);
  });

  test("a sent thread to support@ or billing@ with no reply raises a TODO", async () => {
    const w = world({
      threads: { s1: th(me(OLD, { to: ["support@vendor.com"], cc: [] })), s2: th(me(OLD, { to: ["Billing <billing@vendor.com>"], cc: [] })) },
      rows: ["s1", "s2"].map((id) => ({ id, dateFull: OLD })),
    });
    await run(w);
    expect(w.published.map((p) => p.sourceRef).sort()).toEqual(["follow-up:s1", "follow-up:s2"]);
  });

  test("a quoted unsubscribe footer in the person's message does not stop it", async () => {
    const w = world({
      threads: { q1: th(me(OLD, { body: "Any update?\n\n> Unsubscribe: https://news.acme.com/unsubscribe?u=1\n> manage your preferences" })) },
      rows: [{ id: "q1", dateFull: OLD }],
    });
    await run(w);
    expect(w.published.map((p) => p.sourceRef)).toEqual(["follow-up:q1"]);
  });

  test("the recipient's name is the first To's display name, else its local part", async () => {
    const w = world({
      threads: { n1: th(me(OLD, { to: ["priya.shah@acme.com"], cc: [] })), n2: th(me(OLD, { to: ['"Ravi Kumar" <ravi@acme.com>'], cc: [] })) },
      rows: [{ id: "n1", dateFull: OLD }, { id: "n2", dateFull: OLD }],
    });
    await run(w);
    expect(w.published.map((p) => p.title)).toEqual(["Follow up with Priya", "Follow up with Ravi"]);
  });

  test("reads: one read turn for this consumer, every call under it and on this account, print view, no cache, sent query", async () => {
    const w = world();
    await run(w);
    expect(w.turns).toEqual([{ accountHint: ACCT, consumer: "email-desk:follow-up", opts: expect.objectContaining({ skillId: "gmail" }) }]);
    expect(FOLLOW_UP_CONSUMER).toBe("email-desk:follow-up");
    expect(w.calls.length).toBeGreaterThan(1);
    for (const c of w.calls) { expect(c.skillId).toBe("gmail"); expect(c.opts).toMatchObject({ turnId: "turn-1", account: ACCT }); }
    expect(w.of("searchEmails")[0]!.params.query).toBe(sentQuery(14));
    for (const c of w.of("getThread")) expect(c.params).toMatchObject({ view: "print", bypassCache: true });
    expect(w.released()).toBe(1);
  });

  test("the turn is released when a read throws", async () => {
    const w = world();
    w.ctx.connectors.exec = async () => { throw new Error("boom"); };
    await expect(run(w)).rejects.toThrow("boom");
    expect(w.released()).toBe(1);
  });

  test("a held mailbox reads nothing, the day is left due", async () => {
    const w = world({ turn: { ok: false, reason: "busy", code: "busy" } });
    const t = await run(w);
    expect(w.calls).toHaveLength(0);
    expect(t.completed).toBe(false);
    expect(w.logs.join("\n")).toContain("busy");
  });

  test("a guard refusal on the sent list stops the pass; a failed list leaves the day due", async () => {
    const guard = world({ list: () => ({ ok: false, reason: "guard", code: "guard_budget_exhausted" }) });
    expect((await run(guard)).completed).toBe(false);
    expect(guard.of("getThread")).toHaveLength(0);
    const failed = world({ list: () => ({ ok: false, reason: "no network" }) });
    expect((await run(failed)).completed).toBe(false);
  });

  test("a guard refusal on a thread read stops the pass with the day left due", async () => {
    const w = world();
    const real = w.ctx.connectors.exec;
    w.ctx.connectors.exec = async (s: string, fn: string, p: any, o: any) => fn === "getThread" ? { ok: false, reason: "g", code: "guard_quarantined" } : real(s, fn, p, o);
    const t = await run(w);
    expect(t.completed).toBe(false);
    expect(w.published).toHaveLength(0);
  });

  test("a thread that cannot be read is not remembered: the next run reads it again", async () => {
    const w = world({ threads: {}, rows: [{ id: THREAD, dateFull: OLD }] });
    const t = await run(w);
    expect(t.completed).toBe(true);
    expect(getFollowUp(ACCT, THREAD)).toBeNull();
  });

  test("a TODO that could not be published leaves no offered row and the day due", async () => {
    const w = world({ publishOk: false });
    const t = await run(w);
    expect(t.completed).toBe(false);
    expect(getFollowUp(ACCT, THREAD)).toBeNull();
  });

  test("no mailbox address leaves the day due", async () => {
    const w = world();
    const t = await runFollowUpForAccount(w.ctx, ACCT, "", CFG, w.deps);
    expect(t.completed).toBe(false);
    expect(w.calls).toHaveLength(0);
  });

  test("maxReads caps the reads; the next tick reads only what is left and stamps the day", async () => {
    const ids = ["u1", "u2", "u3", "u4", "u5"];
    const threads = Object.fromEntries(ids.map((id) => [id, th(me(OLD, { to: [`${id}@acme.com`], cc: [] }))]));
    const rows = ids.map((id) => ({ id, dateFull: OLD }));
    const w = world({ threads, rows });
    const first = await run(w, { ...CFG, maxReads: 3 });
    expect(first).toMatchObject({ read: 3, offered: 3, completed: false });
    expect(w.published).toHaveLength(3);
    const second = await run(w, { ...CFG, maxReads: 3 });
    expect(second).toMatchObject({ read: 2, offered: 2, completed: true });
    expect(w.published.map((p) => p.sourceRef).sort()).toEqual(ids.map((i) => `follow-up:${i}`));
    expect(w.sleeps()).toBeGreaterThan(0);
  });

  test("the daily limit caps TODOs, counting those already raised today", async () => {
    const ids = ["u1", "u2", "u3"];
    const threads = Object.fromEntries(ids.map((id) => [id, th(me(OLD, { to: [`${id}@acme.com`], cc: [] }))]));
    const w = world({ threads, rows: ids.map((id) => ({ id, dateFull: OLD })) });
    const first = await run(w, { ...CFG, dailyLimit: 2 });
    expect(first.offered).toBe(2);
    expect(first.completed).toBe(true);
    _resetFollowUpPassMemoryForTesting();
    const again = await run(w, { ...CFG, dailyLimit: 2 });
    expect(again.offered).toBe(0);
    expect(again.completed).toBe(true);
    expect(w.of("searchEmails")).toHaveLength(1); // the spent day is not even listed
    expect(w.published).toHaveLength(2);
  });
});

describe("settleRepliedFollowUps (hourly, journal only)", () => {
  const SINCE = Date.parse("2026-09-24T18:00:00+05:30");
  function journal(threadKey: string, ts: number, from: string, opts: { sent?: boolean } = {}) {
    db.run(
      "INSERT INTO ingest_events (id, source_id, account_id, event_id, kind, actor, thread_key, ts, preview, raw, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [`evt_${Math.random()}`, "gmail", ACCT, `e-${Math.random()}`, "email", JSON.stringify({ email: from }), threadKey, ts, "p", JSON.stringify(opts.sent ? { folder: "sent" } : {}), ts],
    );
  }
  const offer = (threadId = THREAD) => putFollowUp({ accountId: ACCT, threadId, ownerMsgKey: ownerMsgKey({ date: OLD }), status: "offered", checkedAt: SINCE, offeredAt: SINCE });

  test("a reply newer than the TODO withdraws it with no Gmail read; sent rows and the person's own rows are not replies", async () => {
    offer();
    journal(THREAD, SINCE + 1000, OWNER);
    journal(THREAD, SINCE + 2000, "priya@acme.com", { sent: true });
    const w = world();
    expect(await settleRepliedFollowUps(w.ctx, ACCT, OWNER, w.deps)).toBe(0);
    expect(w.withdrawn).toEqual([]);
    journal(THREAD, SINCE + 3000, "Priya Shah <priya@acme.com>");
    expect(await settleRepliedFollowUps(w.ctx, ACCT, OWNER, w.deps)).toBe(1);
    expect(w.withdrawn).toEqual([`follow-up:${THREAD}`]);
    expect(w.calls).toHaveLength(0);
    expect(w.turns).toHaveLength(0);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "replied" });
  });

  test("a reply older than the TODO, or on another thread, changes nothing", async () => {
    offer();
    journal(THREAD, SINCE - 1000, "priya@acme.com");
    journal("other-thread", SINCE + 1000, "priya@acme.com");
    const w = world();
    expect(await settleRepliedFollowUps(w.ctx, ACCT, OWNER, w.deps)).toBe(0);
    expect(w.withdrawn).toEqual([]);
  });

  test("no open TODO: nothing is read, not even the journal; a failed withdraw keeps the row for the next tick", async () => {
    const quiet = world();
    expect(await settleRepliedFollowUps(quiet.ctx, ACCT, OWNER, quiet.deps)).toBe(0);
    offer();
    journal(THREAD, SINCE + 3000, "priya@acme.com");
    const down = world({ withdrawOk: false });
    expect(await settleRepliedFollowUps(down.ctx, ACCT, OWNER, down.deps)).toBe(0);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "offered" });
  });

  test("with no mailbox address nothing is settled (cannot tell the person's rows from a reply)", async () => {
    offer();
    journal(THREAD, SINCE + 3000, "priya@acme.com");
    const w = world();
    expect(await settleRepliedFollowUps(w.ctx, ACCT, "", w.deps)).toBe(0);
    expect(w.withdrawn).toEqual([]);
  });
});

describe("the follow-up routine handler", () => {
  test("before the hour it reads nothing; it settles replies every run", async () => {
    putFollowUp({ accountId: ACCT, threadId: THREAD, ownerMsgKey: "owner:x", status: "offered", checkedAt: 1000, offeredAt: 1000 });
    db.run("INSERT INTO ingest_events (id, source_id, account_id, event_id, kind, actor, thread_key, ts, raw, created_at) VALUES ('e1','gmail',?, 'ev1','email',?,?,5000,'{}',5000)",
      [ACCT, JSON.stringify({ email: "priya@acme.com" }), THREAD]);
    const w = world({ now: () => Date.parse("2026-09-30T07:00:00+05:30") });
    await followUp(w.ctx, w.deps);
    expect(w.calls).toHaveLength(0);
    expect(w.withdrawn).toEqual([`follow-up:${THREAD}`]);
  });

  test("after the hour it runs the day once and stamps it; a second run the same day reads nothing", async () => {
    const w = world();
    await followUp(w.ctx, w.deps);
    expect(w.published).toHaveLength(1);
    expect(lastFollowUpRunAt(ACCT)).toBe(NOW);
    const callsBefore = w.calls.length;
    await followUp(w.ctx, w.deps);
    expect(w.calls.length).toBe(callsBefore);
  });

  test("a day left due is not stamped", async () => {
    const w = world({ turn: { ok: false, reason: "busy", code: "busy" } });
    await followUp(w.ctx, w.deps);
    expect(lastFollowUpRunAt(ACCT)).toBeNull();
  });

  test("Run now (manual) runs even after today's run and before the hour", async () => {
    recordFollowUpRun(ACCT, NOW - 3600_000);
    const w = world({ trigger: "manual", now: () => Date.parse("2026-09-30T07:00:00+05:30") });
    await followUp(w.ctx, w.deps);
    expect(w.of("searchEmails")).toHaveLength(1);
  });

  test("the settings come from the routine's values, over its trigger filter", async () => {
    const w = world({ values: { businessDays: 5, followUpHour: 0 } });
    await followUp(w.ctx, w.deps);
    // Five business days: the OLD message is not yet due, so waiting and no TODO.
    expect(w.published).toHaveLength(0);
    expect(getFollowUp(ACCT, THREAD)).toMatchObject({ status: "waiting" });
  });

  test("the routine never wakes an agent", async () => {
    const w = world();
    await followUp(w.ctx, w.deps); // wakeAgent throws if called
    expect(w.published).toHaveLength(1);
  });
});
