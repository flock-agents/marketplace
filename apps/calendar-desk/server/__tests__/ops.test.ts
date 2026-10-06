import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-ops-"));
const S = await import("../store");
const { ops } = await import("../ops");

const platform = { configured: true } as unknown as PlatformContext;
const ctx = { platform, agentId: "pa" };
beforeEach(() => { for (const t of ["events", "event_notes"]) S._db.exec(`DELETE FROM ${t}`); });

describe("operations", () => {
  test("the reminder operations are gone; the event operations remain", () => {
    expect(Object.keys(ops).sort()).toEqual(["list_upcoming", "plan_events_done", "refresh_calendar", "set_event_note"]);
  });
  test("list_upcoming lists events only, in date order within the window", async () => {
    const row = (eventKey: string, localDate: string) => ({ eventKey, calendar: null, title: eventKey, startAt: null, endAt: null, allDay: true, localDate, attendeesText: null, location: null, rawTimeText: null });
    S.upsertEvents("acct", [row("later", "2099-10-12"), row("first", "2099-10-10")], 1);
    const r: any = await ops.list_upcoming!({ days: 36500 }, ctx);
    expect(r.items.map((i: any) => [i.kind, i.eventKey])).toEqual([["event", "first"], ["event", "later"]]);
  });
  test("list_upcoming returns fact event with source: fact and Google one with source: google", async () => {
    const row = (eventKey: string, localDate: string) => ({ eventKey, calendar: null, title: eventKey, startAt: null, endAt: null, allDay: true, localDate, attendeesText: null, location: null, rawTimeText: null });
    S.upsertEvents("acct", [row("google-event", "2099-10-10")], 1);
    S.upsertFactEvent({ accountId: "acct", factId: 5, title: "Fact event", localDate: "2099-10-10", startAt: null, sourceLink: null }, 1);
    const r: any = await ops.list_upcoming!({ days: 36500 }, ctx);
    expect(r.items.map((i: any) => [i.eventKey, i.source])).toEqual([["google-event", "google"], ["fact:5", "fact"]]);
  });
  test("set_event_note matches by date + title words, reports ambiguity", async () => {
    S.upsertEvents("acct", [
      { eventKey: "p1", calendar: null, title: "Pricing review with Anita", startAt: 1, endAt: 2, allDay: false, localDate: "2099-10-10", attendeesText: null, location: null, rawTimeText: null },
      { eventKey: "p2", calendar: null, title: "Pricing sync", startAt: 3, endAt: 4, allDay: false, localDate: "2099-10-10", attendeesText: null, location: null, rawTimeText: null }], 1);
    expect(await ops.set_event_note!({ match: { date: "2099-10-10", titleContains: "pricing" }, note: "x" }, ctx)).toMatchObject({ code: "AMBIGUOUS" });
    const r: any = await ops.set_event_note!({ match: { date: "2099-10-10", titleContains: "anita" }, note: "ask about the discount" }, ctx);
    expect(r.eventKey).toBe("p1"); expect(S.getEventNote("acct", "p1")!.note).toBe("ask about the discount");
    expect(await ops.set_event_note!({ match: { date: "2099-10-11", titleContains: "x" }, note: "y" }, ctx)).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("refresh_calendar (A13)", () => {
  let scrapes = 0;
  const rp = { configured: true, connectors: { exec: async () => { scrapes++; return ok({ ok: true, events: [] }); } } } as unknown as PlatformContext;
  const rctx = { platform: rp, agentId: "pa" };
  beforeEach(() => { scrapes = 0; S._db.exec("DELETE FROM cursors; DELETE FROM init_state"); S.markInitStarted("acct"); S.markInitFinished("acct", "done"); });
  test("a refresh the user asks for scrapes even when the last scrape is fresh", async () => {
    S.setCursor("last_sync:acct", String(Date.now() - 10 * 60_000));
    const r: any = await ops.refresh_calendar!({}, rctx);
    expect(scrapes).toBe(1);
    expect(r.accounts[0]).toMatchObject({ ok: true, events: 0, fault: null }); expect(r.accounts[0].skipped).toBeUndefined();
    expect(r.note).toBeUndefined();
  });
  test("a scrape still running at the wait limit is reported as running, never as nothing found", async () => {
    let finish!: () => void;
    const slow = { configured: true, connectors: { exec: () => new Promise((res) => { finish = () => res(ok({ ok: true, events: [] })); }) } } as unknown as PlatformContext;
    S.setCursor("last_sync:acct", "0");
    const r: any = await ops.refresh_calendar!({}, { platform: slow, agentId: "pa", waitMs: 50 } as any);
    expect(r.accounts[0]).toMatchObject({ accountId: "acct", ok: true, running: true });
    expect(r.note).toMatch(/still reading/);
    // a second ask while the first scrape runs does not start another; it reports running too
    const r2: any = await ops.refresh_calendar!({}, { platform: slow, agentId: "pa", waitMs: 50 } as any);
    expect(r2.accounts[0]).toMatchObject({ running: true });
    finish(); await new Promise((r) => setTimeout(r, 20)); // let the background scrape settle so inFlight is clean
  });
  test("two slow accounts share one wait and both report running", async () => {
    S.markInitStarted("acct2"); S.markInitFinished("acct2", "done");
    const fins: (() => void)[] = [];
    const slow = { configured: true, connectors: { exec: () => new Promise((res) => { fins.push(() => res(ok({ ok: true, events: [] }))); }) } } as unknown as PlatformContext;
    const t0 = Date.now();
    const r: any = await ops.refresh_calendar!({}, { platform: slow, agentId: "pa", waitMs: 100 } as any);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(r.accounts.map((a: any) => a.running)).toEqual([true, true]);
    fins.forEach((f) => f()); await new Promise((res) => setTimeout(res, 20));
  });
  test("one fast and one slow account: the fast one is reported normally, the slow one running", async () => {
    S.markInitStarted("acct2"); S.markInitFinished("acct2", "done");
    const fins: (() => void)[] = [];
    let n = 0;
    const mixed = { configured: true, connectors: { exec: () => (n++ === 0 ? Promise.resolve(ok({ ok: true, events: [] })) : new Promise((res) => { fins.push(() => res(ok({ ok: true, events: [] }))); })) } } as unknown as PlatformContext;
    const r: any = await ops.refresh_calendar!({}, { platform: mixed, agentId: "pa", waitMs: 100 } as any);
    expect(r.accounts.filter((a: any) => a.running).length).toBe(1);
    expect(r.accounts.find((a: any) => !a.running)).toMatchObject({ ok: true, events: 0, fault: null });
    fins.forEach((f) => f()); await new Promise((res) => setTimeout(res, 20));
  });
  test("a stale last scrape syncs without force", async () => {
    S.setCursor("last_sync:acct", String(Date.now() - 3 * 3600_000));
    await ops.refresh_calendar!({}, rctx); expect(scrapes).toBe(1);
  });
  test("the daily cap wins over force", async () => {
    const { DAILY_SCRAPE_CAP } = await import("../sync"); const { ymd } = await import("../events");
    S.setCursor(`scrapes:acct:${ymd(new Date())}`, String(DAILY_SCRAPE_CAP));
    const r: any = await ops.refresh_calendar!({ force: true }, rctx);
    expect(r.accounts[0]).toMatchObject({ ok: false, skipped: "cap" }); expect(scrapes).toBe(0);
  });
  test("never throws: a failing sync is that account's fault", async () => {
    const bad = { configured: true, connectors: { exec: async () => { throw new Error("boom"); } } } as unknown as PlatformContext;
    S.setCursor("last_sync:acct", "0");
    const r: any = await ops.refresh_calendar!({ force: true }, { platform: bad, agentId: null });
    expect(r).toMatchObject({ ok: true, accounts: [{ accountId: "acct", ok: false, fault: "boom" }] });
  });
});
