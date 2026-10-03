import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-ops-"));
const S = await import("../store");
const { ops } = await import("../ops");
const { rowSourceRef } = await import("../scheduler");

const snoozes: any[] = []; const withdrawn: string[] = []; let withdrawResult: any = ok(undefined);
const platform = { configured: true, tasks: { publish: async () => ok(undefined), withdraw: async (ref: string) => { withdrawn.push(ref); return withdrawResult; }, snooze: async (ref: string, untilDate: string) => { snoozes.push({ ref, untilDate }); return ok(undefined); } } } as unknown as PlatformContext;
const ctx = { platform, agentId: "pa" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
beforeEach(() => { snoozes.length = 0; withdrawn.length = 0; withdrawResult = ok(undefined); for (const t of ["events", "event_notes", "reminders", "fires"]) S._db.exec(`DELETE FROM ${t}`); });

describe("add_reminder", () => {
  test("stores and returns; rejects a past date, a bad time, a missing title", async () => {
    const r: any = await ops.add_reminder!({ title: "Call plumber", dueDate: "2099-10-09", dueTime: "15:00" }, ctx);
    expect(r.id).toMatch(/^rem_/); expect(r.dueTime).toBe("15:00"); expect(r.sourceKind).toBe("user");
    expect(await ops.add_reminder!({ title: "x", dueDate: "2020-01-01" }, ctx)).toMatchObject({ code: "PAST_DATE", status: 422 });
    expect(await ops.add_reminder!({ title: "x", dueDate: "2099-01-01", dueTime: "3pm" }, ctx)).toMatchObject({ code: "BAD_TIME" });
    expect(await ops.add_reminder!({ dueDate: "2099-01-01" }, ctx)).toMatchObject({ code: "MISSING_TITLE" });
    expect(await ops.add_reminder!({ title: "x", dueDate: "2099-02-31" }, ctx)).toMatchObject({ code: "BAD_DATE" });
  });
  test("the same title+date twice is one reminder", async () => {
    await ops.add_reminder!({ title: "Call plumber", dueDate: "2099-10-09" }, ctx);
    const again: any = await ops.add_reminder!({ title: "call plumber", dueDate: "2099-10-09" }, ctx);
    expect(again.duplicate).toBe(true); expect(S.listActiveReminders().length).toBe(1);
  });
});

describe("cancel / snooze / list / note", () => {
  test("cancel by id withdraws any live row; by match needs one hit", async () => {
    const a: any = await ops.add_reminder!({ title: "Call plumber", dueDate: "2099-10-09" }, ctx);
    S.recordFire({ reminderId: a.id, occurrence: "2099-10-09", kind: "row", taskSourceRef: rowSourceRef(a.id, "2099-10-09"), sessionId: null, status: "ok" });
    expect(await ops.cancel_reminder!({ id: a.id }, ctx)).toMatchObject({ ok: true });
    expect(S.getReminder(a.id)!.state).toBe("cancelled");
    expect(withdrawn).toEqual([rowSourceRef(a.id, "2099-10-09")]);
    expect(await ops.cancel_reminder!({ match: "nothing like this" }, ctx)).toMatchObject({ code: "NOT_FOUND" });
  });
  test("a failed withdraw still cancels the reminder but reports 502", async () => {
    const a: any = await ops.add_reminder!({ title: "Call plumber", dueDate: "2099-10-09" }, ctx);
    S.recordFire({ reminderId: a.id, occurrence: "2099-10-09", kind: "row", taskSourceRef: rowSourceRef(a.id, "2099-10-09"), sessionId: null, status: "ok" });
    withdrawResult = { ok: false, reason: "x" };
    expect(await ops.cancel_reminder!({ id: a.id }, ctx)).toMatchObject({ code: "PLATFORM", status: 502 });
    expect(S.getReminder(a.id)!.state).toBe("cancelled");
  });
  test("snooze: an untimed reminder with a live row → platform snooze on that row; a timed one → reschedule in the app", async () => {
    const a: any = await ops.add_reminder!({ title: "Pay rent", dueDate: today() }, ctx);
    S.recordFire({ reminderId: a.id, occurrence: today(), kind: "row", taskSourceRef: rowSourceRef(a.id, today()), sessionId: null, status: "ok" });
    expect(await ops.snooze_reminder!({ match: "rent", untilDate: "2099-10-12" }, ctx)).toMatchObject({ ok: true, via: "row" });
    expect(snoozes[0]).toEqual({ ref: rowSourceRef(a.id, today()), untilDate: "2099-10-12" });
    const t: any = await ops.add_reminder!({ title: "Join webinar", dueDate: "2099-10-09", dueTime: "15:00" }, ctx);
    expect(await ops.snooze_reminder!({ id: t.id, untilDate: "2099-10-10" }, ctx)).toMatchObject({ ok: true, via: "reschedule" });
    expect(S.getReminder(t.id)!.dueDate).toBe("2099-10-10");
    expect(await ops.snooze_reminder!({ id: t.id, untilDate: "2001-01-01" }, ctx)).toMatchObject({ code: "PAST_DATE" });
  });
  test("list_upcoming merges reminders and events in date order within the window", async () => {
    await ops.add_reminder!({ title: "Renew visa", dueDate: "2099-10-12" }, ctx);
    S.upsertEvents("acct", [{ eventKey: "k", calendar: null, title: "Standup", startAt: null, endAt: null, allDay: true, localDate: "2099-10-10", attendeesText: null, location: null, rawTimeText: null }], 1);
    const r: any = await ops.list_upcoming!({ days: 36500 }, ctx);
    expect(r.items.map((i: any) => i.kind)).toEqual(["event", "reminder"]);
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
