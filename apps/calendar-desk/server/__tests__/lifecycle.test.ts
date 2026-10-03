import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
const DIR = mkdtempSync(join(tmpdir(), "calendar-desk-life-"));
process.env.APP_DATA_DIR = DIR;
const S = await import("../store");
const { calendarDeskHooks } = await import("../lifecycle");
const { migrateLegacyReminders } = await import("../migrate-legacy");

function platform(scrape: () => any) {
  const published: any[] = [];
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    progress: { report: async () => ok(undefined) }, tasks: { publish: async (t: any) => { published.push(t); return ok(undefined); }, withdraw: async () => ok(undefined) },
    connectors: { exec: async () => scrape() }, memory: { factsSince: async () => ok({ facts: [], nextSince: "" }), extract: async () => ok(undefined) }, agent: { intent: async () => ok({ sessionId: "s", reused: false }) },
  } as unknown as PlatformContext;
  return { ctx, published };
}
beforeEach(() => { for (const t of ["events", "reminders", "fires", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); });

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
  test("stores routine state, syncs on the scheduled hours only, ingests, publishes", async () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done");
    S.insertReminder({ id: "r1", title: "Pay rent", body: null, dueDate: new Date().toISOString().slice(0, 10), dueTime: null, recurrence: "none", leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    let scrapes = 0;
    const p = platform(() => { scrapes++; return ok({ ok: true, events: [] }); });
    const tick = (hour: number) => calendarDeskHooks.tick!({ readRoutines: [{ id: "reminders", appId: "calendar-desk", trigger: { filter: { publishHour: 6 } } }], platform: p.ctx, now: () => { const d = new Date(); d.setHours(hour, 7, 0, 0); return d; } } as any);
    await tick(6);  expect(scrapes).toBe(1);
    await tick(7);  expect(scrapes).toBe(1);
    await tick(13); expect(scrapes).toBe(2);
    expect(p.published.length).toBe(1);
    expect(JSON.parse(S.getCursor("routines")!).reminders).toBeTruthy();
  });
});

describe("tick — routine identity on the real wire (C2)", () => {
  test("routines arrive as {id: <instance uuid>, appRoutineId: <manifest id>}; both are recognized as enabled", async () => {
    S.insertReminder({ id: "r2", title: "Pay rent", body: null, dueDate: new Date().toISOString().slice(0, 10), dueTime: null, recurrence: "none", leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    const p = platform(() => ok({ ok: true, events: [] }));
    await calendarDeskHooks.tick!({ readRoutines: [
      { id: "6b1f0c2e-9a4d-4c7e-8f1a-0d2b3c4e5f60", appId: "calendar-desk", appRoutineId: "reminders", trigger: { type: "schedule", filter: { publishHour: 0 } } },
      { id: "0e9d8c7b-6a5f-4e3d-2c1b-a09f8e7d6c5b", appId: "calendar-desk", appRoutineId: "meeting-prep", trigger: { type: "schedule", filter: { windowMinutes: 45 } } },
    ], platform: p.ctx, now: () => { const d = new Date(); d.setHours(9, 7, 0, 0); return d; } } as any);
    const { readRoutineState } = await import("../scheduler");
    const st = readRoutineState();
    expect(st.remindersEnabled).toBe(true);
    expect(st.prepEnabled).toBe(true);
    expect(st.prepCfg.windowMinutes).toBe(45);
    expect(p.published.length).toBe(1);
  });
});

describe("progress and legacy migration", () => {
  test("progress names the session fault; migration takes one-shot reminders once and counts recurring ones", () => {
    S.markInitStarted("acct"); S.markInitFinished("acct", "done"); S.setCursor("fault:acct", "login wall");
    expect((calendarDeskHooks.progress!() as { state: string; message: string }[])[0]).toMatchObject({ state: "error", message: expect.stringMatching(/Google session/) });
    writeFileSync(join(DIR, "legacy-reminders.json"), JSON.stringify([
      { id: "rem_1", message: "Call plumber", scheduledFor: "2099-10-09T09:30:00+05:30", recurring: false },
      { id: "rem_2", message: "Standup", schedule: "0 9 * * 1-5", recurring: true },
      { id: "rem_4", message: "Call bank", scheduledFor: "2099-10-09T09:00:00Z", recurring: false },
      { id: "rem_3", message: "Old", scheduledFor: "2020-01-01T09:00:00Z", recurring: false }]));
    expect(migrateLegacyReminders(DIR, "2026-10-05")).toEqual({ migrated: 2, skippedRecurring: 1, absent: false });
    expect(S.listActiveReminders().find((r) => r.title === "Call plumber")).toMatchObject({ dueDate: "2099-10-09", dueTime: "09:30", sourceKind: "migrated" });
    const z = new Date("2099-10-09T09:00:00Z"), p2 = (n: number) => String(n).padStart(2, "0");
    expect(S.listActiveReminders().find((r) => r.title === "Call bank")).toMatchObject({ dueDate: `${z.getFullYear()}-${p2(z.getMonth() + 1)}-${p2(z.getDate())}`, dueTime: `${p2(z.getHours())}:${p2(z.getMinutes())}` });
    expect(existsSync(join(DIR, "legacy-reminders.migrated.json"))).toBe(true);
    expect(migrateLegacyReminders(DIR, "2026-10-05").absent).toBe(true);
  });
});
