import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-widget-"));
const S = await import("../store");
const { widgetRoutes } = await import("../widget");
const { rowSourceRef } = await import("../scheduler");
const { ymd } = await import("../events");

beforeEach(() => { for (const t of ["events", "reminders", "fires"]) S._db.exec(`DELETE FROM ${t}`); });

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
