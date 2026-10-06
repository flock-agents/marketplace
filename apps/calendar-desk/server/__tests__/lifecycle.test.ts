import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
const DIR = mkdtempSync(join(tmpdir(), "calendar-desk-life-"));
process.env.APP_DATA_DIR = DIR;
const S = await import("../store");
const { calendarDeskHooks } = await import("../lifecycle");

function platform(scrape: () => any) {
  const published: any[] = [], intents: any[] = [];
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    progress: { report: async () => ok(undefined) }, tasks: { publish: async (t: any) => { published.push(t); return ok(undefined); }, withdraw: async () => ok(undefined) },
    connectors: { exec: async () => scrape() }, memory: { eventFacts: async () => ok({ facts: [{ id: 7, content: "Passport renewal appointment.", kind: "event", dateRole: "appointment", when: null, validFrom: null, validUntil: null, salience: 0.8, domain: null, sourceLink: null, entityIds: [], recordedAt: "2026-10-04T00:00:00.000Z", eventDate: "2026-10-20", eventTime: null, accountId: null }], snapshot: true }), factsSince: async () => ok({ facts: [], nextSince: "" }), extract: async () => ok(undefined), search: async () => ok({ facts: [] }) },
    agent: { intent: async (name: string, payload: any) => { intents.push({ name, payload }); return ok({ sessionId: "s", reused: false }); } },
  } as unknown as PlatformContext;
  (ctx as any).tasks.list = async () => ok({ tasks: [] });
  return { ctx, published, intents };
}
beforeEach(() => { for (const t of ["events", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); });

describe("initialize", () => {
  test("a refused first scrape is finished-but-failed and retried; a working one is done", async () => {
    await calendarDeskHooks.initialize({ reason: "account-added", accountIds: ["acct"], platform: platform(() => ({ ok: false, reason: "guard_busy" })).ctx } as any);
    expect(S.listInit()[0]).toMatchObject({ outcome: "failed" });
    await calendarDeskHooks.initialize({ reason: "onboarding", platform: platform(() => ok({ ok: true, events: [] })).ctx } as any);
    expect(S.listInit()[0]).toMatchObject({ outcome: "done" });
    expect(calendarDeskHooks.status!("acct")).toBe(true);
  });
});

describe("tick", () => {
  test("stores routine state and syncs on the scheduled hours only", async () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done");
    let scrapes = 0;
    const p = platform(() => { scrapes++; return ok({ ok: true, events: [] }); });
    const tick = (hour: number) => calendarDeskHooks.tick!({ readRoutines: [{ id: "meeting-prep", appId: "calendar-desk", trigger: { filter: { windowMinutes: 20 } } }], platform: p.ctx, now: () => { const d = new Date(); d.setHours(hour, 7, 0, 0); return d; } } as any);
    await tick(6);  expect(scrapes).toBe(1);
    await tick(7);  expect(scrapes).toBe(1);
    await tick(13); expect(scrapes).toBe(2);
    expect(p.published.length).toBe(0);
    expect(JSON.parse(S.getCursor("routines")!)["meeting-prep"]).toBeTruthy();
  });
});

describe("tick — light re-read (A13)", () => {
  test("a light sync runs only when the last scrape is older than 2h", async () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done");
    let scrapes = 0;
    const p = platform(() => { scrapes++; return ok({ ok: true, events: [] }); });
    const at = new Date(); at.setHours(10, 7, 0, 0);
    const tick = () => calendarDeskHooks.tick!({ readRoutines: [], platform: p.ctx, now: () => at } as any);
    const night = new Date(at); night.setHours(23, 0, 0, 0);
    S.setCursor("last_sync:acct", String(night.getTime() - 3 * 3600_000));
    await calendarDeskHooks.tick!({ readRoutines: [], platform: p.ctx, now: () => night } as any); expect(scrapes).toBe(0);
    S.setCursor("last_sync:acct", String(at.getTime() - 30 * 60_000));
    await tick(); expect(scrapes).toBe(0);
    S.setCursor("last_sync:acct", String(at.getTime() - 3 * 3600_000));
    await tick(); expect(scrapes).toBe(1);
    await tick(); expect(scrapes).toBe(1);
  });
});

describe("tick — routine identity on the real wire (C2)", () => {
  test("routines arrive as {id: <instance uuid>, appRoutineId: <manifest id>}; the prep routine is recognized as enabled", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    await calendarDeskHooks.tick!({ readRoutines: [
      { id: "0e9d8c7b-6a5f-4e3d-2c1b-a09f8e7d6c5b", appId: "calendar-desk", appRoutineId: "meeting-prep", trigger: { type: "schedule", filter: { windowMinutes: 45 } } },
    ], platform: p.ctx, now: () => { const d = new Date(); d.setHours(9, 7, 0, 0); return d; } } as any);
    const { readRoutineState } = await import("../scheduler");
    const st = readRoutineState();
    expect(st.prepEnabled).toBe(true);
    expect(st.prepCfg.windowMinutes).toBe(45);
    expect(p.published.length).toBe(0);
  });
});

