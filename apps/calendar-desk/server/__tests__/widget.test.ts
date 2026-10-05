import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-widget-"));
const S = await import("../store");
const { widgetRoutes } = await import("../widget");
const { ymd } = await import("../events");

beforeEach(() => { for (const t of ["events", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); });

describe("widget week ahead (A15)", () => {
  const day = (n: number) => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + n));
  const ins = (...rows: any[]) => S.upsertEvents("a", rows, Date.now());
  const ev = (key: string, n: number, allDay: boolean, hour: number) => ({ accountId: "a", eventKey: key, title: key, startAt: new Date(`${day(n)}T${String(hour).padStart(2, "0")}:00:00`).getTime(), endAt: null, allDay, localDate: day(n), calendar: "primary", attendeesText: null, location: null, rawTimeText: null } as any);
  test("events inside the window are dated, beyond 7 days are dropped", async () => {
    ins(ev("tomorrow", 1, false, 9), ev("far", 9, false, 9), ev("edge", 7, false, 9));
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    expect(body.date).toBe(day(0));
    expect(body.items[0].calendar).toBe("primary");
    expect(body.items.map((i: any) => i.accountId)).toEqual(["a", "a"]);
    expect(body.items.map((i: any) => [i.id, i.date])).toEqual([["tomorrow", day(1)], ["edge", day(7)]]);
  });
  test("order is date, all-day first, time; no reminder items exist", async () => {
    ins(ev("later", 3, false, 15), ev("allday3", 3, true, 0));
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    expect(body.items.map((i: any) => [i.id, i.date])).toEqual([["allday3", day(3)], ["later", day(3)]]);
    expect(body.items.every((i: any) => i.kind === "event")).toBe(true);
  });
  test("fact events: marks memory, url link to the mail, accountId only when known", async () => {
    const today = day(0);
    S.upsertFactEvent({ accountId: "acc-home", factId: 3, title: "Flight 6E-512", localDate: today, startAt: null, sourceLink: "https://mail.google.com/mail/?authuser=a%40b.c#all/x" }, 1);
    S.upsertFactEvent({ accountId: "", factId: 4, title: "Asha's birthday", localDate: today, startAt: null, sourceLink: null }, 1);
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    const a = body.items.find((i: any) => i.id === "fact:3"), b = body.items.find((i: any) => i.id === "fact:4");
    expect(a).toMatchObject({ kind: "event", accountId: "acc-home", marks: ["memory"], link: { kind: "url", href: "https://mail.google.com/mail/?authuser=a%40b.c#all/x" } });
    expect(b.accountId).toBeUndefined();
    expect(b).toMatchObject({ marks: ["memory"], link: null });
  });
});

describe("widget connector state (A10)", () => {
  const get = async () => await (await widgetRoutes.request("/api/widget/today")).json() as any;
  test("no account: connected, connector none, no items", async () => {
    const body = await get();
    expect(body.connected).toBe(true);
    expect(body.fault).toBeNull();
    expect(body.connector).toBe("none");
    expect(body.items).toEqual([]);
  });
  test("first read not finished: syncing", async () => {
    S.markInitStarted("acct-1", "Reading your calendar");
    expect((await get()).connector).toBe("syncing");
  });
  test("read done, no fault: ok", async () => {
    S.markInitStarted("acct-1", "x"); S.markInitFinished("acct-1", "done", "Calendar is set up");
    expect((await get()).connector).toBe("ok");
  });
  test("fault recorded: attention, still connected, fault null", async () => {
    S.markInitStarted("acct-1", "x"); S.markInitFinished("acct-1", "done", "ok"); S.setCursor("fault:acct-1", "login wall");
    expect(await get()).toMatchObject({ connected: true, fault: null, connector: "attention" });
  });
});

