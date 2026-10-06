// server/__tests__/sync.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-sync-"));
const S = await import("../store");
const P = await import("../planning-store");
const { syncAccount, shouldScrape, DAILY_SCRAPE_CAP, lastFault, MAX_RESULTS, ABSENCE_CHECK_MAX } = await import("../sync");

const NOW = new Date(2026, 9, 5, 9, 0);
function platform(answer: (req: any) => any): { ctx: PlatformContext; calls: any[] } {
  const calls: any[] = [];
  const ctx = { appId: "calendar-desk", pairedAgent: { id: "pa", name: "PA" }, dataDir: ".", configured: true,
    progress: { report: async () => ok(undefined) }, tasks: { publish: async () => ok(undefined), withdraw: async () => ok(undefined) },
    connectors: { exec: async (req: any) => { calls.push(req); return answer(req); } },
    memory: { extract: async () => ok(undefined), factsSince: async () => ok({ facts: [], nextSince: "" }) },
    agent: { intent: async () => ok({ sessionId: "s", reused: false }) },
  } as unknown as PlatformContext;
  return { ctx, calls };
}
beforeEach(() => { for (const t of ["events", "cursors"]) S._db.exec(`DELETE FROM ${t}`); });

describe("syncAccount", () => {
  test("stores the scrape, asks for today, and marks events Google says are gone", async () => {
    const p = platform(() => ok({ ok: true, events: [{ eventId: "su", title: "Standup", time: "9:30 – 10am", date: "Mon, 5 Oct" }], source: "browser_session" }));
    const r = await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(r).toMatchObject({ ok: true, events: 1, fault: null });
    expect(p.calls[0]).toMatchObject({ skillId: "google-calendar", functionName: "listEvents", accountHint: "acct", params: { timeMin: "2026-10-05" } });
    expect(p.calls[0].timeoutMs).toBeGreaterThanOrEqual(45_000);
    // Next scrape: Standup absent and Google can't find it → missing, not deleted.
    const p2 = platform((req) => req.functionName === "getEvent" ? ok({ ok: true, exists: false }) : ok({ ok: true, events: [{ title: "Review", time: "11am", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: p2.ctx, now: () => new Date(NOW.getTime() + 3 * 3600_000) }, "pre-prep");
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.find((e) => e.title === "Standup")!.missingSince).not.toBeNull();
    expect(all.find((e) => e.title === "Review")!.missingSince).toBeNull();
  });
  test("a clean sync leaves old fact events alone (they are withdrawn by the reconcile, never by date)", async () => {
    S.upsertFactEvent({ accountId: "acct", factId: 9, title: "Old fact", localDate: "2026-10-03", startAt: null, sourceLink: null }, 1);
    const r = await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    expect(r.ok).toBe(true);
    expect(S.listFactEvents().map((e) => e.eventKey)).toEqual(["fact:9"]);
  });
  test("a faulted scrape keeps yesterday's events and records the fault (Review Focus 3)", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const r = await syncAccount("acct", { platform: platform(() => ({ ok: false, reason: "BROWSER_ERROR: login wall" })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    expect(r.ok).toBe(false);
    expect(r.fault).toMatch(/login/);
    expect(lastFault("acct")).toMatch(/login/);
    expect(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05" }).length).toBe(1);
  });
  test("all rows filtered: ok, 0 events, stored rows Google can't find marked missing, no fault", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ eventId: "su", title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const r = await syncAccount("acct", { platform: platform((req) => req.functionName === "getEvent" ? ok({ ok: true, exists: false }) : ok({ ok: true, events: [{ title: "Diwali", date: "Mon, 5 Oct", allDay: true, calendar: "Holidays in India" }] })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    expect(r).toMatchObject({ ok: true, events: 0, fault: null });
    expect(lastFault("acct")).toBeNull();
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.length).toBe(1);
    expect(all[0]!.missingSince).not.toBeNull();
  });
  test("filtered plus a lone unreadable row: a fault now, still no missing-marking", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const orig = console.warn; console.warn = () => {};
    let r: any;
    try {
      r = await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [
        { title: "Diwali", date: "Mon, 5 Oct", allDay: true, calendar: "Holidays in India" }, { title: "Garbled", time: "1pm", date: "Sun4" }] })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    } finally { console.warn = orig; }
    expect(r.ok).toBe(false);
    expect(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true })[0]!.missingSince).toBeNull();
  });
  test("noise rows filtered and every other row unreadable: a fault, events kept, last_sync not advanced, nothing marked missing", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const before = S.getCursor("last_sync:acct");
    const orig = console.warn; console.warn = () => {};
    let r: any;
    try {
      r = await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [
        { title: "Example Festival", date: "", allDay: true, calendar: "Holidays in India" },
        { title: "Team offsite", date: "", allDay: true, attendees: "Alex Example" },
        { title: "Review", time: "1pm", date: "" }] })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    } finally { console.warn = orig; }
    expect(r).toMatchObject({ ok: false, events: 0, fault: "agenda unreadable" });
    expect(lastFault("acct")).toBe("agenda unreadable");
    expect(S.getCursor("last_sync:acct")).toBe(before);
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.length).toBe(1);
    expect(all[0]!.missingSince).toBeNull();
  });
  test("an honest empty scrape clears the day once Google confirms each event is gone", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ eventId: "su", title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    await syncAccount("acct", { platform: platform((req) => req.functionName === "getEvent" ? ok({ ok: true, exists: false }) : ok({ ok: true, events: [] })).ctx, now: () => new Date(NOW.getTime() + 4 * 3600_000) }, "scheduled");
    expect(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05" }).length).toBe(0);
  });
  test("a partly unreadable page upserts what parsed and withdraws nothing", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const logs: string[] = []; const orig = console.log; console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    let r: any;
    try {
      r = await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [
        { title: "Review", time: "11am", date: "Mon, 5 Oct" }, { title: "Garbled", time: "1pm", date: "Sun4" }] })).ctx, now: () => new Date(NOW.getTime() + 3 * 3600_000) }, "scheduled");
    } finally { console.log = orig; }
    expect(r).toMatchObject({ ok: true, events: 1, skippedRows: 1 });
    expect(logs.join("\n")).toContain("skipped=1");
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.find((e) => e.title === "Review")).toBeTruthy();
    expect(all.find((e) => e.title === "Standup")!.missingSince).toBeNull();
  });
  test("all rows unreadable is a fault; stored events and last_sync stay", async () => {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Standup", time: "9:30am", date: "Mon, 5 Oct" }] })).ctx, now: () => NOW }, "scheduled");
    const before = S.getCursor("last_sync:acct");
    const orig = console.warn; console.warn = () => {};
    let r: any;
    try {
      r = await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "G", date: "Sun4" }, { title: "H", date: "zzz" }] })).ctx, now: () => new Date(NOW.getTime() + 3 * 3600_000) }, "scheduled");
    } finally { console.warn = orig; }
    expect(r).toEqual({ ok: false, events: 0, fault: "agenda unreadable" });
    expect(lastFault("acct")).toBe("agenda unreadable");
    expect(S.getCursor("last_sync:acct")).toBe(before);
    const all = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(all.length).toBe(1); expect(all[0]!.missingSince).toBeNull();
  });
  test("the daily cap and the freshness rule", async () => {
    const p = platform(() => ok({ ok: true, events: [] }));
    for (let i = 0; i < DAILY_SCRAPE_CAP; i++) await syncAccount("acct", { platform: p.ctx, now: () => new Date(NOW.getTime() + i * 30 * 60_000) }, "scheduled");
    const r = await syncAccount("acct", { platform: p.ctx, now: () => new Date(2026, 9, 5, 23, 50) }, "scheduled");
    expect(r.skipped).toBe("cap");
    expect(p.calls.length).toBe(DAILY_SCRAPE_CAP);
    // pre-prep within 2h of a scrape is "fresh" and skipped
    S._db.exec("DELETE FROM cursors");
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "scheduled");
    expect(shouldScrape("acct", new Date(NOW.getTime() + 30 * 60_000), "pre-prep")).toBe(false);
    expect(shouldScrape("acct", new Date(NOW.getTime() + 3 * 3600_000), "pre-prep")).toBe(true);
  });
});

