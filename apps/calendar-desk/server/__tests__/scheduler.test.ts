// server/__tests__/scheduler.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-sched-"));
const S = await import("../store");
const { publishDueRows, fireTimedReminders, runPrepWindow, quietHoursDefer, readPrepConfig } = await import("../scheduler");
const { readRemindersConfig } = await import("../rules");

const cfg = readRemindersConfig(undefined);
function platform() {
  const published: any[] = [], intents: any[] = [];
  const ctx = { configured: true, pairedAgent: { id: "pa", name: "PA" },
    tasks: { publish: async (t: any) => { published.push(t); return ok(undefined); }, withdraw: async () => ok(undefined) },
    agent: { intent: async (name: string, payload: any) => { intents.push({ name, payload }); return ok({ sessionId: `s-${intents.length}`, reused: false }); } },
    connectors: { exec: async () => ok({ ok: true, events: [] }) },
    memory: { factsSince: async () => ok({ facts: [], nextSince: "" }) },
  } as unknown as PlatformContext;
  return { ctx, published, intents };
}
const rem = (over: any = {}) => S.insertReminder({ id: over.id ?? `rem_${Math.random().toString(36).slice(2, 7)}`, title: "Renew visa", body: "Visa valid until 19 Oct", dueDate: "2026-10-19", dueTime: null, recurrence: "none", leadDays: [14, 3, 0], sourceKind: "user", sourceRef: null, sourceLink: "https://x", accountId: null, state: "active", ...over });
beforeEach(() => { for (const t of ["events", "event_notes", "reminders", "fires", "preps", "cursors"]) S._db.exec(`DELETE FROM ${t}`); });

describe("publishDueRows", () => {
  test("publishes today's occurrences once, with due at local 09:00 and a card body; never before publishHour", async () => {
    const r = rem({ id: "rem_a" });
    const p = platform();
    expect(await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 5, 30))).toEqual({ published: 0, failed: 0 });
    expect(await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 6, 7))).toEqual({ published: 1, failed: 0 });
    expect(p.published[0]).toMatchObject({ sourceRef: "rem|rem_a|2026-10-19", title: "Renew visa — in 14 days (19 Oct)", type: "reminder", due: new Date(2026, 9, 19, 9, 0).getTime() });
    expect(p.published[0].context.card.blocks[0]).toMatchObject({ kind: "fields" });
    expect(await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 7, 7))).toEqual({ published: 0, failed: 0 });
    expect(S.getFire(r.id, "2026-10-19", "row")!.taskSourceRef).toBe("rem|rem_a|2026-10-19");
  });
  test("a same-day reminder created after publishHour is published on the next pass (Review Focus 1)", async () => {
    rem({ dueDate: "2026-10-05", leadDays: [0] });
    const p = platform();
    expect((await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 14, 7))).published).toBe(1);
  });
  test("a refused publish is not recorded, so the next pass retries", async () => {
    rem({ dueDate: "2026-10-05", leadDays: [0] });
    const p = platform(); (p.ctx.tasks as any).publish = async () => ({ ok: false, reason: "platform 503" });
    expect((await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 7, 0))).failed).toBe(1);
    expect(S.listFiresOn("2026-10-05").length).toBe(0);
  });
});

