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
    expect(body.items.map((i: any) => [i.id, i.date])).toEqual([["tomorrow", day(1)], ["edge", day(7)]]);
  });
  test("order is date, all-day first, time; no reminder items exist", async () => {
    ins(ev("later", 3, false, 15), ev("allday3", 3, true, 0));
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    expect(body.items.map((i: any) => [i.id, i.date])).toEqual([["allday3", day(3)], ["later", day(3)]]);
    expect(body.items.every((i: any) => i.kind === "event")).toBe(true);
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
