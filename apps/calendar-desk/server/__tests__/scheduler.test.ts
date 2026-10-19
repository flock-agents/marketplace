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
beforeEach(() => { for (const t of ["events", "event_notes", "preps", "cursors", "skipped_series"]) S._db.exec(`DELETE FROM ${t}`); });

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
  test("skips all-day events by default, and a vanished event", async () => {
    ev({ eventKey: "allday", allDay: true, startAt: null, endAt: null });
    ev({ eventKey: "gone" }); S.markMissingEvents("acct", ["2026-10-05"], ["allday"], 2);
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(0);
  });
  test("a fact event inside the prep window is never prepped", async () => {
    S.upsertFactEvent({ accountId: "acct", factId: 3, title: "Invented fact event", localDate: "2026-10-05", startAt: new Date(2026, 9, 5, 15, 0).getTime(), sourceLink: null }, 1);
    S.upsertFactEvent({ accountId: "acct", factId: 4, title: "Invented all-day fact", localDate: "2026-10-05", startAt: null, sourceLink: null }, 1);
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig({ skipAllDay: false }), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(0);
    expect(p.intents).toEqual([]);
  });
  test("unknown attendees (null — the scrape reads none) are prepped (R22)", async () => {
    ev({ eventKey: "unknown", attendeesText: null });
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync })).prepped).toBe(1);
    expect(p.intents[0].payload).toMatchObject({ eventKey: "unknown", attendees: "" });
  });
  test("the pre-prep refresh re-reads the candidates' details (forceDetailIds = their Google ids)", async () => {
    ev({ eventKey: "k1", googleEventId: "gk1" });
    const seen: any[] = [];
    const spy = (async (acct: string, _deps: any, reason: string, opts: any) => { seen.push({ acct, reason, opts }); return { ok: true, events: 0, fault: null }; }) as any;
    await runPrepWindow(platform().ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync: spy });
    expect(seen).toEqual([{ acct: "acct", reason: "pre-prep", opts: { forceDetailIds: ["gk1"] } }]);
  });
  test("details read but guests unknown (null) still prep (R22)", async () => {
    ev({ eventKey: "k1" }); S.saveEventDetails("acct", "k1", { guestSummary: "3 guests" }, 1);
    const p = platform();
    await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync });
    expect(p.intents.map((i) => i.payload.eventKey)).toEqual(["k1"]);
  });
  test("prep payload carries guests, description and Meet link", async () => {
    ev({ eventKey: "k1" });
    S.saveEventDetails("acct", "k1", { guests: [{ email: "yogesh@crafo.ai", rsvp: "awaiting" }, { email: "anita@acme.com", name: "Anita Rao", rsvp: "yes" }], guestSummary: "2 guests", description: "Review the calendar app", meetLink: "https://meet.google.com/abc-defg-hij" }, 1);
    const p = platform();
    await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync });
    const guests = "yogesh@crafo.ai (awaiting)\nAnita Rao <anita@acme.com> (yes)";
    expect(p.intents[0].payload).toMatchObject({ guests, attendees: guests, guestSummary: "2 guests", description: "Review the calendar app", meetLink: "https://meet.google.com/abc-defg-hij" });
  });
  test("guests never decide prep: a solo entry (details read, no other guest, an empty agenda line) is prepped for the agent to judge", async () => {
    ev({ eventKey: "solo", title: "Interview for Acme" }); S.saveEventDetails("acct", "solo", { guests: [] }, 1);
    ev({ eventKey: "blank", attendeesText: "" });
    const p = platform();
    await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 40), { facts: async () => [], sync });
    expect(p.intents.map((i) => i.payload.eventKey).sort()).toEqual(["blank", "solo"]);
  });
  test("a skipped series is skipped without the agent; an occurrence whose guests become known goes back to it", async () => {
    const at = (d: number) => ({ localDate: `2026-10-0${d}`, startAt: new Date(2026, 9, d, 15, 0).getTime(), endAt: new Date(2026, 9, d, 15, 30).getTime() });
    ev({ eventKey: "gym-5", title: "Gym", ...at(5) });
    const p = platform();
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 45), { sync })).prepped).toBe(1);
    expect(S.recordPrepVerdict("gym-5", "skip_series", "personal time block", 1)).toBe("skip_series");
    ev({ eventKey: "gym-6", title: "Gym", ...at(6) });
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 6, 14, 45), { sync })).prepped).toBe(0);
    ev({ eventKey: "gym-7", title: "Gym", ...at(7) }); S.saveEventDetails("acct", "gym-7", { guests: [{ email: "coach@gym.com" }] }, 1);
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 7, 14, 45), { sync })).prepped).toBe(1);
    expect(p.intents).toHaveLength(2);
  });
  test("any change to an occurrence clears the series skip so the agent decides again; an unchanged one stays skipped", async () => {
    const at = (d: number, h = 15, mins = 30) => ({ localDate: `2026-10-0${d}`, startAt: new Date(2026, 9, d, h, 0).getTime(), endAt: new Date(2026, 9, d, h, mins).getTime() });
    ev({ eventKey: "gym-5", title: "Gym", ...at(5) });
    const p = platform();
    await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 45), { sync });
    S.recordPrepVerdict("gym-5", "skip_series", "personal time block", 1);
    ev({ eventKey: "gym-6", title: "Gym", ...at(6) });
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 6, 14, 45), { sync })).prepped).toBe(0);
    ev({ eventKey: "gym-7", title: "Gym", ...at(7, 15, 60) });              // longer this time
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 7, 14, 45), { sync })).prepped).toBe(1);
    ev({ eventKey: "gym-8", title: "Gym", ...at(8) });                      // the skip was cleared: back to the agent
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 8, 14, 45), { sync })).prepped).toBe(1);
  });
  test("an occurrence with guests or a video link is never skipped for good: skip_series takes effect as skip_once", async () => {
    ev({ eventKey: "standup-5", title: "Daily standup" }); S.saveEventDetails("acct", "standup-5", { guests: [{ email: "dev@crafo.ai" }] }, 1); S.recordPrep("acct", "standup-5", "s");
    expect(S.recordPrepVerdict("standup-5", "skip_series", "routine", 2)).toBe("skip_once");
    expect(S.isSkippedSeries(S.getEvent("acct", "standup-5")!)).toBe(false);
    ev({ eventKey: "call-5", title: "Sync" }); S.saveEventDetails("acct", "call-5", { guests: [], meetLink: "https://meet.google.com/x" }, 1); S.recordPrep("acct", "call-5", "s");
    expect(S.recordPrepVerdict("call-5", "skip_series", null, 2)).toBe("skip_once");
  });
  test("skip_once skips only that occurrence: the next one still goes to the agent", async () => {
    const at = (d: number) => ({ localDate: `2026-10-0${d}`, startAt: new Date(2026, 9, d, 15, 0).getTime(), endAt: new Date(2026, 9, d, 15, 30).getTime() });
    ev({ eventKey: "review-5", title: "Product review", ...at(5) });
    const p = platform();
    await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 5, 14, 45), { sync });
    S.recordPrepVerdict("review-5", "skip_once", "nothing new this week", 1);
    ev({ eventKey: "review-6", title: "Product review", ...at(6) });
    expect((await runPrepWindow(p.ctx, readPrepConfig(undefined), new Date(2026, 9, 6, 14, 45), { sync })).prepped).toBe(1);
  });
  test("a verdict needs a prepped event; prep or skip_once clears an earlier series skip", async () => {
    ev({ eventKey: "never-prepped" });
    expect(S.recordPrepVerdict("never-prepped", "skip_series", null, 1)).toBeNull();
    ev({ eventKey: "sync-5", title: "Weekly sync" }); S.recordPrep("acct", "sync-5", "s");
    S.recordPrepVerdict("sync-5", "skip_series", "a hold", 1);
    expect(S.isSkippedSeries(S.getEvent("acct", "sync-5")!)).toBe(true);
    S.recordPrepVerdict("sync-5", "prep", "a call with the team", 2);
    expect(S.isSkippedSeries(S.getEvent("acct", "sync-5")!)).toBe(false);
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