describe("tick — fact events", () => {
  test("the tick reconciles the fact snapshot into events even with no accounts", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    await calendarDeskHooks.tick!({ readRoutines: [], platform: p.ctx, now: () => new Date(2026, 9, 5, 10, 0) } as any);
    expect(S.listFactEvents()).toHaveLength(1);
  });
});

describe("progress", () => {
  test("progress names the session fault; a healthy account reads as watching", () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done");
    expect((calendarDeskHooks.progress!() as { state: string; message: string }[])[0]).toMatchObject({ state: "done", message: "Watching your calendar" });
    S.setCursor("fault:acct", "login wall");
    expect((calendarDeskHooks.progress!() as { state: string; message: string }[])[0]).toMatchObject({ state: "error", message: expect.stringMatching(/Google session/) });
  });
});

describe("tick — event planning", () => {
  test("the tick plans only when it names the event-planning routine", async () => {
    for (const t of ["planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`);
    const p = platform(() => ok({ ok: true, events: [] }));
    const now = () => new Date(2026, 9, 5, 10, 30);
    await calendarDeskHooks.tick!({ readRoutines: [{ id: "u1", appId: "calendar-desk", appRoutineId: "meeting-prep", trigger: {} }], platform: p.ctx, now } as any);
    expect(p.intents).toEqual([]);
    await calendarDeskHooks.tick!({ readRoutines: [{ id: "u2", appId: "calendar-desk", appRoutineId: "event-planning", trigger: {} }], platform: p.ctx, now } as any);
    expect(p.intents.map((i: any) => i.name)).toEqual(["plan_events"]);
    expect(p.intents[0].payload.events.map((e: any) => e.event)).toEqual(["calendar-desk:fact:7"]);
    const { readRoutineState } = await import("../scheduler");
    expect(readRoutineState().planEnabled).toBe(true);
  });
});

describe("initialize — plans right after the first read", () => {
  const NOW = () => new Date(2026, 9, 5, 10, 30);
  const wipe = () => { for (const t of ["planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); S.setCursor("routines", "{}"); };
  const planCalls = (p: { intents: any[] }) => p.intents.filter((i) => i.name === "plan_events");
  const init = (p: any, extra: Record<string, unknown> = {}) => calendarDeskHooks.initialize({ reason: "onboarding", accountIds: ["acct"], platform: p.ctx, now: NOW, ...extra } as any);
  beforeEach(wipe);

  test("a first read that finishes done plans at once", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    await init(p, { enabledRoutines: ["event-planning"] });
    expect(planCalls(p)).toHaveLength(1);
  });
  test("planning off: no plan", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    await init(p, { enabledRoutines: ["meeting-prep"] });
    expect(planCalls(p)).toHaveLength(0);
  });
  test("a failed read: no plan", async () => {
    const p = platform(() => ({ ok: false, reason: "guard_busy" }));
    await init(p, { enabledRoutines: ["event-planning"] });
    expect(planCalls(p)).toHaveLength(0);
  });
  test("older platform: falls back to the tick snapshot", async () => {
    const { storeRoutineState } = await import("../scheduler");
    const a = platform(() => ok({ ok: true, events: [] }));
    await init(a);
    expect(planCalls(a)).toHaveLength(0);
    S._db.exec("DELETE FROM init_state");
    storeRoutineState([{ id: "x", appRoutineId: "event-planning", trigger: {} }]);
    const b = platform(() => ok({ ok: true, events: [] }));
    await init(b);
    expect(planCalls(b)).toHaveLength(1);
  });
  test("an account already done is not a first read", async () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done");
    const p = platform(() => ok({ ok: true, events: [] }));
    await init(p, { enabledRoutines: ["event-planning"] });
    expect(planCalls(p)).toHaveLength(0);
  });
  test("guards hold: a young open plan blocks a second wake", async () => {
    const P = await import("../planning-store");
    P.createPlan([{ ref: "r", accountId: "acct", eventKey: "k", date: "2026-10-06", startAt: null }], NOW().getTime() - 30 * 60_000);
    const p = platform(() => ok({ ok: true, events: [] }));
    await init(p, { enabledRoutines: ["event-planning"] });
    expect(planCalls(p)).toHaveLength(0);
  });
  test("a planning throw does not fail initialize", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    (p.ctx as any).agent.intent = async () => { throw new Error("boom"); };
    await init(p, { enabledRoutines: ["event-planning"] });
    expect(S.listInit()[0]).toMatchObject({ outcome: "done" });
  });
});