describe("event details (Task 8)", () => {
  test("asks for details per detailPlan, stores them, scales the timeout", async () => {
    const p = platform(() => ok({ ok: true, events: [
      { eventId: "g1", title: "Design Review", time: "4pm – 4:30pm", date: "Mon, 5 Oct", attendees: "Shiva Shankar", location: null,
        details: { guests: [{ email: "yogesh@crafo.ai" }], location: "HSR Layout" } },
    ] }));
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "forced");
    expect(MAX_RESULTS).toBe(200);
    expect(p.calls[0].params).toMatchObject({ maxResults: 200, details: { max: 60, skipIds: [] } });
    expect(p.calls[0].timeoutMs).toBe(195_000);
    const e = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05", accountId: "acct" })[0]!;
    expect([e.googleEventId, e.guests, e.location]).toEqual(["g1", [{ email: "yogesh@crafo.ai" }], "HSR Layout"]);
  });
  test("a popover without a location keeps the agenda's; unknown guests are stored as null", async () => {
    const p = platform(() => ok({ ok: true, events: [
      { eventId: "g1", title: "Dentist", time: "4pm – 4:30pm", date: "Mon, 5 Oct", location: "Smile Dental", details: { guestSummary: "2 guests" } },
    ] }));
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "forced");
    const e = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05", accountId: "acct" })[0]!;
    expect([e.location, e.guests, e.guestSummary]).toEqual(["Smile Dental", null, "2 guests"]);
  });
  test("forceDetailIds are asked for even when their details are fresh", async () => {
    const first = platform(() => ok({ ok: true, events: [{ eventId: "g3", title: "Review", time: "4pm", date: "Mon, 5 Oct", details: { guests: [{ email: "a@x.com" }] } }] }));
    await syncAccount("acct", { platform: first.ctx, now: () => NOW }, "forced");
    const p = platform(() => ok({ ok: true, events: [{ eventId: "g3", title: "Review", time: "4pm", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: p.ctx, now: () => new Date(NOW.getTime() + 3600_000) }, "forced", { forceDetailIds: ["g3"] });
    expect(p.calls[0].params.details.skipIds).not.toContain("g3");
  });
  test("a row without details is kept and is not skipped next time (Review Focus 4)", async () => {
    const p = platform(() => ok({ ok: true, events: [{ eventId: "g2", title: "Standup", time: "11am – 11:15am", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: p.ctx, now: () => NOW }, "forced");
    const e = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05", accountId: "acct" })[0]!;
    expect([e.googleEventId, e.guests, e.detailsAt]).toEqual(["g2", null, null]);
    expect(S.detailPlan("acct", NOW).skipIds).not.toContain("g2");
  });
  test("a re-scrape that skipped an event's details keeps the stored ones; the next plan skips it", async () => {
    const withDetails = platform(() => ok({ ok: true, events: [{ eventId: "g3", title: "Review", time: "4pm", date: "Mon, 5 Oct", details: { guests: [{ email: "a@x.com" }], meetLink: "https://meet.google.com/x" } }] }));
    await syncAccount("acct", { platform: withDetails.ctx, now: () => NOW }, "forced");
    const p = platform(() => ok({ ok: true, events: [{ eventId: "g3", title: "Review", time: "4pm", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: p.ctx, now: () => new Date(NOW.getTime() + 3600_000) }, "forced");
    expect(p.calls[0].params.details).toEqual({ max: 15, skipIds: ["g3"] });
    const e = S.getEvent("acct", S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-05" })[0]!.eventKey)!;
    expect([e.guests, e.meetLink, e.detailsAt]).toEqual([[{ email: "a@x.com" }], "https://meet.google.com/x", NOW.getTime()]);
  });
  test("a detail pass that got nothing back probes 3 for a day; a pass with details returns to the normal rule", async () => {
    const miss = platform(() => ok({ ok: true, events: [{ eventId: "g4", title: "Sync", time: "4pm", date: "Mon, 5 Oct" }] }));
    await syncAccount("acct", { platform: miss.ctx, now: () => NOW }, "forced");
    expect(miss.calls[0].params.details.max).toBe(60);
    expect(S.getCursor("detail_miss:acct")).toBe(String(NOW.getTime()));
    const later = new Date(NOW.getTime() + 3600_000);
    expect(S.detailPlan("acct", later).max).toBe(3);
    const hit = platform(() => ok({ ok: true, events: [{ eventId: "g4", title: "Sync", time: "4pm", date: "Mon, 5 Oct", details: { guests: [] } }] }));
    await syncAccount("acct", { platform: hit.ctx, now: () => later }, "forced");
    expect(hit.calls[0].params.details.max).toBe(3);
    expect(hit.calls[0].timeoutMs).toBe(195_000);
    expect(S.getCursor("detail_miss:acct")).toBe("");
    expect(S.detailPlan("acct", later).max).toBe(15);
  });
  test("the probe ends after a day; an all-day-only read is not a miss", async () => {
    S.setCursor("detail_miss:acct", String(NOW.getTime() - 25 * 3600_000));
    expect(S.detailPlan("acct", NOW).max).toBe(60);
    S.setCursor("detail_miss:acct", "");
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ eventId: "g5", title: "Offsite", date: "Mon, 5 Oct", allDay: true, attendees: "Pat" }] })).ctx, now: () => NOW }, "forced");
    expect(S.getCursor("detail_miss:acct")).toBe("");
  });
  test("a read that hit maxResults marks nothing missing (Review Focus 5)", async () => {
    S.upsertEvents("acct", [{ eventKey: "late", calendar: "primary", title: "Late", startAt: null, endAt: null, allDay: false, localDate: "2026-10-09", attendeesText: null, location: null, rawTimeText: null, googleEventId: null }], 1);
    const many = Array.from({ length: 200 }, (_, i) => ({ eventId: `g${i}`, title: `E${i}`, time: "9am – 10am", date: "Mon, 5 Oct" }));
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: many })).ctx, now: () => NOW }, "forced");
    expect(S.listEvents({ fromDate: "2026-10-09", toDate: "2026-10-09", accountId: "acct" }).length).toBe(1);
  });
});

