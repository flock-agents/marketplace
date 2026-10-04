import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-widget-"));
const S = await import("../store");
const { widgetRoutes } = await import("../widget");
const { rowSourceRef } = await import("../scheduler");
const { ymd } = await import("../events");

beforeEach(() => { for (const t of ["events", "reminders", "fires", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); });

describe("widget /api/widget/today", () => {
  test("a lead row published today is on the rail, linked to its occurrence's row (R21)", async () => {
    const occ = ymd(new Date(Date.now() + 3 * 86_400_000));
    S.insertReminder({ id: "rem_w", title: "Renew visa", body: null, dueDate: occ, dueTime: "10:00", recurrence: "none", leadDays: [3, 0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    S.recordFire({ reminderId: "rem_w", occurrence: occ, kind: "row@3", taskSourceRef: rowSourceRef("rem_w", occ), sessionId: null, status: "ok" });
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    const item = body.items.find((i: any) => i.id === "rem_w");
    expect(item).toMatchObject({ kind: "reminder", allDay: true, startAt: null, link: { kind: "task", sourceRef: rowSourceRef("rem_w", occ) } });
    expect(item.title).toMatch(/^Renew visa — in 3 days/);
  });
});

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
  test("a reminder due in 3 days is listed with its plain title and date; order is date, all-day first, time", async () => {
    S.insertReminder({ id: "rem_f", title: "Renew visa", body: null, dueDate: day(3), dueTime: "10:00", recurrence: "none", leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    S.insertReminder({ id: "rem_t", title: "Pay rent", body: null, dueDate: day(0), dueTime: null, recurrence: "none", leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    ins(ev("later", 3, false, 15), ev("allday3", 3, true, 0));
    const body = await (await widgetRoutes.request("/api/widget/today")).json() as any;
    expect(body.items.map((i: any) => [i.id, i.date])).toEqual([["rem_t", day(0)], ["allday3", day(3)], ["rem_f", day(3)], ["later", day(3)]]);
    expect(body.items.find((i: any) => i.id === "rem_f").title).toBe("Renew visa");
  });
});

describe("widget lead row in the window (A15)", () => {
  test("a lead row published today for an occurrence 5 days out sits under its due date", async () => {
    const occ = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 5));
    S.insertReminder({ id: "rem_l", title: "Renew visa", body: null, dueDate: occ, dueTime: "10:00", recurrence: "none", leadDays: [5, 0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    S.recordFire({ reminderId: "rem_l", occurrence: occ, kind: "row@5", taskSourceRef: rowSourceRef("rem_l", occ), sessionId: null, status: "ok" });
    const item = ((await (await widgetRoutes.request("/api/widget/today")).json()) as any).items.find((i: any) => i.id === "rem_l");
    expect(item).toMatchObject({ date: occ, allDay: true, link: { kind: "task", sourceRef: rowSourceRef("rem_l", occ) } });
  });
});

describe("widget connector state (A10)", () => {
  const get = async () => await (await widgetRoutes.request("/api/widget/today")).json() as any;
  test("no account: connected, connector none, reminders still listed", async () => {
    S.insertReminder({ id: "rem_n", title: "Pay rent", body: null, dueDate: ymd(new Date()), dueTime: null, recurrence: "none", leadDays: [0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    const body = await get();
    expect(body.connected).toBe(true);
    expect(body.fault).toBeNull();
    expect(body.connector).toBe("none");
    expect(body.items.map((i: any) => i.kind)).toContain("reminder");
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
