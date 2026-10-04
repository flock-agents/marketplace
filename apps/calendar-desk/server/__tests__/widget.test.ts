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