describe("fireTimedReminders", () => {
  test("fires at the minute, once, reusing the day's reminder session; defers inside quiet hours", async () => {
    rem({ id: "rem_t", dueDate: "2026-10-05", dueTime: "15:00", leadDays: [0] });
    const p = platform();
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 14, 59))).fired).toBe(0);
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 15, 0))).fired).toBe(1);
    expect(p.intents[0]).toMatchObject({ name: "reminder_due", payload: { reminderId: "rem_t", title: "Renew visa", dueAt: new Date(2026, 9, 5, 15, 0).toISOString() } });
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 15, 1))).fired).toBe(0);
    rem({ id: "rem_u", dueDate: "2026-10-05", dueTime: "16:00", leadDays: [0] });
    await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 16, 0));
    expect(p.intents[1].payload.reuseSessionId).toBe("s-1");
    rem({ id: "rem_q", dueDate: "2026-10-05", dueTime: "23:30", leadDays: [0] });
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 23, 31))).deferred).toBe(1);
    expect(quietHoursDefer(new Date(2026, 9, 5, 23, 31))!.getHours()).toBe(8);
    expect(quietHoursDefer(new Date(2026, 9, 5, 12, 0))).toBeNull();
  });
  test("missed while asleep: still today → fires once; yesterday → becomes a 'Missed:' row next morning (Review Focus 2)", async () => {
    rem({ id: "rem_m", dueDate: "2026-10-05", dueTime: "09:00", leadDays: [0] });
    const p = platform();
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 13, 0))).fired).toBe(1);
    rem({ id: "rem_y", dueDate: "2026-10-04", dueTime: "09:00", leadDays: [0] });
    expect((await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 13, 1))).fired).toBe(0);
    await publishDueRows(p.ctx, cfg, new Date(2026, 9, 5, 13, 2));
    expect(p.published.some((t) => t.title.startsWith("Missed:") && t.sourceRef === "rem|rem_y|2026-10-04")).toBe(true);
  });
  test("an intent failure is retried on the next loop and gives up after 3", async () => {
    rem({ id: "rem_f", dueDate: "2026-10-05", dueTime: "15:00", leadDays: [0] });
    const p = platform(); (p.ctx.agent as any).intent = async () => ({ ok: false, reason: "platform 429" });
    for (let i = 0; i < 4; i++) await fireTimedReminders(p.ctx, new Date(2026, 9, 5, 15, i));
    const f = S.getFire("rem_f", "2026-10-05", "chat")!;
    expect(f.status).toBe("failed"); expect(f.attempts).toBe(3);
  });
});

describe("runPrepWindow", () => {
  // The refresh path (an honest empty scrape clears the day) is covered by sync.test.ts; stub it here.
  const sync = (async () => ({ ok: true, events: 0, fault: null })) as any;
  const ev = (over: any = {}) => S.upsertEvents("acct", [{ eventKey: over.eventKey ?? "k1", calendar: "primary", title: "Pricing review", startAt: new Date(2026, 9, 5, 15, 0).getTime(), endAt: new Date(2026, 9, 5, 15, 30).getTime(), allDay: false, localDate: "2026-10-05", attendeesText: "Anita Rao", location: null, rawTimeText: "3 – 3:30pm", ...over }], 1);
  test("a meeting inside the window gets one prep intent with the note and nearby facts; outside or all-day gets none", async () => {
    ev(); S.setEventNote("acct", "k1", "ask about the renewal discount", "user");
    const p = platform();
    const facts = async () => [{ content: "Anita leads procurement at Acme." }];
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 0), { facts, sync })).prepped).toBe(0);
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 31), { facts, sync })).prepped).toBe(1);
    expect(p.intents[0]).toMatchObject({ name: "meeting_prep", payload: { eventKey: "k1", title: "Pricing review", note: "ask about the renewal discount", attendees: "Anita Rao" } });
    expect(p.intents[0].payload.factsAround).toHaveLength(1);
    expect(p.intents[0].payload.budget).toEqual({ toolCalls: 3, words: 300 });
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 45), { facts, sync })).prepped).toBe(0);
    expect(S.getPrep("acct", "k1")!.sessionId).toBe("s-1");
  });
  test("skips all-day and no-attendee events by default, and a vanished event", async () => {
    ev({ eventKey: "allday", allDay: true, startAt: null, endAt: null });
    ev({ eventKey: "solo", attendeesText: null });
    ev({ eventKey: "gone" }); S.markMissingEvents("acct", ["2026-10-05"], ["allday", "solo"], 2);
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(0);
    expect((await runPrepWindow(p.ctx, readPrepConfig({ skipNoAttendees: false }), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(1);
  });
});
