import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-store-"));
const S = await import("../store");

function wipe() { for (const t of ["events", "event_notes", "reminders", "fires", "preps", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

describe("events", () => {
  test("upsert is keyed by (account, eventKey); a re-seen event keeps first_seen and clears missing", () => {
    const row = { eventKey: "k1", calendar: "primary", title: "Standup", startAt: 1, endAt: 2, allDay: false, localDate: "2026-10-05", attendeesText: null, location: null, rawTimeText: "9:30am" };
    expect(S.upsertEvents("acct", [row], 100)).toEqual({ inserted: 1, updated: 0 });
    expect(S.markMissingEvents("acct", ["2026-10-05"], [], 200)).toBe(1);
    expect(S.getEvent("acct", "k1")!.missingSince).toBe(200);
    expect(S.upsertEvents("acct", [row], 300)).toEqual({ inserted: 0, updated: 1 });
    const e = S.getEvent("acct", "k1")!;
    expect(e.firstSeenAt).toBe(100); expect(e.lastSeenAt).toBe(300); expect(e.missingSince).toBeNull();
  });
  test("listEvents hides missing rows unless asked and honours the date window", () => {
    S.upsertEvents("acct", [{ eventKey: "a", calendar: null, title: "A", startAt: null, endAt: null, allDay: true, localDate: "2026-10-05", attendeesText: null, location: null, rawTimeText: null },
                            { eventKey: "b", calendar: null, title: "B", startAt: null, endAt: null, allDay: true, localDate: "2026-10-20", attendeesText: null, location: null, rawTimeText: null }], 1);
    S.markMissingEvents("acct", ["2026-10-05"], [], 2);
    expect(S.listEvents({ fromDate: "2026-10-01", toDate: "2026-10-31" }).map((e) => e.eventKey)).toEqual(["b"]);
    expect(S.listEvents({ fromDate: "2026-10-01", toDate: "2026-10-31", includeMissing: true }).length).toBe(2);
  });
  test("a note survives the event vanishing", () => {
    S.setEventNote("acct", "k9", "ask about the discount", "user");
    expect(S.getEventNote("acct", "k9")!.note).toBe("ask about the discount");
  });
});

describe("reminders and fires", () => {
  const base = { id: "rem_1", title: "Call plumber", body: null, dueDate: "2026-10-09", dueTime: null, recurrence: "none" as const, leadDays: [0], sourceKind: "user" as const, sourceRef: null, sourceLink: null, accountId: null, state: "active" as const };
  test("insert, find by title+date (case-insensitive), by sourceRef, search", () => {
    S.insertReminder(base);
    S.insertReminder({ ...base, id: "rem_2", title: "Renew visa", sourceKind: "fact", sourceRef: "fact:42" });
    expect(S.findActiveReminderByTitleDate("call PLUMBER", "2026-10-09")!.id).toBe("rem_1");
    expect(S.findReminderBySourceRef("fact:42")!.id).toBe("rem_2");
    expect(S.searchActiveReminders("plumb").map((r) => r.id)).toEqual(["rem_1"]);
    expect(S.listActiveReminders().length).toBe(2);
  });
  test("leadDays round-trips as JSON; update patches and bumps updated_at", () => {
    S.insertReminder({ ...base, leadDays: [14, 3, 0] });
    expect(S.getReminder("rem_1")!.leadDays).toEqual([14, 3, 0]);
    const u = S.updateReminder("rem_1", { state: "cancelled" })!;
    expect(u.state).toBe("cancelled");
    expect(S.listActiveReminders().length).toBe(0);
  });
  test("a fire is unique per (reminder, occurrence, kind)", () => {
    S.recordFire({ reminderId: "rem_1", occurrence: "2026-10-09", kind: "row", taskSourceRef: "rem|rem_1|2026-10-09", sessionId: null, status: "ok" });
    S.recordFire({ reminderId: "rem_1", occurrence: "2026-10-09", kind: "row", taskSourceRef: "rem|rem_1|2026-10-09", sessionId: null, status: "ok" });
    expect(S.listFiresOn("2026-10-09").length).toBe(1);
    expect(S.getFire("rem_1", "2026-10-09", "chat")).toBeNull();
  });
  test("cursors and init records", () => {
    expect(S.getCursor("facts_since")).toBeNull();
    S.setCursor("facts_since", "2026-10-05T00:00:00Z");
    expect(S.getCursor("facts_since")).toBe("2026-10-05T00:00:00Z");
    S.markInitStarted("acct", "Reading your calendar");
    expect(S.listInit()[0].finishedAt).toBeNull();
    S.markInitFinished("acct", "done", "Calendar is set up");
    expect(S.listInit()[0].outcome).toBe("done");
  });
});
