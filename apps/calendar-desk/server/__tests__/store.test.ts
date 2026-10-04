import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-store-"));
const S = await import("../store");

function wipe() { for (const t of ["events", "event_notes", "preps", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); }
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

describe("schema and cursors", () => {
  test("the reminders and fires tables are dropped", () => {
    const names = (S._db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain("reminders"); expect(names).not.toContain("fires");
    expect(names).toEqual(expect.arrayContaining(["events", "event_notes", "preps", "cursors", "init_state"]));
  });
  test("cursors and init records", () => {
    expect(S.getCursor("some_cursor")).toBeNull();
    S.setCursor("some_cursor", "2026-10-05T00:00:00Z");
    expect(S.getCursor("some_cursor")).toBe("2026-10-05T00:00:00Z");
    S.markInitStarted("acct", "Reading your calendar");
    expect(S.listInit()[0].finishedAt).toBeNull();
    S.markInitFinished("acct", "done", "Calendar is set up");
    expect(S.listInit()[0].outcome).toBe("done");
  });
});