describe("shouldScrape light/forced (A13)", () => {
  test("light needs a 2h-old scrape, forced ignores freshness, both obey the cap", async () => {
    const now = new Date(); const day = (await import("../events")).ymd(now);
    S.setCursor("last_sync:accl", String(now.getTime() - 30 * 60_000));
    expect(shouldScrape("accl", now, "light")).toBe(false);
    expect(shouldScrape("accl", now, "forced")).toBe(true);
    S.setCursor("last_sync:accl", String(now.getTime() - 3 * 3600_000));
    expect(shouldScrape("accl", now, "light")).toBe(true);
    S.setCursor(`scrapes:accl:${day}`, String(DAILY_SCRAPE_CAP));
    expect(shouldScrape("accl", now, "light")).toBe(false);
    expect(shouldScrape("accl", now, "forced")).toBe(false);
  });
});

describe("attempt back-off and in-flight guard (R33)", () => {
  test("a fault 30 min ago keeps light fresh; forced still runs", async () => {
    const now = new Date(); let n = 0;
    const p = platform(() => { n++; return { ok: false, reason: "guard_busy" }; });
    S.setCursor("last_sync:accb", "0");
    await syncAccount("accb", { platform: p.ctx, now: () => new Date(now.getTime() - 30 * 60_000) }, "forced");
    expect(n).toBe(1);
    const r: any = await syncAccount("accb", { platform: p.ctx, now: () => now }, "light");
    expect(r.skipped).toBe("fresh"); expect(n).toBe(1);
    await syncAccount("accb", { platform: p.ctx, now: () => now }, "forced"); expect(n).toBe(2);
  });
  test("an overlapping sync is skipped busy and uncounted", async () => {
    const now = new Date(); let n = 0; let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    const p = platform(() => { n++; return gate.then(() => ok({ ok: true, events: [] })); });
    const first = syncAccount("accc", { platform: p.ctx, now: () => now }, "forced");
    const second: any = await syncAccount("accc", { platform: p.ctx, now: () => now }, "forced");
    expect(second).toMatchObject({ ok: true, skipped: "busy" });
    release(); await first;
    expect(n).toBe(1);
    const { ymd } = await import("../events");
    expect(S.getCursor(`scrapes:accc:${ymd(now)}`)).toBe("1");
  });
});

