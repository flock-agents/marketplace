import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-init-retry-"));
const S = await import("../store");
const { retryUnfinishedInits } = await import("../init-retry");

const T0 = new Date(2026, 9, 5, 9, 0);
const at = (min: number, sec = 0) => new Date(T0.getTime() + min * 60_000 + sec * 1000);
const STANDUP = { eventId: "su", title: "Standup", time: "11am", date: "Mon, 5 Oct" };

function platform(scrape: () => any) {
  const intents: any[] = [];
  let scrapes = 0;
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    progress: { report: async () => ok(undefined) }, tasks: { publish: async () => ok(undefined), withdraw: async () => ok(undefined), list: async () => ok({ tasks: [] }) },
    connectors: { exec: async (req: any) => { if (req.functionName === "listEvents") scrapes++; return req.functionName === "getEvent" ? ok({ ok: true, exists: true }) : scrape(); } },
    memory: { factsSince: async () => ok({ facts: [], nextSince: "" }), search: async () => ok({ facts: [] }) },
    agent: { intent: async (name: string, payload: any) => { intents.push({ name, payload }); return ok({ sessionId: "s", reused: false }); } },
  } as unknown as PlatformContext;
  return { ctx, intents, scrapes: () => scrapes };
}
const busy = () => platform(() => ({ ok: false, reason: "guard_busy" }));
const fails = () => platform(() => ({ ok: false, reason: "timeout" }));
const works = () => platform(() => ok({ ok: true, events: [STANDUP] }));

beforeEach(() => {
  for (const t of ["events", "cursors", "init_state", "planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`);
  S.markInitStarted("acct", "Reading your calendar");
});

describe("retryUnfinishedInits backoff", () => {
  test("a busy read is retried after 1 minute, not before; a second busy waits 2 minutes", async () => {
    let p = busy();
    expect(await retryUnfinishedInits(p.ctx, at(0))).toBe(1);
    expect(S.listInit()[0]!.finishedAt).toBeNull();
    p = busy();
    expect(await retryUnfinishedInits(p.ctx, at(0, 50))).toBe(0);
    expect(p.scrapes()).toBe(0);
    expect(await retryUnfinishedInits(p.ctx, at(1, 1))).toBe(1);
    expect(await retryUnfinishedInits(p.ctx, at(2, 30))).toBe(0);
    expect(await retryUnfinishedInits(p.ctx, at(3, 2))).toBe(1);
    expect(p.scrapes()).toBe(2);
  });
  test("a failed read waits 5 minutes", async () => {
    const p = fails();
    expect(await retryUnfinishedInits(p.ctx, at(0))).toBe(1);
    expect(S.listInit()[0]).toMatchObject({ outcome: "failed" });
    expect(await retryUnfinishedInits(p.ctx, at(4, 50))).toBe(0);
    expect(await retryUnfinishedInits(p.ctx, at(5, 1))).toBe(1);
  });
  test("busy and failure keep their own ladders: a failure after busy refusals waits 5 minutes, a busy after failures waits 1", async () => {
    await retryUnfinishedInits(busy().ctx, at(0));
    await retryUnfinishedInits(busy().ctx, at(1, 1));
    await retryUnfinishedInits(busy().ctx, at(3, 2));
    await retryUnfinishedInits(fails().ctx, at(7, 3));
    expect(await retryUnfinishedInits(fails().ctx, at(12, 0))).toBe(0);
    expect(await retryUnfinishedInits(fails().ctx, at(12, 5))).toBe(1);
    expect(await retryUnfinishedInits(busy().ctx, at(22, 10))).toBe(1);
    expect(await retryUnfinishedInits(busy().ctx, at(23, 0))).toBe(0);
    expect(await retryUnfinishedInits(busy().ctx, at(23, 15))).toBe(1);
  });
  test("a row that became done during the loop is not read again, and a done row is never demoted", async () => {
    S.markInitStarted("acct2", "Reading your calendar");
    const seen: string[] = [];
    const sync = async (a: string) => {
      seen.push(a);
      if (a === "acct") S.markInitFinished("acct2", "done", "Calendar is set up");
      return { ok: true, events: 0, fault: null };
    };
    expect(await retryUnfinishedInits(works().ctx, at(0), { sync: sync as any })).toBe(1);
    expect(seen).toEqual(["acct"]);
    const { completeFirstRead } = await import("../init-retry");
    expect(await completeFirstRead(works().ctx, "acct2", { ok: false, events: 0, fault: "timeout" }, () => at(1))).toBe("done");
    expect(await completeFirstRead(works().ctx, "acct2", { ok: false, events: 0, fault: "guard_busy", busy: true }, () => at(1))).toBe("done");
    expect(S.listInit().find((r) => r.accountId === "acct2")).toMatchObject({ outcome: "done" });
  });
  test("done rows are not retried", async () => {
    S.markInitFinished("acct", "done", "Calendar is set up");
    const p = works();
    expect(await retryUnfinishedInits(p.ctx, at(0))).toBe(0);
    expect(p.scrapes()).toBe(0);
  });
});

describe("retryUnfinishedInits planning", () => {
  test("a retried first success plans once with a fresh clock and the stored init_routines", async () => {
    S.setCursor("init_routines", JSON.stringify(["event-planning"]));
    S.markInitStarted("acct2", "Reading your calendar");
    let t = at(10).getTime();
    const p = platform(() => { t += 90_000; return ok({ ok: true, events: [STANDUP] }); });
    expect(await retryUnfinishedInits(p.ctx, at(10), { clock: () => new Date(t) })).toBe(2);
    expect(S.listInit().every((r) => r.outcome === "done")).toBe(true);
    const calls = p.intents.filter((i) => i.name === "plan_events");
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.nowLocal).toBe("09:13");
    const P = await import("../planning-store");
    expect(P.openPlan()?.createdAt).toBe(t);
    expect(S.getCursor("init_retry:acct") ?? "").toBe("");
  });
  test("planning off: the retry succeeds and no plan is made", async () => {
    const p = works();
    expect(await retryUnfinishedInits(p.ctx, at(0))).toBe(1);
    expect(S.listInit()[0]).toMatchObject({ outcome: "done" });
    expect(p.intents).toHaveLength(0);
  });
});