describe("widget 90-day horizon feed (Task 53)", () => {
  const day = (n: number) => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + n));
  const feed = async (path: string) => await (await widgetRoutes.request(path)).json() as any;
  test("a fact event 45 days out is in /horizon and not in /today", async () => {
    S.upsertFactEvent({ accountId: "acc-home", factId: 11, title: "Mira's wedding", localDate: day(45), startAt: null, sourceLink: null }, 1);
    const h = await feed("/api/widget/horizon"), t = await feed("/api/widget/today");
    expect(h).toMatchObject({ template: "horizon", date: day(0) });
    expect(h.items.map((i: any) => i.id)).toEqual(["fact:11"]);
    expect(t.items).toEqual([]);
  });
  test("events past 90 days are dropped; day 90 is kept", async () => {
    S.upsertFactEvent({ accountId: "", factId: 12, title: "Edge day", localDate: day(90), startAt: null, sourceLink: null }, 1);
    S.upsertFactEvent({ accountId: "", factId: 13, title: "Beyond", localDate: day(91), startAt: null, sourceLink: null }, 1);
    expect((await feed("/api/widget/horizon")).items.map((i: any) => i.id)).toEqual(["fact:12"]);
  });
  test("a Google event today is in both feeds with identical item fields", async () => {
    const startAt = new Date(`${day(0)}T09:00:00`).getTime();
    S.upsertEvents("a", [{ accountId: "a", eventKey: "standup", title: "Standup", startAt, endAt: null, allDay: false, localDate: day(0), calendar: "primary", attendeesText: null, location: null, rawTimeText: null } as any], Date.now());
    S.upsertFactEvent({ accountId: "acc-home", factId: 14, title: "Zed's flight", localDate: day(0), startAt: null, sourceLink: "https://mail.google.com/x" }, 1);
    const h = await feed("/api/widget/horizon"), t = await feed("/api/widget/today");
    expect(t.items.length).toBe(2);
    expect(h.items).toEqual(t.items);
  });
});

describe("feeds carry event details (Task 9)", () => {
  const today = ymd(new Date());
  const seedEvent = (o: { eventKey: string; guests?: any[]; location?: string; meetLink?: string; description?: string }) => {
    S.upsertEvents("a", [{ accountId: "a", eventKey: o.eventKey, title: o.eventKey, startAt: new Date(`${today}T09:00:00`).getTime(), endAt: null, allDay: false, localDate: today, calendar: "primary", attendeesText: null, location: null, rawTimeText: null } as any], Date.now());
    S.saveEventDetails("a", o.eventKey, { guests: o.guests ?? [], location: o.location, meetLink: o.meetLink, description: o.description }, Date.now());
  };
  test("event items carry up to 8 guests, the rest counted, location and Meet; never description", async () => {
    seedEvent({ eventKey: "k1", guests: Array.from({ length: 11 }, (_, i) => ({ email: `g${i}@x.com` })), location: "HSR", meetLink: "https://meet.google.com/abc-defg-hij", description: "secret agenda" });
    const body = await (await widgetRoutes.request("/api/widget/horizon")).json() as any;
    const it0 = body.items.find((i: any) => i.id === "k1");
    expect([it0.guests.length, it0.moreGuests, it0.location, it0.meetLink, "description" in it0]).toEqual([8, 3, "HSR", "https://meet.google.com/abc-defg-hij", false]);
  });
  test("an event without details carries no guest, location or Meet fields", async () => {
    seedEvent({ eventKey: "bare" });
    const it0 = ((await (await widgetRoutes.request("/api/widget/today")).json()) as any).items.find((i: any) => i.id === "bare");
    expect(["guests", "moreGuests", "location", "meetLink"].map((k) => k in it0)).toEqual([false, false, false, false]);
  });
  test("horizon reports connector like /today", async () => {
    S.markInitStarted("acc", "x"); S.markInitFinished("acc", "done", "ok"); S.setCursor("fault:acc", "agenda unreadable");
    const body = await (await widgetRoutes.request("/api/widget/horizon")).json() as any;
    expect([body.connector, body.fault]).toEqual(["attention", null]);
  });
});