describe("an event missing from a read is checked with Google (owner 2026-10-06)", () => {
  const LATER = () => new Date(NOW.getTime() + 4 * 3600_000);
  const seed = async (n: number, extra: any[] = []) => {
    const events = [...Array.from({ length: n }, (_, i) => ({ title: `E${i}`, time: `${(i % 12) + 1}pm`, date: "Mon, 5 Oct", eventId: `id${i}` })), ...extra];
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events })).ctx, now: () => NOW }, "scheduled");
  };
  const state = () => Object.fromEntries(S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true })
    .map((e) => [e.title, e.missingSince == null ? "present" : "removed"]));
  const read = (events: any[], answers: Record<string, any> = {}) => platform((req) => req.functionName === "listEvents" ? ok({ ok: true, events }) : answers[req.params.eid]);
  const checked = (p: { calls: any[] }) => p.calls.filter((c) => c.functionName === "getEvent").map((c) => c.params.eid);

  test("only Google saying it can't find the event removes it; found, unsure or no id changes nothing", async () => {
    await seed(4, [{ title: "No id", time: "11pm", date: "Mon, 5 Oct" }]);
    const p = read([{ title: "E3", time: "4pm", date: "Mon, 5 Oct", eventId: "id3" }],
      { id0: ok({ ok: true, exists: true }), id1: ok({ ok: true, exists: false }), id2: { ok: false, reason: "UNKNOWN: Could not tell" } });
    const r = await syncAccount("acct", { platform: p.ctx, now: LATER }, "scheduled");
    expect(r.ok).toBe(true);
    expect(p.calls.filter((c) => c.functionName === "getEvent").map((c) => [c.skillId, c.accountHint, c.params]))
      .toEqual(["id0", "id1", "id2"].map((eid) => ["google-calendar", "acct", { eid, check: true }]));
    expect(state()).toEqual({ E0: "present", E1: "removed", E2: "present", E3: "present", "No id": "present" });
  });
  test("a blank read is the same rule: every event is checked on its own", async () => {
    await seed(2);
    const p = read([], { id0: ok({ ok: true, exists: true }), id1: ok({ ok: true, exists: false }) });
    await syncAccount("acct", { platform: p.ctx, now: LATER }, "scheduled");
    expect(state()).toEqual({ E0: "present", E1: "removed" });
  });
  test("an unsure answer is asked again on the next read", async () => {
    await seed(1);
    const p1 = read([{ title: "Other", time: "9pm", date: "Mon, 5 Oct", eventId: "o" }], { id0: { ok: false, reason: "BROWSER_ERROR" } });
    await syncAccount("acct", { platform: p1.ctx, now: LATER }, "forced");
    const p2 = read([{ title: "Other", time: "9pm", date: "Mon, 5 Oct", eventId: "o" }], { id0: ok({ ok: true, exists: false }) });
    await syncAccount("acct", { platform: p2.ctx, now: () => new Date(LATER().getTime() + 3 * 3600_000) }, "forced");
    expect([checked(p1), checked(p2), state().E0]).toEqual([["id0"], ["id0"], "removed"]);
  });
  test(`at most ${10} checks per read; the rest wait for the next one`, async () => {
    expect(ABSENCE_CHECK_MAX).toBe(10);
    await seed(12);
    const p = read([], Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`id${i}`, ok({ ok: true, exists: false })])));
    await syncAccount("acct", { platform: p.ctx, now: LATER }, "scheduled");
    expect(checked(p).length).toBe(10);
    const v = Object.values(state());
    expect([v.filter((x) => x === "removed").length, v.filter((x) => x === "present").length]).toEqual([10, 2]);
  });
  test("renamed or moved: the Google id is the key, so it is one row, updated, present, with no getEvent call", async () => {
    await seed(1);
    const p = read([{ title: "E0 renamed", time: "5pm", date: "Mon, 5 Oct", eventId: "id0" }]);
    await syncAccount("acct", { platform: p.ctx, now: LATER }, "scheduled");
    expect(checked(p)).toEqual([]);
    const rows = S.listEvents({ fromDate: "2026-10-05", toDate: "2026-10-12", includeMissing: true });
    expect(rows.map((e) => [e.eventKey, e.title, e.missingSince])).toEqual([["id0", "E0 renamed", null]]);
  });
});

