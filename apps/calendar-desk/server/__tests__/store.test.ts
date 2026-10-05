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

describe("fact events", () => {
  const g = (k: string) => ({ eventKey: k, calendar: "primary", title: "Standup", startAt: null, endAt: null, allDay: true, localDate: "2026-10-06", attendeesText: null, location: null, rawTimeText: null });
  test("migration adds source, fact_id, source_link; existing rows are google", () => {
    const cols = (S._db.query("PRAGMA table_info(events)").all() as { name: string }[]);
    expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(["source", "fact_id", "source_link"]));
    S.upsertEvents("acct", [g("k1")], 1);
    expect(S.getEvent("acct", "k1")!.source).toBe("google");
  });
  test("insert, unchanged, update, delete; no account stored as ''", () => {
    const r = { accountId: "", factId: 12, title: "Flight 6E-512 BLR to MAA", localDate: "2026-10-08", startAt: null, sourceLink: null };
    expect(S.upsertFactEvent(r, 1)).toBe("inserted");
    expect(S.upsertFactEvent(r, 2)).toBe("unchanged");
    expect(S.upsertFactEvent({ ...r, localDate: "2026-10-09" }, 3)).toBe("updated");
    const [row] = S.listFactEvents();
    expect(row).toMatchObject({ accountId: "", eventKey: "fact:12", source: "fact", factId: 12, localDate: "2026-10-09", calendar: null });
    S.deleteFactEvent("", "fact:12");
    expect(S.listFactEvents()).toEqual([]);
  });
  test("a fact whose account changes moves: old row gone, one row left", () => {
    const r = { accountId: "a", factId: 5, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null };
    S.upsertFactEvent(r, 1);
    expect(S.upsertFactEvent({ ...r, accountId: "b" }, 2)).toBe("inserted");
    expect(S.listFactEvents().map((e) => e.accountId)).toEqual(["b"]);
  });
  test("a clean Google scrape never marks a fact event under the same account missing", () => {
    S.upsertFactEvent({ accountId: "acct", factId: 7, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null }, 1);
    expect(S.markMissingEvents("acct", ["2026-10-06"], [], 5)).toBe(0);
    expect(S.listFactEvents()[0].missingSince).toBeNull();
  });
  test("listEvents filters by source", () => {
    S.upsertEvents("acct", [g("g1")], 1);
    S.upsertFactEvent({ accountId: "acct", factId: 7, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null }, 1);
    expect(S.listEvents({ fromDate: "2026-10-06", toDate: "2026-10-06", source: "google" }).map((e) => e.eventKey)).toEqual(["g1"]);
    expect(S.listEvents({ fromDate: "2026-10-06", toDate: "2026-10-06" })).toHaveLength(2);
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
