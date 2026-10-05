// server/__tests__/scheduler.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-sched-"));
const S = await import("../store");
const { runPrepWindow, readPrepConfig, factsAroundDate } = await import("../scheduler");

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
beforeEach(() => { for (const t of ["events", "event_notes", "preps", "cursors"]) S._db.exec(`DELETE FROM ${t}`); });

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
  test("skips all-day and known-no-attendee events by default, and a vanished event", async () => {
    ev({ eventKey: "allday", allDay: true, startAt: null, endAt: null });
    ev({ eventKey: "solo", attendeesText: "" });
    ev({ eventKey: "gone" }); S.markMissingEvents("acct", ["2026-10-05"], ["allday", "solo"], 2);
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(0);
    expect((await runPrepWindow(p.ctx, readPrepConfig({ skipNoAttendees: false }), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(1);
  });
  test("a fact event inside the prep window is never prepped", async () => {
    S.upsertFactEvent({ accountId: "acct", factId: 3, title: "Invented fact event", localDate: "2026-10-05", startAt: new Date(2026, 9, 5, 15, 0).getTime(), sourceLink: null }, 1);
    S.upsertFactEvent({ accountId: "acct", factId: 4, title: "Invented all-day fact", localDate: "2026-10-05", startAt: null, sourceLink: null }, 1);
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig({ skipAllDay: false, skipNoAttendees: false }), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(0);
    expect(p.intents).toEqual([]);
  });
  test("unknown attendees (null — the scrape reads none) are not 'nobody invited': prepped with skipNoAttendees on (R22)", async () => {
    ev({ eventKey: "unknown", attendeesText: null });
    const p = platform();
    const cfgOn = readPrepConfig(undefined);
    expect(cfgOn.skipNoAttendees).toBe(true);
    expect((await runPrepWindow(p.ctx, cfgOn, new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(1);
    expect(p.intents[0].payload).toMatchObject({ eventKey: "unknown", attendees: "" });
  });
});

describe("factsAroundDate", () => {
  test("reads past the oldest page so recent facts are not dropped, newest first", async () => {
    const fact = (id: number, recordedAt: string, date: string) => ({ id, content: `fact ${id}`, when: { date }, dateRole: "deadline", recordedAt });
    const old = Array.from({ length: 500 }, (_, i) => fact(i + 1, `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, "2026-01-01"));
    const pages: Record<string, any> = {
      first: { facts: old, nextSince: "2026-09-01T00:00:59.000Z" },
      "2026-09-01T00:00:59.000Z": { facts: [old[499], fact(900, "2026-10-01T00:00:00.000Z", "2026-10-05"), fact(901, "2026-10-02T00:00:00.000Z", "2026-10-05")], nextSince: "2026-10-02T00:00:00.000Z" },
    };
    const asked: string[] = [];
    const p = platform();
    (p.ctx as any).memory.factsSince = async (o: { sinceIso: string }) => { asked.push(o.sinceIso); return ok(pages[asked.length === 1 ? "first" : o.sinceIso] ?? { facts: [], nextSince: o.sinceIso }); };
    const got = await factsAroundDate(p.ctx)("2026-10-05");
    expect(got.map((f: any) => f.content)).toEqual(["fact 901", "fact 900"]);
    expect(asked.length).toBe(2);
  });
});