describe("a renamed planned event re-publishes its steps' limit reason (final review finding 2)", () => {
  const LATER = () => new Date(NOW.getTime() + 4 * 3600_000);
  function planningPlatform(events: any[], tasks: any[]) {
    const published: any[] = [];
    const base = platform((req) => req.functionName === "listEvents" ? ok({ ok: true, events }) : ok({ ok: true, exists: true }));
    (base.ctx as any).tasks = {
      publish: async (t: any) => { published.push(t); return ok(undefined); },
      withdraw: async () => ok(undefined),
      list: async (o: { prefix?: string } = {}) => ok({ tasks: tasks.filter((t) => t.sourceRef.startsWith(o.prefix ?? "")) }),
    };
    return { ...base, published };
  }
  const cab = { sourceRef: "step:id0:cab", status: "open", title: "Book a cab", due: new Date(2026, 9, 5).getTime(), dueTimed: false, showFrom: null, updatedAt: 0 };
  beforeEach(() => { for (const t of ["planned", "plans", "plan_steps"]) S._db.exec(`DELETE FROM ${t}`); });
  async function seedPlanned() {
    await syncAccount("acct", { platform: platform(() => ok({ ok: true, events: [{ title: "Physio", time: "5pm", date: "Mon, 5 Oct", eventId: "id0" }] })).ctx, now: () => NOW }, "scheduled");
    const e = S.getEvent("acct", "id0")!;
    P.markPlanned([{ accountId: "acct", eventKey: "id0", date: e.localDate, startAt: e.startAt }], NOW.getTime());
    P.recordStep("acct", "id0", "cab");
  }

  test("same time, new title: each open recorded step gets the cap with the new title", async () => {
    await seedPlanned();
    const p = planningPlatform([{ title: "Physio session", time: "5pm", date: "Mon, 5 Oct", eventId: "id0" }], [cab]);
    await syncAccount("acct", { platform: p.ctx, now: LATER }, "scheduled");
    expect(p.published).toEqual([{ sourceRef: "step:id0:cab", title: "Book a cab", maxDue: new Date(2026, 9, 5, 17, 0).getTime(), maxDueReason: "Physio session, Mon 5 Oct 17:00" }]);
  });

  test("unchanged title, or renamed and moved (the planning run re-dates it): nothing published here", async () => {
    await seedPlanned();
    const same = planningPlatform([{ title: "Physio", time: "5pm", date: "Mon, 5 Oct", eventId: "id0" }], [cab]);
    await syncAccount("acct", { platform: same.ctx, now: LATER }, "scheduled");
    const moved = planningPlatform([{ title: "Physio session", time: "6pm", date: "Mon, 5 Oct", eventId: "id0" }], [cab]);
    await syncAccount("acct", { platform: moved.ctx, now: () => new Date(LATER().getTime() + 3 * 3600_000) }, "scheduled");
    expect([same.published, moved.published]).toEqual([[], []]);
  });
});
